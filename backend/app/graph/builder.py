# Graph builder — wires all nodes into a LangGraph StateGraph.
#
# This is the single assembly point for the graph pipeline:
#   START → intent_resolver → doc_resolver → validate_inputs
#         → [route_to_action] → {summarize|inquire|compare|audit}
#         → format_response → END
#
# graph_service.py calls build_graph().compile(checkpointer=PostgresSaver)
# to produce the singleton compiled graph used by the chat router.
#
# Phase 3 changes: adds conditional edges from intent_resolver / doc_resolver
# for interrupt() gates — only these edges change, node logic is untouched.

import logging

from langgraph.graph import END, START, StateGraph

from app.graph.nodes.doc_resolver import doc_resolver
from app.graph.nodes.format_response import format_response
from app.graph.nodes.intent_resolver import intent_resolver
from app.graph.nodes.stub_actions import (
    audit_action,
    compare_action,
    inquire_action,
    summarize_action,
)
from app.graph.nodes.validate_inputs import validate_inputs
from app.graph.state import AgentState

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Routing function — NOT a node, used by add_conditional_edges
# ---------------------------------------------------------------------------


def route_to_action(state: AgentState) -> str:
    """
    Read state["action"] (set by intent_resolver) and return the target node name.
    Defaults to "inquire" if action is somehow unset — safe fallback.
    """
    action = state.get("action") or "inquire"
    valid = {"summarize", "inquire", "compare", "audit"}
    if action not in valid:
        logger.warning("route_to_action | unexpected action=%r — defaulting to inquire", action)
        return "inquire"
    return action


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------


def build_graph() -> StateGraph:
    """
    Return an uncompiled StateGraph with all nodes and edges registered.
    Compiled by graph_service.py with the PostgresSaver checkpointer.
    """
    builder: StateGraph = StateGraph(AgentState)

    # ── Nodes ────────────────────────────────────────────────────────────────
    builder.add_node("intent_resolver", intent_resolver)
    builder.add_node("doc_resolver", doc_resolver)
    builder.add_node("validate_inputs", validate_inputs)
    builder.add_node("summarize", summarize_action)
    builder.add_node("inquire", inquire_action)
    builder.add_node("compare", compare_action)
    builder.add_node("audit", audit_action)
    builder.add_node("format_response", format_response)

    # ── Linear edges (Phase 2) ────────────────────────────────────────────────
    builder.add_edge(START, "intent_resolver")
    builder.add_edge("intent_resolver", "doc_resolver")
    builder.add_edge("doc_resolver", "validate_inputs")

    # ── Conditional routing after validation ─────────────────────────────────
    builder.add_conditional_edges(
        "validate_inputs",
        route_to_action,
        {
            "summarize": "summarize",
            "inquire": "inquire",
            "compare": "compare",
            "audit": "audit",
        },
    )

    # ── All action nodes converge on format_response ──────────────────────────
    builder.add_edge("summarize", "format_response")
    builder.add_edge("inquire", "format_response")
    builder.add_edge("compare", "format_response")
    builder.add_edge("audit", "format_response")
    builder.add_edge("format_response", END)

    return builder
