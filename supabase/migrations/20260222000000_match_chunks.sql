-- match_chunks: pgvector cosine similarity search scoped to user + optional doc list.
-- Called via supabase.rpc("match_chunks", {...}) from retrieval_service.py.
-- Uses the existing HNSW index (idx_chunks_embedding) automatically.

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  filter_user_id uuid,
  filter_doc_ids uuid[] DEFAULT NULL,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 15
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  page int,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.chunk_index,
    c.page,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE c.user_id = filter_user_id
    AND (filter_doc_ids IS NULL OR c.document_id = ANY(filter_doc_ids))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 200);
$$;
