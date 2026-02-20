# RAG Foundations & Pipeline Design

---

## The "Why" (Business Outcome)
LLMs are trained on public data up to a cutoff date. They know nothing about *your* documents. RAG (Retrieval-Augmented Generation) is the architectural pattern that bridges this gap — it lets you inject your private, up-to-date knowledge into an LLM's answer *at query time*, without retraining the model.

**Without RAG:** "What does our Capital Adequacy policy say?" → LLM guesses or says "I don't know."
**With RAG:** The system finds the 3 most relevant chunks from your uploaded PDF, injects them, and the LLM answers accurately.

---

## The Concept Crash Course

### Level 1 — The Core Problem

An LLM's context window is like working memory — it's fast but limited. GPT-4o can hold ~128,000 tokens. A 300-page regulatory document is ~200,000+ tokens. You can't fit it all in. Even if you could, it's expensive and slow.

**Solution:** Don't send the whole document. Send only the *relevant pieces*.

---

### Level 2 — The Two Phases

RAG has two completely separate phases that happen at different times:

```
PHASE 1: INGESTION (happens once, when user uploads a PDF)
─────────────────────────────────────────────────────────
PDF → Extract Text → Chunk → Embed → Store in Vector DB

PHASE 2: RETRIEVAL (happens every query)
──────────────────────────────────────────
User Question → Embed Question → Search Vector DB → Top-K Chunks → LLM → Answer
```

Think of Phase 1 as building a library index. Phase 2 is using that index to find the right books.

---

### Level 3 — Each Step Explained

**Step 1: Extract Text**
- Tool: `pypdf` (reads the raw text from each page of a PDF)
- Output: A list of strings, one per page
- Edge case: Scanned PDFs are *images*, not text — `pypdf` returns nothing. Must reject with a helpful error.

**Step 2: Chunk**
- Tool: `RecursiveCharacterTextSplitter`
- Why chunk? LLMs work best with focused context. Sending a full chapter is noisy.
- **Chunk size:** 1000 characters (~250 tokens) — enough for a complete idea
- **Chunk overlap:** 150 characters — prevents a sentence from being cut in half across two chunks. Without overlap, a key fact could land on the boundary and be retrieved incompletely.
- Output: Many smaller text pieces, each tagged with its source page number (critical for citations later)

**Step 3: Embed**
- Tool: OpenAI `text-embedding-3-small`
- What is an embedding? A list of 1536 numbers (a vector) that represents the *meaning* of a text. Texts with similar meanings produce vectors that are mathematically close together.
- Why batch? OpenAI charges per API call overhead. Sending 500 chunks in 1 call is ~100x cheaper than 500 individual calls.
- Output: 1536-dimensional vector per chunk

**Step 4: Store in Vector DB**
- Tool: `pgvector` (a PostgreSQL extension)
- Stores: chunk text + embedding vector + metadata (page number, document ID, user ID)
- Indexed with HNSW (a graph algorithm) for fast nearest-neighbour search at scale

**Step 5: Retrieve (at query time)**
- Embed the user's question using the same model
- Search pgvector for the K chunks whose vectors are closest to the question vector
- "Closest" = most semantically similar = most relevant
- Return top-K chunks (typically 3–8 depending on complexity)

**Step 6: Generate**
- Inject the chunks into the LLM prompt as context
- LLM reads them and generates a grounded answer
- Because the LLM only sees the relevant chunks, it stays accurate and focused

---

### Level 4 — Key Design Decisions & Tradeoffs

| Decision | Option A | Option B | Winner (for PolicyPal) |
|---|---|---|---|
| Chunk size | 500 chars (small) | 1000 chars (medium) | 1000 — enough context per chunk |
| Overlap | 0 (no overlap) | 150 chars | 150 — prevents boundary cuts |
| Embedding model | `text-embedding-3-large` | `text-embedding-3-small` | small — 5x cheaper, 90% as good |
| Top-K chunks | 3 | 8 | Depends on action (Inquire=3, Audit=8) |

**The core tradeoff:** Larger chunks = more context per chunk, fewer chunks needed → cheaper retrieval. But larger chunks are noisier — the LLM gets irrelevant sentences alongside the key fact. Smaller chunks = more precise, but risk cutting ideas mid-sentence.

---

### Level 5 — What Makes RAG "Agentic"

Basic RAG always searches all documents. Agentic RAG (what PolicyPal does) adds:
- **Smart document selection:** The agent decides *which* documents to search before querying
- **Confidence scoring:** The agent rates how sure it is, based on similarity scores
- **Action-specific retrieval:** Inquire uses 3 chunks, Audit uses 8 — different needs, different strategies
- **Memory:** Previous conversation turns inform what to retrieve next

---

## Struggle Points
*(To be filled as you work through the material)*
- [ ] Why overlap prevents lost information at chunk boundaries
- [ ] How vector similarity actually works mathematically (dot product vs cosine)
- [ ] Why `text-embedding-3-small` dimensions (1536) aren't arbitrary

---

## Active Recall Questions
1. A user uploads a scanned PDF (image-based). What happens at the extraction step, and how does our system handle it?
2. Why do we chunk with 150-character overlap instead of 0?
3. What is the difference between Phase 1 (ingestion) and Phase 2 (retrieval)? Which is slower?
4. Why do we batch embedding API calls instead of sending one chunk at a time?
5. An LLM with a 128K token context window exists. Why do we still use RAG instead of sending the full document?

---

## Spaced Repetition Log

| Date | Interval (Days) | Next Review | Status |
|---|---|---|---|
| Feb 20, 2026 | — | — | 📖 Need to Learn |
