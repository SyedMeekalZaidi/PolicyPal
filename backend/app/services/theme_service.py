# Theme Service — shared utility for extracting comparison themes from document chunks.
#
# Used by:
#   - compare.py  (holistic mode): extract themes before GPT-4o generation
#   - audit.py    (policy mode, Phase 4): extract themes from source policy chunks
#
# Design: one cheap GPT-4o-mini call (routed via "intent" action key) that reads
# sampled passages and returns 3-5 concise theme strings. Callers sum cost/tokens.

import logging

from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from pydantic import BaseModel

from app.services.llm_service import LLMResult, get_llm_service

logger = logging.getLogger(__name__)

_FALLBACK_THEMES = ["Key Requirements", "Implementation Approach", "Compliance Standards"]

# Max chars per chunk shown to the theme extraction LLM.
# Enough to convey topic signal without blowing the context budget.
_CHUNK_PREVIEW_CHARS = 300


# Private schema — only used inside this module.
class _ThemeExtraction(BaseModel):
    themes: list[str]


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
# Structure: ROLE → DOCUMENTS → CONTEXT → TASK → RULES  (prompt engineering §9)

_SYSTEM_PROMPT = """\
You are a document analysis assistant.

DOCUMENTS: {doc_titles}

CONTEXT (representative passages from the documents):
{context_snippets}

TASK: Identify 3-5 major themes or topics that appear across these documents — \
either as shared requirements or as key points of divergence. Each theme should be 2-5 words.

RULES:
- Focus on compliance/regulatory themes (requirements, frameworks, processes, penalties).
- Return exactly 3-5 themes — no more, no fewer.
- Each theme must be grounded in the context above, not invented from general knowledge.\
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@traceable(run_type="tool", name="extract_themes")
def extract_themes(
    chunks: list[dict],
    resolved_doc_titles: dict[str, str],
) -> LLMResult:
    """
    Extract 3-5 comparison themes from sampled document chunks via GPT-4o-mini.

    Args:
        chunks:               Flat list of chunk dicts (from stratified_sample).
                              Each chunk needs: 'content', 'document_id'.
        resolved_doc_titles:  {doc_id: title} — same dict as AgentState field.

    Returns:
        LLMResult where:
          .parsed          → _ThemeExtraction instance; access .themes: list[str]
          .tokens_used     → int (add to node running total)
          .cost_usd        → float (add to node running total)

    On any failure (LLM error, parse error, < 3 themes returned):
        Returns a zero-cost LLMResult with hardcoded fallback themes — never crashes.
    """
    doc_titles_str = ", ".join(resolved_doc_titles.values()) if resolved_doc_titles else "Documents"

    # Build numbered snippet list — first N chars of each chunk to stay token-efficient
    snippets: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        preview = chunk.get("content", "")[:_CHUNK_PREVIEW_CHARS].replace("\n", " ")
        snippets.append(f"[{i}] {preview}")

    context_snippets = "\n".join(snippets) if snippets else "(No passages available.)"

    system_content = _SYSTEM_PROMPT.format(
        doc_titles=doc_titles_str,
        context_snippets=context_snippets,
    )

    messages = [
        SystemMessage(content=system_content),
        HumanMessage(content="Identify 3-5 comparison themes from the passages above."),
    ]

    try:
        llm = get_llm_service()
        result: LLMResult = llm.invoke_structured("intent", _ThemeExtraction, messages)
        parsed: _ThemeExtraction = result.parsed

        # Validate — LLM must return at least 3 themes; fall back if not
        if not parsed.themes or len(parsed.themes) < 3:
            logger.warning(
                "theme_service | LLM returned %d themes (< 3) — using fallback",
                len(parsed.themes) if parsed.themes else 0,
            )
            return LLMResult(
                parsed=_ThemeExtraction(themes=_FALLBACK_THEMES),
                tokens_used=result.tokens_used,
                cost_usd=result.cost_usd,
            )

        logger.info(
            "theme_service | extracted %d themes: %s | tokens=%d cost=$%.6f",
            len(parsed.themes), parsed.themes, result.tokens_used, result.cost_usd,
        )
        return result

    except Exception as exc:
        logger.error("theme_service | extract_themes failed: %s — using fallback", exc)
        return LLMResult(
            parsed=_ThemeExtraction(themes=_FALLBACK_THEMES),
            tokens_used=0,
            cost_usd=0.0,
        )
