# Stub Action nodes — placeholder responses for all four action types.
#
# Each function is a separate graph node (separate LangSmith trace,
# separate PalReasoning status entry). Iterations 2-3 replace each stub
# body with real RAG retrieval logic — function signatures stay the same.
#
# Why AIMessage in the return dict:
#   The add_messages reducer APPENDS the AIMessage to conversation history.
#   PostgresSaver persists it so the next turn has the full exchange in context.
#   Without this, history would contain only HumanMessages.

import logging

from langchain_core.messages import AIMessage, HumanMessage

from app.graph.state import AgentState

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------


def _build_stub_response(action: str, state: AgentState) -> dict:
    """
    Shared stub response builder.  All four action stubs call this.

    Returns a full partial-state dict ready to be returned from a graph node.
    """
    messages = state.get("messages") or []
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    enable_web_search: bool = state.get("enable_web_search") or False

    # Latest human message text (fallback to empty string)
    last_message = ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            last_message = str(msg.content)
            break

    doc_summary = (
        f"{len(resolved_doc_ids)} doc(s): {resolved_doc_ids}"
        if resolved_doc_ids
        else "no documents resolved"
    )

    response_parts = [
        f"[{action.upper()} — coming soon]",
        f"Query: {last_message[:200]}",
        f"Resolved: {doc_summary}",
    ]

    # Web search stub note — real Tavily call added in future iteration
    web_search_query: str | None = None
    if enable_web_search:
        web_search_query = last_message[:200]
        response_parts.append(
            f"[Web search would be performed here for: {web_search_query!r}]"
        )

    response = " | ".join(response_parts)

    logger.info(
        "stub_%s | docs=%d web_search=%s",
        action, len(resolved_doc_ids), enable_web_search,
    )

    result: dict = {
        "response": response,
        "citations": [],
        "retrieved_chunks": [],
        "retrieval_confidence": "high",   # hardcoded for stubs
        "confidence_score": 1.0,
        "tokens_used": 0,
        "cost_usd": 0.0,
        "messages": [AIMessage(content=response)],  # persisted via add_messages reducer
    }

    if web_search_query is not None:
        result["web_search_query"] = web_search_query

    return result


# ---------------------------------------------------------------------------
# Action nodes — each is a separate graph node
# ---------------------------------------------------------------------------


def summarize_action(state: AgentState) -> dict:
    """Stub: summarize one or more documents."""
    return _build_stub_response("summarize", state)


def inquire_action(state: AgentState) -> dict:
    """Stub: answer a specific question about document content."""
    return _build_stub_response("inquire", state)


def compare_action(state: AgentState) -> dict:
    """Stub: compare differences across 2+ documents."""
    return _build_stub_response("compare", state)


def audit_action(state: AgentState) -> dict:
    """Stub: audit source text against regulation documents."""
    return _build_stub_response("audit", state)
