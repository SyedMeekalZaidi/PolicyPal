# Compare action node — generates a structured comparison of 2-5 documents.
#
# Pipeline:
#   1. Read state: resolved_doc_ids, resolved_doc_titles, clean_query, user context
#   2. Mode classification (GPT-4o-mini, ~$0.001):
#        - Empty query       → holistic (shortcut, $0)
#        - Specific topic    → focused  (per-doc semantic search + table)
#        - General/no topic  → holistic (stratified sampling + 5-section report)
#   3. Focused branch:
#        rewrite_query() → per-doc search_chunks() (k=7/doc) → merge + confidence
#   4. Holistic branch:
#        stratified_sample() → extract_themes() → 3-5 theme strings
#   5. _build_compare_context() — per-doc grouped [N] blocks; ALL docs get a heading
#      even when 0 chunks were found (empty-doc placeholder so LLM writes "Not addressed")
#   6. Mode-specific GPT-4o generation → CompareResponse (response + citations)
#   7. Return state update — costs summed across all LLM calls in the run

import logging
from collections import defaultdict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langsmith import traceable

from app.graph.state import AgentState
from app.graph.utils import rewrite_query
from app.models.action_schemas import CompareIntent, CompareResponse
from app.services.llm_service import get_llm_service
from app.services.retrieval_service import search_chunks, stratified_sample
from app.services.theme_service import extract_themes

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _score_confidence(similarities: list[float]) -> tuple[str, float]:
    """Convert a list of cosine similarities to a confidence tier + average."""
    if not similarities:
        return "low", 0.0
    avg = sum(similarities) / len(similarities)
    if avg >= 0.7:
        return "high", avg
    elif avg >= 0.5:
        return "medium", avg
    return "low", avg


def _build_compare_context(
    chunks: list[dict],
    resolved_doc_ids: list[str],
    resolved_doc_titles: dict[str, str],
    sort_by: str = "similarity",
) -> str:
    """
    Build the per-doc grouped [N] context block for the system prompt.

    Critical difference from Summarize: ALL docs always get a heading, even
    those with 0 retrieved chunks. This ensures the LLM knows every tagged
    document exists and writes "Not addressed" in table cells rather than
    silently omitting a column.

    Args:
        chunks:               Flat list of all retrieved chunks across all docs.
        resolved_doc_ids:     Doc ordering determines section order in the block.
        resolved_doc_titles:  {doc_id: title} for heading labels.
        sort_by:              "similarity" (focused — most relevant first) or
                              "chunk_index" (holistic — natural document flow).
    """
    doc_chunks: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        doc_chunks[chunk["document_id"]].append(chunk)

    for doc_id in doc_chunks:
        if sort_by == "similarity":
            doc_chunks[doc_id].sort(key=lambda c: c.get("similarity", 0.0), reverse=True)
        else:
            doc_chunks[doc_id].sort(key=lambda c: c.get("chunk_index", 0))

    parts: list[str] = []
    n = 1  # global citation counter across all docs

    for doc_id in resolved_doc_ids:
        title = resolved_doc_titles.get(doc_id, "Document")
        parts.append(f"### {title} (DocID: {doc_id})")

        chunks_for_doc = doc_chunks.get(doc_id, [])
        if not chunks_for_doc:
            # Placeholder — LLM must acknowledge this doc exists in comparison
            parts.append("(No relevant passages found for this topic.)")
            continue

        for chunk in chunks_for_doc:
            page_str = str(chunk["page"]) if chunk.get("page") is not None else "N/A"
            parts.append(
                f'[{n}] Source: {chunk.get("doc_title", title)} | Page: {page_str}\n'
                f'"{chunk["content"]}"'
            )
            n += 1

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# System prompt templates
# ---------------------------------------------------------------------------
# Structure: ROLE → CONTEXT → TASK → RULES → FORMAT  (§9 prompt engineering rules)

_CLASSIFICATION_PROMPT = """\
You are a comparison mode classifier.

DOCUMENTS: {doc_titles}

TASK: Given the user's comparison request, determine:
1. Mode: "focused" if the user asks about a SPECIFIC topic or aspect of the documents, \
"holistic" if they want a general, comprehensive, or full comparison.
2. Topic: if focused, extract the specific comparison topic (2-10 words). If holistic, set to null.

RULES:
- "Compare everything" / "thorough analysis" / "full comparison" / no specific topic → holistic
- "Compare capital requirements" / "how do they differ on X?" / "contrast their approach to Y" → focused with topic=X/Y
- When in doubt, default to holistic (safer — shows everything).\
"""

_SYSTEM_PROMPT_FOCUSED = """\
You are a compliance document comparison analyst for PolicyPal.

CONTEXT:
{context_block}

COMPARISON TOPIC: {topic}

TASK: Generate a focused, professional comparison structured as follows:

**Part 1 — Comparison Table**
Use this exact header row:
{table_header}
- Each cell: 1-2 sentences with the key finding. Bold the single most important term or threshold in each cell (e.g. **8% minimum ratio**).
- If a document doesn't address an aspect, write *Not addressed*.
- Include 4-8 meaningful rows covering distinct aspects of the topic.

**Part 2 — Analysis**
Structure the analysis with these two subheadings:
#### Key Differences
- Use bullet points — one bullet per significant difference.
- Bold the regulatory concept being contrasted on each bullet (e.g. **Capital Requirements**: ...).
- Cite every factual claim with [N].

#### Implications
- 1-2 short paragraphs on what these differences mean for compliance professionals.
- Use *italics* to name each jurisdiction (e.g. *Malaysia*, *Singapore*) for scannability.

RULES:
- CITATION IDs: Each citation's `id` MUST equal the exact [N] number you wrote in the response. Never renumber 1, 2, 3... — if you cited [7], the citation object must have id=7.
- Use ONLY the context above. Do not use prior knowledge.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context section header.{user_context}

FORMAT: Return a response string (table + #### subheadings + bullets with [N] markers) and a citations list. Each citation id must match its [N] marker exactly.\
"""

_SYSTEM_PROMPT_HOLISTIC = """\
You are a compliance document comparison analyst for PolicyPal.

CONTEXT:
{context_block}

KEY THEMES IDENTIFIED: {themes}

TASK: Generate a professional, well-structured comparison report with these 5 sections. \
Use markdown formatting throughout for clarity and scannability.

### Overview
- One short paragraph per document. Bold the document name (e.g. **MY-Islamic-Banking**) at the start of its paragraph.
- State each document's regulatory scope and primary purpose.

### Key Differences
- Use a bullet list — one bullet per significant divergence across the identified themes.
- Format each bullet: **Theme Name**: _DocumentA_ does X, while _DocumentB_ does Y [N].
- Italicise document names for scannability throughout this section.

### Similarities
- Use a bullet list — one bullet per shared requirement or approach [N].
- Bold the shared concept at the start of each bullet (e.g. **Capital Adequacy**: both require...).

### Unique Aspects
- Sub-group by document using a **DocumentName** bold label, then bullets for what is exclusive to that document [N].

### Implications
- 2-3 short paragraphs on practical compliance impact.
- Use *italics* for jurisdiction names (*Malaysia*, *Singapore*).
- Bold the single most actionable takeaway per paragraph.

RULES:
- CITATION IDs: Each citation's `id` MUST equal the exact [N] number you wrote in the response. Never renumber 1, 2, 3... — if you cited [7], the citation object must have id=7.
- Place [N] after every factual claim throughout all sections.
- Use ONLY the context above. Do not use prior knowledge.
- Do not merge content from different documents without attribution.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context section header.{user_context}

FORMAT: Return a response string (5 ### sections with bullets, bold, italics, and [N] markers) and a citations list. Each citation id must match its [N] marker exactly.\
"""


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


@traceable(run_type="chain", name="compare_action")
def compare_action(state: AgentState) -> dict:
    """
    LangGraph node: compare 2-5 documents in focused (table) or holistic (report) mode.

    Returns partial state update with response, citations, retrieval metadata, and cost.
    All LLM costs (classification + theme extraction + generation) are summed.
    """
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    resolved_doc_titles: dict[str, str] = state.get("resolved_doc_titles") or {}
    clean_query: str = state.get("clean_query") or ""
    user_id: str = state.get("user_id") or ""
    user_industry: str = state.get("user_industry") or ""
    user_location: str = state.get("user_location") or ""

    llm = get_llm_service()
    total_tokens = 0
    total_cost = 0.0

    logger.info(
        "compare | docs=%d query=%r",
        len(resolved_doc_ids), clean_query[:80],
    )

    # ── Step 2: Mode classification ───────────────────────────────────────────
    # Shortcut: empty query → holistic (nothing to classify, saves $0.001 + latency)
    mode = "holistic"
    topic: str | None = None

    if clean_query.strip():
        try:
            doc_titles_str = ", ".join(resolved_doc_titles.values())
            classify_messages = [
                SystemMessage(content=_CLASSIFICATION_PROMPT.format(doc_titles=doc_titles_str)),
                HumanMessage(content=clean_query),
            ]
            classify_result = llm.invoke_structured("intent", CompareIntent, classify_messages)
            mode = classify_result.parsed.mode
            topic = classify_result.parsed.topic
            total_tokens += classify_result.tokens_used
            total_cost += classify_result.cost_usd
            logger.info(
                "compare | classification: mode=%s topic=%r tokens=%d cost=$%.6f",
                mode, topic, classify_result.tokens_used, classify_result.cost_usd,
            )
        except Exception as exc:
            logger.warning("compare | classification failed → holistic fallback: %s", exc)
            mode = "holistic"

    # Guard: focused requires a topic or a query to actually search for
    if mode == "focused" and not topic and not clean_query.strip():
        logger.info("compare | focused mode but no topic and no query → holistic fallback")
        mode = "holistic"

    # ── Steps 3-4: Retrieval ──────────────────────────────────────────────────

    chunks: list[dict] = []
    confidence_tier = "high"
    avg_similarity = 1.0
    themes_str = ""

    if mode == "focused":
        # Per-doc semantic retrieval: k=7 per doc to guarantee balanced coverage
        search_topic = topic or clean_query
        retrieval_query = rewrite_query(search_topic, resolved_doc_titles, "compare").retrieval

        logger.info(
            "compare | focused: topic=%r retrieval_query=%r",
            search_topic[:60], retrieval_query[:80],
        )

        for doc_id in resolved_doc_ids:
            result = search_chunks(
                query_text=retrieval_query,
                user_id=user_id,
                doc_ids=[doc_id],
                k=7,
                threshold=0.5,
            )
            chunks.extend(result["chunks"])

        all_similarities = [c.get("similarity", 0.0) for c in chunks]
        confidence_tier, avg_similarity = _score_confidence(all_similarities)

        logger.info(
            "compare | focused: total_chunks=%d confidence=%s avg_sim=%.3f",
            len(chunks), confidence_tier, avg_similarity,
        )

        # Early return: focused mode found nothing across ALL docs
        if not chunks:
            fallback = (
                f"I couldn't find relevant content about '{search_topic}' in the selected "
                "documents. Try rephrasing your question or verify that this topic is "
                "covered in your uploaded documents."
            )
            return {
                "response": fallback,
                "citations": [],
                "retrieved_chunks": [],
                "retrieval_confidence": "low",
                "confidence_score": 0.0,
                "tokens_used": total_tokens,
                "cost_usd": total_cost,
                "messages": [AIMessage(content=fallback)],
            }

    else:
        # Holistic: positional spread + theme extraction
        retrieval = stratified_sample(user_id=user_id, doc_ids=resolved_doc_ids)
        chunks = retrieval["chunks"]

        theme_result = extract_themes(chunks, resolved_doc_titles)
        themes_list: list[str] = theme_result.parsed.themes
        total_tokens += theme_result.tokens_used
        total_cost += theme_result.cost_usd

        themes_str = ", ".join(themes_list)
        confidence_tier = "high"
        avg_similarity = 1.0

        logger.info(
            "compare | holistic: chunks=%d themes=%s tokens=%d cost=$%.6f",
            len(chunks), themes_list, theme_result.tokens_used, theme_result.cost_usd,
        )

    # ── Step 5: Build per-doc grouped context block ───────────────────────────
    sort_by = "similarity" if mode == "focused" else "chunk_index"
    context_block = _build_compare_context(chunks, resolved_doc_ids, resolved_doc_titles, sort_by)

    # ── Step 6: Build mode-specific system prompt ─────────────────────────────
    user_context_line = ""
    if user_industry or user_location:
        ctx_parts = [p for p in [user_industry, user_location] if p]
        user_context_line = (
            f"\nUser context: Works in {' / '.join(ctx_parts)}. "
            "Tailor regulatory references and examples to their jurisdiction."
        )

    if mode == "focused":
        # Build exact table header so the LLM uses real document titles as column names
        table_header = "| Aspect | " + " | ".join(resolved_doc_titles.values()) + " |"
        system_content = _SYSTEM_PROMPT_FOCUSED.format(
            context_block=context_block,
            topic=search_topic,  # type: ignore[possibly-undefined]  # defined when mode=="focused"
            table_header=table_header,
            user_context=user_context_line,
        )
    else:
        system_content = _SYSTEM_PROMPT_HOLISTIC.format(
            context_block=context_block,
            themes=themes_str,
            user_context=user_context_line,
        )

    # ── Step 7: Build human message ───────────────────────────────────────────
    if mode == "focused":
        human_content = clean_query.strip() if clean_query.strip() else f"Compare these documents on: {search_topic}"  # type: ignore[possibly-undefined]
    else:
        human_content = "Compare these documents comprehensively across the identified themes."

    llm_messages = [
        SystemMessage(content=system_content),
        HumanMessage(content=human_content),
    ]

    # ── Step 8: GPT-4o generation (routed via "compare" action key) ───────────
    llm_result = llm.invoke_structured("compare", CompareResponse, llm_messages)
    parsed: CompareResponse = llm_result.parsed

    total_tokens += llm_result.tokens_used
    total_cost += llm_result.cost_usd

    logger.info(
        "compare | LLM: mode=%s response_len=%d citations=%d tokens=%d cost=$%.6f",
        mode, len(parsed.response), len(parsed.citations),
        llm_result.tokens_used, llm_result.cost_usd,
    )

    # ── Step 9: Return state update ───────────────────────────────────────────
    return {
        "response": parsed.response,
        "citations": [c.model_dump() for c in parsed.citations],
        "retrieved_chunks": chunks,
        "retrieval_confidence": confidence_tier,
        "confidence_score": avg_similarity,
        "tokens_used": total_tokens,
        "cost_usd": total_cost,
        "messages": [AIMessage(content=parsed.response)],
    }
