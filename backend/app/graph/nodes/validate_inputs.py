# Validate Inputs node — pure Python validation gate, $0 cost.
#
# Checks action-specific document requirements and cleans up flags.
# Pure Python — re-running on resume is free (no LLM, no idempotency concerns).
#
# Also handles set_id expansion: if the user @mentioned a document set,
# this node fetches all ready documents in that set and merges them into
# resolved_doc_ids before the action node runs.
#
# Interrupt gate:
#   Gate 1: insufficient docs for action → text_input (tag a doc)
#
# NOTE: Audit Gate 2 (source text validation) lives in audit.py, not here.
# validate_inputs cannot know whether audit is text mode or policy mode — that
# determination requires a DB query that only audit_action performs.

import logging
import uuid as _uuid_mod

from langchain_core.messages import AIMessage
from langgraph.types import Command, interrupt

from app.graph.state import CANCEL_SENTINEL, AgentState
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Minimum resolved_doc_ids count per action
_DOC_REQUIREMENTS: dict[str, int] = {
    "summarize": 1,
    "inquire": 0,   # can be general knowledge or web-only
    "compare": 2,
    "audit": 1,     # always needs 1+ target regulatory doc; source is doc or user text (checked in audit.py)
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
    # These actions operate only on uploaded docs — web search is not applicable
    if action in ("compare", "summarize", "audit") and enable_web_search:
        logger.info(
            "validate_inputs | %s + web_search=True -> dropping web search flag (not applicable)",
            action,
        )
        result["enable_web_search"] = False

    # ── Action-specific doc count validation ───────────────────────────────────
    min_docs = _DOC_REQUIREMENTS.get(action, 0)
    actual_docs = len(resolved_doc_ids)

    logger.info(
        "validate_inputs | action=%s docs=%d/%d required",
        action, actual_docs, min_docs,
    )

    # ── Gate 1 — Insufficient documents for the action ────────────────────────
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

    return result
