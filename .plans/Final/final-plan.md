# Final Build Plan — PolicyPal Remaining Features

**Date:** Feb 22 | **Goal:** Ship all action nodes + citations + polish + deploy by end of day

---

## What's Built (Foundation)

- Full LangGraph pipeline: intent_resolver → doc_resolver → validate_inputs → [action stub] → format_response → END
- PalAssist interrupt/resume lifecycle with cancel → feedback flow
- Document ingestion: PDF → chunks → embeddings (pgvector, HNSW index, 1536-dim)
- Chat SSE streaming, conversation history, checkpoint persistence
- 3-panel layout (sidebar, chat, sources placeholder)
- Confidence dots + cost display on messages (tokens_used > 0)
- LLMService: action-based model routing, structured output, cost tracking

---

## What's Missing (Feature List)

| # | Feature | Where |
|---|---------|-------|
| 1 | **Retrieval service** — pgvector similarity search, user_id scoping, confidence scoring | Backend (new service) |
| 2 | **Tavily web search** — search service, query generation, result merging | Backend (new service) |
| 3 | **Inquire action** — adaptive-k retrieval → GPT-4o-mini generation → citations | Backend (replace stub) |
| 4 | **Summarize action** — stratified sampling → GPT-4o-mini summary → citations | Backend (replace stub) |
| 5 | **Compare action** — focused mode (table) + holistic mode (5-section report) | Backend (replace stub) |
| 6 | **Audit action** — text mode + policy mode (theme extraction → per-theme retrieval) | Backend (replace stub) |
| 7 | **Citation type + inline rendering** — typed citations, icons, hover tooltips | Frontend |
| 8 | **Markdown rendering** — `react-markdown` for AI responses | Frontend |
| 9 | **Sources panel** — populate with citations from active message | Frontend |
| 10 | **Confidence + cost persistence** — store in AIMessage metadata for history reload | Backend (format_response) |
| 11 | **LangSmith observability** — env var fix, `@traceable` on services, thread grouping | Backend (config + decorators) |
| 12 | **Long conversation management** — message windowing + summarization (>15 messages) | Backend (new node or in-action) |
| 13 | **Deploy** — Render (FastAPI) + Vercel (Next.js) | Infra |

---

## System Architecture (What's Left)

```
                    ┌─────────────────────────────────┐
                    │     NEW: retrieval_service.py    │
                    │  embed_query() → pgvector search │
                    │  score_confidence() → tier       │
                    │  user_id + doc_id scoping        │
                    └──────────┬──────────────────────┘
                               │ used by all 4 actions
    ┌──────────────────────────┼──────────────────────────┐
    │                          │                          │
┌───▼────┐  ┌────────▼────────┐  ┌──────▼──────┐  ┌─────▼─────┐
│Inquire │  │  Summarize      │  │  Compare    │  │  Audit    │
│ adaptive│  │  stratified     │  │  per-doc    │  │  source→  │
│ -k RAG │  │  sampling       │  │  targeted   │  │  target   │
│ +web?  │  │                 │  │  diff table │  │  findings │
│ 4o-mini│  │  4o-mini        │  │  4o-mini/4o │  │  4o       │
└───┬────┘  └────────┬────────┘  └──────┬──────┘  └─────┬─────┘
    │                │                   │               │
    └────────────────┴───────┬───────────┘───────────────┘
                             │
                    ┌────────▼────────────┐
                    │  NEW: tavily_svc.py │  (conditional — only when
                    │  web search + merge │   enable_web_search=True)
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │  format_response    │
                    │  + store confidence │
                    │  + cost in metadata │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │  SSE ChatResponse   │
                    │  citations, conf,   │
                    │  cost → frontend    │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐ ┌─────▼──────┐ ┌────▼──────┐
        │ Markdown  │ │ Citation   │ │ Sources   │
        │ rendering │ │ icons +    │ │ Panel     │
        │ (react-   │ │ tooltips   │ │ (populate │
        │  markdown)│ │            │ │  on click)│
        └───────────┘ └────────────┘ └───────────┘
```

---

## Vertical Slice Phases

### Phase 1: Shared Infrastructure + Inquire (~2 hrs)
**The foundational slice — everything after reuses this.**

**Backend:**
- SQL migration: `match_chunks` RPC function (see Research §1)
- `retrieval_service.py`: `search_chunks(query, user_id, doc_ids, k, threshold)` → returns chunks + similarity scores + confidence tier
- `tavily_service.py`: `web_search(query)` → returns formatted results
- **User context injection:** Add `user_industry`, `user_location` to `AgentState`. Fetch profile from Supabase in `/chat` endpoint (1 query), inject into `initial_state`. Action node system prompts include: "User works in {industry} in {location}. Tailor to their regulatory context." Omitted gracefully if profile is empty.
- Replace `inquire` stub: adaptive-k retrieval (threshold 0.5 cosine similarity, max 15 chunks, 3-5 per doc) → conditional web search → GPT-4o-mini generation with citation extraction → confidence scoring
- Citation schema: `{ id, source_type: "document"|"web", doc_id?, title, page?, url?, quote }`

**Frontend:**
- Install `react-markdown` + `remark-gfm`
- Add `Citation` TypeScript type to `lib/types/chat.ts`
- Render AI responses with markdown
- **Perplexity-style grouped citation bubbles** (see Research §5 for full architecture):
  - LLM outputs individual `[1]`, `[2]`, `[3]` markers in text (standard RAG prompting)
  - Frontend groups consecutive markers into a single bubble: `[1][2][3]` → one "+3" pill
  - Each bubble represents the citations supporting the preceding sentence/clause
  - On click: (1) highlights the supported text in the AI response, (2) filters Sources Panel to only those citations
  - Bottom of message: "View All" button (glassmorphism pill, shows total count) → click resets to show all citations
  - New AI message with citations → auto-populates Sources Panel with "All Citations" view
- **Sources panel interaction:**
  - `DashboardShell` lifts citation state: `ChatPanel` calls `onCitationChange(citations, filteredIds)` callback
  - `DashboardShell` passes state down to `SourcesPanel` and auto-expands panel when citations arrive
  - Panel shows filtered citations (by group click) or all citations (by default / "View All" click)
- Cost display: money icon next to confidence badge on every message

**Persistence:**
- `format_response`: store `retrieval_confidence`, `cost_usd`, `tokens_used` in AIMessage `additional_kwargs` so history reload shows confidence + cost

**Test:** Send "@Inquire what are the capital requirements in @BankNegara2024" → get RAG answer with grouped citation bubbles ("+2", "+1") inline. Click a bubble → text highlights + sources panel filters to those citations. Click "View All" → all citations shown, highlight removed. New message → sources panel auto-populates. Refresh → data persists.

---

### Phase 1.5: LangSmith Observability (~15 min)
**Activate tracing so we can debug Phases 2-4 via LangSmith dashboard.**

- Fix env vars: add `LANGSMITH_TRACING=true` + `LANGSMITH_PROJECT=policypal` to `.env` (see Research §7)
- Add `load_dotenv()` to `main.py` so LangSmith reads env vars from `os.environ`
- Rename `langsmith_tracing_v2` → `langsmith_tracing` in `config.py`
- Add `@traceable` decorator to `retrieval_service.search_chunks()` and `tavily_service.web_search()` for granular trace visibility
- Verify: run Inquire query → check trace appears at smith.langchain.com with full node tree + cost breakdown

**What's automatic (zero code):** Full trace tree per graph invocation, per-LLM-call token counts + costs, latency per node, input/output for each step, thread grouping (we already pass `thread_id` in config)

**Test:** Open smith.langchain.com → project "policypal" → see trace with nodes: intent_resolver → doc_resolver → validate_inputs → inquire → format_response, each with token/cost breakdown

---

### Phase 2: Summarize (~45 min)
**Reuses retrieval service + citation pattern from Phase 1.**

- Replace `summarize` stub: stratified sampling (see Research §1c) — positional spread across document → GPT-4o-mini structured summary → citations
- Multi-doc: per-doc section headings in response
- Same citation/confidence/cost pattern

**Test:** "@Summarize @BankNegara2024" → structured summary with key points + citations

---

### Phase 3: Compare (~1.5 hrs)
**Both focused + holistic modes in MVP.**

- Replace `compare` stub
- **Mode detection:** If user message includes a specific topic → focused mode. Otherwise → holistic.
- **Focused mode (GPT-4o-mini):**
  - Per-doc targeted retrieval (same as Inquire, scoped per doc, k=7 each)
  - LLM generates difference TABLE (markdown) for 2-3 docs
  - Table format: `| Aspect | Doc1 | Doc2 | (Doc3) |` — clear per-doc breakdown
  - **Table UX:** CSS `overflow-x: auto` wrapper on markdown tables so they scroll horizontally if needed. Max 3 doc columns to keep it readable.
- **Holistic mode (GPT-4o):**
  - Stratified sampling across all docs (reuse from Summarize)
  - `extract_themes()` — shared helper (1 LLM call: GPT-4o-mini): input sampled chunks → output 3-5 theme strings
  - GPT-4o 5-section report: Overview, Key Differences, Similarities, Unique Aspects, Implications
  - Same citation pattern as other actions
- `extract_themes()` helper lives in `backend/app/services/theme_service.py` — reused by Audit policy mode

**Test:** 
- Focused: "@Compare @BankNegara2024 @FSA capital requirements" → markdown table
- Holistic: "@Compare @BankNegara2024 @FSA" (no topic) → 5-section report

---

### Phase 4: Audit (~2 hrs)
**Both text mode + policy mode in MVP.**

- Replace `audit` stub
- **Mode detection:** If source is free text in message (no source doc tagged) → text mode. If source doc is tagged → policy mode.
- **Text mode (short source < 1000 words):**
  - Embed source text (from HumanMessage) → `match_chunks` scoped to target doc_ids
  - k=5 per target, threshold=0.6 (higher precision for compliance)
  - GPT-4o structured findings per target
- **Policy mode (long source — doc tagged as source):**
  - Step 1: Stratified sampling of source doc (reuse from Summarize, ~10 chunks)
  - Step 2: `extract_themes()` (reuse from Compare, shared helper) → 3-5 themes
  - Step 3: Per-theme retrieval against target docs (2-3 chunks per target per theme)
  - Step 4: GPT-4o cross-reference per theme per target → structured findings
- **Shared structured output:** `AuditResult` Pydantic model:
  - `overall_status`: "Compliant" | "Minor Issues" | "Major Violations"
  - `findings[]`: `{ target_doc_id, target_doc_title, theme?, severity, consequence, source_quote, target_quote, suggestion, confidence_score }`
  - `summary`: cross-doc compliance insights
- Frontend: severity badges (Critical=red, High=orange, Medium=yellow, Low=blue)

**Test:**
- Text: "Audit this email: [paste text] against @BankNegara2024" → structured findings
- Policy: "@Audit @OurPolicy against @BankNegara2024" → theme-based findings with severity

---

### Phase 5: Long Conversation Management (~30 min)
**Prevent context overflow for long conversations.**

- Add `conversation_summary: str` field to `AgentState`
- Manual summarization in action nodes (NOT `langmem` — see Research §4)
- Before LLM call: if messages > 15, summarize older messages using GPT-4o-mini
- Cache summary in state, regenerate every 10 messages
- Pass `[summary_message] + [last 10 messages]` to action LLM

**Test:** 20+ message conversation → still coherent responses without context overflow

---

### Phase 6: Polish (~45 min)

- Sources panel: click citation in chat → scroll sources panel to that citation
- Confidence badge tooltips on hover
- Cost display formatting cleanup (money icon + compact format)
- Error states for failed retrieval
- Empty states when no citations

---

### Phase 7: Deploy (~30 min)

- Render deployment (FastAPI + requirements.txt)
- Vercel deployment (Next.js)
- Environment variables (OpenAI, Supabase, Tavily, LangSmith)
- Smoke test all 4 actions on production

---

## Scope Control

**Must ship:** Phases 1-4 (all 4 actions — both modes each, real RAG, citations)
**Should ship:** Phase 1.5 (LangSmith), Phase 5 (long conversation), Phase 6 (polish)
**Nice to have:** Phase 7 (deploy)
**Cut if behind:** Long conversation management first, then sources panel click-to-scroll, then polish details.

---

## Key Decisions

1. **Retrieval service is shared** — one RPC function + Python wrapper used by all 4 actions with different parameters
2. **Perplexity-style grouped citation bubbles** — LLM outputs `[N]` markers, frontend groups consecutive markers into clickable bubbles that highlight text + filter sources panel. Uses React Context to bridge ChatPanel↔SourcesPanel across route boundary
3. **Markdown for all responses** — `react-markdown` handles tables, lists, bold, etc. natively
4. **Confidence + cost persisted in AIMessage metadata** — history reload shows same badges
5. **Manual summarization over langmem** — langmem incompatible with langgraph 1.0.7 (see Research §4)
6. **Supabase RPC function** — server-side SQL for vector search (standard Supabase pattern)
7. **LangSmith is nearly free** — auto-traces all ChatOpenAI calls; just needs env var fix + `@traceable` on services
8. **`extract_themes()` is shared** — Compare holistic + Audit policy mode both use the same theme extraction helper (DRY)
9. **Compare table capped at 3 docs** — more than 3 columns makes tables unreadable in chat. 4+ docs → paragraph format automatically

---
---

# Research

## §1. Retrieval: pgvector Similarity Search via Supabase RPC

**Sources:**
- https://supabase.com/docs/guides/ai/semantic-search
- https://supabase.com/docs/guides/ai/going-to-prod
- https://supabase.com/docs/guides/ai/vector-indexes

### Core Pattern: RPC Function

Supabase recommends wrapping pgvector queries in PostgreSQL functions called via `.rpc()`. PostgREST (Supabase's auto-generated API) doesn't support pgvector operators directly, so RPC is the standard approach.

**Our `match_chunks` RPC function:**

```sql
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
```

**Key details:**
- `<=>` is cosine DISTANCE (0 = identical, 2 = opposite). We convert to similarity: `1 - distance`.
- `STABLE` keyword: tells Postgres this function doesn't modify data (optimizer hint).
- `filter_doc_ids`: NULL = search all user docs, array = scope to specific docs.
- `LEAST(match_count, 200)`: safety cap to prevent overloading.
- Uses the existing HNSW index (`idx_chunks_embedding`) automatically.

**Calling from Python (admin client):**

```python
result = supabase.rpc("match_chunks", {
    "query_embedding": embedding_vector,   # list[float] from embed_texts()
    "filter_user_id": user_id,
    "filter_doc_ids": doc_ids or None,     # None = search all
    "match_threshold": 0.5,
    "match_count": 15,
}).execute()
chunks = result.data  # list[dict] with id, document_id, chunk_index, page, content, similarity
```

### Cosine Distance vs Similarity

| Metric | Range | Identical | Orthogonal | pgvector operator |
|--------|-------|-----------|------------|-------------------|
| Cosine similarity | -1 to 1 | 1 | 0 | N/A |
| Cosine distance | 0 to 2 | 0 | 1 | `<=>` |
| Relationship | `similarity = 1 - distance` | | | |

### Similarity Threshold Guidance (text-embedding-3-small)

No hard rules — depends on data. Empirical starting points:
- **0.5** = conservative (recall-heavy, catches more chunks but some may be loosely related)
- **0.6** = balanced (good precision/recall for compliance docs)
- **0.7+** = strict (precision-heavy, may miss relevant chunks)

We start at **0.5** and let the confidence scorer classify quality:
- avg similarity ≥ 0.7 → "high" confidence
- avg similarity ≥ 0.5 → "medium" confidence
- avg similarity < 0.5 → "low" confidence

### Retrieval Strategies (per action)

#### a) Adaptive-k (Inquire)
**Goal:** Find the most relevant chunks for a specific question.
- Call `match_chunks` with k=15, threshold=0.5
- Post-process in Python: cap 3-5 chunks per document to prevent single-doc domination
- Return actual count (adapts to quality — if only 4 chunks pass threshold, return 4)
- Confidence = average similarity of returned chunks

#### b) Stratified Sampling (Summarize)
**Goal:** Representative spread of entire document, not just semantically similar chunks.
- For each resolved document:
  1. Get total `chunk_count` from the `documents` table
  2. Divide chunk_indexes into N strata (e.g., chunk_count / 4)
  3. From each stratum, fetch 3-4 chunks using Supabase query (ORDER BY chunk_index)
  4. Total: ~15-20 chunks spread evenly across document sections
- This is a **positional** strategy, NOT semantic search — avoids bias toward repetitive topics
- Optionally: if user included a specific topic ("summarize the capital section"), combine stratified + semantic (use match_chunks within each stratum)
- Confidence: always "high" for stratified (we're sampling the full doc)

#### c) Per-doc Targeted (Compare)
**Goal:** Get comparable chunks from each document for the same topic.
- For each resolved document independently: call `match_chunks` scoped to that doc_id
- k=7 per doc, threshold=0.5
- All docs get equal representation (prevents larger docs dominating)
- Confidence = min(per-doc avg similarity) across all docs

#### d) Direct Semantic (Audit — text mode)
**Goal:** Find regulations matching the source text.
- Embed the source text (or key sentences from it via chunking)
- Call `match_chunks` scoped to target regulation doc_ids
- k=5 per target, threshold=0.6 (higher threshold — need precise matches for compliance)
- Confidence = average similarity across all matched chunks

### HNSW Index (Already Created)

```sql
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
```

Default parameters: `m=16`, `ef_construction=64`, `ef_search=40`. Sufficient for our scale (<100k chunks).

---

## §2. Tavily Web Search Integration

**Sources:**
- https://docs.tavily.com/sdk/python/reference
- https://docs.tavily.com/sdk/python/quick-start

### Setup

```bash
pip install tavily-python
```

**Environment variable:** `TAVILY_API_KEY` (add to `.env` and `config.py`)

### Usage Pattern (Async)

```python
from tavily import AsyncTavilyClient

client = AsyncTavilyClient(api_key=settings.tavily_api_key)

response = await client.search(
    query="Bank Negara capital adequacy requirements 2024",
    search_depth="basic",          # "basic" = 1 credit, "advanced" = 2 credits
    max_results=5,                 # 0-20, default 5
    topic="general",               # "general" | "news" | "finance"
    include_answer=False,          # skip LLM answer (we generate our own)
    include_raw_content=False,     # skip full HTML (save bandwidth)
)
```

### Response Schema

```python
{
    "query": "Bank Negara capital adequacy...",
    "results": [
        {
            "title": "Source Title",
            "url": "https://...",
            "content": "Most relevant snippet (max ~500 chars per chunk)",
            "score": 0.99,          # relevance score (0-1)
        },
        # ... up to max_results
    ],
    "response_time": 1.09,
}
```

### Integration Plan

- New service: `backend/app/services/tavily_service.py`
- Single function: `async def web_search(query: str, max_results: int = 5) -> list[dict]`
- Returns normalized results: `[{ title, url, content, score }]`
- Called conditionally in action nodes when `state["enable_web_search"] == True`
- Results stored in `state["web_search_results"]` and converted to citations with `source_type: "web"`

### Cost: 1 credit per basic search (1,000 free credits/month)

---

## §3. LangGraph Action Node Patterns

**Sources:**
- https://sumanta9090.medium.com/langgraph-patterns-best-practices-guide-2025-38cc2abb8763
- https://kalle.wtf/articles/tools-and-structured-output-in-langgraph
- Our existing nodes: `intent_resolver.py`, `doc_resolver.py`, `validate_inputs.py`

### Node Design Principles

1. **Single responsibility:** Each node does one logical task. Our action nodes: retrieve → generate → format.
2. **Return only changed fields:** Return a dict of only the state fields that changed. The reducer handles merging.
3. **Pure functions:** `def action_node(state: AgentState) -> dict` — read state, do work, return updates.
4. **Structured output:** Use `LLMService.ainvoke_structured(action, schema, messages)` with Pydantic models for predictable responses.

### Our Existing Pattern (follow this)

```python
def action_node(state: AgentState) -> dict:
    # 1. Read state
    action = state.get("action")
    resolved_doc_ids = state.get("resolved_doc_ids") or []
    messages = state.get("messages") or []

    # 2. Do retrieval
    chunks = retrieval_service.search_chunks(...)

    # 3. Build prompt with context
    system_prompt = "..."
    context = "\n".join([c["content"] for c in chunks])

    # 4. Call LLM with structured output
    result = llm_service.invoke_structured("inquire", ResponseSchema, [system, human])

    # 5. Return changed fields
    return {
        "response": result.response,
        "citations": [c.dict() for c in result.citations],
        "retrieved_chunks": chunks,
        "retrieval_confidence": confidence_tier,
        "tokens_used": ...,
        "cost_usd": ...,
    }
```

### Structured Output with LLMService

Our `LLMService.invoke_structured()` uses `ChatOpenAI.with_structured_output(schema)` internally. This forces the LLM to return JSON matching our Pydantic model — no parsing needed.

Each action defines its own response Pydantic model:
- `InquireResponse`: `response: str, citations: list[Citation]`
- `SummarizeResponse`: `summary: str, key_points: list[str], citations: list[Citation]`
- `CompareResponse`: `comparison_table: list[ComparisonRow], summary: str, citations: list[Citation]`
- `AuditResponse`: `overall_status: str, findings: list[AuditFinding], summary: str`

### Cost Tracking (Already Built)

`LLMService` already logs cost per call. Action nodes just need to accumulate:

```python
result = llm_service.invoke_structured(...)
# Cost is already logged internally by LLMService
# We extract usage from the AIMessage.usage_metadata
```

The `cost_usd` and `tokens_used` fields in AgentState get set by action nodes and flow through to `format_response` → SSE → frontend.

---

## §4. Long Conversation Management

**Sources:**
- https://langchain-ai.github.io/langmem/guides/summarization/
- https://langchain-ai.github.io/langmem/reference/short_term/
- https://github.com/langchain-ai/langmem/issues/130 (compatibility issue)

### ⚠️ Critical: `langmem` is NOT compatible with `langgraph 1.0.7`

The official `langmem` package (v0.0.25) requires `langgraph>=0.6.0,<0.7.0`. Our project uses `langgraph==1.0.7`. There's a known GitHub issue (#130) requesting a fix in v0.0.30, but it hasn't been released.

**Decision: Manual summarization using our existing `LLMService`.**

### Strategy (matches features.md specification)

```
Message arrives for thread
    ↓
Step 1: Count messages in state
    ↓
Step 2: Check conversation length
    - ≤ 15 messages: Use full history (no summarization)
    - > 15 messages: Summarize + window
    ↓
Step 3: Windowing (for long conversations)
    - Keep last 10 messages verbatim (recent context)
    - Summarize messages 1 through (N-10) into compact summary
    ↓
Step 4: Summary generation
    - Model: GPT-4o-mini via LLMService (action="summarize")
    - Input: Old messages (1 to N-10)
    - Output: ~200-300 token summary
    - Cache in state["conversation_summary"]
    - Regenerate when summary is stale (messages grew by 10+)
    ↓
Step 5: Pass to action LLM
    - Context: [SystemMessage with summary] + [Last 10 messages]
    - Token savings: ~77% for 50+ message conversations
```

### Implementation: Helper function, not a graph node

Instead of a separate node in the graph (which would add latency even for short conversations), we implement a helper function called by each action node:

```python
# In backend/app/services/context_service.py

def prepare_messages_for_llm(state: AgentState) -> tuple[list[BaseMessage], dict]:
    """
    Returns (messages_for_llm, state_updates).
    If conversation is short, returns all messages + empty updates.
    If long, summarizes old messages and returns windowed list + updated summary.
    """
    messages = state.get("messages") or []
    existing_summary = state.get("conversation_summary") or ""

    if len(messages) <= 15:
        return messages, {}

    # Window: last 10 messages
    recent = messages[-10:]
    old = messages[:-10]

    # Check if summary is stale (covers fewer messages than old count)
    if not existing_summary or _summary_is_stale(existing_summary, len(old)):
        summary = _generate_summary(old, existing_summary)
        return [SystemMessage(content=f"Conversation summary: {summary}")] + recent, {
            "conversation_summary": summary
        }

    return [SystemMessage(content=f"Conversation summary: {existing_summary}")] + recent, {}
```

### State Change

Add to `AgentState`:
```python
conversation_summary: str  # cached rolling summary of old messages
```

### Why NOT a separate graph node

- Short conversations (90% of usage) would pass through an unnecessary node
- Action nodes already read messages — they can call the helper inline
- No graph topology change needed
- The helper is a pure function — easy to test

---

## §5. Citation Architecture — Perplexity-Style Grouped Bubbles

### Overview

Modeled after Perplexity AI / Google AI Mode. Grouped citation bubbles appear inline in the AI response. Each bubble represents the specific sources supporting a piece of text. Clicking a bubble: (1) highlights the supported text, (2) filters the Sources Panel to those citations only.

### End-to-End Data Flow

```
1. BACKEND (no special handling needed)
   LLM structured output → response string with [N] markers + citations[] array
   Example: "Capital requirements increased [1][2]. The FSA mandates reporting [3]."
   citations: [{ id: 1, ... }, { id: 2, ... }, { id: 3, ... }]
       ↓
2. SSE TRANSPORT (existing ChatResponse — no change)
   { type: "response", response: "...text with [1][2]...", citations: [...], ... }
       ↓
3. CHAT PANEL (onResponse callback)
   - Stores ChatResponse in message.response
   - Calls onCitationChange(citations, null) → lifts state to DashboardShell
   - DashboardShell auto-expands SourcesPanel if collapsed
       ↓
4. MARKDOWN RENDERER (new component: CitedMarkdown)
   - react-markdown renders the response text
   - Custom text-node processor: regex splits on [N] groups
   - Groups consecutive markers: "[1][2][3]" → one CitationBubble with ids=[1,2,3]
   - Wraps preceding text in <span data-cite-group="g0" class="cite-span">
   - Renders CitationBubble component at group boundary
       ↓
5. CITATION BUBBLE (new component: CitationBubble)
   - Glassmorphism pill showing count: "+3" (or "1" for single)
   - onClick → dispatches: setHighlightedGroup({ spanId: "g0", citationIds: [1,2,3] })
       ↓
6. TEXT HIGHLIGHTING (CSS class toggle)
   - Active group's <span> gets class "cite-highlighted" (subtle bg highlight)
   - All other groups: normal styling
   - Clicking a different bubble or "View All" removes highlight
       ↓
7. SOURCES PANEL (receives filtered state)
   - filteredCitationIds === null → show ALL citations (default)
   - filteredCitationIds === [1,2,3] → show only those 3
   - Each citation card: icon (📄/🌐) + title + page/url + quote preview
       ↓
8. BOTTOM "VIEW ALL" BUTTON
   - At bottom of AI message, below content
   - Glassmorphism pill: "📄 N sources"
   - onClick → setHighlightedGroup(null) → panel shows all, text highlight removed
```

### Backend: LLM Citation Prompting

The structured output Pydantic model for each action includes:

```python
class Citation(BaseModel):
    id: int                                    # sequential: 1, 2, 3...
    source_type: Literal["document", "web"]
    doc_id: Optional[str] = None               # UUID for document citations
    title: str                                 # document title or web page title
    page: Optional[int] = None                 # PDF page number (document only)
    url: Optional[str] = None                  # URL (web only)
    quote: str                                 # exact text from source supporting the claim
```

The LLM prompt instructs: "Place citation markers [1], [2], etc. inline in your response immediately after the claim they support. Multiple markers can appear together [1][2] when multiple sources support the same claim."

### Frontend: TypeScript Types

```typescript
// lib/types/chat.ts — add these

export type Citation = {
  id: number;
  source_type: "document" | "web";
  doc_id?: string;
  title: string;
  page?: number;
  url?: string;
  quote: string;
};

// Internal state for citation interaction (not in SSE contract)
export type CitationGroup = {
  spanId: string;         // "g0", "g1", ... — matches data-cite-group attribute
  citationIds: number[];  // which citation IDs this group references
};
```

### Frontend: Parsing Algorithm (CitedMarkdown)

```
Input: "Capital requirements increased [1][2]. The FSA mandates reporting [3]."

Step 1: Regex split on /(\[\d+\])+/g (groups of consecutive [N] markers)
  → segments: [
      { text: "Capital requirements increased ", citationIds: [] },
      { text: "", citationIds: [1, 2] },    ← marker group
      { text: ". The FSA mandates reporting ", citationIds: [] },
      { text: "", citationIds: [3] },        ← marker group
    ]

Step 2: Merge text + following marker group into CitedSegments:
  → [
      { text: "Capital requirements increased", groupId: "g0", citationIds: [1, 2] },
      { text: ". The FSA mandates reporting", groupId: "g1", citationIds: [3] },
    ]

Step 3: Render each segment:
  <span data-cite-group="g0" className={highlighted === "g0" ? "cite-highlighted" : ""}>
    Capital requirements increased
  </span>
  <CitationBubble groupId="g0" count={2} onClick={handleGroupClick} />
  <span data-cite-group="g1" ...>. The FSA mandates reporting</span>
  <CitationBubble groupId="g1" count={1} onClick={handleGroupClick} />
```

**Important:** The parsing happens AFTER react-markdown renders. We use a custom component override for paragraph/text nodes to inject the citation logic. This preserves markdown formatting (bold, italic, lists, tables) while adding citation interactivity.

### Frontend: State Management

```
DashboardShell (orchestrator)
  ├── state: activeCitations: Citation[]           — all citations from active message
  ├── state: highlightedGroup: CitationGroup | null — which group is clicked
  ├── state: sourcesCollapsed: boolean
  │
  ├── ChatPanel (center)
  │     ├── calls onCitationChange(citations, null) when new AI message arrives
  │     ├── calls onCitationChange(citations, group) when bubble clicked
  │     └── renders CitedMarkdown with highlightedGroup for CSS class
  │
  └── SourcesPanel (right)
        ├── receives: activeCitations, highlightedGroup
        ├── if highlightedGroup is null → render all citations
        └── if highlightedGroup set → render only highlightedGroup.citationIds
```

**DashboardShell changes needed:**
- Add `activeCitations`, `highlightedGroup` state
- Add `onCitationChange` callback (passed to ChatPanel as prop via route children pattern)
- Pass citation state to SourcesPanel
- Auto-expand SourcesPanel when citations arrive (if collapsed)

**Problem: ChatPanel is rendered as `children` in the route layout, not as a direct child of DashboardShell.**
**Solution:** Use React Context. Create a `CitationContext` provider in DashboardShell that ChatPanel consumes. This avoids prop drilling through the route layer.

```typescript
// context/citation-context.ts
type CitationContextValue = {
  activeCitations: Citation[];
  highlightedGroup: CitationGroup | null;
  setActiveCitations: (citations: Citation[]) => void;
  setHighlightedGroup: (group: CitationGroup | null) => void;
};
```

### Edge Cases

1. **Same citation in multiple groups:** `[1]` appears in two different sentences. Each group is independent. Clicking group A shows `[1]`, clicking group B also shows `[1]`. Panel deduplicates if needed.

2. **Single citation:** `[1]` alone → bubble shows "1" (small superscript-style pill). Still clickable.

3. **No citations in message:** `citations` array is empty → render response as plain markdown. No bubbles, no sources panel update. No "View All" button.

4. **Citation mid-sentence:** "The regulation [1] requires..." → bubble appears inline between words. Text before it is the highlighted span.

5. **Markdown formatting around citations:** "**important finding** [1][2]" → bold text is preserved, bubble appears after the bold span. The regex operates on the final rendered text nodes, not raw markdown.

6. **Multiple AI messages:** Each message has its own `citations`. Clicking a bubble on message N replaces the sources panel content entirely (not additive). Only one message's citations are "active" at a time.

7. **History reload:** `ChatHistoryMessage.metadata` stores the original `ChatResponse` including `citations[]`. The `content` field has `[N]` markers. System rehydrates correctly — CitedMarkdown re-parses on render.

8. **Message with 0 marker groups but non-empty citations array:** Defensive — if LLM returns citations but forgets to place `[N]` markers, show the "View All" button anyway so citations are still accessible.

9. **Click outside / deselect:** Clicking anywhere in the chat area (not on a bubble) could optionally clear the highlight. Or we keep highlight until another bubble or "View All" is clicked. Simpler: only bubble clicks and "View All" change state.

---

## §5b. Shared Theme Extraction Service

Compare (holistic) and Audit (policy mode) both need theme extraction from document chunks. Shared helper avoids duplication:

```python
# backend/app/services/theme_service.py

async def extract_themes(chunks: list[dict], max_themes: int = 5) -> list[str]:
    """
    Given sampled chunks from one or more documents, extract 3-5 key themes.
    Used by: Compare holistic mode, Audit policy mode.
    Model: GPT-4o-mini (classification task, cheap).
    Returns: ["Capital requirements", "Reporting obligations", "Penalties", ...]
    """
```

**Reuse map:**
- Compare holistic: `stratified_sample(all docs)` → `extract_themes()` → GPT-4o 5-section report
- Audit policy: `stratified_sample(source doc)` → `extract_themes()` → per-theme retrieval against targets → GPT-4o findings

---

## §6. New Dependencies to Install

### Backend (`pip install`)
- `tavily-python` — Tavily web search SDK

### Frontend (`npm install`)
- `react-markdown` — render AI responses as markdown
- `remark-gfm` — GitHub Flavored Markdown (tables, strikethrough, etc.)

### NOT installing
- `langmem` — incompatible with langgraph 1.0.7 (see §4)
- `langchain-tavily` — unnecessary; we use tavily-python directly (simpler, fewer deps)

---

## §7. LangSmith Observability

**Sources:**
- https://docs.langchain.com/langsmith/trace-with-langgraph
- https://docs.langchain.com/langsmith/cost-tracking
- https://docs.langchain.com/langsmith/env-var
- https://docs.langchain.com/langsmith/observability-quickstart

### What LangSmith Auto-Captures (Zero Code)

Since we use `langchain-openai` (`ChatOpenAI`) via `LLMService`, LangSmith automatically traces:

| Feature | How | What it shows |
|---------|-----|---------------|
| **Full trace tree** | Every `graph.invoke()` / `graph.astream()` creates a trace | Each node as a nested "run" (intent_resolver → doc_resolver → ... → format_response) |
| **Token counts** | Extracted from `ChatOpenAI` response metadata | Input tokens, output tokens, total per LLM call |
| **Cost calculation** | OpenAI pricing built into LangSmith | Per-call cost in USD, aggregated per trace and per project |
| **Latency** | Wall-clock time per run | Identify slow nodes (retrieval vs LLM vs formatting) |
| **Input/Output** | Captured for each node | See exact messages sent to LLM and response received |
| **Thread grouping** | We already pass `thread_id` in LangGraph config | Conversations grouped in LangSmith "Threads" view |

### What's Currently Broken

Our backend has a **configuration gap** that prevents LangSmith from activating:

1. **Missing env vars in `.env`:**
   - `LANGSMITH_TRACING=true` ← not present (tracing never activates)
   - `LANGSMITH_PROJECT=policypal` ← not present (traces go to "default" project)

2. **Env vars not in `os.environ`:**
   - `pydantic_settings.BaseSettings` reads `.env` into a Settings object but does NOT set them as environment variables
   - LangSmith's internal code checks `os.environ.get("LANGSMITH_TRACING")` directly
   - **Fix:** Add `load_dotenv()` at the top of `main.py` before any imports that trigger LangChain initialization

3. **Stale field name in `config.py`:**
   - Current: `langsmith_tracing_v2` (old LangChain convention: `LANGCHAIN_TRACING_V2`)
   - Should be: `langsmith_tracing` (current LangSmith convention: `LANGSMITH_TRACING`)

### Fix Steps (Phase 1.5)

**Step 1: Update `.env` file**
```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<your-key>
LANGSMITH_PROJECT=policypal
```

**Step 2: Add `load_dotenv()` to `main.py`**
```python
from dotenv import load_dotenv
load_dotenv()  # Must be BEFORE any langchain/langsmith imports
```

**Step 3: Rename field in `config.py`**
```python
langsmith_tracing: str = "true"  # was langsmith_tracing_v2
```

**Step 4: Add `@traceable` to custom services (optional but valuable)**

For non-LangChain functions (our retrieval and web search services), use the `@traceable` decorator from `langsmith` to make them visible in the trace tree:

```python
from langsmith import traceable

@traceable(run_type="retrieval", name="search_chunks")
async def search_chunks(query, user_id, doc_ids, k, threshold):
    # ... pgvector search
    pass

@traceable(run_type="tool", name="tavily_web_search")
async def web_search(query, max_results=5):
    # ... Tavily API call
    pass
```

This creates nested runs inside the action node's trace, showing retrieval separately from LLM generation.

### LangSmith Dashboard Views

Once activated, we can use these views at smith.langchain.com:

1. **Trace tree** — Click any trace → see full node execution tree with timing + cost per step
2. **Threads view** — Group traces by `thread_id` → see full conversation history with per-turn costs
3. **Project stats** — Total token usage + cost across all traces for the "policypal" project
4. **Dashboards** — Cost trends over time, input/output token breakdown

### Cost of LangSmith

- **Developer plan (free):** 5,000 traces/month — sufficient for our development + demo
- No payment needed for portfolio project usage
