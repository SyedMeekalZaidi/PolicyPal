# Implementation Plan: Document Ingestion Pipeline

## Overview

Build the full document ingestion system: user uploads PDF with metadata → backend processes (extract, chunk, embed) → frontend shows shimmer animation while processing with optimistic updates. User can browse documents grouped by Sets, search, edit metadata, and retry failed uploads.

**Key decisions:**
- **Read/Update/Delete** documents directly via Supabase client (RLS handles security)
- **Upload/Ingest** goes through Next.js API proxy → FastAPI (needs Python for PDF processing + embedding)
- **Retry** goes through Next.js API proxy → FastAPI (re-processes already-stored file, no re-upload)
- **Synchronous processing** for MVP (frontend shows shimmer, user can still use app)
- **Optimistic updates** via TanStack Query mutations (instant UI, reconcile on response)
- **pypdf direct** (not PyPDFLoader) — reads bytes directly, no temp files needed
- **Indeterminate shimmer** (not progress bar) — we don't have real-time progress data

---

## Database Gap (Must Fix First)

The `documents` table is **missing a `status` field**. Without it, we can't track processing state or show the "Ingesting" section in the UI.

**Migration adds:**
- `status TEXT NOT NULL DEFAULT 'processing'` — tracks: `processing` | `ready` | `failed`
- `error_message TEXT` — stores failure reason (null when successful)
- `original_filename TEXT NOT NULL` — preserves upload filename for display/download

---

## API Contract

### Backend (FastAPI): `POST /ingest`

```
Request: multipart/form-data
  - file: PDF binary
  - user_id: UUID (from Next.js proxy, NOT from browser — validated as UUID)
  - title: string (required)
  - version: string (optional)
  - doc_type: "company_policy" | "regulatory_source" (required)
  - set_id: UUID (optional)

Response (200):
  {
    "document_id": "uuid",
    "status": "ready",
    "chunk_count": 487,
    "message": "Document processed successfully"
  }

Response (200, failed):
  {
    "document_id": "uuid",
    "status": "failed",
    "error_message": "Failed to extract text from PDF"
  }
```

### Backend (FastAPI): `POST /retry/{document_id}`

```
Request: JSON
  - user_id: UUID (from Next.js proxy)

Pre-checks:
  1. Validate user_id is valid UUID
  2. Verify document belongs to this user (security)
  3. Verify document status is 'failed' (can only retry failed docs)
  4. Verify file exists in Supabase Storage (download it)
     → If no file: return error "Original file not available. Please delete and re-upload."

Processing:
  1. Delete any existing chunks for this document (cleanup partial data)
  2. Download file from Supabase Storage
  3. Re-run: extract → validate text → chunk → embed → save chunks → update status

Response (200):
  {
    "document_id": "uuid",
    "status": "ready",
    "chunk_count": 487,
    "message": "Document reprocessed successfully"
  }

Response (200, failed):
  {
    "document_id": "uuid",
    "status": "failed",
    "error_message": "..."
  }

Response (404):
  { "error": "Original file not available. Please delete and re-upload." }

Response (403):
  { "error": "Document does not belong to this user" }
```

### Next.js Proxy: `POST /api/documents/upload`

```
Request: multipart/form-data (same fields minus user_id, extracted from session)
Response: Forwards FastAPI response as JSON
Auth: Validates Supabase session, rejects 401 if not authenticated
Config: Body size limit set to 25MB in route config
```

### Next.js Proxy: `POST /api/documents/retry/[id]`

```
Request: No body (document_id from URL param)
Response: Forwards FastAPI response as JSON
Auth: Validates Supabase session, extracts user_id
```

### Direct Supabase Client (no proxy needed):

```
GET documents (with sets join) → supabase.from('documents').select('*, sets(*)')
GET sets                       → supabase.from('sets').select('*')
PATCH documents/:id            → supabase.from('documents').update({...})
DELETE documents/:id            → 1. Read storage_path from doc
                                  2. supabase.storage.from('documents').remove([path])
                                  3. supabase.from('documents').delete() (CASCADE deletes chunks)
                                  (Order matters: read path BEFORE deleting record)
POST sets (create new)         → supabase.from('sets').insert({...})
```

---

## Phase 1: Database Migration + Backend Foundation
**Goal:** Schema ready + backend can receive and process PDFs

### 1a: Database Migration (5 min)
**Files:**
- `supabase/migrations/TIMESTAMP_add_document_status.sql` (new)
- `lib/supabase/database.types.ts` (regenerate)

**Tasks:**
1. [ ] Create migration: add `status`, `error_message`, `original_filename` to documents table
2. [ ] Run `supabase db push`
3. [ ] Regenerate types: `npx supabase gen types typescript --project-id vezidnvayhhlhcwnqbzp > lib/supabase/database.types.ts`

**Test:** Check Supabase dashboard — documents table has new columns

### 1b: Backend Service Layer (2 hours)
**Files:**
- `backend/app/models/schemas.py` (new) — Pydantic models
- `backend/app/services/supabase_client.py` (new) — Shared Supabase admin client
- `backend/app/services/storage_service.py` (new) — Upload/download PDFs to Supabase Storage
- `backend/app/services/processing_service.py` (new) — pypdf + RecursiveCharacterTextSplitter
- `backend/app/services/embedding_service.py` (new) — OpenAI batch embeddings
- `backend/app/routers/documents.py` (new) — POST /ingest + POST /retry endpoints
- `backend/app/main.py` (edit) — Register documents router

**Tasks:**
1. [ ] `schemas.py` — IngestRequest, IngestResponse, RetryResponse, DocumentStatus Pydantic models
2. [ ] `supabase_client.py` — Initialize Supabase client with service key (bypasses RLS for backend ops)
3. [ ] `storage_service.py` — upload_file() + download_file() + check_file_exists()
4. [ ] `processing_service.py`:
   - Use `pypdf.PdfReader(BytesIO(file_bytes))` directly (no PyPDFLoader, no temp files)
   - Extract text page-by-page, create LangChain Document objects with page metadata
   - Feed to RecursiveCharacterTextSplitter (1000 chars, 150 overlap)
   - **Empty text validation:** If total extracted text < 50 chars → raise error "No extractable text found. PDF may be image-based, corrupted, or password-protected."
   - Returns list of {content, page, chunk_index}
5. [ ] `embedding_service.py` — embed_texts(texts) → vectors (batch, split into chunks of 2000 if needed)
6. [ ] `documents.py` router:
   - **POST /ingest**: Validate user_id is UUID → create doc record (status='processing') → upload to storage → extract & validate text → chunk → embed → save chunks atomically → update status to 'ready'
   - **POST /retry/{document_id}**: Validate user_id → verify ownership → verify status='failed' → check file exists in storage → delete existing chunks → download file → re-process → update status
   - Both endpoints: try/except wraps processing, sets status='failed' + error_message on any error
7. [ ] Register router in `main.py`

**Test:** `curl -X POST http://localhost:8000/ingest -F "file=@test.pdf" -F "title=Test" -F "doc_type=regulatory_source" -F "user_id=xxx"` returns `{"status": "ready"}`

---

## Phase 2: Next.js API Routes + TanStack Query Setup
**Goal:** Frontend can call backend securely + data fetching infrastructure ready

### 2a: Next.js API Proxy (30 min)
**Files:**
- `app/api/documents/upload/route.ts` (new) — Auth proxy for upload
- `app/api/documents/retry/[id]/route.ts` (new) — Auth proxy for retry

**Tasks:**
1. [ ] Upload route: validate Supabase session → extract user_id → forward multipart to FastAPI → return response
2. [ ] Retry route: validate Supabase session → extract user_id → POST to FastAPI /retry/{id} → return response
3. [ ] Add `BACKEND_URL` to `.env.local` (e.g., `http://localhost:8000`)
4. [ ] Handle errors: 401 if no session, 500 if backend fails
5. [ ] Configure body size limit for upload route (25MB) via route segment config

**Test:** Upload via Postman to `/api/documents/upload` with auth cookie

### 2b: TanStack Query Provider + Hooks (45 min)
**Files:**
- `components/providers/query-provider.tsx` (new) — QueryClientProvider wrapper
- `app/layout.tsx` (edit) — Wrap children with QueryProvider
- `hooks/queries/use-documents.ts` (new) — Fetch documents with sets
- `hooks/queries/use-sets.ts` (new) — Fetch sets
- `hooks/mutations/use-upload-document.ts` (new) — Upload mutation with optimistic update
- `hooks/mutations/use-update-document.ts` (new) — Edit mutation with optimistic update
- `hooks/mutations/use-delete-document.ts` (new) — Delete mutation (safe order)
- `hooks/mutations/use-retry-document.ts` (new) — Retry mutation

**Tasks:**
1. [ ] Create QueryProvider (client component wrapper)
2. [ ] Add to root layout (inside ThemeProvider)
3. [ ] `use-documents.ts` — fetches documents with sets join, sorted by set then title
4. [ ] `use-sets.ts` — fetches user's sets
5. [ ] `use-upload-document.ts` — sends multipart to `/api/documents/upload`, optimistically adds doc with status='processing' and a temp ID to cache, replaces with real data on success
6. [ ] `use-update-document.ts` — direct Supabase update, optimistic cache update
7. [ ] `use-delete-document.ts` — **Safe order:** read storage_path from cache → delete from Supabase Storage → delete from documents table (CASCADE handles chunks) → remove from cache
8. [ ] `use-retry-document.ts` — calls `/api/documents/retry/{id}`, optimistically sets status back to 'processing', updates to 'ready' or 'failed' on response

**Test:** Console.log hook outputs in dashboard — documents and sets fetched correctly

---

## Phase 3: Frontend UI — Upload Modal + Document Panel
**Goal:** User can upload documents and see them organized in the panel

### 3a: Install Missing Shadcn Components (5 min)
**Tasks:**
1. [ ] `npx shadcn@latest add dialog` — For upload/edit modals
2. [ ] `npx shadcn@latest add select` — For doc_type dropdown
3. [ ] `npx shadcn@latest add sonner` — For toast notifications (success/error/info)

### 3b: Upload Document Modal (45 min)
**Files:**
- `components/documents/upload-document-modal.tsx` (new)
- `lib/constants/colors.ts` (new) — Preset color palette for sets (6-8 hex values)

**Tasks:**
1. [ ] Modal with fields: PDF file picker, Title (text input), Version (text input), Doc Type (Select: Company Policy / Regulatory Source), Set (SearchSelect with existing sets + "Create new" option)
2. [ ] "Create new set" inline flow: when user selects "Create new" → show name input + color picker (6-8 preset color circles). Creates set via Supabase insert, then assigns to document.
3. [ ] File validation: PDF only (check MIME type + extension), max 20MB, show clear error if invalid
4. [ ] On submit: call useUploadDocument mutation → close modal immediately (optimistic) → doc appears in Ingesting section
5. [ ] All fields use Shadcn components (no raw HTML inputs)

**Test:** Open modal → fill fields → upload → modal closes → doc appears in "Ingesting" section with shimmer

### 3c: Document Panel (1 hour)
**Files:**
- `components/documents/document-panel.tsx` (new) — Main document panel (replaces DocumentsContent)
- `components/documents/document-search.tsx` (new) — Search input that filters docs + sets
- `components/documents/ingesting-section.tsx` (new) — Collapsible section for processing/failed docs
- `components/documents/document-card.tsx` (new) — Individual doc card
- `components/documents/set-section.tsx` (new) — Set group header + document grid
- `components/dashboard/left-panel.tsx` (edit) — Wire up upload button + render DocumentPanel

**Ingesting section states:**
- **Processing:** Shimmer/pulse animation (Tailwind `animate-pulse`) + "Processing..." text. No percentage bar — we don't have real-time progress data, so we don't fake it.
- **Failed:** Error icon (replaces doc icon) + error message text + "Retry" button + "Delete" button. Error message comes from backend `error_message` field.
- **Section visibility:** Only visible when there are processing OR failed documents. Collapsible via chevron toggle.

**Search behavior:**
- Matches on **both** document titles AND set names (case-insensitive)
- If a set name matches → show the entire set with all its documents
- If only a doc title matches → show that doc under its set (or Global)
- Empty search → show all
- No matches → "No results found" empty state

**Layout structure:**
```
┌─────────────────────────────┐
│ [Search documents...]       │ ← Filters docs + sets by name
├─────────────────────────────┤
│ ▼ Ingesting (2)             │ ← Collapsible, only when processing/failed exist
│ ┌───────────┬───────────┐   │
│ │ 📄 doc.pdf│ ⚠️ pol.pdf│   │   Processing: shimmer + "Processing..."
│ │ ░░░░░░░░  │ Error msg │   │   Failed: error icon + msg + Retry/Delete
│ │           │ [⟳] [✕]   │   │
│ └───────────┴───────────┘   │
├─────────────────────────────┤
│ Global Documents            │ ← Docs with no set (status='ready' only)
│ ┌───────────┬───────────┐   │
│ │▐ Policy v1│▐ Email    │   │   2-column grid
│ │ (2024)    │ Draft     │   │   Left accent = doc type color (gold/green)
│ └───────────┴───────────┘   │   Edit icon on hover only
├─────────────────────────────┤
│ 🔵 Bank Negara              │ ← Set header with colored dot
│ ┌───────────┬───────────┐   │
│ │ Capital   │ AML Rules │   │   Card bg = subtle set color tint
│ │ (2024)    │ (2025)    │   │
│ └───────────┴───────────┘   │
├─────────────────────────────┤
│ 🟢 ISO 27001                │
│ ┌───────────┬───────────┐   │
│ │ Framework │ Audit     │   │
│ │ (v3)      │ Checklist │   │
│ └───────────┴───────────┘   │
└─────────────────────────────┘
```

**Document card details:**
- Left accent bar: Gold (#FEC872) for Regulatory Source, Green (#10B981) for Company Policy
- Display format: "Title (Version)" — e.g., "Capital Guidelines (2024)"
- Edit icon: appears on hover only (pencil icon, top-right)
- Set cards: subtle tinted background using set color at low opacity

**Test:** Upload 2 docs (1 with set, 1 without) → both appear in correct sections

### 3d: Edit Document Modal (30 min)
**Files:**
- `components/documents/edit-document-modal.tsx` (new)

**Tasks:**
1. [ ] Pre-fill modal with current doc metadata (title, version, doc_type, set)
2. [ ] Same fields as upload modal (minus file picker — can't change the PDF itself)
3. [ ] On save: call useUpdateDocument mutation → close modal → optimistic update in panel
4. [ ] Show success toast via Sonner

**Test:** Click edit on doc → change title → save → title updates instantly in panel

---

## Phase 4: Error Handling + Polish
**Goal:** Production-quality error states and retry logic

**Files:**
- `components/documents/ingesting-section.tsx` (edit) — Error state UI
- Various hooks (edit) — Error handling + toasts

**Tasks:**
1. [ ] Failed documents: error icon + helpful error_message + "Retry" + "Delete" buttons
2. [ ] Retry button: calls useRetryDocument → sets status back to 'processing' (shimmer) → backend re-processes from stored file → updates to 'ready' or 'failed'
3. [ ] Retry edge case: if backend returns 404 (file not in storage), show toast "Original file not available. Please delete and re-upload."
4. [ ] Delete button on failed docs: calls useDeleteDocument (safe order: storage → record)
5. [ ] Toast notifications (Sonner): success on upload/retry complete, error on failure, info on retry started
6. [ ] Empty states: "No documents yet — upload a PDF to get started" when zero docs, "No results" when search has no matches

**Test:** Upload invalid PDF → see "No extractable text" error in Ingesting section → click Retry → if file exists, re-processes → if not, shows helpful toast

---

## Phase 5: End-to-End Testing
**Goal:** Verify full pipeline works with real PDFs

**Tasks:**
1. [ ] Upload regulatory PDF (e.g., Bank Negara guidelines) — assigned to "Bank Negara" set
2. [ ] Upload company policy PDF — no set (goes to Global)
3. [ ] Verify `documents` table: 2 rows, both `status='ready'`
4. [ ] Verify `chunks` table: correct chunk counts, embeddings not null
5. [ ] Verify Storage: PDFs exist at `{user_id}/{doc_id}/{filename}` paths
6. [ ] Edit document: change title → verify instant optimistic update
7. [ ] Search: type "Bank" → verify Bank Negara set + all its docs appear
8. [ ] Search: type doc title → verify individual doc appears under its section
9. [ ] Delete document: verify chunks CASCADE deleted + storage file removed
10. [ ] Upload empty/image PDF → verify "No extractable text" error appears in Ingesting section
11. [ ] Test retry on failed document → verify it re-processes successfully

---

## Summary

| Phase | What | Time Estimate |
|-------|------|---------------|
| 1a | Database migration | 5 min |
| 1b | Backend services + router + retry endpoint | 2 hours |
| 2a | Next.js API proxies (upload + retry) | 30 min |
| 2b | TanStack Query provider + hooks | 45 min |
| 3a | Install Shadcn components | 5 min |
| 3b | Upload modal | 45 min |
| 3c | Document panel + ingesting section | 1 hour |
| 3d | Edit modal | 30 min |
| 4 | Error handling + retry UX + toasts | 30 min |
| 5 | E2E testing | 30 min |
| **Total** | | **~6.5 hours** |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenAI API down | Can't embed | Status='failed', user clicks Retry later (file already in storage) |
| Large PDF (>100 pages) | Timeout at 60s | 20MB file limit + frontend warning for large files |
| Supabase Storage upload fails | No file stored | Retry shows "File not available, please re-upload" |
| Empty/scanned PDF | 0 chunks, useless doc | Validate extracted text > 50 chars, fail with clear error message |
| Optimistic update desync | Stale UI | TanStack Query invalidation on mutation settle |
| Next.js body size limit | Upload rejected silently | Configure 25MB limit in route segment config |
| Backend sets wrong user_id | Data isolation breach | Validate user_id is valid UUID in router before any DB operation |
| Delete loses storage_path | Orphaned file in storage | Safe order: read path → delete storage → delete DB record |
