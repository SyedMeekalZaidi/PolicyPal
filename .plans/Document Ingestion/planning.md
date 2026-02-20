# Document Ingestion Pipeline - System Architecture

## High-Level Flow (A to Z)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. USER UPLOADS PDF                                                 │
│    Browser → PDF file + metadata (title, version, doc_type, set)   │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. NEXT.JS API ROUTE (Security Layer)                              │
│    /api/documents/upload/route.ts                                  │
│    - Authenticates user (Supabase session)                         │
│    - Extracts user_id from session                                 │
│    - Forwards file + metadata + user_id to backend                 │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼ (HTTP POST)
┌─────────────────────────────────────────────────────────────────────┐
│ 3. FASTAPI BACKEND (Processing Orchestrator)                       │
│    POST /ingest                                                     │
│                                                                     │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ Step 1: Upload PDF to Supabase Storage                   │   │
│    │         Path: {user_id}/{document_id}/{filename}         │   │
│    │         storage_service.py                                │   │
│    └──────────────────────────────────────────────────────────┘   │
│                             ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ Step 2: Create document record (status='processing')     │   │
│    │         documents table                                   │   │
│    └──────────────────────────────────────────────────────────┘   │
│                             ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ Step 3: Extract text from PDF                            │   │
│    │         PyPDFLoader (page-by-page with page numbers)     │   │
│    │         processing_service.py                             │   │
│    └──────────────────────────────────────────────────────────┘   │
│                             ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ Step 4: Chunk text                                       │   │
│    │         RecursiveCharacterTextSplitter                   │   │
│    │         - 1000 chars per chunk                           │   │
│    │         - 150 char overlap                               │   │
│    │         - Preserves page numbers                         │   │
│    │         processing_service.py                             │   │
│    └──────────────────────────────────────────────────────────┘   │
│                             ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ Step 5: Generate embeddings                              │   │
│    │         OpenAI text-embedding-3-small                    │   │
│    │         - Batch embed all chunks (1 API call)            │   │
│    │         - Returns 1536-dimensional vectors               │   │
│    │         embedding_service.py                              │   │
│    └──────────────────────────────────────────────────────────┘   │
│                             ▼                                       │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ Step 6: Save chunks to database (ATOMIC TRANSACTION)     │   │
│    │         - Insert all chunks at once                      │   │
│    │         - Each chunk: content + embedding + page + user  │   │
│    │         - Update document (status='ready', chunk_count)  │   │
│    │         - Rollback if any step fails                     │   │
│    └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. SUPABASE (Storage + Database)                                   │
│    - Storage: Raw PDF files ({user_id}/{doc_id}/{filename})       │
│    - documents: Metadata + status                                  │
│    - chunks: Text content + embeddings (pgvector)                  │
│    - HNSW index on embeddings for fast similarity search           │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. RESULT RETURNED TO FRONTEND                                     │
│    { document_id, status: 'ready', chunk_count: 487 }              │
│    Frontend shows: "Document ready! ✅"                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Choices & Rationale

### 1. **Next.js API Route as Security Proxy**
**Choice:** Frontend → Next.js API → FastAPI (not Frontend → FastAPI directly)

**Why:**
- **Security:** Browser never knows FastAPI URL or API keys
- **Authentication:** Next.js validates Supabase session before forwarding
- **CORS:** Avoids cross-origin issues (Next.js same-origin as frontend)
- **Future-proof:** Can add rate limiting, request validation at proxy layer

---

### 2. **Synchronous Processing (MVP)**
**Choice:** HTTP request stays open until processing completes (~30 seconds)

**Why:**
- **Simplicity:** No background job queue needed
- **Deadline:** Faster to build (2 hours vs 4 hours for async)
- **Test scope:** Our test PDFs are <20 pages (~5-10 seconds)
- **Browser non-blocking:** Frontend `fetch()` is async, so user can still use app
- **Upgrade path:** Can add async processing in v1.1 without breaking changes

**Tradeoff:** Max 60-second timeout means we can't process very large PDFs (>100 pages)

---

### 3. **PyPDFLoader (LangChain)**
**Choice:** PyPDFLoader over alternatives (pdfplumber, pdfminer, etc.)

**Why:**
- **Page number preservation:** Critical for citations ("Bank Negara 2024, page 12")
- **LangChain integration:** Works seamlessly with RecursiveCharacterTextSplitter
- **Lightweight:** No external dependencies (unlike Tesseract OCR)
- **Speed:** Pure Python, fast enough for text-based PDFs

**Limitation:** Doesn't handle scanned PDFs (images). Acceptable for MVP—regulatory docs are text-based.

---

### 4. **RecursiveCharacterTextSplitter**
**Choice:** Recursive splitter with 1000 chars + 150 overlap

**Why:**
- **Respects structure:** Tries to split at paragraphs → sentences → words (not arbitrary cuts)
- **Overlap prevents context loss:** Sentences at chunk boundaries appear in both chunks
- **1000 chars = ~250 words:** Optimal balance—large enough for context, small enough for precision
- **150 char overlap:** Ensures complete sentences at boundaries aren't orphaned

**Tradeoff:** More chunks = more storage, but better retrieval accuracy

---

### 5. **Batch Embedding (Single API Call)**
**Choice:** Embed all chunks in one OpenAI API call

**Why:**
- **Cost:** Batching is often cheaper (provider-side optimizations)
- **Speed:** 1 call << 500 individual calls (network overhead eliminated)
- **Rate limits:** Less likely to hit OpenAI rate limits

**Implementation:** If >2000 chunks, split into batches of 2000 (OpenAI limit)

---

### 6. **Atomic Transaction for Chunk Insertion**
**Choice:** All chunks inserted in single database transaction

**Why:**
- **Data integrity:** Either document is fully searchable or marked as failed (no half-ingested state)
- **Retry safety:** If embedding fails halfway, we can retry without orphaned chunks
- **Status tracking:** `status='processing'` → `status='ready'` is atomic

**Alternative rejected:** Insert chunks one-by-one (would leave partial data on failure)

---

### 7. **Storage Path: `{user_id}/{document_id}/{filename}`**
**Choice:** Three-level path hierarchy

**Why:**
- **user_id:** Multi-tenant isolation (User A can't access User B's files)
- **document_id:** Prevents filename collisions (two "policy.pdf" uploads coexist)
- **filename:** Preserves original name for display/download

**Security:** RLS policy checks `(storage.foldername(name))[1] = auth.uid()::text`

---

### 8. **OpenAI text-embedding-3-small**
**Choice:** Small model (1536 dimensions) over text-embedding-3-large (3072 dimensions)

**Why:**
- **Cost:** $0.02/1M tokens (5x cheaper than large model)
- **Speed:** Faster inference
- **Storage:** Half the space in pgvector (1536 floats vs 3072)
- **Accuracy:** Large model only ~2% better for our use case (not worth 5x cost)

---

### 9. **HNSW Index for Vector Search**
**Choice:** HNSW algorithm over IVFFlat

**Why:**
- **Speed:** Logarithmic search time (vs linear for IVFFlat)
- **Accuracy:** Better recall (finds more relevant chunks)
- **Scale:** Handles 100k+ chunks efficiently

**Tradeoff:** Slightly slower inserts, but we insert rarely (only during ingestion)

---

## Code Structure (Service Layer Pattern)

```
backend/app/
├── routers/
│   └── documents.py          # HTTP endpoint (orchestration)
├── services/
│   ├── storage_service.py    # Supabase Storage operations
│   ├── processing_service.py # PDF → chunks pipeline
│   └── embedding_service.py  # OpenAI embeddings wrapper
└── models/
    └── schemas.py            # Pydantic validation models
```

**Why separate services:**
- **Single Responsibility:** Each service does one thing well
- **Testability:** Mock services in unit tests
- **Reusability:** embedding_service can be used by other routers later
- **Maintainability:** Change embedding provider by editing one file

---

## Error Handling Strategy

```python
try:
    # Heavy processing (Steps 3-5)
    chunks = process_pdf(file)
    embeddings = embed_chunks(chunks)
    save_chunks_to_db(chunks, embeddings)
    
    update_document(status='ready')
    return {"status": "ready"}

except Exception as e:
    update_document(status='failed', error=str(e))
    return {"status": "failed", "error": str(e)}
```

**Status field tracks state:**
- `processing` → Document is being ingested
- `ready` → Fully searchable
- `failed` → User can retry upload

**Why status field:** If request times out, frontend can poll `/documents/{id}` to check status

---

## Performance Estimates (MVP)

| Document Size | Pages | Chunks | Processing Time |
|--------------|-------|--------|----------------|
| Small        | 10    | ~50    | 5-8 seconds    |
| Medium       | 50    | ~250   | 15-20 seconds  |
| Large        | 100   | ~500   | 30-40 seconds  |

**Bottleneck:** OpenAI embedding API (~1 second per 50 chunks)

**Timeout:** 60 seconds (supports up to ~150 pages)

---

## Security Layers

1. **Frontend:** No secrets, no direct backend access
2. **Next.js API:** Validates Supabase session (user authentication)
3. **FastAPI:** Receives authenticated user_id, scopes all operations
4. **Database RLS:** Postgres enforces user_id filtering (defense in depth)
5. **Storage RLS:** Users can only access their own folders

**Multi-tenant isolation:** Every query includes `WHERE user_id = $1`

---

## Testing Plan (End-to-End)

1. Upload 2 test PDFs (one regulatory, one company policy)
2. Verify `documents` table has 2 rows (status='ready')
3. Verify `chunks` table has correct chunk_count
4. Check embeddings exist (not null)
5. Test semantic search (query → retrieve relevant chunks)

**Success criteria:** Both documents fully searchable in <30 seconds
