# Summarize action node — produces a structured summary of one or more documents.
#
# Pipeline:
#   1. Read state: resolved_doc_ids, resolved_doc_titles, clean_query, user context
#   2. stratified_sample() — positional spread across each doc (NOT semantic search)
#   3. Build per-doc grouped context block with ### section headings + global [N] numbering
#   4. GPT-4o-mini structured generation → SummarizeResponse (summary + key_points + citations)
#   5. Combine summary + key_points into one response string for the frontend renderer
#
# Key differences from Inquire:
#   - No rewrite_query() — positional sampling ignores the query
#   - No web search — summarization is about the user's uploaded documents only
#   - No mode selection — validate_inputs guarantees 1+ docs always arrive here
#   - confidence_score is fixed at 1.0 (no cosine similarity from positional sampling)
#   - retrieval_confidence is always "high" (full-document coverage by design)

import logging
from collections import defaultdict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langsmith import traceable

from app.graph.state import AgentState
from app.models.action_schemas import SummarizeResponse
from app.services.llm_service import get_llm_service
from app.services.retrieval_service import stratified_sample

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
# Structure: ROLE → CONTEXT → TASK → RULES → FORMAT  (§9 prompt engineering rules)
# Single mode — validate_inputs always guarantees 1+ docs arrive here.

_SYSTEM_PROMPT = """\
You are a compliance document summarizer for PolicyPal.

CONTEXT:
{context_block}

TASK: Produce a clear, professional summary structured for easy comprehension.

**Single document:** Use `####` subheadings for each major section of the document (e.g. #### Scope, #### Key Requirements, #### Governance). Under each subheading:
- Use bullet points for enumerated requirements or obligations.
- Bold defined terms and key thresholds on first mention (e.g. **Shariah Governance Framework**).
- Use *italics* for document or regulation names (e.g. *Banking Act 1970*).

**Multiple documents:** Use a `### DocumentTitle` heading per document, then apply the same subheading + bullet structure within each section.

RULES:
- CITATION IDs: Each citation's `id` MUST equal the exact [N] number you wrote in the summary. Never renumber 1, 2, 3... — if you cited [4], the citation object must have id=4.
- Place [N] markers immediately after specific claims.
- Cover all major topics — do not skip sections.
- Do not merge content from different documents.
- Do not use prior knowledge — summarize only what is in the context above.
- If a focus instruction is provided, emphasize that area throughout.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context header.{user_context}

FORMAT: Return a summary string (#### subheadings + bullets + bold + [N] markers), a key_points list of 3-7 concise takeaways, and a citations list. Each citation id must match its [N] marker exactly.\
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_summarize_context(
    chunks: list[dict],
    resolved_doc_ids: list[str],
    resolved_doc_titles: dict[str, str],
) -> str:
    """
    Build the per-doc grouped [N] context block for the system prompt.

    Groups chunks under "### DocTitle" headings in resolved_doc_ids order.
    Global [N] numbering across all documents — critical for citation mapping.

    Unlike Inquire's interleaved context (sorted by relevance), Summarize groups
    by document so the LLM can write coherent per-doc summary sections.
    """
    # Group chunks by document_id, preserving chunk order within each doc
    doc_chunks: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        doc_chunks[chunk["document_id"]].append(chunk)

    # Sort chunks within each doc by chunk_index for natural document flow
    for doc_id in doc_chunks:
        doc_chunks[doc_id].sort(key=lambda c: c.get("chunk_index", 0))

    parts: list[str] = []
    n = 1  # global citation counter across all docs

    # Iterate in resolved_doc_ids order for consistent, predictable output
    for doc_id in resolved_doc_ids:
        chunks_for_doc = doc_chunks.get(doc_id, [])
        if not chunks_for_doc:
            continue

        # Use resolved_doc_titles (from state, zero DB calls) with fallback
        title = resolved_doc_titles.get(doc_id, "Document")
        parts.append(f"### {title}")

        for chunk in chunks_for_doc:
            page_str = str(chunk["page"]) if chunk.get("page") is not None else "N/A"
            parts.append(
                f'[{n}] Source: {chunk.get("doc_title", title)} | Page: {page_str}'
                f' | DocID: {doc_id}\n'
                f'"{chunk["content"]}"'
            )
            n += 1

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


@traceable(run_type="chain", name="summarize_action")
def summarize_action(state: AgentState) -> dict:
    """
    LangGraph node: produce a structured summary of resolved documents.

    Returns partial state update with response, citations, retrieval metadata, and cost.
    """
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    resolved_doc_titles: dict = state.get("resolved_doc_titles") or {}
    user_id: str = state.get("user_id") or ""
    user_industry: str = state.get("user_industry") or ""
    user_location: str = state.get("user_location") or ""

    # clean_query carries any user focus instruction (e.g. "Focus on capital requirements").
    # Empty for pure @mentions like "@Summarize @Doc" — replaced with a default below.
    focus_instruction: str = state.get("clean_query") or ""

    logger.info(
        "summarize | docs=%d focus=%r",
        len(resolved_doc_ids), focus_instruction[:80],
    )

    # ── Step 1: Stratified positional sampling ────────────────────────────────
    # Positional spread — 4 bands × 4 chunks per doc = ~16 chunks/doc.
    # Does NOT use embeddings. confidence_tier is always "high" by design.
    retrieval = stratified_sample(user_id=user_id, doc_ids=resolved_doc_ids)
    chunks: list[dict] = retrieval["chunks"]

    logger.info(
        "summarize | sampled %d chunks across %d doc(s)",
        len(chunks), len(resolved_doc_ids),
    )

    # ── Step 2: Build per-doc grouped context block ───────────────────────────
    context_block = _build_summarize_context(chunks, resolved_doc_ids, resolved_doc_titles)

    # Defensive fallback — validate_inputs guarantees docs, but guard anyway
    if not context_block:
        fallback = "I wasn't able to retrieve content from the selected document(s). Please ensure the documents have been processed successfully."
        logger.warning("summarize | empty context after sampling docs=%s", resolved_doc_ids)
        return {
            "response": fallback,
            "citations": [],
            "retrieved_chunks": [],
            "retrieval_confidence": "low",
            "confidence_score": 0.0,
            "tokens_used": 0,
            "cost_usd": 0.0,
            "messages": [AIMessage(content=fallback)],
        }

    # ── Step 3: Build system prompt ───────────────────────────────────────────
    user_context_line = ""
    if user_industry or user_location:
        ctx_parts = [p for p in [user_industry, user_location] if p]
        user_context_line = (
            f"\nUser context: Works in {' / '.join(ctx_parts)}. "
            "Tailor regulatory references and examples to their jurisdiction."
        )

    system_content = _SYSTEM_PROMPT.format(
        context_block=context_block,
        user_context=user_context_line,
    )

    # ── Step 4: Build human message ───────────────────────────────────────────
    # Use focus instruction if the user provided one, otherwise give a clear default.
    # Sending an empty string to the LLM degrades output quality.
    human_content = focus_instruction.strip() if focus_instruction.strip() else "Summarize these documents comprehensively."

    llm_messages = [
        SystemMessage(content=system_content),
        HumanMessage(content=human_content),
    ]

    # ── Step 5: LLM generation ────────────────────────────────────────────────
    llm = get_llm_service()
    llm_result = llm.invoke_structured("summarize", SummarizeResponse, llm_messages)
    parsed: SummarizeResponse = llm_result.parsed

    logger.info(
        "summarize | LLM: summary_len=%d key_points=%d citations=%d tokens=%d cost=$%.6f",
        len(parsed.summary), len(parsed.key_points), len(parsed.citations),
        llm_result.tokens_used, llm_result.cost_usd,
    )

    # ── Step 6: Combine summary + key_points into single response string ──────
    # Frontend renders this via CitedMarkdown — markdown formatting is preserved.
    if parsed.key_points:
        bullet_list = "\n".join(f"- {point}" for point in parsed.key_points)
        response = f"{parsed.summary}\n\n**Key Points:**\n{bullet_list}"
    else:
        response = parsed.summary

    return {
        "response": response,
        "citations": [c.model_dump() for c in parsed.citations],
        "retrieved_chunks": chunks,
        # Positional sampling always covers the full document — confidence is always high.
        # confidence_score is fixed at 1.0 (no cosine similarity from positional sampling).
        "retrieval_confidence": "high",
        "confidence_score": 1.0,
        "tokens_used": llm_result.tokens_used,
        "cost_usd": llm_result.cost_usd,
        "messages": [AIMessage(content=response)],
    }
