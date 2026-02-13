# PolicyPal – High-Level Plan

**Purpose:** Stack and decisions locked. Next step: define features high-level, then thorough plan.

---

## Locked stack & decisions

| Area | Decision |
|------|----------|
| **Orchestration** | LangGraph |
| **Observability** | LangSmith (must) |
| **Vector DB** | Supabase pgvector |
| **Backend** | Python + FastAPI |
| **Frontend** | Next.js + React + Shadcn + React Query |
| **Auth & data** | Supabase Auth, Postgres, pgvector, **Storage** for PDFs |
| **Hosting** | Vercel (Next.js), Render (FastAPI) |
| **Frontend → backend** | Next.js API routes as proxy only |
| **FastAPI identity** | Next.js validates session, sends API key + `user_id` |
| **Document isolation** | Per-user; all chunks/queries scoped by `user_id` |
| **PDF storage** | Store raw PDFs in **Supabase Storage**; chunks + embeddings in pgvector |
| **Document sets** | **One document set per user** (no named sets in MVP) |
| **API contract** | Define ingest / QA / scan before building; **next phase** (add as setup step) |
| **Demo** | One **public demo PDF** for try-before-upload |
| **“I don’t know”** | Threshold **tuned in implementation**; plan notes configurable |
| **Streaming** | Tier 3 optional; first to cut if behind |
| **Next project** | Pinecone, hybrid search, multimodality |

---


## Decisions

- **Security:** Next.js API routes proxy all backend calls; FastAPI URL and keys never exposed.
- **Identity:** Next.js validates Supabase session, then calls FastAPI with internal API key + `user_id`. FastAPI trusts proxy.
- **Isolation:** Per-user only; all chunks and queries scoped by `user_id`.
- **PDFs:** Store raw PDFs in **Supabase Storage** (by `user_id`); process to chunks + embeddings in pgvector. Enables “your documents” list and re-ingest.
- **Document sets:** **Named Sets**
- **Demo:** One **public demo PDF** for try-before-upload.
- **“I don’t know”:** Threshold tuned in implementation; plan notes “configurable threshold.”
- **Streaming:** Optional Tier 3 (QA); first to cut if behind.
- **API contract:** Define ingest / QA / scan request-response **before building**; done in **next planning phase** as a setup step.
- **Next project:** Pinecone, hybrid search, multimodality.

---

## Next

1. Define **features high-level** and confirm the app flow.
2. Then: **thorough plan** (phases, tasks, API spec).
