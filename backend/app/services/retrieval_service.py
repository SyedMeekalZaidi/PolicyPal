# Retrieval service — shared by all 4 action nodes.
#
# Two strategies:
#   search_chunks()     — adaptive-k semantic search via pgvector RPC (Inquire, Compare, Audit text)
#   stratified_sample() — positional spread via direct table queries (Summarize, Compare holistic, Audit policy)
#
# Both functions enrich chunks with doc_title via _enrich_with_titles() (DRY).
# Confidence tier: high ≥ 0.7, medium ≥ 0.5, low < 0.5 (based on avg cosine similarity).

import logging
from collections import defaultdict

from langsmith import traceable

from app.services.embedding_service import embed_texts
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Per-doc chunk cap for adaptive-k: prevents a single large doc dominating retrieval
_MAX_CHUNKS_PER_DOC = 5


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _score_confidence(similarities: list[float]) -> tuple[str, float]:
    """Convert a list of cosine similarities to a confidence tier + average."""
    if not similarities:
        return "low", 0.0
    avg = sum(similarities) / len(similarities)
    if avg >= 0.7:
        tier = "high"
    elif avg >= 0.5:
        tier = "medium"
    else:
        tier = "low"
    return tier, avg


def _enrich_with_titles(chunks: list[dict]) -> list[dict]:
    """
    Fetch doc titles for all unique document_ids in chunks and merge into each chunk dict.

    Returns new list of dicts with added 'doc_title' key.
    match_chunks RPC does not return titles; we do one extra query here (DRY).
    """
    if not chunks:
        return chunks

    unique_doc_ids = list({c["document_id"] for c in chunks})

    try:
        resp = (
            get_supabase()
            .table("documents")
            .select("id, title")
            .in_("id", unique_doc_ids)
            .execute()
        )
        id_to_title: dict[str, str] = {
            row["id"]: row["title"] for row in (resp.data or [])
        }
    except Exception as e:
        logger.warning("retrieval | _enrich_with_titles failed: %s — using doc_id fallback", e)
        id_to_title = {}

    return [
        {**chunk, "doc_title": id_to_title.get(chunk["document_id"], chunk["document_id"])}
        for chunk in chunks
    ]


# ---------------------------------------------------------------------------
# Semantic search (Inquire, Compare per-doc, Audit text mode)
# ---------------------------------------------------------------------------


@traceable(name="search_chunks", run_type="retriever")
def search_chunks(
    query_text: str,
    user_id: str,
    doc_ids: list[str] | None,
    k: int = 15,
    threshold: float = 0.5,
) -> dict:
    """
    Embed query_text, call match_chunks RPC, cap per-doc chunks, return enriched results.

    Args:
        query_text: the user's question or search phrase
        user_id:    for RLS scoping (admin client still passes user_id explicitly)
        doc_ids:    None = all user docs, list = scoped to specific docs
        k:          max total chunks to return before per-doc cap
        threshold:  minimum cosine similarity (0-1); chunks below this are excluded

    Returns:
        {
            "chunks": list[dict],   # each: {id, document_id, doc_title, chunk_index, page, content, similarity}
            "confidence_tier": str, # "high" | "medium" | "low"
            "avg_similarity": float,
        }
    """
    # Embed the query (single vector, not batched)
    try:
        query_embedding = embed_texts([query_text])[0]
    except Exception as e:
        logger.error("retrieval | embedding failed for query %r: %s", query_text[:80], e)
        return {"chunks": [], "confidence_tier": "low", "avg_similarity": 0.0}

    # Call RPC
    try:
        rpc_params = {
            "query_embedding": query_embedding,
            "filter_user_id": user_id,
            "filter_doc_ids": doc_ids if doc_ids else None,
            "match_threshold": threshold,
            "match_count": k,
        }
        resp = get_supabase().rpc("match_chunks", rpc_params).execute()
        raw_chunks: list[dict] = resp.data or []
    except Exception as e:
        logger.error("retrieval | match_chunks RPC failed: %s", e)
        return {"chunks": [], "confidence_tier": "low", "avg_similarity": 0.0}

    logger.info(
        "retrieval | search_chunks: query=%r docs=%s k=%d threshold=%.2f → %d raw chunks",
        query_text[:60], doc_ids, k, threshold, len(raw_chunks),
    )

    if not raw_chunks:
        return {"chunks": [], "confidence_tier": "low", "avg_similarity": 0.0}

    # Cap per-doc: prevent one large doc from filling all slots
    doc_chunk_counts: dict[str, int] = defaultdict(int)
    capped: list[dict] = []
    for chunk in raw_chunks:  # already sorted by similarity desc from RPC
        doc_id = chunk["document_id"]
        if doc_chunk_counts[doc_id] < _MAX_CHUNKS_PER_DOC:
            capped.append(chunk)
            doc_chunk_counts[doc_id] += 1

    enriched = _enrich_with_titles(capped)
    similarities = [c["similarity"] for c in enriched]
    tier, avg = _score_confidence(similarities)

    logger.info(
        "retrieval | after cap: %d chunks, confidence=%s avg_sim=%.3f",
        len(enriched), tier, avg,
    )

    return {"chunks": enriched, "confidence_tier": tier, "avg_similarity": avg}


# ---------------------------------------------------------------------------
# Stratified positional sampling (Summarize, Compare holistic, Audit policy)
# ---------------------------------------------------------------------------


@traceable(name="stratified_sample", run_type="retriever")
def stratified_sample(user_id: str, doc_ids: list[str]) -> dict:
    """
    Positional spread across each document — 4 bands, 4 chunks per band (~16 per doc).

    Does NOT use match_chunks RPC (semantic search is biased toward repeated terms).
    Uses direct Supabase table queries by chunk_index range.

    Returns:
        {
            "chunks": list[dict],   # each: {id, document_id, doc_title, chunk_index, page, content}
            "confidence_tier": "high",  # positional sampling always covers the full doc
        }
    """
    all_chunks: list[dict] = []
    supabase = get_supabase()

    for doc_id in doc_ids:
        # Step 1: get total chunk count for this doc
        try:
            count_resp = (
                supabase
                .table("chunks")
                .select("chunk_index", count="exact")
                .eq("document_id", doc_id)
                .eq("user_id", user_id)
                .execute()
            )
            total = count_resp.count or 0
        except Exception as e:
            logger.error("retrieval | stratified count failed for doc=%s: %s", doc_id, e)
            continue

        if total == 0:
            logger.warning("retrieval | stratified: no chunks found for doc=%s", doc_id)
            continue

        # Step 2: divide into 4 bands and fetch 4 chunks per band
        band_size = max(total // 4, 1)
        doc_chunks: list[dict] = []

        for band_idx in range(4):
            band_start = band_idx * band_size
            # Last band extends to end to avoid off-by-one gaps
            band_end = (band_idx + 1) * band_size if band_idx < 3 else total

            try:
                band_resp = (
                    supabase
                    .table("chunks")
                    .select("id, document_id, chunk_index, page, content")
                    .eq("document_id", doc_id)
                    .eq("user_id", user_id)
                    .gte("chunk_index", band_start)
                    .lt("chunk_index", band_end)
                    .order("chunk_index")
                    .limit(4)
                    .execute()
                )
                doc_chunks.extend(band_resp.data or [])
            except Exception as e:
                logger.error(
                    "retrieval | stratified band fetch failed doc=%s band=%d: %s",
                    doc_id, band_idx, e,
                )

        logger.info(
            "retrieval | stratified doc=%s total_chunks=%d sampled=%d",
            doc_id, total, len(doc_chunks),
        )
        all_chunks.extend(doc_chunks)

    enriched = _enrich_with_titles(all_chunks)

    return {
        "chunks": enriched,
        "confidence_tier": "high",  # positional sampling covers full document — always high
    }
