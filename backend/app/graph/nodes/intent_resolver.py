# Intent Resolver node — classifies the user's intended action.
#
# Pipeline:
#   Step 0: Explicit @Action tag from frontend → skip LLM entirely ($0)
#   Step 1: Python keyword scan for temporal terms → enable_web_search flag (free)
#   Step 2: First LLM pass with latest message only (cheap, fast)
#   Step 3: Second LLM pass with 5-message context if low/medium confidence
#   Step 4: "Summarize X about Y" override — specific topic queries → inquire
#   Step 5: Interrupt gates (Phase 3)
#             - multi_action_detected → action_choice interrupt (which action first?)
#             - confidence == "low"   → action_choice interrupt (please choose)
#   Final:  OR all web-search signals together
#
# IMPORTANT: This node does NOT write inference_confidence to state.
# That field is owned by doc_resolver (document resolution confidence).
#
# IDEMPOTENCY: LLM calls (Steps 2-3) run on first call AND on resume, but
# temperature=0 guarantees deterministic output so the same interrupt fires.
# interrupt() returns the resume value on re-run — the code after interrupt()
# only executes on resume. The double LLM call is acceptable (cheap, fast).

import logging
import re
from typing import Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from app.graph.state import CANCEL_SENTINEL, AgentState
from app.services.llm_service import get_llm_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Temporal keyword scan — triggers enable_web_search without LLM
# ---------------------------------------------------------------------------

_TEMPORAL_RE = re.compile(
    r"\b(latest|recent|current|now|today|still|updated?|new|2025|2026)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# "Summarize X about Y" override — specific topic → inquire
# Catches: "Summarize the capital requirements in...", "What does BN say about..."
# ---------------------------------------------------------------------------

_SPECIFIC_TOPIC_RE = re.compile(
    r"\b(what|how|when|where|why|which|does|is|are|can|explain|tell me)\b"
    r"|\b(requirements?|provisions?|rules?|limits?|thresholds?|definitions?|sections?|clauses?|articles?)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Pydantic schema for LLM structured output
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an intent classifier for PolicyPal, a compliance document AI assistant.

ACTIONS — choose the single best one:
- summarize : User wants a broad overview or high-level summary of document(s). No specific question.
- inquire   : User has a specific question about document content (requirements, definitions, amounts, rules).
- compare   : User wants to find differences or similarities across 2 or more documents.
- audit     : User wants to check whether a text, policy, or practice complies with regulations.

WEB SEARCH — set enable_web_search=true ONLY if the user asks about:
- Whether something is currently in effect ("still valid", "still enforced", "still required")
- Recent changes or updates ("latest version", "recent amendments", "updated rules")
- Time-sensitive status ("as of 2025", "current requirement", "new regulation")

MULTI-ACTION — set multi_action_detected=true ONLY if the message clearly requests two different
actions at once (e.g. "summarize AND compare", "audit this then inquire about...").
When multi_action_detected=true, list ALL detected actions in detected_actions (e.g. ["summarize", "audit"]).
When multi_action_detected=false, detected_actions should contain only the single best action.

REASONING — 1-2 sentences explaining your classification. Used for debugging only."""


class IntentClassification(BaseModel):
    action: Literal["summarize", "inquire", "compare", "audit"] = Field(
        description="The single best action for the user's request"
    )
    confidence: Literal["high", "medium", "low"] = Field(
        description="How confident you are in the classification"
    )
    enable_web_search: bool = Field(
        description="True if the user is asking about current/recent/time-sensitive information"
    )
    multi_action_detected: bool = Field(
        description="True if the message requests two different actions simultaneously"
    )
    detected_actions: list[str] = Field(
        description="All actions detected in the message. Multiple items only when multi_action_detected=true."
    )
    reasoning: str = Field(
        description="Brief explanation of the classification (debug only, never shown to user)"
    )


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


def intent_resolver(state: AgentState) -> dict:
    """
    LangGraph node: classify user intent and detect web-search need.
    Returns partial state update: { action, enable_web_search }.
    """
    messages = state.get("messages", [])
    frontend_action = state.get("action", "")
    frontend_web = state.get("enable_web_search", False)

    # Get last human message text for keyword scan + LLM prompt
    last_message_text = ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            last_message_text = str(msg.content)
            break

    # ── Step 1: Python keyword scan (free, always runs) ──────────────────────
    python_web_flag = bool(_TEMPORAL_RE.search(last_message_text))

    # ── Step 0: Explicit @Action tag — skip LLM entirely ─────────────────────
    if frontend_action:
        logger.info(
            "intent_resolver | explicit action=%s web_scan=%s",
            frontend_action, python_web_flag,
        )
        return {
            "action": frontend_action,
            "enable_web_search": frontend_web or python_web_flag,
        }

    # ── Step 2: First LLM pass (latest message only) ──────────────────────────
    llm = get_llm_service()
    prompt = [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=last_message_text)]

    classification = llm.invoke_structured("intent", IntentClassification, prompt)

    logger.info(
        "intent_resolver | pass=1 action=%s confidence=%s web=%s multi=%s | %s",
        classification.action, classification.confidence,
        classification.enable_web_search, classification.multi_action_detected,
        classification.reasoning[:120],
    )

    # ── Step 3: Second pass with 5-message context (low/medium confidence) ────
    if classification.confidence in ("low", "medium"):
        last_5 = [m for m in messages[-6:] if not isinstance(m, SystemMessage)]
        # Rebuild with richer context
        context_prompt = [SystemMessage(content=_SYSTEM_PROMPT), *last_5]
        classification = llm.invoke_structured("intent", IntentClassification, context_prompt)
        logger.info(
            "intent_resolver | pass=2 action=%s confidence=%s web=%s | %s",
            classification.action, classification.confidence,
            classification.enable_web_search, classification.reasoning[:120],
        )

    # ── Step 4: "Summarize X about Y" override ────────────────────────────────
    # "Summarize the capital requirements in Doc" is really an Inquire.
    if classification.action == "summarize" and _SPECIFIC_TOPIC_RE.search(last_message_text):
        logger.info(
            "intent_resolver | override summarize→inquire (specific topic detected)"
        )
        classification = IntentClassification(
            action="inquire",
            confidence=classification.confidence,
            enable_web_search=classification.enable_web_search,
            multi_action_detected=classification.multi_action_detected,
            detected_actions=classification.detected_actions,
            reasoning=classification.reasoning + " [overridden: specific topic → inquire]",
        )

    # ── Final: OR all web-search signals ──────────────────────────────────────
    merged_web = frontend_web or python_web_flag or classification.enable_web_search

    # ── Step 5: Interrupt gates ────────────────────────────────────────────────
    # These run on BOTH first call and resume (temperature=0 → deterministic LLM).
    # interrupt() pauses on first call; returns resume_value on re-run.
    # Code after interrupt() only executes on the RESUME path.

    _ACTION_LABELS = {
        "summarize": "Summarize",
        "inquire": "Inquire",
        "compare": "Compare",
        "audit": "Audit",
    }

    # Gate 1 — Multi-action: user requested two actions simultaneously
    if classification.multi_action_detected:
        valid = {"summarize", "inquire", "compare", "audit"}
        options = [
            {"id": a, "label": _ACTION_LABELS[a]}
            for a in classification.detected_actions
            if a in valid
        ]
        # Fallback if LLM didn't populate detected_actions properly
        if len(options) < 2:
            options = [{"id": a, "label": l} for a, l in _ACTION_LABELS.items()]

        logger.info(
            "intent_resolver | multi_action_detected — interrupting for user choice. options=%s",
            [o["id"] for o in options],
        )
        resume_val = interrupt({
            "interrupt_type": "action_choice",
            "message": "I can only perform one action at a time. Which would you like to do first?",
            "options": options,
        })
        # ── RESUME PATH ONLY ──────────────────────────────────────────────────
        if resume_val in (None, CANCEL_SENTINEL):
            msg = (
                "I wasn't sure which action to perform. "
                "Try again using @Summarize, @Inquire, @Compare, or @Audit with your message."
            )
            logger.info("intent_resolver | multi_action cancel → stopping with feedback")
            return Command(
                update={"response": msg, "messages": [AIMessage(content=msg)]},
                goto="format_response",
            )
        logger.info("intent_resolver | multi_action resume → action=%s", resume_val)
        return {"action": resume_val, "enable_web_search": merged_web}

    # Gate 2 — Low confidence: classifier uncertain after retry
    if classification.confidence == "low":
        options = [{"id": a, "label": l} for a, l in _ACTION_LABELS.items()]
        logger.info("intent_resolver | low confidence after retry — interrupting for user choice")
        resume_val = interrupt({
            "interrupt_type": "action_choice",
            "message": "I'm not sure what you'd like to do. Please choose an action:",
            "options": options,
        })
        # ── RESUME PATH ONLY ──────────────────────────────────────────────────
        if resume_val in (None, CANCEL_SENTINEL):
            msg = (
                "I wasn't sure which action to perform. "
                "Try again using @Summarize, @Inquire, @Compare, or @Audit with your message."
            )
            logger.info("intent_resolver | low_conf cancel → stopping with feedback")
            return Command(
                update={"response": msg, "messages": [AIMessage(content=msg)]},
                goto="format_response",
            )
        logger.info("intent_resolver | low_conf resume → action=%s", resume_val)
        return {"action": resume_val, "enable_web_search": merged_web}

    # ── Normal path (no interrupt needed) ────────────────────────────────────
    return {
        "action": classification.action,
        "enable_web_search": merged_web,
    }
