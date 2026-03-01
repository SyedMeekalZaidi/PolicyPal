# LLM Service — action-based model routing over ChatOpenAI.
#
# Nodes call llm_service.invoke_structured(action_type, Schema, messages)
# or llm_service.ainvoke_structured(...) for async nodes.
# They never know which model they're using — routing is centralised here.
#
# Model routing rationale:
#   gpt-4o-mini → intent, doc_resolution, summarize, inquire
#     (classification + targeted extraction — cost-efficient)
#   gpt-4o     → compare, audit
#     (multi-theme synthesis + legal risk analysis — highest stakes / quality)
#
# One ChatOpenAI instance is created per model name and reused across all
# calls (connection pooling, avoids repeated client init overhead).

import asyncio
import logging
import time
from typing import Any, NamedTuple, Type, TypeVar

import openai
from langchain_core.messages import AIMessage, BaseMessage
from langchain_openai import ChatOpenAI
from langsmith import traceable
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class LLMResult(NamedTuple):
    """Return value of invoke_structured / ainvoke_structured.

    Bundles the validated Pydantic object with per-call usage data so callers
    can persist cost and token counts without a second LLM call.
    """
    parsed: Any       # validated Pydantic instance (type T, but NamedTuple can't carry TypeVar)
    tokens_used: int  # total input + output tokens for this call
    cost_usd: float   # estimated USD cost at published per-token rates

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ACTION_TO_MODEL: dict[str, str] = {
    "intent": "gpt-4o-mini",        # classification before action is known
    "doc_resolution": "gpt-4o-mini", # name matching — simple, cheap
    "query_rewrite": "gpt-4o-mini",  # query optimisation utility — ~$0.0001/call
    "summarize": "gpt-4o-mini",      # extraction task — cost-efficient
    "inquire": "gpt-4o-mini",        # targeted Q&A — cost-efficient
    "compare": "gpt-4o",             # multi-theme synthesis — needs reasoning
    "audit": "gpt-4o",               # legal risk analysis — highest stakes
}

# USD per token — used for per-call cost logging
_COST_PER_TOKEN: dict[str, dict[str, float]] = {
    "gpt-4o":      {"input": 5.00 / 1_000_000,  "output": 15.00 / 1_000_000},
    "gpt-4o-mini": {"input": 0.15 / 1_000_000,  "output":  0.60 / 1_000_000},
}

# ---------------------------------------------------------------------------
# LLMService
# ---------------------------------------------------------------------------


class LLMService:
    """
    Thin wrapper around ChatOpenAI with:
      - Action-based model routing
      - Structured output (with_structured_output → validated Pydantic object)
      - Automatic retry on rate-limit and timeout errors
      - Per-call token usage and cost logging
    """

    def __init__(self) -> None:
        settings = get_settings()
        # One instance per model — reused across all calls
        self._models: dict[str, ChatOpenAI] = {
            model: ChatOpenAI(
                model=model,
                temperature=0,        # deterministic — required for compliance outputs
                api_key=settings.openai_api_key,
                timeout=30,
            )
            for model in {"gpt-4o", "gpt-4o-mini"}
        }

    # ── Internal helpers ────────────────────────────────────────────────────

    def _model_for(self, action_type: str) -> tuple[str, ChatOpenAI]:
        model_name = _ACTION_TO_MODEL.get(action_type)
        if not model_name:
            raise ValueError(
                f"Unknown action_type '{action_type}'. "
                f"Valid types: {list(_ACTION_TO_MODEL)}"
            )
        return model_name, self._models[model_name]

    def _log_usage(
        self, action_type: str, model_name: str, result: AIMessage
    ) -> tuple[int, float]:
        """Extract token counts and cost from an AIMessage, log them, and return the values."""
        meta = getattr(result, "usage_metadata", None)
        if not meta:
            return 0, 0.0
        input_tokens = meta.get("input_tokens", 0)
        output_tokens = meta.get("output_tokens", 0)
        total_tokens = meta.get("total_tokens", 0)
        pricing = _COST_PER_TOKEN.get(model_name, {})
        cost = (
            input_tokens * pricing.get("input", 0)
            + output_tokens * pricing.get("output", 0)
        )
        logger.info(
            "LLM | action=%-14s model=%-12s tokens=%d (in=%d out=%d) cost=$%.6f",
            action_type, model_name, total_tokens, input_tokens, output_tokens, cost,
        )
        return total_tokens, cost

    # ── Sync API ────────────────────────────────────────────────────────────

    @traceable(run_type="llm", name="invoke_structured")
    def invoke_structured(
        self, action_type: str, schema: Type[T], messages: list[BaseMessage]
    ) -> LLMResult:
        """
        Call the appropriate model and return an LLMResult(parsed, tokens_used, cost_usd).

        Uses include_raw=True so the raw AIMessage is accessible for usage metadata.
        Retries once on RateLimitError (after 1 s) and once on APITimeoutError.
        """
        model_name, llm = self._model_for(action_type)
        structured = llm.with_structured_output(schema, include_raw=True)

        for attempt in range(2):
            try:
                raw_result: dict = structured.invoke(messages)  # type: ignore[assignment]
                if raw_result.get("parsing_error"):
                    raise RuntimeError(
                        f"Structured output parsing failed for {action_type}: "
                        f"{raw_result['parsing_error']}"
                    )
                parsed = raw_result["parsed"]
                tokens_used, cost_usd = self._log_usage(
                    action_type, model_name, raw_result["raw"]
                )
                return LLMResult(parsed=parsed, tokens_used=tokens_used, cost_usd=cost_usd)
            except openai.RateLimitError:
                if attempt == 0:
                    logger.warning("Rate limit hit for action=%s — retrying in 1 s", action_type)
                    time.sleep(1)
                    continue
                raise
            except openai.APITimeoutError:
                if attempt == 0:
                    logger.warning("Timeout for action=%s — retrying", action_type)
                    continue
                raise
            except openai.APIError as exc:
                raise RuntimeError(
                    f"OpenAI API error during {action_type}: {exc}"
                ) from exc

        raise RuntimeError(f"invoke_structured failed after 2 attempts (action={action_type})")

    @traceable(run_type="llm", name="invoke")
    def invoke(self, action_type: str, messages: list[BaseMessage]) -> AIMessage:
        """
        Call the appropriate model and return the raw AIMessage.
        Used when structured output is not needed.
        """
        model_name, llm = self._model_for(action_type)

        for attempt in range(2):
            try:
                result: AIMessage = llm.invoke(messages)  # type: ignore[assignment]
                self._log_usage(action_type, model_name, result)
                return result
            except openai.RateLimitError:
                if attempt == 0:
                    logger.warning("Rate limit hit for action=%s — retrying in 1 s", action_type)
                    time.sleep(1)
                    continue
                raise
            except openai.APITimeoutError:
                if attempt == 0:
                    logger.warning("Timeout for action=%s — retrying", action_type)
                    continue
                raise
            except openai.APIError as exc:
                raise RuntimeError(
                    f"OpenAI API error during {action_type}: {exc}"
                ) from exc

        raise RuntimeError(f"invoke failed after 2 attempts (action={action_type})")

    # ── Async API ────────────────────────────────────────────────────────────
    # Used by async LangGraph nodes (graph.astream → async node functions).

    @traceable(run_type="llm", name="ainvoke_structured")
    async def ainvoke_structured(
        self, action_type: str, schema: Type[T], messages: list[BaseMessage]
    ) -> LLMResult:
        """Async variant of invoke_structured — returns LLMResult(parsed, tokens_used, cost_usd)."""
        model_name, llm = self._model_for(action_type)
        structured = llm.with_structured_output(schema, include_raw=True)

        for attempt in range(2):
            try:
                raw_result: dict = await structured.ainvoke(messages)  # type: ignore[assignment]
                if raw_result.get("parsing_error"):
                    raise RuntimeError(
                        f"Structured output parsing failed for {action_type}: "
                        f"{raw_result['parsing_error']}"
                    )
                parsed = raw_result["parsed"]
                tokens_used, cost_usd = self._log_usage(
                    action_type, model_name, raw_result["raw"]
                )
                return LLMResult(parsed=parsed, tokens_used=tokens_used, cost_usd=cost_usd)
            except openai.RateLimitError:
                if attempt == 0:
                    logger.warning("Rate limit hit for action=%s — retrying in 1 s", action_type)
                    await asyncio.sleep(1)
                    continue
                raise
            except openai.APITimeoutError:
                if attempt == 0:
                    logger.warning("Timeout for action=%s — retrying", action_type)
                    continue
                raise
            except openai.APIError as exc:
                raise RuntimeError(
                    f"OpenAI API error during {action_type}: {exc}"
                ) from exc

        raise RuntimeError(f"ainvoke_structured failed after 2 attempts (action={action_type})")

    @traceable(run_type="llm", name="ainvoke")
    async def ainvoke(self, action_type: str, messages: list[BaseMessage]) -> AIMessage:
        """Async variant of invoke for use in async graph nodes."""
        model_name, llm = self._model_for(action_type)

        for attempt in range(2):
            try:
                result: AIMessage = await llm.ainvoke(messages)  # type: ignore[assignment]
                self._log_usage(action_type, model_name, result)
                return result
            except openai.RateLimitError:
                if attempt == 0:
                    logger.warning("Rate limit hit for action=%s — retrying in 1 s", action_type)
                    await asyncio.sleep(1)
                    continue
                raise
            except openai.APITimeoutError:
                if attempt == 0:
                    logger.warning("Timeout for action=%s — retrying", action_type)
                    continue
                raise
            except openai.APIError as exc:
                raise RuntimeError(
                    f"OpenAI API error during {action_type}: {exc}"
                ) from exc

        raise RuntimeError(f"ainvoke failed after 2 attempts (action={action_type})")


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    """Return the singleton LLMService, creating it on first call."""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
        logger.info("LLMService initialised (gpt-4o + gpt-4o-mini)")
    return _llm_service
