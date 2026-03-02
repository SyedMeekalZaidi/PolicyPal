# Query rewrite utility — optimises the user's cleaned message into an
# embedding-friendly retrieval query (and optionally a Tavily web query)
# before semantic retrieval in action nodes.
#
# Called by:  inquire_action (retrieval + optional web query)
#             compare_action, audit_action (retrieval only)
# NOT called by: summarize_action (uses stratified sampling, not semantic search).
#
# Design:
#   - Returns QueryRewriteResult(retrieval, web) — a NamedTuple.
#   - When web_search=False (compare, audit), web=None and the LLM produces
#     only an optimised retrieval query (existing behaviour, backward-compat).
#   - When web_search=True (inquire), a single LLM call produces BOTH a dense
#     retrieval query for pgvector AND a natural-language web query for Tavily.
#   - Optional `messages` parameter injects the last 4 conversation turns so
#     the rewriter can resolve pronouns like "these regulations", "that policy".
#   - Falls back to clean_query / clean_query[:150] on any LLM failure.

import logging
from typing import NamedTuple

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langsmith import traceable
from pydantic import BaseModel

from app.services.llm_service import get_llm_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public return type
# ---------------------------------------------------------------------------

class QueryRewriteResult(NamedTuple):
    """Return type of rewrite_query().

    retrieval: dense embedding-search query for pgvector retrieval.
    web:       web-search query for Tavily; None when web_search=False.
    """
    retrieval: str
    web: str | None


# ---------------------------------------------------------------------------
# Private Pydantic output schemas
# ---------------------------------------------------------------------------

class _QueryRewriteResult(BaseModel):
    """LLM schema — retrieval-only path (web_search=False)."""
    optimized_query: str


class _QueryRewriteResultWeb(BaseModel):
    """LLM schema — combined path (web_search=True).

    optimized_query: dense semantic search query for pgvector.
    web_query:       natural-language query for Tavily web search.
    """
    optimized_query: str
    web_query: str


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------
# All templates accept {titles} and {history_block} via str.format(**kwargs).
# Python silently ignores extra kwargs, so passing both to every template is safe.
# The `audit` template intentionally omits {titles} — audit uses themes extracted
# from the user's own text. {history_block} is used only in the `inquire` template.

_SYSTEM_PROMPTS: dict[str, str] = {
    "inquire": (
        "You are a search query optimizer for a compliance document AI.\n\n"
        "DOCUMENTS: {titles}\n\n"
        "RECENT CONVERSATION (use to resolve pronouns like 'these', 'it', 'that policy'):\n"
        "{history_block}\n\n"
        "TASK: Rewrite the user's question as a semantic search query (15-25 words) "
        "that will retrieve the most relevant passages from the document(s). "
        "Include the document subject matter and the user's specific question topic.\n\n"
        "RULES:\n"
        "- Return ONLY the optimized query, no explanation.\n"
        "- Use conversation context to resolve any ambiguous references.\n"
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

# Combined retrieval + web prompt — used only when web_search=True.
_WEB_SYSTEM_PROMPT = (
    "You are a search query optimizer for a compliance document AI.\n\n"
    "DOCUMENTS: {titles}\n\n"
    "RECENT CONVERSATION (use to resolve pronouns like 'these', 'it', 'that policy'):\n"
    "{history_block}\n\n"
    "TASK: Produce TWO optimized search queries for the user's question:\n\n"
    "1. RETRIEVAL QUERY (15-25 words): For semantic similarity search within the uploaded "
    "document(s). Dense, keyword-rich, using the document's technical terminology and "
    "subject matter as context.\n\n"
    "2. WEB QUERY (10-20 words): For a web search engine to find real-world regulatory "
    "information online. Use official real-world names (e.g. 'Bank Negara Malaysia' not "
    "'MY-Islamic-Banking', 'MAS Notice 637' not 'SG-Islamic-Guidelines'). Include temporal "
    "context for time-sensitive questions (e.g. '2026', 'current', 'latest'). Never use "
    "internal document labels or system names.\n\n"
    "RULES:\n"
    "- Use conversation context to resolve ambiguous references.\n"
    "- Preserve the core intent of the original question.\n"
    "- Return ONLY the two queries — no explanation."
)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _build_history_block(messages: list, n: int = 4) -> str:
    """Format up to N messages before the current query as readable context.

    Finds the last HumanMessage (= the query being rewritten) and returns the
    N messages that precede it, formatted as 'User: ...' / 'AI: ...' lines.
    """
    if not messages:
        return "(No prior conversation)"

    # Find the last HumanMessage — that is the current query we're rewriting
    last_human_idx: int | None = None
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            last_human_idx = i
            break

    if last_human_idx is None or last_human_idx == 0:
        return "(No prior conversation)"

    prior = messages[max(0, last_human_idx - n):last_human_idx]
    lines: list[str] = []
    for msg in prior:
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        truncated = content[:300]
        if isinstance(msg, HumanMessage):
            lines.append(f"User: {truncated}")
        elif isinstance(msg, AIMessage):
            lines.append(f"AI: {truncated}")

    return "\n".join(lines) if lines else "(No prior conversation)"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@traceable(run_type="tool", name="rewrite_query")
def rewrite_query(
    clean_query: str,
    doc_titles: dict[str, str],
    action: str,
    messages: list | None = None,
    web_search: bool = False,
) -> QueryRewriteResult:
    """
    Optimise `clean_query` for semantic retrieval — and optionally produce a
    Tavily web search query in the same LLM call.

    Args:
        clean_query:  Plain text from TipTap walk (all @mentions stripped).
        doc_titles:   {uuid: title} from resolved_doc_titles in AgentState.
        action:       "inquire" | "compare" | "audit" | ...
        messages:     Full state["messages"] list — used to build conversation
                      context so the rewriter can resolve follow-up pronouns.
                      Pass None (or omit) for compare/audit (no history needed).
        web_search:   When True, produce both retrieval + web queries in one call.
                      Only inquire_action passes True.

    Returns:
        QueryRewriteResult(retrieval, web)
        - retrieval: optimised pgvector search string (never empty — falls back
                     to clean_query on error).
        - web:       Tavily-optimised query, or None when web_search=False.
    """
    titles_str = (
        ", ".join(doc_titles.values())
        if doc_titles
        else "(no specific document — general question)"
    )
    history_block = _build_history_block(messages) if messages else "(No prior conversation)"

    # Pure retrieval shortcut: no docs and no web search — LLM adds no value.
    if not doc_titles and not web_search:
        return QueryRewriteResult(retrieval=clean_query, web=None)

    human_content = (
        clean_query
        if clean_query
        else f"(no explicit question — generate queries for {action} on these documents)"
    )

    llm = get_llm_service()

    # ── Web + retrieval path ───────────────────────────────────────────────
    if web_search:
        system_content = _WEB_SYSTEM_PROMPT.format(
            titles=titles_str, history_block=history_block
        )
        msg_list = [
            SystemMessage(content=system_content),
            HumanMessage(content=human_content),
        ]
        try:
            result = llm.invoke_structured("query_rewrite_web", _QueryRewriteResultWeb, msg_list)
            retrieval = result.parsed.optimized_query.strip() or clean_query
            web = result.parsed.web_query.strip() or clean_query[:150]
            logger.info(
                "rewrite_query | web=True action=%s | retrieval=%r web=%r",
                action, retrieval[:80], web[:80],
            )
            return QueryRewriteResult(retrieval=retrieval, web=web)
        except Exception as exc:
            logger.warning(
                "rewrite_query | LLM failed (web path, action=%s) — falling back: %s",
                action, exc,
            )
            return QueryRewriteResult(retrieval=clean_query, web=clean_query[:150])

    # ── Retrieval-only path ────────────────────────────────────────────────
    template = _SYSTEM_PROMPTS.get(action, _DEFAULT_SYSTEM_PROMPT)
    system_content = template.format(titles=titles_str, history_block=history_block)
    msg_list = [
        SystemMessage(content=system_content),
        HumanMessage(content=human_content),
    ]
    try:
        result = llm.invoke_structured("query_rewrite", _QueryRewriteResult, msg_list)
        optimized = result.parsed.optimized_query.strip() or clean_query
        logger.info(
            "rewrite_query | action=%s docs=%d | %r → %r",
            action, len(doc_titles), clean_query[:60], optimized[:80],
        )
        return QueryRewriteResult(retrieval=optimized, web=None)
    except Exception as exc:
        logger.warning(
            "rewrite_query | LLM failed (action=%s) — falling back to clean_query: %s",
            action, exc,
        )
        return QueryRewriteResult(retrieval=clean_query, web=None)
