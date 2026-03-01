# Format Response node — last node before END.
#
# Responsibilities:
#   1. Update conversation_docs registry (title→UUID map for implicit reference resolution)
#   2. Embed retrieval metadata into the AIMessage's additional_kwargs so history
#      reload can show confidence badges, cost, and citations without re-computation.
#
# Metadata is injected by cloning the last AIMessage with the same id.
# The add_messages reducer detects the matching id and REPLACES instead of appending,
# so the checkpoint contains exactly one AI message per turn with full metadata.

import logging

from langchain_core.messages import AIMessage
from langsmith import traceable

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


@traceable(run_type="chain", name="format_response")
def format_response(state: AgentState) -> dict:
    """
    LangGraph node: update conversation_docs registry and embed metadata into AIMessage.

    Returns partial state: { "conversation_docs": merged_registry, "messages": [updated_ai_msg] }
    The messages entry uses same-id replacement so the checkpoint has one AI message per turn.
    """
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    existing_registry: dict[str, str] = state.get("conversation_docs") or {}

    # ── 1. Update conversation_docs registry ──────────────────────────────────
    new_pairs = _fetch_doc_titles(resolved_doc_ids)
    merged_registry = {**existing_registry, **new_pairs}

    if new_pairs:
        logger.info(
            "format_response | registry +%d entries (total %d): %s",
            len(new_pairs), len(merged_registry), list(new_pairs.keys()),
        )
    else:
        logger.info(
            "format_response | no new docs (resolved_doc_ids=%s)", resolved_doc_ids,
        )

    result: dict = {"conversation_docs": merged_registry}

    # ── 2. Inject retrieval metadata into the last AIMessage ──────────────────
    # Find the last AIMessage written by the action node this turn.
    last_ai_msg: AIMessage | None = None
    for msg in reversed(state.get("messages") or []):
        if isinstance(msg, AIMessage):
            last_ai_msg = msg
            break

    if last_ai_msg is None:
        # Cancel flow or stub node — no AIMessage to enrich, skip injection
        logger.info("format_response | no AIMessage found — skipping metadata injection")
        return result

    # Build merged additional_kwargs — preserve any existing keys, add/overwrite metadata
    updated_kwargs = {
        **last_ai_msg.additional_kwargs,
        "retrieval_confidence": state.get("retrieval_confidence") or "low",
        "cost_usd": state.get("cost_usd") or 0.0,
        "tokens_used": state.get("tokens_used") or 0,
        "citations": state.get("citations") or [],
        "action": state.get("action") or "inquire",
    }

    # Clone with the SAME id → add_messages reducer replaces instead of appending
    updated_ai_msg = last_ai_msg.model_copy(update={"additional_kwargs": updated_kwargs})

    logger.info(
        "format_response | metadata injected: confidence=%s tokens=%d cost=$%.6f citations=%d",
        updated_kwargs["retrieval_confidence"],
        updated_kwargs["tokens_used"],
        updated_kwargs["cost_usd"],
        len(updated_kwargs["citations"]),
    )

    result["messages"] = [updated_ai_msg]
    return result
