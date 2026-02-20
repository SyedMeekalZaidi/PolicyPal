# pgvector & Embeddings

---

## The "Why" (Business Outcome)
Traditional databases search by exact match or keyword (`WHERE title LIKE '%capital%'`). That fails for meaning-based queries. A user asking *"what are the liquidity rules?"* won't match a chunk that says *"minimum cash reserve requirements"* — even though they mean the same thing.

Embeddings + pgvector solve this. They let you search by **meaning**, not just words. This is the foundation of every modern AI search system.

---

## The Concept Crash Course

### Level 1 — What is an Embedding?

An embedding is a list of numbers (a vector) that represents the *meaning* of a piece of text.

```
"The dog barked loudly"     → [0.21, -0.54, 0.88, 0.03, ... ] (1536 numbers)
"The puppy made loud noise" → [0.20, -0.52, 0.87, 0.04, ... ] (1536 numbers)
"Stock market crashed"      → [-0.71, 0.33, -0.12, 0.95, ... ] (completely different)
```

The first two sentences have similar meanings → their vectors are numerically close.
The third has a different meaning → its vector is far away.

**Analogy:** Imagine plotting every sentence in 3D space. Similar sentences cluster together. An embedding is just the (x, y, z) coordinate — except instead of 3 dimensions, we use 1536.

---

### Level 2 — How Similarity Search Works

When you query a vector DB, you're answering: *"Which stored vectors are closest to this query vector?"*

The mathematical measure is **cosine similarity**:
- 1.0 = identical meaning
- 0.0 = unrelated
- -1.0 = opposite meaning

```
Query: "What are the minimum capital requirements?"
       → embed → [0.33, -0.41, 0.76, ...]

Vector DB searches all stored chunk vectors:
  Chunk A: "Banks must maintain 8% tier-1 capital ratio" → similarity: 0.91 ✅ TOP RESULT
  Chunk B: "Customer complaints procedure"               → similarity: 0.12 ❌ Irrelevant
  Chunk C: "Minimum reserve capital buffer rules"        → similarity: 0.88 ✅ RETURNED
```

The DB returns the top-K results by similarity score. This is **semantic search**.

---

### Level 3 — pgvector: Postgres as a Vector DB

`pgvector` is a PostgreSQL extension that adds:
1. A new column type: `vector(1536)` — stores an array of 1536 floats
2. A similarity operator: `<=>` (cosine distance)
3. An index type: `HNSW` — makes searches fast even with millions of rows

**Why Postgres instead of a dedicated vector DB (like Pinecone)?**

| | pgvector | Pinecone |
|---|---|---|
| Setup | Already have Postgres (Supabase) | New service to manage |
| Cost | Free | Paid |
| SQL joins | Yes — filter by user_id, doc_id easily | No |
| Scale ceiling | ~10M vectors (more than enough for MVP) | Billions |
| Our choice | ✅ | ❌ (overkill for now) |

The rule: use what you already have until it breaks.

---

### Level 4 — The Schema Design

Our `chunks` table:
```
id            UUID    — unique identifier
user_id       UUID    — RLS scopes all searches to this user only
document_id   UUID    — links back to which PDF this came from
chunk_index   INT     — position within the document (for ordering)
page          INT     — which PDF page (for citations: "see page 34")
content       TEXT    — the actual text of this chunk
embedding     vector(1536)  — the 1536-dimension meaning vector
```

**Why store `page`?** When the LLM answers a question, we want to cite the exact page: *"According to page 34 of Capital Adequacy Framework..."* Without storing page number at ingestion time, we can never surface this.

---

### Level 5 — The HNSW Index

Without an index, finding the nearest vector requires comparing your query against *every single row* (called a full table scan). At 100,000 chunks, that's 100,000 comparisons per query — slow.

**HNSW (Hierarchical Navigable Small World)** builds a graph where nearby vectors are connected. Instead of checking all 100,000, it navigates the graph and checks ~200 — finding the approximate nearest neighbours in milliseconds.

```sql
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

**Trade-off:** HNSW gives *approximate* nearest neighbours, not exact. In practice, the accuracy is >99% for text embeddings, and the speed gain is 100x+. For RAG, approximate is fine.

---

### Level 6 — Choosing an Embedding Model

| Model | Dimensions | Relative Cost | Quality |
|---|---|---|---|
| `text-embedding-3-small` | 1536 | 1x (baseline) | Great for most RAG |
| `text-embedding-3-large` | 3072 | 6x | Marginally better |
| `text-embedding-ada-002` | 1536 | 2.5x | Older, worse than small |

**We chose `text-embedding-3-small` because:**
- Same dimensions as `ada-002` (1536) but 60% cheaper and more accurate
- For compliance text (structured, formal language), small is more than sufficient
- Every query + every chunk at ingestion runs through this model — cost compounds fast

**Critical rule:** The embedding model used at **ingestion** must be the **exact same model** used at **query time**. If you switch models, all stored vectors are incompatible and must be regenerated from scratch.

---

## Struggle Points
*(To be filled as you work through the material)*
- [ ] Why cosine similarity vs Euclidean distance (hint: cosine ignores vector magnitude)
- [ ] What "1536 dimensions" actually represents physically
- [ ] Why changing embedding models requires re-ingesting everything

---

## Active Recall Questions
1. Two sentences: "Fire the employee" and "Terminate the worker's contract" — would their embeddings be close or far? Why?
2. Why can't you switch embedding models mid-project without re-ingesting all documents?
3. What's the difference between `<=>` (cosine distance) and a SQL `LIKE` query? When would `LIKE` beat semantic search?
4. What does HNSW do, and what does "approximate nearest neighbours" mean in plain English?
5. We store `page` in the chunks table. Why? What feature does this enable?

---

## Spaced Repetition Log

| Date | Interval (Days) | Next Review | Status |
|---|---|---|---|
| Feb 20, 2026 | — | — | 📖 Need to Learn |
| Feb 20, 2026 | 1 | Feb 21, 2026 | ✅ Reviewed |
