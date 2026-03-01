# Query rewrite utility — optimises the user's cleaned message into an
# embedding-friendly search query before semantic retrieval in action nodes.
#
# Called by:  inquire_action; compare_action and audit_action (future phases).
# NOT called by: summarize_action (uses stratified sampling, not semantic search).
#
# Design: action-aware prompt branching → GPT-4o-mini → validated string output.
# Falls back to clean_query on any LLM failure — never crashes the graph run.

import logging

from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable
from pydantic import BaseModel

from app.services.llm_service import get_llm_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic output schema (private — only used by this module)
# ---------------------------------------------------------------------------

class _QueryRewriteResult(BaseModel):
    optimized_query: str


# ---------------------------------------------------------------------------
# Action-aware system prompt templates
# ---------------------------------------------------------------------------
# All templates accept a `titles` kwarg via str.format().
# The `audit` template intentionally omits {titles} — audit retrieves themes
# from the user's own text, not by document name lookup. Extra kwargs to
# str.format() are silently ignored, so calling .format(titles=...) is safe.

_SYSTEM_PROMPTS: dict[str, str] = {
    "inquire": (
        "You are a search query optimizer for a compliance document AI.\n\n"
        "DOCUMENTS: {titles}\n\n"
        "TASK: Rewrite the user's question as a semantic search query (15-25 words) "
        "that will retrieve the most relevant passages from the document(s). "
        "Include the document subject matter and the user's specific question topic.\n\n"
        "RULES:\n"
        "- Return ONLY the optimized query, no explanation.\n"
        "- Preserve the core intent of the original question.\n"
        "- Add document context to improve semantic similarity."
    ),
    "compare": (
        "You are a search query optimizer for a compliance document AI.\n\n"
        "DOCUMENTS: {titles}\n\n"
        "TASK: Generate a semantic search query (15-25 words) to find content about "
        "the specific topic the user wants to compare across these documents.\n\n"
        "RULES:\n"
        "- Return ONLY the query, no explanation.\n"
        "- Include both the comparison topic and the document subject matter."
    ),
    "audit": (
        "You are a search query optimizer for a compliance document AI.\n\n"
        "TASK: From the user's audit text, extract the 3 most important compliance "
        "themes and form them into a single semantic search query (15-25 words) "
        "suitable for finding matching regulatory clauses.\n\n"
        "RULES:\n"
        "- Return ONLY the query, no explanation.\n"
        "- Focus on compliance obligations, requirements, and risk areas."
    ),
}

_DEFAULT_SYSTEM_PROMPT = (
    "You are a search query optimizer for a compliance document AI.\n\n"
    "DOCUMENTS: {titles}\n\n"
    "TASK: Rephrase the user's message as a semantic search query (15-25 words) "
    "optimised for finding relevant content in the document(s).\n\n"
    "RULES:\n"
    "- Return ONLY the query, no explanation."
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@traceable(run_type="tool", name="rewrite_query")
def rewrite_query(
    clean_query: str,
    doc_titles: dict[str, str],
    action: str,
) -> str:
    """
    Optimise `clean_query` for semantic retrieval using a cheap GPT-4o-mini call.

    Skips the LLM when doc_titles is empty — the raw query is the best we can
    do without document context (general knowledge question case).
    Falls back to clean_query if the LLM call fails for any reason.

    Args:
        clean_query: Plain text from TipTap walk (all @mentions stripped).
                     May be empty for pure-mention messages.
        doc_titles:  {uuid: title} from resolved_doc_titles in AgentState.
        action:      "inquire" | "compare" | "audit" | ...

    Returns:
        Optimised search query string, or clean_query on error/no-doc fallback.
    """
    if not doc_titles:
        # No document context — skip LLM, the query is already as good as it gets.
        return clean_query

    titles_str = ", ".join(doc_titles.values())
    template = _SYSTEM_PROMPTS.get(action, _DEFAULT_SYSTEM_PROMPT)
    system_content = template.format(titles=titles_str)

    # For pure-mention messages (no explicit question), give the LLM a hint
    # so it can still generate a meaningful retrieval query from context alone.
    human_content = (
        clean_query
        if clean_query
        else f"(no explicit question — generate a retrieval query for {action} on these documents)"
    )

    messages = [
        SystemMessage(content=system_content),
        HumanMessage(content=human_content),
    ]

    try:
        llm = get_llm_service()
        result = llm.invoke_structured("query_rewrite", _QueryRewriteResult, messages)
        optimized = result.parsed.optimized_query.strip()
        logger.info(
            "rewrite_query | action=%s docs=%d | %r → %r",
            action, len(doc_titles), clean_query[:60], optimized[:80],
        )
        return optimized or clean_query
    except Exception as exc:
        logger.warning(
            "rewrite_query | LLM failed (action=%s) — falling back to clean_query: %s",
            action, exc,
        )
        return clean_query
