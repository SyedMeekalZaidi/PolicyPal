# Inquire action node — answers specific compliance questions via RAG.
#
# Pipeline:
#   1. Read clean_query from state (set by doc_resolver); fallback to regex
#   2. rewrite_query() — action-aware GPT-4o-mini query optimisation for retrieval
#   3. Adaptive-k semantic retrieval (k=15, threshold=0.5, max 5 chunks/doc)
#   4. Optional Tavily web search (if enable_web_search=True)
#   5. Mode selection:
#        Mode A — RAG       : chunks or web results found → strict context answer
#        Mode B — General   : no docs resolved + no chunks → general knowledge answer
#        Mode C — Not Found : docs resolved but no matching chunks → inform user
#   6. GPT-4o-mini structured generation → InquireResponse (response + citations)
#   7. Return state update with all retrieval + cost metadata
#
# The LLM receives the exact same [N] numbers used in context so citations
# can be mapped back to source chunks/URLs by the frontend.

import logging
import re

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langsmith import traceable

from app.graph.state import AgentState
from app.graph.utils import rewrite_query
from app.models.action_schemas import InquireResponse
from app.services.llm_service import get_llm_service
from app.services.retrieval_service import search_chunks
from app.services.tavily_service import web_search as tavily_search

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt templates
# ---------------------------------------------------------------------------
# Structure: ROLE → CONTEXT (injected) → TASK → RULES → FORMAT  (§9 prompt rules)
# Critical rules placed first and last — attention degrades in the middle.

# Mode A — strict RAG (chunks or web results available)
_SYSTEM_PROMPT_RAG = """\
You are a compliance document analyst for PolicyPal. Answer questions using ONLY the provided context.

CONTEXT:
{context_block}

TASK: Answer the user's specific compliance question concisely and accurately.

RULES:
- Use ONLY the context above. Do not use prior knowledge or assumptions.
- Place [N] citation markers immediately after every factual claim (e.g. "The minimum ratio is 8% [1].").
- For claims supported by multiple sources, write markers together with no space: [1][2].
- If the context does not contain the answer, state that explicitly — do not guess.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context header. Set doc_id to null for web sources.
- Set source_type to "document" for uploaded docs, "web" for web results.{user_context}

FORMAT: Return a response string with inline [N] markers and a citations list where each entry id matches its [N] number.\
"""

# Mode B — general knowledge (no documents resolved, no retrieval context)
_SYSTEM_PROMPT_GENERAL = """\
You are a compliance document analyst for PolicyPal.

No documents are attached to this conversation.

TASK: Answer the user's compliance question from your general knowledge.

RULES:
- Clearly state that this answer is based on general knowledge, not from uploaded documents.
- Be accurate and concise. Do not fabricate specific regulatory citations or clause numbers.
- Return an empty citations list.{user_context}

FORMAT: Return a response string with an empty citations list.\
"""

# Mode C — document found but no relevant chunks matched the query
_SYSTEM_PROMPT_NO_CHUNKS = """\
You are a compliance document analyst for PolicyPal.

DOCUMENTS SEARCHED: {doc_titles}

TASK: Inform the user that no relevant passages were found in their document(s) for this question.

RULES:
- Do NOT answer from general knowledge.
- Tell the user the specific content was not found in their attached document(s).
- Suggest they try rephrasing their question or verify the content exists in their document.
- Return an empty citations list.

FORMAT: Return a helpful response string with an empty citations list.\
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_query(messages: list) -> str:
    """
    Fallback query extractor — strips @mention tokens from the last HumanMessage.
    Used only when clean_query is absent from state (e.g. empty tiptap_json).
    Note: regex is imprecise for multi-word mentions; replaced by TipTap walk in doc_resolver.
    """
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
            return re.sub(r"@\S+", "", text).strip() or text
    return ""


def _build_context_block(chunks: list[dict], web_results: list[dict]) -> str:
    """
    Build the numbered [N] context block injected into the Mode A system prompt.

    Document chunks:  [N] Source: {title} | Page: {page} | DocID: {uuid}
    Web results:      [N] Source: {title} (web) | URL: {url}
    """
    parts: list[str] = []
    n = 1

    for chunk in chunks:
        page_str = str(chunk["page"]) if chunk.get("page") is not None else "N/A"
        parts.append(
            f'[{n}] Source: {chunk.get("doc_title", "Unknown")} | Page: {page_str}'
            f' | DocID: {chunk["document_id"]}\n'
            f'"{chunk["content"]}"'
        )
        n += 1

    for result in web_results:
        parts.append(
            f'[{n}] Source: {result.get("title", "Web Source")} (web)'
            f' | URL: {result.get("url", "")}\n'
            f'"{result.get("content", "")}"'
        )
        n += 1

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


@traceable(run_type="chain", name="inquire_action")
def inquire_action(state: AgentState) -> dict:
    """
    LangGraph node: answer a specific compliance question via RAG + optional web search.

    Returns partial state update with response, citations, retrieval metadata, and cost.
    """
    messages = state.get("messages") or []
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    resolved_doc_titles: dict = state.get("resolved_doc_titles") or {}
    enable_web_search: bool = state.get("enable_web_search") or False
    user_id: str = state.get("user_id") or ""
    user_industry: str = state.get("user_industry") or ""
    user_location: str = state.get("user_location") or ""

    # ── Step 1: Get query ─────────────────────────────────────────────────────
    # Prefer clean_query from state (set by doc_resolver TipTap walk).
    # Fallback to regex for the rare case where tiptap_json was missing/empty.
    query = state.get("clean_query") or _extract_query(messages)
    logger.info(
        "inquire | query=%r docs=%d web=%s",
        query[:80], len(resolved_doc_ids), enable_web_search,
    )

    # ── Step 2: Optimise query for retrieval ───────────────────────────────────
    # rewrite_query() is a no-op when resolved_doc_titles is empty (general question).
    retrieval_query = rewrite_query(query, resolved_doc_titles, "inquire")
    logger.info("inquire | retrieval_query=%r", retrieval_query[:80])

    # ── Step 3: Semantic retrieval ─────────────────────────────────────────────
    # Pass None for doc_ids when list is empty → search across ALL user docs
    retrieval = search_chunks(
        query_text=retrieval_query,
        user_id=user_id,
        doc_ids=resolved_doc_ids if resolved_doc_ids else None,
        k=15,
        threshold=0.5,
    )
    chunks: list[dict] = retrieval["chunks"]
    confidence_tier: str = retrieval["confidence_tier"]
    avg_similarity: float = retrieval.get("avg_similarity", 0.0)

    logger.info(
        "inquire | retrieved %d chunks, confidence=%s avg_sim=%.3f",
        len(chunks), confidence_tier, avg_similarity,
    )

    # ── Step 4: Optional web search ───────────────────────────────────────────
    web_results: list[dict] = []
    web_search_query: str | None = None

    if enable_web_search:
        web_search_query = retrieval_query[:200] if retrieval_query else "compliance regulatory requirements"
        web_results = tavily_search(web_search_query)
        logger.info(
            "inquire | web search: query=%r → %d results",
            web_search_query[:60], len(web_results),
        )

    # ── Step 5: Select mode + build system prompt ──────────────────────────────
    # Mode selection must run AFTER web search so web_results is populated.
    #   Mode A — chunks or web results found → strict RAG
    #   Mode C — docs resolved but nothing retrieved → content not found
    #   Mode B — no docs at all → general knowledge answer

    user_context_line = ""
    if user_industry or user_location:
        ctx_parts = [p for p in [user_industry, user_location] if p]
        user_context_line = (
            f"\nUser context: Works in {' / '.join(ctx_parts)}. "
            "Tailor regulatory references and examples to their jurisdiction."
        )

    has_content = len(chunks) > 0 or len(web_results) > 0

    if has_content:
        # Mode A — build numbered context block and instruct strict RAG answer
        context_block = _build_context_block(chunks, web_results)
        system_content = _SYSTEM_PROMPT_RAG.format(
            context_block=context_block,
            user_context=user_context_line,
        )
        logger.info("inquire | mode=RAG chunks=%d web=%d", len(chunks), len(web_results))

    elif resolved_doc_ids:
        # Mode C — doc(s) were resolved but semantic search found nothing relevant.
        # Do NOT fall back to general knowledge — that would be misleading for compliance.
        doc_titles_str = ", ".join(resolved_doc_titles.values()) if resolved_doc_titles else "the selected document(s)"
        system_content = _SYSTEM_PROMPT_NO_CHUNKS.format(doc_titles=doc_titles_str)
        confidence_tier = "low"
        avg_similarity = 0.0
        logger.info("inquire | mode=NOT_FOUND docs=%s", list(resolved_doc_titles.values()))

    else:
        # Mode B — no documents in this conversation; answer from general knowledge.
        system_content = _SYSTEM_PROMPT_GENERAL.format(user_context=user_context_line)
        confidence_tier = "low"
        avg_similarity = 0.0
        logger.info("inquire | mode=GENERAL (no resolved docs)")

    # Use the raw last HumanMessage as the user turn — includes @mention labels
    # as natural language context for the LLM (not the engineered retrieval_query).
    last_human_content = ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            last_human_content = msg.content if isinstance(msg.content, str) else str(msg.content)
            break

    llm_messages = [
        SystemMessage(content=system_content),
        HumanMessage(content=last_human_content),
    ]

    # ── Step 6: LLM generation ────────────────────────────────────────────────
    llm = get_llm_service()
    llm_result = llm.invoke_structured("inquire", InquireResponse, llm_messages)
    parsed: InquireResponse = llm_result.parsed

    logger.info(
        "inquire | LLM: response_len=%d citations=%d tokens=%d cost=$%.6f",
        len(parsed.response), len(parsed.citations),
        llm_result.tokens_used, llm_result.cost_usd,
    )

    return {
        "response": parsed.response,
        "citations": [c.model_dump() for c in parsed.citations],
        "retrieved_chunks": chunks,
        "retrieval_confidence": confidence_tier,
        "confidence_score": avg_similarity,
        "tokens_used": llm_result.tokens_used,
        "cost_usd": llm_result.cost_usd,
        "web_search_results": web_results or None,
        "web_search_query": web_search_query,
        "messages": [AIMessage(content=parsed.response)],
    }
