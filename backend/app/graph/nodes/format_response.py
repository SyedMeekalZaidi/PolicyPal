# Format Response node — last node before END.
#
# Single responsibility: update the conversation_docs registry with titles
# for all documents resolved this turn, so subsequent turns can resolve
# implicit references ("that document", "it", etc.) without LLM confusion.
#
# Action nodes own retrieval + generation.
# This node owns: registry maintenance + future cost aggregation / citation dedup.
# Adding either later means touching ONLY this file.

import logging

from app.graph.state import AgentState
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)


def _fetch_doc_titles(doc_ids: list[str]) -> dict[str, str]:
    """
    Fetch { title: uuid } pairs for the given document IDs.
    Returns empty dict on empty input or Supabase error.
    """
    if not doc_ids:
        return {}
    try:
        resp = (
            get_supabase()
            .table("documents")
            .select("id, title")
            .in_("id", doc_ids)
            .execute()
        )
        return {row["title"]: row["id"] for row in (resp.data or [])}
    except Exception as e:
        logger.error("format_response | Supabase title fetch failed: %s", e)
        return {}


def format_response(state: AgentState) -> dict:
    """
    LangGraph node: update conversation_docs registry after each turn.

    Returns partial state: { "conversation_docs": merged_registry }
    """
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    existing_registry: dict[str, str] = state.get("conversation_docs") or {}

    # Fetch titles for all documents resolved this turn
    new_pairs = _fetch_doc_titles(resolved_doc_ids)

    # Merge: existing entries preserved, new entries added/updated
    # dict unpacking: new_pairs takes precedence (handles title renames)
    merged_registry = {**existing_registry, **new_pairs}

    if new_pairs:
        logger.info(
            "format_response | registry +%d entries (total %d): %s",
            len(new_pairs), len(merged_registry), list(new_pairs.keys()),
        )
    else:
        logger.info(
            "format_response | no new docs to register (resolved_doc_ids=%s)",
            resolved_doc_ids,
        )

    return {"conversation_docs": merged_registry}
