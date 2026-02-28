# Validate Inputs node — pure Python validation gate, $0 cost.
#
# Checks action-specific document requirements and cleans up flags.
# Pure Python — re-running on resume is free (no LLM, no idempotency concerns).
#
# Also handles set_id expansion: if the user @mentioned a document set,
# this node fetches all ready documents in that set and merges them into
# resolved_doc_ids before the action node runs.
#
# Interrupt gates (Phase 3):
#   Gate 1: insufficient docs for action  → text_input (tag a doc)
#   Gate 2: audit with no source text     → text_input (provide audit text)
#   Gates are elif — mutually exclusive on each pass.

import logging
import re
import uuid as _uuid_mod

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command, interrupt

from app.graph.state import CANCEL_SENTINEL, AgentState
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Minimum resolved_doc_ids count per action
_DOC_REQUIREMENTS: dict[str, int] = {
    "summarize": 1,
    "inquire": 0,   # can be general knowledge or web-only
    "compare": 2,
    "audit": 1,     # source text is in the message; needs 1+ target regulation doc
}


def _fetch_set_doc_ids(set_id: str, user_id: str) -> list[str]:
    """Return all ready document IDs belonging to the given set and user."""
    try:
        resp = (
            get_supabase()
            .table("documents")
            .select("id")
            .eq("set_id", set_id)
            .eq("user_id", user_id)
            .eq("status", "ready")
            .execute()
        )
        return [row["id"] for row in (resp.data or [])]
    except Exception as e:
        logger.error("validate_inputs | set_id fetch failed (set=%s): %s", set_id, e)
        return []


def _is_audit_text_missing(state: AgentState) -> bool:
    """
    True if the last human message has no substantial free text for auditing.

    Audit requires a policy/email excerpt. If the message is only @mentions
    (mentions get label text prepended), the remaining text will be very short.
    Heuristic: strip @word tokens; if < 50 chars remain, treat as missing.
    """
    messages = state.get("messages") or []
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            # Strip @mention label tokens (e.g. "Audit", "DocTitle") — these come
            # from TipTap mention rendering, not the user's actual audit text
            cleaned = re.sub(r"@\S+", "", content).strip()
            return len(cleaned) < 50
    return True


def validate_inputs(state: AgentState) -> dict:
    """
    LangGraph node: validate action requirements and clean up flags.
    Returns partial state update (may be empty if nothing changed).
    """
    action = state.get("action") or "inquire"
    resolved_doc_ids: list[str] = list(state.get("resolved_doc_ids") or [])
    enable_web_search: bool = state.get("enable_web_search") or False
    set_id: str | None = state.get("set_id")
    user_id: str = state.get("user_id") or ""

    result: dict = {}

    # ── Set ID expansion: fetch all docs in the set and merge ─────────────────
    if set_id and user_id:
        set_doc_ids = _fetch_set_doc_ids(set_id, user_id)
        if set_doc_ids:
            merged = list(dict.fromkeys(resolved_doc_ids + set_doc_ids))
            if merged != resolved_doc_ids:
                logger.info(
                    "validate_inputs | set_id=%s added %d docs -> total %d",
                    set_id, len(set_doc_ids), len(merged),
                )
                resolved_doc_ids = merged
                result["resolved_doc_ids"] = resolved_doc_ids

    # ── Web search cleanup ─────────────────────────────────────────────────────
    # Compare is always between uploaded docs — web search is meaningless here
    if action == "compare" and enable_web_search:
        logger.info("validate_inputs | compare + web_search=True -> dropping web search flag")
        result["enable_web_search"] = False

    # ── Action-specific doc count validation ───────────────────────────────────
    min_docs = _DOC_REQUIREMENTS.get(action, 0)
    actual_docs = len(resolved_doc_ids)

    logger.info(
        "validate_inputs | action=%s docs=%d/%d required",
        action, actual_docs, min_docs,
    )

    # ── Interrupt gates ────────────────────────────────────────────────────────
    # Gates are elif — only one fires per pass. Pure Python, no cost on re-run.

    # Gate 1 — Insufficient documents for the action
    if actual_docs < min_docs:
        if action == "compare":
            msg = "Compare requires at least 2 documents. Please @tag the additional document."
        elif action == "summarize":
            msg = "Please @tag the document you'd like to summarize."
        else:  # audit — needs 1 target regulation doc
            msg = "Please @tag the regulation document you'd like to audit against."

        logger.info(
            "validate_inputs | Gate 1: %s needs %d docs, got %d — interrupting",
            action, min_docs, actual_docs,
        )
        resume_val = interrupt({
            "interrupt_type": "text_input",
            "message": msg,
            "options": None,
        })
        # ── RESUME PATH ONLY ──────────────────────────────────────────────────
        if resume_val not in (None, CANCEL_SENTINEL):
            is_valid_uuid = False
            try:
                _uuid_mod.UUID(str(resume_val))
                is_valid_uuid = True
            except (ValueError, AttributeError):
                pass

            if is_valid_uuid:
                resolved_doc_ids = list(dict.fromkeys(resolved_doc_ids + [resume_val]))
                result["resolved_doc_ids"] = resolved_doc_ids
                logger.info(
                    "validate_inputs | Gate 1 resume: added UUID=%s → total=%d docs",
                    resume_val, len(resolved_doc_ids),
                )
            else:
                logger.warning(
                    "validate_inputs | Gate 1 resume: non-UUID value %r — ignoring", resume_val
                )
        else:
            if action == "compare":
                cancel_msg = "Compare requires at least 2 documents. Please @tag them and try again."
            elif action == "summarize":
                cancel_msg = "I need a document to summarize. Please @tag a document and try again."
            else:
                cancel_msg = f"I need a regulation document to run {action.capitalize()}. Please @tag one and try again."
            logger.info("validate_inputs | Gate 1 cancel → stopping with feedback")
            return Command(
                update={**result, "response": cancel_msg, "messages": [AIMessage(content=cancel_msg)]},
                goto="format_response",
            )

    # Gate 2 — Audit action with no meaningful source text in the message
    elif action == "audit" and _is_audit_text_missing(state):
        logger.info("validate_inputs | Gate 2: audit source text missing — interrupting")
        resume_val = interrupt({
            "interrupt_type": "text_input",
            "message": "Please enter the text you'd like to audit (e.g. an email or policy excerpt).",
            "options": None,
        })
        # ── RESUME PATH ONLY ──────────────────────────────────────────────────
        if resume_val not in (None, CANCEL_SENTINEL):
            # Append the user's audit text as a new message so action nodes can find it.
            # add_messages reducer will append this to the conversation history.
            result["messages"] = [HumanMessage(content=str(resume_val))]
            logger.info(
                "validate_inputs | Gate 2 resume: source text added (%d chars)", len(str(resume_val))
            )
        else:
            cancel_msg = (
                "I need the text you'd like to audit. "
                "Please include it in your next message along with a @tagged regulation document."
            )
            logger.info("validate_inputs | Gate 2 cancel → stopping with feedback")
            return Command(
                update={**result, "response": cancel_msg, "messages": [AIMessage(content=cancel_msg)]},
                goto="format_response",
            )

    return result
