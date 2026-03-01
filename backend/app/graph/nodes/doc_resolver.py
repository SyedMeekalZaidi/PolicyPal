# Doc Resolver node — 3-stage document resolution pipeline.
#
# Stage 1 — Python pre-processor (free):
#   Walk TipTap JSON → extract explicit UUIDs + labels.
#   If message is a "pure mention" (no free text) → return immediately ($0).
#   Determine LLM context scope: cheap (registry hit) vs history (pronouns/unknown).
#
# Stage 2 — One LLM call (right-sized context):
#   Resolve all document references (explicit + implicit) using the conversation_docs registry.
#   Merge explicit UUIDs with LLM-resolved UUIDs.
#
# Stage 3 — Python fuzzy match (only if unresolved_names present):
#   Supabase lookup → rapidfuzz WRatio ≥ 85 → add to resolved_doc_ids.
#
# Stage 4 — Interrupt gates (Phase 3):
#   medium confidence + candidates  → doc_choice interrupt (which doc?)
#   low confidence + unresolved     → text_input interrupt (please @tag a doc)
#
# IDEMPOTENCY: LLM call runs on both first call and resume (temperature=0 → deterministic).
# interrupt() returns the resume value on re-run. Code after interrupt() is resume-path only.

import json
import logging
import uuid as _uuid_mod
from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field
from rapidfuzz import fuzz, process

from app.graph.state import CANCEL_SENTINEL, AgentState
from app.services.llm_service import get_llm_service
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_FUZZY_THRESHOLD = 85  # WRatio score — empirically calibrated

# ---------------------------------------------------------------------------
# Pydantic schema for LLM structured output
# ---------------------------------------------------------------------------

_ACTION_HINTS: dict[str, str] = {
    "summarize": "expects 1+ documents to summarize",
    "inquire": "expects 0+ documents to query (may be general knowledge)",
    "compare": "expects 2+ documents for side-by-side comparison",
    "audit": "expects source text to audit + 1+ target regulation documents",
}

_SYSTEM_PROMPT_TEMPLATE = """You are a document resolver for PolicyPal, a compliance document AI assistant.

Your job: given the user's message, identify EVERY document they are referencing — both explicit @mentions and implicit references ("it", "that document", "the policy", "BankNegara", etc.).

DOCUMENT REGISTRY (documents seen in this conversation — use EXACT UUIDs from this list):
{registry_block}

ACTION: {action} — {action_hint}

ALREADY EXPLICITLY TAGGED (do NOT re-add these to resolved_uuids — they are already confirmed):
{explicit_block}

INSTRUCTIONS:
1. Look for references in the user's message(s) to any document in the registry.
2. For each reference you can match: add its UUID to resolved_uuids.
3. For each reference you CANNOT match (unknown name, unclear pronoun with no prior context): add the name/phrase to unresolved_names.
4. Set has_implicit_refs=true if any resolved doc was NOT explicitly @mentioned.
5. Confidence: high = certain match, medium = probable match, low = guessing or registry is empty.
6. NEVER invent UUIDs. Only use UUIDs from the registry above."""


class DocResolution(BaseModel):
    resolved_uuids: list[str] = Field(
        description="UUIDs from the registry that the user is implicitly referencing (excludes explicit @mentions)"
    )
    unresolved_names: list[str] = Field(
        description="Reference names/phrases the LLM could not match to any registry entry"
    )
    inference_confidence: Literal["high", "medium", "low"] = Field(
        description="How confident the LLM is in the resolved documents"
    )
    has_implicit_refs: bool = Field(
        description="True if any resolved document was NOT explicitly @mentioned by the user"
    )
    reasoning: str = Field(
        description="Brief explanation for LangSmith debugging (never shown to user)"
    )


# ---------------------------------------------------------------------------
# Stage 1 helpers — TipTap JSON walker
# ---------------------------------------------------------------------------


def _walk_tiptap(tiptap_json: dict) -> tuple[dict[str, str], str]:
    """
    Recursively walk TipTap JSON.

    Returns:
        doc_mentions: { uuid: label } for every document @mention found
        free_text: concatenated text from pure text nodes (no mention labels)
    """
    doc_mentions: dict[str, str] = {}
    text_parts: list[str] = []

    def _walk(node: dict) -> None:
        node_type = node.get("type", "")
        if node_type == "mention":
            attrs = node.get("attrs") or {}
            if attrs.get("category") == "document":
                uid = attrs.get("id", "")
                label = attrs.get("label", attrs.get("id", ""))
                if uid:
                    doc_mentions[uid] = label
            # Don't collect mention text as free text
            return

        if node_type == "text":
            text = node.get("text", "")
            text_parts.append(text)

        for child in node.get("content", []):
            _walk(child)

    _walk(tiptap_json)
    return doc_mentions, "".join(text_parts)


def _is_pure_mention(free_text: str) -> bool:
    """True if the message has no meaningful free text (only @mentions)."""
    return not free_text.strip()


# ---------------------------------------------------------------------------
# Stage 3 helper — Supabase + rapidfuzz
# ---------------------------------------------------------------------------


def _fetch_user_docs(user_id: str) -> list[dict]:
    """Fetch all document id+title pairs for a user. Used for fuzzy matching."""
    try:
        resp = (
            get_supabase()
            .table("documents")
            .select("id, title")
            .eq("user_id", user_id)
            .eq("status", "ready")
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.error("doc_resolver | Supabase fetch failed: %s", e)
        return []


def _fuzzy_match(
    unresolved_names: list[str], all_docs: list[dict]
) -> tuple[list[str], list[str]]:
    """
    Match unresolved names against all user documents using WRatio.

    Returns:
        matched_uuids: UUIDs that crossed the threshold
        still_unresolved: names that had no good match
    """
    if not all_docs or not unresolved_names:
        return [], unresolved_names

    titles = [d["title"] for d in all_docs]
    title_to_uuid = {d["title"]: d["id"] for d in all_docs}

    matched_uuids: list[str] = []
    still_unresolved: list[str] = []

    for name in unresolved_names:
        result = process.extractOne(name, titles, scorer=fuzz.WRatio)
        if result and result[1] >= _FUZZY_THRESHOLD:
            matched_title = result[0]
            matched_uuids.append(title_to_uuid[matched_title])
            logger.info(
                "doc_resolver | fuzzy match: %r -> %r (score=%.1f)",
                name, matched_title, result[1],
            )
        else:
            still_unresolved.append(name)
            logger.info(
                "doc_resolver | fuzzy no-match: %r (best score=%.1f)",
                name, result[1] if result else 0,
            )

    return matched_uuids, still_unresolved


# ---------------------------------------------------------------------------
# Stage 2 helper — build LLM prompt
# ---------------------------------------------------------------------------


def _build_llm_messages(
    conversation_docs: dict[str, str],
    explicit_uuids: list[str],
    doc_mentions: dict[str, str],
    action: str,
    latest_message: str,
    context_messages: list,
) -> list:
    """Construct the messages list for the doc resolution LLM call."""
    # Registry block — sorted for determinism
    if conversation_docs:
        registry_lines = [
            f'- "{title}" -> UUID: {uuid}'
            for title, uuid in sorted(conversation_docs.items())
        ]
        registry_block = "\n".join(registry_lines)
    else:
        registry_block = "(empty — this is the user's first message, no prior documents)"

    # Explicit block — prefer TipTap label (human-readable) over registry/UUID fallback
    if explicit_uuids:
        explicit_lines = [
            f"- UUID: {uid} "
            f'("{doc_mentions.get(uid) or next((t for t, u in conversation_docs.items() if u == uid), uid)}")'
            for uid in explicit_uuids
        ]
        explicit_block = "\n".join(explicit_lines)
    else:
        explicit_block = "(none)"

    action_hint = _ACTION_HINTS.get(action, "")
    system_content = _SYSTEM_PROMPT_TEMPLATE.format(
        registry_block=registry_block,
        action=action,
        action_hint=action_hint,
        explicit_block=explicit_block,
    )

    messages: list = [SystemMessage(content=system_content)]
    # Prepend context messages (last 5 from history) if available
    messages.extend(context_messages)
    messages.append(HumanMessage(content=latest_message))
    return messages


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


def doc_resolver(state: AgentState) -> dict:
    """
    LangGraph node: resolve which documents the user is referencing.
    Returns partial state update with resolved_doc_ids, confidence, and metadata.
    """
    tiptap_json = state.get("tiptap_json") or {}
    conversation_docs: dict[str, str] = state.get("conversation_docs") or {}
    action = state.get("action") or "inquire"
    user_id = state.get("user_id") or ""
    messages = state.get("messages") or []

    # ── Stage 1a: Extract explicit mentions from TipTap JSON ─────────────────
    doc_mentions, free_text = _walk_tiptap(tiptap_json)
    explicit_uuids = list(doc_mentions.keys())

    # Fallback: if tiptap_json was empty, use state's explicit_doc_ids
    if not explicit_uuids and state.get("explicit_doc_ids"):
        explicit_uuids = list(state["explicit_doc_ids"])

    logger.info(
        "doc_resolver | explicit_uuids=%s free_text=%r",
        explicit_uuids, free_text[:80],
    )

    # ── Stage 1b: Pure mention shortcut ($0) ──────────────────────────────────
    if _is_pure_mention(free_text) and explicit_uuids:
        logger.info("doc_resolver | pure mention shortcut — skipping LLM")
        # resolved_doc_titles built directly from TipTap labels — doc_mentions has
        # {uuid: label} for all @mentioned docs, which is the most accurate source.
        return {
            "resolved_doc_ids": explicit_uuids,
            "inference_source": "explicit",
            "inference_confidence": "high",
            "has_implicit_refs": False,
            "inferred_doc_ids": [],
            "unresolved_names": [],
            "inference_reasoning": "All documents explicitly @mentioned, no free text.",
            "suggested_doc_ids": [],
            "clean_query": "",
            "resolved_doc_titles": {uid: label for uid, label in doc_mentions.items()},
        }

    # ── Stage 1c: Determine context scope ─────────────────────────────────────
    # Registry hit → only latest message; pronoun/unknown → 5 messages of history
    registry_keys_lower = {k.lower() for k in conversation_docs}
    has_registry_hit = any(
        key in free_text.lower() for key in registry_keys_lower
    )

    if has_registry_hit or not conversation_docs:
        # Cheap path: no prior context needed
        context_messages: list = []
        logger.info("doc_resolver | context=cheap (registry hit=%s)", has_registry_hit)
    else:
        # History path: include last 5 non-system messages for disambiguation
        context_messages = [
            m for m in messages[-6:-1]
            if not isinstance(m, SystemMessage)
        ]
        logger.info("doc_resolver | context=history (%d msgs)", len(context_messages))

    # Send full raw message to LLM — includes @mention labels so it can reason
    # accurately about explicit tags ("user tagged @Muscle Building Guide").
    # The ALREADY EXPLICITLY TAGGED block in the prompt prevents double-counting.
    latest_message_text = (
        str(messages[-1].content) if messages else free_text
    )

    # ── Stage 2: LLM call ─────────────────────────────────────────────────────
    llm_messages = _build_llm_messages(
        conversation_docs=conversation_docs,
        explicit_uuids=explicit_uuids,
        doc_mentions=doc_mentions,
        action=action,
        latest_message=latest_message_text,
        context_messages=context_messages,
    )

    llm = get_llm_service()
    resolution = llm.invoke_structured("doc_resolution", DocResolution, llm_messages).parsed

    logger.info(
        "doc_resolver | LLM: resolved=%s unresolved=%s confidence=%s | %s",
        resolution.resolved_uuids, resolution.unresolved_names,
        resolution.inference_confidence, resolution.reasoning[:120],
    )

    # Validate: only accept UUIDs that exist in the registry or explicit tags
    # Prevents LLM hallucinated UUIDs from entering the pipeline
    known_uuids = set(conversation_docs.values()) | set(explicit_uuids)
    validated_llm_uuids = [
        uid for uid in resolution.resolved_uuids
        if uid in known_uuids
    ]
    if len(validated_llm_uuids) < len(resolution.resolved_uuids):
        hallucinated = set(resolution.resolved_uuids) - set(validated_llm_uuids)
        logger.warning("doc_resolver | filtered hallucinated UUIDs: %s", hallucinated)

    # Merge: explicit ∪ LLM-resolved (deduplicated)
    merged_uuids = list(dict.fromkeys(explicit_uuids + validated_llm_uuids))

    # ── Stage 3: Fuzzy match for unresolved names ──────────────────────────────
    remaining_unresolved = resolution.unresolved_names
    inference_source = "inferred" if validated_llm_uuids or not explicit_uuids else "explicit"

    # Initialized here so it's always in scope when building resolved_doc_titles below,
    # even when the fuzzy block never runs (avoids NameError on the title lookup).
    all_docs: list[dict] = []

    if remaining_unresolved and user_id:
        all_docs = _fetch_user_docs(user_id)
        fuzzy_uuids, remaining_unresolved = _fuzzy_match(remaining_unresolved, all_docs)

        if fuzzy_uuids:
            merged_uuids = list(dict.fromkeys(merged_uuids + fuzzy_uuids))
            inference_source = "fuzzy_match"
            logger.info("doc_resolver | fuzzy added %d UUIDs", len(fuzzy_uuids))

    # Build {uuid: title} from data already in memory — zero extra DB calls.
    # Priority: TipTap label (current turn) → registry (history) → fuzzy DB fetch → UUID fallback.
    # Must run AFTER the fuzzy block so merged_uuids is fully populated.
    _uuid_to_title = {v: k for k, v in conversation_docs.items()}
    _fuzzy_titles = {d["id"]: d["title"] for d in all_docs}
    resolved_doc_titles: dict[str, str] = {
        uid: (
            doc_mentions.get(uid)
            or _uuid_to_title.get(uid)
            or _fuzzy_titles.get(uid)
            or uid
        )
        for uid in merged_uuids
    }

    # suggested_doc_ids: LLM's best guesses for PalAssist (medium/low confidence)
    suggested_doc_ids = validated_llm_uuids if resolution.inference_confidence != "high" else []

    # Base result — shared by normal path and all interrupt resume paths
    base_result = {
        "resolved_doc_ids": merged_uuids,
        "inference_source": inference_source,
        "inference_confidence": resolution.inference_confidence,
        "has_implicit_refs": resolution.has_implicit_refs,
        "inferred_doc_ids": validated_llm_uuids,
        "unresolved_names": remaining_unresolved,
        "inference_reasoning": resolution.reasoning,
        "suggested_doc_ids": suggested_doc_ids,
        "clean_query": free_text.strip(),
        "resolved_doc_titles": resolved_doc_titles,
    }

    # ── Stage 4: Interrupt gates ───────────────────────────────────────────────
    # _uuid_to_title already built above for resolved_doc_titles; reused here.

    # Gate 1 — Medium confidence: multiple candidate docs, user must choose
    if resolution.inference_confidence == "medium" and suggested_doc_ids:
        options = []
        for uid in suggested_doc_ids:
            # doc_mentions has label from @mention; registry has historical title
            label = doc_mentions.get(uid) or _uuid_to_title.get(uid) or uid
            options.append({"id": uid, "label": label})
        options.append({"id": "all", "label": "All of these"})

        _action_verbs = {
            "summarize": "summarize", "compare": "compare",
            "audit": "audit against", "inquire": "query",
        }
        action_verb = _action_verbs.get(action, "use")

        logger.info(
            "doc_resolver | medium confidence — interrupting. candidates=%s",
            suggested_doc_ids,
        )
        resume_val = interrupt({
            "interrupt_type": "doc_choice",
            "message": f"Which document would you like to {action_verb}?",
            "options": options,
        })
        # ── RESUME PATH ONLY ──────────────────────────────────────────────────
        if resume_val in (None, CANCEL_SENTINEL):
            msg = (
                f"I can't proceed with {action.capitalize()} without a specific document. "
                "Please @tag a document and try again for optimal results."
            )
            logger.info("doc_resolver | doc_choice cancel → stopping with feedback")
            return Command(
                update={**base_result, "inference_confidence": "low", "response": msg, "messages": [AIMessage(content=msg)]},
                goto="format_response",
            )

        if resume_val == "all":
            final_ids = list(dict.fromkeys(merged_uuids + suggested_doc_ids))
        else:
            final_ids = list(dict.fromkeys(merged_uuids + [resume_val]))

        logger.info("doc_resolver | doc_choice resume=%r → resolved=%s", resume_val, final_ids)
        return {**base_result, "resolved_doc_ids": final_ids, "inference_confidence": "high"}

    # Gate 2 — Low confidence: unresolvable references, user must tag the doc.
    # Skip if explicit tags already gave us documents — unresolved pronouns are
    # irrelevant when the user has already told us which document(s) to use.
    if resolution.inference_confidence == "low" and remaining_unresolved and not merged_uuids:
        logger.info(
            "doc_resolver | low confidence, unresolved=%s — interrupting for @tag",
            remaining_unresolved,
        )
        resume_val = interrupt({
            "interrupt_type": "text_input",
            "message": "I couldn't find the document you're referring to. Please @tag the document you'd like to use.",
            "options": None,
        })
        # ── RESUME PATH ONLY ──────────────────────────────────────────────────
        if resume_val in (None, CANCEL_SENTINEL):
            msg = (
                f"I can't proceed with {action.capitalize()} without a specific document. "
                "Please @tag a document and try again for optimal results."
            )
            logger.info("doc_resolver | text_input cancel → stopping with feedback")
            return Command(
                update={**base_result, "inference_confidence": "low", "response": msg, "messages": [AIMessage(content=msg)]},
                goto="format_response",
            )

        # Resume value should be a UUID from an @mention
        is_valid_uuid = False
        try:
            _uuid_mod.UUID(str(resume_val))
            is_valid_uuid = True
        except (ValueError, AttributeError):
            pass

        if is_valid_uuid:
            final_ids = list(dict.fromkeys(merged_uuids + [resume_val]))
            logger.info("doc_resolver | text_input resume → added UUID=%s", resume_val)
            return {**base_result, "resolved_doc_ids": final_ids, "inference_confidence": "high"}
        else:
            logger.warning(
                "doc_resolver | text_input resume non-UUID: %r — proceeding without it", resume_val
            )
            return {**base_result, "inference_confidence": "low"}

    # ── Normal path (no interrupt needed) ────────────────────────────────────
    return base_result
