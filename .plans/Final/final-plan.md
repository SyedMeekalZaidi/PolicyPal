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
- **`LLMService` fix (FIRST):** Modify `invoke_structured()` to use `include_raw=True`, return `LLMResult(parsed, tokens_used, cost_usd)` instead of just Pydantic model. Update 3 existing callers (`intent_resolver`, `doc_resolver`, `validate_inputs`) to destructure via `.parsed`. (See Research §3 for details.)
- SQL migration: `match_chunks` RPC function (see Research §1)
- `retrieval_service.py`: `search_chunks(query, user_id, doc_ids, k, threshold)` + `stratified_sample(user_id, doc_ids)` → returns chunks + similarity scores + confidence tier
- `tavily_service.py`: `def web_search(query)` → sync, uses `TavilyClient` (not async). Returns formatted results
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

**Persistence — `format_response` modification (detailed):**
`format_response` currently only updates `conversation_docs`. It must also embed metadata into the AIMessage so history reload shows confidence + cost + citations.

Specifically, `format_response` will:
1. Read from state: `retrieval_confidence`, `cost_usd`, `tokens_used`, `citations`, `action`
2. Get the last `AIMessage` from `state["messages"]` (the one the action node appended)
3. Write these into `AIMessage.additional_kwargs`:
   ```python
   ai_msg.additional_kwargs["retrieval_confidence"] = state.get("retrieval_confidence", "low")
   ai_msg.additional_kwargs["cost_usd"] = state.get("cost_usd", 0.0)
   ai_msg.additional_kwargs["tokens_used"] = state.get("tokens_used", 0)
   ai_msg.additional_kwargs["citations"] = state.get("citations", [])
   ai_msg.additional_kwargs["action"] = state.get("action", "inquire")
   ```
4. Return the updated message (the checkpoint persists `additional_kwargs` — SSE reads from state, history reads from checkpoint)

This ensures that when the frontend reloads chat history, each AI message carries its own confidence, cost, and citations — no re-computation needed.

**Test:** Send "@Inquire what are the capital requirements in @BankNegara2024" → get RAG answer with grouped citation bubbles ("+2", "+1") inline. Click a bubble → text highlights + sources panel filters to those citations. Click "View All" → all citations shown, highlight removed. New message → sources panel auto-populates. Refresh → data persists.

---

## Phase 1 — Implementation Plan

Six sub-phases, each independently testable. Must complete in order (each depends on the previous).

### Sub-phase 1.1: Foundation (LLMService + Config + State)
**Goal:** Fix the cost-tracking bug, add missing config fields, and extend AgentState — so all downstream code has a correct foundation.

**Files to modify:**
- `backend/app/services/llm_service.py`
- `backend/app/graph/nodes/intent_resolver.py`
- `backend/app/graph/nodes/doc_resolver.py`
- `backend/app/graph/nodes/validate_inputs.py`
- `backend/app/config.py`
- `backend/app/graph/state.py`

**Tasks:**
1. [ ] Add `LLMResult` NamedTuple to `llm_service.py`: `(parsed: Any, tokens_used: int, cost_usd: float)`
2. [ ] Modify `invoke_structured()`: use `with_structured_output(schema, include_raw=True)`, extract `raw_result["parsed"]` and `raw_result["raw"]`, pass raw AIMessage to `_log_usage`, compute + return `LLMResult(parsed, tokens, cost)`. If `usage_metadata` is missing, default to `(0, 0.0)`.
3. [ ] Modify `_log_usage()` to RETURN `(tokens_used, cost_usd)` in addition to logging (currently returns None).
4. [ ] Update `intent_resolver.py`: `llm_result = llm.invoke_structured(...)` → `result = llm_result.parsed`. All attribute access via `.parsed`. No other logic changes.
5. [ ] Update `doc_resolver.py`: same destructuring pattern.
6. [ ] Update `validate_inputs.py`: same destructuring pattern.
7. [ ] Add `tavily_api_key: str = ""` to `Settings` in `config.py` (optional, empty default).
8. [ ] Add `user_industry: str`, `user_location: str` to `AgentState` in `state.py`.

**Test:** Start backend → run existing graph flow (send a message) → no regressions. LangSmith or logs now show actual token counts for structured calls.

---

### Sub-phase 1.2: Retrieval Layer (Migration + Services)
**Goal:** The retrieval backbone used by all 4 actions. Semantic search via pgvector RPC + Tavily web search.

**Files to create:**
- `supabase/migrations/<timestamp>_match_chunks.sql`
- `backend/app/services/retrieval_service.py`
- `backend/app/services/tavily_service.py`

**Files to modify:**
- `backend/requirements.txt` (add `tavily-python`)

**Tasks:**
1. [ ] Create SQL migration: `match_chunks` RPC function (copy from Research §1 — accepts `query_embedding`, `filter_user_id`, `filter_doc_ids`, `match_threshold`, `match_count`; returns `id, document_id, chunk_index, page, content, similarity`).
2. [ ] Run `supabase migration new match_chunks` → paste SQL → `supabase db push`.
3. [ ] Create `retrieval_service.py` with:
   - `search_chunks(query_text: str, user_id: str, doc_ids: list[str] | None, k: int = 15, threshold: float = 0.5) -> dict` — calls `embed_texts([query_text])[0]` (single vector), then `supabase.rpc("match_chunks", {...})`, post-processes: caps 3-5 chunks per doc to prevent single-doc domination, computes confidence tier from avg similarity (≥0.7=high, ≥0.5=medium, <0.5=low). **Title enrichment:** after getting chunks, collect unique `document_id`s, fetch titles via `get_supabase().from_("documents").select("id, title").in_("id", unique_ids)`, merge `doc_title` into each chunk dict. Returns `{"chunks": [...], "confidence_tier": str, "avg_similarity": float}` where each chunk has `{id, document_id, doc_title, chunk_index, page, content, similarity}`.
   - `stratified_sample(user_id: str, doc_ids: list[str]) -> dict` — for each doc: query total chunk count, divide into 4 bands, fetch 3-4 chunks per band via Supabase table query (`.from_("chunks").select(...)...`). **Same title enrichment** as `search_chunks`. Returns `{"chunks": [...], "confidence_tier": "high"}`. (Used by Summarize/Compare holistic/Audit policy — NOT used in this sub-phase, but built now for reuse.)
   - `_enrich_with_titles(chunks: list[dict]) -> list[dict]` — shared helper that fetches and merges `doc_title` for a list of chunks. Called by both `search_chunks` and `stratified_sample` (DRY).
   - `_score_confidence(similarities: list[float]) -> tuple[str, float]` — returns `(tier, avg)`.
   - Uses `get_supabase()` and `embed_texts()` from existing services.
4. [ ] Create `tavily_service.py` with:
   - `web_search(query: str, max_results: int = 5) -> list[dict]` — sync `TavilyClient`. Returns `[{title, url, content, score}]`. If `tavily_api_key` is empty, log warning and return `[]`. Wrap in try/except for API errors → return `[]` with logged warning.
5. [ ] Add `tavily-python` to `requirements.txt`.

**Test:** Python REPL or temp test script:
- `search_chunks("capital requirements", user_id, [doc_id])` → returns chunks with similarity scores.
- `web_search("Bank Negara capital requirements 2024")` → returns Tavily results (or `[]` if no API key).

---

### Sub-phase 1.3: Inquire Action Node
**Goal:** Replace the Inquire stub with real RAG — retrieval, optional web search, LLM generation with citations, confidence scoring. The core of the vertical slice.

**Files to create:**
- `backend/app/models/action_schemas.py` (Pydantic models for all action responses — shared across phases)
- `backend/app/graph/nodes/inquire.py`

**Files to modify:**
- `backend/app/graph/builder.py` (import `inquire_action` from new file instead of `stub_actions`)
- `backend/app/routers/chat.py` (user context injection — profile fetch)

**Tasks:**
1. [ ] Create `action_schemas.py` with:
   - `Citation(BaseModel)`: `id: int, source_type: Literal["document", "web"], doc_id: Optional[str], title: str, page: Optional[int], url: Optional[str], quote: str`
   - `InquireResponse(BaseModel)`: `response: str, citations: list[Citation]`
   - (Future phases will add `SummarizeResponse`, `CompareResponse`, `AuditResponse` here — single file for all action schemas.)
2. [ ] Create `inquire.py` with `def inquire_action(state: AgentState) -> dict`:
   - Read: `resolved_doc_ids`, `messages`, `enable_web_search`, `user_id`, `user_industry`, `user_location`
   - Extract user query from last `HumanMessage`
   - **Retrieve:** Call `retrieval_service.search_chunks(query, user_id, doc_ids, k=15, threshold=0.5)`
   - **Web search (conditional):** If `enable_web_search` and Tavily is configured, generate a search query from user question, call `tavily_service.web_search(query)`. Store in `web_search_results`.
   - **Build context block:** Format chunks as `[N] Source: {title} | Page: {page}\n"{content}"` (per Research §9). Append web results as additional numbered sources with `source_type: "web"`.
   - **Build system prompt:** Role + RAG rules + context block + user context injection (if industry/location present). 150-250 words per §9 guidelines.
   - **LLM call:** `llm_service.invoke_structured("inquire", InquireResponse, [system_msg, human_msg])` → `LLMResult(parsed, tokens, cost)`.
   - **Return:** `{ "response": parsed.response, "citations": [c.model_dump() for c in parsed.citations], "retrieved_chunks": chunks, "retrieval_confidence": confidence_tier, "confidence_score": avg_sim, "tokens_used": tokens, "cost_usd": cost, "web_search_results": web_results, "web_search_query": query_used, "messages": [AIMessage(content=parsed.response)] }`
3. [ ] Update `builder.py`: change `from app.graph.nodes.stub_actions import inquire_action` → `from app.graph.nodes.inquire import inquire_action`. Keep other 3 stubs unchanged.
4. [ ] Update `chat.py` `/chat` endpoint: after building `initial_state`, fetch profile: `get_supabase().from_("profiles").select("industry, location").eq("id", user_id).single().execute()`. Add `"user_industry": profile.industry or ""`, `"user_location": profile.location or ""` to `initial_state`. Wrap in try/except — if profile fetch fails, default to empty strings.

**Test:** Send "@Inquire what are the key policies in @BankNegara2024" via the chat UI.
- PalReasoning shows "Clarifying intent..." → "Finding documents..." → "Researching your question..." → "Formatting response..."
- Response: real RAG answer (not stub text) with `[1]`, `[2]` markers in the text
- SSE `ChatResponse` contains `citations: [...]`, `tokens_used > 0`, `cost_usd > 0`
- Frontend still displays as plain text (markdown rendering comes in 1.5) — but data is correct

---

### Sub-phase 1.4: format_response Enhancement
**Goal:** Persist confidence, cost, citations, and action in the AIMessage checkpoint so history reload shows the same badges.

**Files to modify:**
- `backend/app/graph/nodes/format_response.py`

**Tasks:**
1. [ ] After the existing `conversation_docs` merge logic, add:
   - Get the last `AIMessage` from `state["messages"]`
   - Clone it with updated `additional_kwargs` containing: `retrieval_confidence`, `cost_usd`, `tokens_used`, `citations` (list of dicts), `action`
   - Return the cloned message in `{"messages": [updated_ai_msg]}` so the `add_messages` reducer replaces the old one (same `id`)
2. [ ] Edge case: if no AIMessage exists in messages (e.g., cancel flow), skip metadata injection.

**Test:** Send Inquire query → get response → refresh page → `/chat/history` endpoint returns messages where the AI message's `additional_kwargs` contains `retrieval_confidence`, `cost_usd`, `tokens_used`, `citations`. Frontend still renders confidence dot + cost badge from the reloaded data.

---

### Sub-phase 1.5: Frontend — Markdown + Citation Bubbles
**Goal:** Render AI responses as markdown with Perplexity-style grouped citation bubbles.

**Files to create:**
- `components/chat/cited-markdown.tsx` (CitedMarkdown + parsing logic)
- `components/chat/citation-bubble.tsx` (glassmorphism pill)

**Files to modify:**
- `lib/types/chat.ts` (add `Citation`, `CitationGroup` types, update `ChatResponse.citations` to `Citation[]`)
- `components/dashboard/chat-panel.tsx` (replace plain text `{m.text}` with `<CitedMarkdown>`)
- `package.json` (install deps)

**Tasks:**
1. [ ] Run `npm install react-markdown remark-gfm`
2. [ ] Add to `lib/types/chat.ts`:
   - `Citation` type: `{ id: number, source_type: "document"|"web", doc_id?: string, title: string, page?: number, url?: string, quote: string }`
   - `CitationGroup` type: `{ spanId: string, citationIds: number[] }`
   - Update `ChatResponse.citations` from `Record<string, unknown>[]` to `Citation[]`
3. [ ] Create `citation-bubble.tsx`:
   - Props: `groupId`, `citationIds`, `count`, `onClick(groupId, citationIds)`, `isActive`
   - Renders glassmorphism pill (design system: `rounded-full`, `bg-primary/10`, `border-primary/20`, `text-primary`, `text-xs font-medium`)
   - Shows count: single = "1", multiple = "+3"
   - Hover: subtle lift effect
   - Active state: `bg-primary/20` when highlighted
4. [ ] Create `cited-markdown.tsx`:
   - Props: `content: string`, `citations: Citation[]`, `highlightedGroup: CitationGroup | null`, `onBubbleClick(group: CitationGroup | null)` (null = "View All" / clear highlight)
   - **Parsing algorithm** (per Research §5):
     a. Use `react-markdown` with `remarkGfm` for base rendering
     b. Custom `components.p` and `components.li` override: process text children through citation parser
     c. Citation parser: regex split on `/(\[\d+\](?:\[\d+\])*)/g`, group consecutive markers, merge text + markers into `CitedSegment[]`
     d. Render each segment: `<span data-cite-group={gN} className={highlighted ? "cite-highlighted" : ""}>text</span>` + `<CitationBubble />`
   - CSS class `cite-highlighted`: `bg-primary/10 rounded-sm px-0.5 transition-colors` (subtle highlight)
   - Bottom "View All" pill: show only when `citations.length > 0`. Glassmorphism pill with file icon + `"{count} sources"`. onClick → `onBubbleClick(null)` (clears highlight, shows all)
   - Edge case: no `[N]` markers but citations exist → still show "View All" button
   - **Table wrapper:** wrap `<table>` in `<div className="overflow-x-auto">` for horizontal scroll (needed by Compare phase)
5. [ ] Update `chat-panel.tsx` assistant bubble:
   - Replace `{m.text}` with `<CitedMarkdown content={m.text} citations={m.response?.citations || []} highlightedGroup={...} onBubbleClick={...} />`
   - Update cost display: replace 🪙 with `<DollarSign className="h-3 w-3" />` from Lucide
   - Add local `highlightedGroup` state per message (or lift to context in 1.6)

**Test:** Send Inquire query → response renders as markdown (bold, lists, etc.). Citation markers `[1][2]` appear as clickable pills inline. Click pill → text segment highlights with subtle blue background. "3 sources" pill at bottom. Cost icon is now a dollar sign. (Sources panel not yet wired — that's 1.6.)

---

### Sub-phase 1.6: Sources Panel + Citation Context
**Goal:** Wire citation state across panels — clicking a citation bubble filters the Sources Panel, new messages auto-populate it.

**Files to create:**
- `context/citation-context.tsx` (React Context for citation state)
- `components/dashboard/citation-card.tsx` (individual citation card in Sources Panel)

**Files to modify:**
- `components/dashboard/dashboard-shell.tsx` (wrap with CitationProvider, wire state)
- `components/dashboard/sources-panel.tsx` (render real citations, support filtering)
- `components/dashboard/chat-panel.tsx` (consume CitationContext, call setActiveCitations on new response, call setHighlightedGroup on bubble click)
- `components/chat/cited-markdown.tsx` (use context instead of local state for highlighting)

**Tasks:**
1. [ ] Create `citation-context.tsx`:
   - `CitationContextValue`: `{ activeCitations: Citation[], highlightedGroup: CitationGroup | null, setActiveCitations, setHighlightedGroup, sourcesCollapsed: boolean, toggleSources: () => void }`
   - Provider owns `sourcesCollapsed` state (moved FROM DashboardShell — a component can't consume its own provider, so the panel collapse state must live inside the context)
   - **Auto-expand logic** lives inside the Provider: `useEffect` watching `activeCitations.length` — when changes from 0 → non-zero, set `sourcesCollapsed = false`
   - Default: empty citations, null highlighted, `sourcesCollapsed = false`
2. [ ] Update `dashboard-shell.tsx`:
   - Wrap `return` JSX with `<CitationProvider>`
   - **Remove** local `sourcesCollapsed` state and `toggleSources` callback (now in context)
   - SourcesPanel reads `sourcesCollapsed` and `toggleSources` from context instead of props
   - DashboardShell becomes a thin layout wrapper — all citation + panel state managed by context
3. [ ] Update `chat-panel.tsx`:
   - Consume `CitationContext` via `useCitationContext()`
   - In `onResponse` callback: call `setActiveCitations(event.citations)` to populate Sources Panel
   - In bubble click handler: call `setHighlightedGroup({ spanId, citationIds })` or `setHighlightedGroup(null)` for "View All"
   - When user clicks a different AI message's citation: replace `activeCitations` with that message's citations
4. [ ] Update `cited-markdown.tsx`:
   - Read `highlightedGroup` from context instead of props/local state
   - `onBubbleClick` calls `setHighlightedGroup` from context
5. [ ] Create `citation-card.tsx`:
   - Props: `citation: Citation`
   - Renders: icon (FileText for document, Globe for web), title, page number or URL, quote preview (truncated to 2 lines)
   - Glassmorphism card style (match existing card patterns)
6. [ ] Update `sources-panel.tsx`:
   - Consume `CitationContext` (replaces `isCollapsed` and `onToggle` props — now reads `sourcesCollapsed`, `toggleSources`, `activeCitations`, `highlightedGroup` from context)
   - If `activeCitations` is empty → show current empty state text
   - If `activeCitations` is non-empty:
     - If `highlightedGroup` is null → render ALL `activeCitations` as `<CitationCard>` list
     - If `highlightedGroup` is set → render only citations whose `id` is in `highlightedGroup.citationIds`
   - Section header: "Sources" with count badge
   - Separate document and web citations into two groups with section dividers
7. [ ] History reload support: when ChatPanel loads history, if user clicks an assistant message, set `activeCitations` from that message's `response.citations`. (Deferred to Phase 6 polish if time-pressed — not blocking.)

**Test (full vertical slice):**
1. "@Inquire what are the capital requirements in @BankNegara2024"
2. PalReasoning indicators flow through
3. Response renders as markdown with inline citation bubbles ("+2", "1")
4. Sources Panel auto-expands with all citations (document cards with icons)
5. Click a "+2" bubble → text highlights, Sources Panel filters to 2 citations
6. Click "3 sources" (View All) → highlight removed, all citations shown
7. Send a different message → new citations replace old ones in Sources Panel
8. Refresh page → confidence dot + cost badge persist (citations in panel reset — expected, they reload on message click in Phase 6)

---

### Phase 1 — Dependency Graph

```
1.1 Foundation ──► 1.2 Retrieval ──► 1.3 Inquire Node ──► 1.4 format_response
                                                                    │
                                          1.5 Frontend Markdown ◄───┘
                                                    │
                                          1.6 Sources Panel + Context
```

### Phase 1 — Files Summary

| Sub-phase | New files | Modified files |
|-----------|-----------|----------------|
| **1.1** | — | `llm_service.py`, `intent_resolver.py`, `doc_resolver.py`, `validate_inputs.py`, `config.py`, `state.py` |
| **1.2** | `match_chunks.sql`, `retrieval_service.py`, `tavily_service.py` | `requirements.txt` |
| **1.3** | `action_schemas.py`, `inquire.py` | `builder.py`, `chat.py` |
| **1.4** | — | `format_response.py` |
| **1.5** | `cited-markdown.tsx`, `citation-bubble.tsx` | `chat.ts`, `chat-panel.tsx`, `package.json` |
| **1.6** | `citation-context.tsx`, `citation-card.tsx` | `dashboard-shell.tsx`, `sources-panel.tsx`, `chat-panel.tsx`, `cited-markdown.tsx` |

### Phase 1 — Reuse by Future Phases

| Built in Phase 1 | Reused by |
|-------------------|-----------|
| `retrieval_service.search_chunks()` | Inquire, Compare (focused), Audit (text mode) |
| `retrieval_service.stratified_sample()` | Summarize, Compare (holistic), Audit (policy mode) |
| `tavily_service.web_search()` | Inquire, Summarize, Audit (when web search enabled) |
| `LLMResult` + fixed `invoke_structured()` | Every LLM call in every phase |
| `Citation` Pydantic model | All 4 action schemas |
| `CitedMarkdown` component | Every AI response in every action |
| `CitationContext` | All citation interactions |
| `citation-card.tsx` + `SourcesPanel` | All actions |
| `format_response` metadata persistence | All actions |
| User context injection | All action node prompts |

---

### Phase 1.7: LangSmith Observability (Consolidated Fix)

**Root Cause:** The LangSmith SDK sends traces via a background batch thread (`auto_batch_tracing=True`). In FastAPI/uvicorn, this background thread silently dies or never flushes (documented: GitHub langsmith-sdk #457, #1630). `Client.list_projects()` works because it's a synchronous HTTP call that bypasses the tracing pipeline. `@traceable` functions succeed because they only *queue* data — they don't confirm delivery.

**Two separate flush mechanisms needed:**
- `Client().flush()` → flushes `@traceable` decorator trace queue
- `wait_for_all_tracers()` from `langchain_core.tracers.langchain` → flushes LangChainTracer callback queue (used by LangGraph)

**What's already done (keep):**
- ✅ Env vars in `.env`: `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT=policypal`, `LANGSMITH_ENDPOINT`
- ✅ `load_dotenv(path, override=True)` at top of `main.py` before imports
- ✅ Backward-compat aliases: `LANGCHAIN_API_KEY`, `LANGCHAIN_TRACING_V2`
- ✅ `langsmith_endpoint` field in `config.py` Settings
- ✅ `LangChainTracer` injected in graph config via `_make_graph_config()`
- ✅ `@traceable` on `LLMService` methods, `inquire_action`, `format_response`
- ✅ `tracing_context` wrapper around `graph.astream` in `_stream_graph()`
- ✅ Startup API key validation via `Client.list_projects()`

**Implementation — 3 changes:**

**1. Shared LangSmith client singleton** (`backend/app/services/langsmith_client.py` — new file)
- Create module-level `Client()` instance + export `flush_traces()` helper
- `flush_traces()` calls both `client.flush()` AND `wait_for_all_tracers()`
- Single import for any module that needs to flush

**2. Startup ping with explicit flush** (`main.py`)
- After `_ping()` runs, call `flush_traces()` to synchronously send the trace
- Add 2-second sleep after flush + re-check via `client.list_runs()` to confirm delivery
- Log whether the ping trace was actually received by LangSmith (not just queued)
- Add `@app.on_event("shutdown")` handler that calls `flush_traces()` to drain remaining traces

**3. Post-stream flush** (`chat.py`)
- At the end of `_stream_graph()`, after the `with tracing_context` block exits, call `flush_traces()`
- This ensures every graph run's traces are delivered before the SSE stream closes
- Placed outside the `try/except` so it runs even on error paths

**What's automatic (zero code):** Full trace tree per graph invocation (via `LangChainTracer` callback), per-LLM-call token counts + costs, latency per node, input/output for each step, thread grouping via `thread_id` in config, `@traceable` nested spans for LLMService/retrieval/tavily calls.

**Test:** 
1. Restart backend → check startup logs show "ping trace confirmed delivered"
2. Send an Inquire query → check `policypal` project at smith.langchain.com
3. Should see trace tree: intent_resolver → doc_resolver → validate_inputs → inquire → format_response, each with token/cost breakdown

---

## Phase 2: Summarize (~45 min)

**Overview:** Replace the summarize stub with a real action node. Uses `stratified_sample()` (positional spread, NOT semantic search) to get representative chunks across the full document, then GPT-4o-mini produces a structured summary with key points and citations. Multi-doc messages get per-doc section headings. No web search — summarization is inherently about the user's uploaded documents.

**Key architectural differences from Inquire:**
- **No `rewrite_query()`** — stratified sampling is position-based, query doesn't affect which chunks are returned
- **No web search** — `enable_web_search` is ignored; summarization is about the user's docs only
- **No mode selection (A/B/C)** — `validate_inputs` already enforces that Summarize requires 1+ docs. Only one prompt mode needed.
- **Per-doc grouping** — context block groups chunks by document (not interleaved by relevance) so the LLM produces coherent per-doc summaries
- **Confidence always "high"** — stratified sampling covers the full document by design

**Reuses from Phase 1:**
- `retrieval_service.stratified_sample()` — already built and tested
- `Citation` Pydantic model from `action_schemas.py`
- `LLMService.invoke_structured()` → `LLMResult`
- `format_response` metadata injection (no changes needed)
- `@traceable` decorator for LangSmith observability
- `_enrich_with_titles()` — already called inside `stratified_sample()`

**Files changed:**

| File | Change Type |
|------|-------------|
| `backend/app/models/action_schemas.py` | Add `SummarizeResponse` schema |
| `backend/app/graph/nodes/summarize.py` | **New file** — real summarize action node |
| `backend/app/graph/builder.py` | Swap import from `stub_actions.summarize_action` → `summarize.summarize_action` |
| `backend/app/graph/nodes/validate_inputs.py` | Extend web search cleanup to also drop flag for `summarize` |

**Files NOT changed:** `state.py`, `chat.py`, `format_response.py`, `retrieval_service.py`, `llm_service.py`, all frontend files.

---

### Sub-phase 2.1: SummarizeResponse Schema
**Goal:** Add the Pydantic structured output schema for the Summarize LLM call.

**File:** `backend/app/models/action_schemas.py`

**Tasks:**
1. Add `SummarizeResponse(BaseModel)` with 3 fields:
   - `summary: str` — Full structured summary with inline `[N]` citation markers. For multi-doc, includes markdown `### DocTitle` section headings.
   - `key_points: list[str]` — 3-7 bullet-point key takeaways extracted from the document(s). Each point should be 1-2 sentences. No citation markers needed here (they're in the summary).
   - `citations: list[Citation]` — Same `Citation` model as Inquire. id matches `[N]` markers in the summary text.

**Why `key_points` as a separate field?** Gives the frontend a clean structured list for display without parsing markdown bullets. Also forces the LLM to distill takeaways rather than just dumping text — better output quality.

**Edge case:** LLM might return 0 key points for a very short document. This is fine — the summary field is the primary output.

---

### Sub-phase 2.2: validate_inputs — Drop Web Search for Summarize
**Goal:** Explicitly drop `enable_web_search` for summarize in `validate_inputs`, matching the existing compare pattern. Log a message so LangSmith traces show it was intentionally dropped.

**File:** `backend/app/graph/nodes/validate_inputs.py`

**Tasks:**
1. Change the web search cleanup condition from:
   `if action == "compare" and enable_web_search:`
   to:
   `if action in ("compare", "summarize") and enable_web_search:`
2. Update the log message to include the action name:
   `"validate_inputs | %s + web_search=True -> dropping web search flag (not applicable)", action`

**Why here instead of in the summarize node?**
`validate_inputs` is the single place where action-specific flag cleanup lives. Doing it there keeps the summarize node clean (it never even sees `enable_web_search`) and prevents stale `True` values from polluting traces or future cost tracking logic. Consistent with how compare already works.

**Edge case:** User sends `@Summarize @Web Search @Doc` — frontend sets `enable_web_search=True`. After this fix, `validate_inputs` drops it to `False` and logs the reason. The summarize node never knows web search was requested — clean separation.

---

### Sub-phase 2.3: Summarize Action Node
**Goal:** Create the real `summarize_action` that replaces the stub.

**File:** `backend/app/graph/nodes/summarize.py` (new file)

**Pipeline (7 steps):**

```
Step 1: Read state
  → resolved_doc_ids, resolved_doc_titles, clean_query, user_id, user_industry, user_location

Step 2: stratified_sample(user_id, resolved_doc_ids)
  → ~16 chunks per doc, evenly spread across intro/body/conclusion
  → confidence_tier always "high"

Step 3: Build per-doc context block
  → Group chunks by document_id
  → For each doc group: "### {doc_title}" header, then numbered [N] entries
  → Global numbering across all docs: [1]...[N]

Step 4: Build system prompt
  → Role: compliance document summarizer
  → Context: per-doc grouped context block
  → Task: structured summary with per-doc sections (if multi-doc)
  → Rules: cite with [N], produce key_points, don't merge unrelated sections
  → User context: industry/location if available

Step 5: Build human message
  → If clean_query is non-empty: use it (e.g. "Focus on governance requirements")
  → If clean_query is empty (pure mention): use "Summarize these documents comprehensively."

Step 6: LLM call
  → invoke_structured("summarize", SummarizeResponse, messages) → LLMResult

Step 7: Return state update
  → Same shape as Inquire: response, citations, retrieved_chunks, confidence, cost, AIMessage
  → response = f"{parsed.summary}\n\n**Key Points:**\n{bullet_list}"
    (combine summary + key_points into one response string for the frontend renderer)
  → confidence_score = 1.0 (fixed — stratified sampling has no similarity scores to average;
    Inquire uses avg cosine similarity here, but positional sampling always covers the full doc)
  → retrieval_confidence = "high" (from stratified_sample — always "high" by design)
```

**System prompt design (following §9 prompt engineering rules):**

Single mode — strict document context (no general knowledge fallback):
```
Role:   You are a compliance document summarizer for PolicyPal.
Context: [per-doc grouped chunks with [N] numbering]
Task:   Produce a structured summary of the document(s).
        For multi-doc: use ### headings for each document section.
        Extract 3-7 key takeaways as bullet points.
Rules:  - Cite specific claims with [N] markers
        - Cover all major topics found in the context
        - Do not merge content from different documents into one section
        - If user provided a focus instruction, emphasize that area
        - Copy verbatim quotes into citation quote fields
User context: {industry/location if available}
Format: Return summary (markdown with [N] markers), key_points (list of strings), citations (list)
```

**Context block helper — `_build_summarize_context()`:**

Unlike Inquire's `_build_context_block()` which interleaves all chunks by relevance, Summarize needs **per-doc grouping** so the LLM can write coherent per-doc sections:

```
### Muscle Building Guide
[1] Source: Muscle Building Guide | Page: 2 | DocID: 80b7...
"Training hard with weights gives your body that reason..."

[2] Source: Muscle Building Guide | Page: 4 | DocID: 80b7...
"Good lifting technique allows you to stimulate..."

### BankNegara 2024
[3] Source: BankNegara 2024 | Page: 1 | DocID: a3f2...
"This policy document sets out the minimum..."
```

Global `[N]` numbering across all docs — critical for citation mapping.

**Why a separate helper instead of reusing `_build_context_block()` from Inquire?**
Different structure requirement: Inquire interleaves chunks by relevance (no doc grouping), Summarize groups by document. The numbering logic and metadata format are the same, but the grouping is fundamentally different. Keeping them separate avoids a tangled `if action == "summarize"` branch in a shared function.

**Edge cases handled:**
- `resolved_doc_ids = []` → `stratified_sample` returns 0 chunks → short "no documents to summarize" response. (Shouldn't happen — `validate_inputs` catches this, but defensive.)
- Single doc with 3 chunks → `stratified_sample` gets all 3 → LLM works fine with less context, summary is just shorter.
- `clean_query` has focus instruction → passes through as the HumanMessage → LLM naturally focuses the summary.
- 5 docs (max allowed) → ~80 chunks → ~16,000 tokens of context → within GPT-4o-mini's 128k window, no issue.

---

### Sub-phase 2.4: Builder Wiring
**Goal:** Replace the stub import with the real summarize node.

**File:** `backend/app/graph/builder.py`

**Tasks:**
1. Change import: `from app.graph.nodes.stub_actions import summarize_action` → `from app.graph.nodes.summarize import summarize_action`
2. Keep `audit_action` and `compare_action` still imported from `stub_actions` (they stay as stubs until Phase 3 and 4).
3. No edge changes — `"summarize"` node name already exists in the graph.

**After this change, `stub_actions.py` still provides:**
- `compare_action` (stub until Phase 3)
- `audit_action` (stub until Phase 4)
- `_build_stub_response` helper (shared by remaining stubs)

The `summarize_action` and `inquire_action` functions in `stub_actions.py` are now dead code. Do NOT delete `stub_actions.py` — the other two stubs still depend on it.

---

### Sub-phase 2.5: Final Integration Test

**Test scenarios — all 5 must pass:**

| # | Input | Expected |
|---|-------|----------|
| S1 | `@Summarize @MuscleBuilding` | Structured summary with ~5 citations, key points, confidence=high, confidence_score=1.0, cost > 0 |
| S2 | `@Summarize @AtomicHabits @MuscleBuilding` | Per-doc sections with `###` headings, citations from both docs |
| S3 | `@Summarize @AtomicHabits Focus on identity change` | Summary emphasizes identity-based habits, key points filtered to that focus |
| S4 | Refresh page after S1 | Confidence badge, cost, citations all persist (format_response already handles this) |
| S5 | `@Summarize @Web Search @AtomicHabits` | `validate_inputs` logs "dropping web search flag". Summary produced normally — no web results in citations. |

**LangSmith trace should show:**
```
intent_resolver → doc_resolver → validate_inputs → summarize → format_response
```
- `summarize` span contains: `stratified_sample` as a child retriever span
- No `rewrite_query` span (not used)
- No `web_search` span (not used)

**Regression — Inquire must still work:** Send `@Inquire @AtomicHabits What is this about?` after testing Summarize. Should return normal RAG answer. The builder change only swapped the summarize import — inquire is untouched.

---

## Phase 3: Compare (~1.5 hrs)
**Both focused + holistic modes in MVP.**

**Overview:** Replace the compare stub with a real action node that has two distinct pipelines selected at runtime by a mini-LLM classification step. Focused mode produces a markdown TABLE via per-doc semantic search; holistic mode produces a 5-section report via stratified sampling + theme extraction. Both use GPT-4o for the final generation (strongest reasoning for cross-document synthesis).

**Key architectural differences from Inquire/Summarize:**
- **Two pipelines in one node** — mode classification first, then branch to focused or holistic
- **Multiple LLM calls per run** — classification (mini) + optional themes (mini) + generation (4o). Costs must be summed.
- **GPT-4o for generation** — `"compare"` action key routes to `gpt-4o` (not mini) for multi-doc reasoning quality
- **Per-doc balanced retrieval** (focused) — individual `search_chunks()` per doc to guarantee balanced coverage
- **No web search** — `validate_inputs` already drops the flag for compare

**Reuses from Phase 1 & 2:**
- `search_chunks()` — focused per-doc semantic retrieval
- `stratified_sample()` — holistic full-doc positional sampling
- `rewrite_query()` with `"compare"` template — query optimization for focused mode
- `Citation` Pydantic model, `LLMService.invoke_structured()` → `LLMResult`
- `_build_summarize_context()` pattern — per-doc grouped `[N]` context blocks
- `format_response` metadata injection (no changes needed)
- `@traceable` for LangSmith observability
- `CitedMarkdown` table rendering with `overflow-x: auto` (already built in Phase 1)

**Files changed:**

| File | Change Type |
|------|-------------|
| `backend/app/models/action_schemas.py` | Add `CompareIntent` + `CompareResponse` schemas |
| `backend/app/services/theme_service.py` | **New file** — `extract_themes()` shared helper (reused by Audit Phase 4) |
| `backend/app/graph/nodes/compare.py` | **New file** — real compare action node |
| `backend/app/graph/builder.py` | Swap import from `stub_actions.compare_action` → `compare.compare_action` |

**Files NOT changed:** `state.py`, `validate_inputs.py`, `llm_service.py`, `retrieval_service.py`, `graph/utils.py`, `chat.py`, all frontend files.

---

### Sub-phase 3.1: CompareIntent + CompareResponse Schemas
**Goal:** Add Pydantic structured output schemas for mode classification and the compare LLM call.

**File:** `backend/app/models/action_schemas.py`

**Tasks:**
1. Add `CompareIntent(BaseModel)` with 2 fields:
   - `mode: Literal["focused", "holistic"]` — classification result
   - `topic: Optional[str] = None` — extracted specific topic for focused mode (null for holistic)

2. Add `CompareResponse(BaseModel)` with 2 fields:
   - `response: str` — Markdown with inline `[N]` markers. For focused: comparison table + brief analysis. For holistic: 5-section report with `###` headings.
   - `citations: list[Citation]` — Same Citation model as Inquire/Summarize.

**Why one CompareResponse for both modes?** The mode-specific structure (table vs 5-section) is encoded in the markdown via prompt instructions. The frontend's `CitedMarkdown` already renders both tables and headings. Separate schemas would add complexity for no benefit.

---

### Sub-phase 3.2: Theme Service (Shared Helper)
**Goal:** Create `extract_themes()` — a GPT-4o-mini call that distills document chunks into 3-5 comparison themes. Used by holistic compare now and by Audit policy mode in Phase 4.

**File:** `backend/app/services/theme_service.py` (new file)

**Design:**
- Input: list of chunks (from `stratified_sample`), dict of `{doc_id: title}` (same shape as `resolved_doc_titles` in state)
- Returns: `LLMResult` — caller accesses `.parsed.themes: list[str]` for the 3-5 theme strings, and `.tokens_used` / `.cost_usd` to sum into the node total
- LLM call: `invoke_structured("intent", ThemeExtraction, messages)` — routes to GPT-4o-mini via `"intent"` action key (classification task, same routing as intent_resolver)
- Private Pydantic schema: `ThemeExtraction(themes: list[str])`
- `@traceable(run_type="tool", name="extract_themes")`

**Caller usage pattern:**
```python
theme_result = extract_themes(chunks, resolved_doc_titles)
themes: list[str] = theme_result.parsed.themes
total_tokens += theme_result.tokens_used
total_cost += theme_result.cost_usd
```

**System prompt:**
```
You are a document analysis assistant.

DOCUMENTS: {comma-separated doc titles}

CONTEXT (representative passages from the documents):
[1] {chunk1 content, first 300 chars}
[2] {chunk2 content, first 300 chars}
...

TASK: Identify 3-5 major themes or topics that appear across these documents — either as shared requirements or as key points of divergence. Each theme should be 2-5 words.

RULES:
- Focus on compliance/regulatory themes (requirements, frameworks, processes, penalties).
- Return exactly 3-5 themes — no more, no fewer.
- Each theme must be grounded in the context above, not invented from general knowledge.
```

**Why a separate service file?** Audit policy mode (Phase 4) needs the exact same function. Putting it in `compare.py` would require Audit to import from another action node (messy coupling). A service file keeps it clean — `theme_service.py` alongside `retrieval_service.py` and `llm_service.py`.

**Edge case:** LLM returns < 3 themes OR fails → return a fallback `LLMResult` with `parsed.themes = ["Key Requirements", "Implementation Approach", "Compliance Standards"]` and zero cost. Wraps error in a try/except — never crashes the graph.

---

### Sub-phase 3.3: Compare Action Node
**Goal:** Create the real `compare_action` that replaces the stub. Contains the mode classification, two retrieval branches, and two prompt modes.

**File:** `backend/app/graph/nodes/compare.py` (new file)

**Pipeline (9 steps):**

```
Step 1: Read state
  → resolved_doc_ids, resolved_doc_titles, clean_query, user_id, user_industry, user_location

Step 2: Mode classification
  → If clean_query is empty → shortcut to "holistic" (no LLM, $0)
  → Else → invoke_structured("intent", CompareIntent, classification_prompt) → mode + topic
  → Track classification tokens/cost

Step 3: Branch on mode
  ├── FOCUSED (Steps 4a–5a)
  └── HOLISTIC (Steps 4b–5b)

Step 4a (Focused): Per-doc semantic retrieval
  → rewrite_query(topic or clean_query, doc_titles, "compare") → optimized_query
  → For each doc_id: search_chunks(optimized_query, user_id, [doc_id], k=7, threshold=0.5)
  → Merge all per-doc chunks into one list
  → Confidence: average similarity across all chunks (or "low" if 0 chunks)

Step 4b (Holistic): Stratified sampling + theme extraction
  → stratified_sample(user_id, resolved_doc_ids) → ~16 chunks per doc
  → extract_themes(chunks, resolved_doc_titles) → LLMResult; access .parsed.themes for 3-5 strings
  → Track theme_result.tokens_used / theme_result.cost_usd
  → Confidence: fixed 1.0 / "high"

Step 5: Build per-doc grouped context block
  → _build_compare_context(chunks, resolved_doc_ids, resolved_doc_titles, sort_by)
  → Group by doc_id → "### DocTitle (DocID: {id})" heading per doc (ALWAYS, even if 0 chunks)
  → Docs with 0 chunks → placeholder: "(No relevant passages found for this topic.)"
  → Docs with chunks → [N] numbered content, global numbering across all docs
  → sort_by="similarity" for focused, "chunk_index" for holistic

Step 6: Build mode-specific system prompt

Step 7: Build human message
  → Focused: use clean_query (the user's full question/topic)
  → Holistic: "Compare these documents comprehensively across the identified themes."

Step 8: LLM call → GPT-4o
  → invoke_structured("compare", CompareResponse, messages) → LLMResult
  → Track generation tokens/cost

Step 9: Return state update
  → Sum ALL LLM costs: classification + themes (if holistic) + generation
  → Same return shape as Inquire/Summarize
```

**Classification prompt (Step 2):**
```
You are a comparison mode classifier.

DOCUMENTS: {doc titles}

TASK: Given the user's comparison request, determine:
1. Mode: "focused" if the user asks about a SPECIFIC topic/aspect, "holistic" if they want a general/comprehensive comparison.
2. Topic: if focused, extract the specific topic (2-10 words). If holistic, set to null.

RULES:
- "Compare everything" / "thorough analysis" / no specific topic → holistic
- "Compare capital requirements" / "how do they differ on X?" → focused with topic=X
- When in doubt, default to holistic (safer — shows everything)
```

**Focused system prompt (Step 6a):**
```
You are a compliance document comparison analyst for PolicyPal.

CONTEXT:
{per-doc grouped context block}

COMPARISON TOPIC: {topic}

TASK: Generate a focused comparison of the documents on the specified topic.
1. Start with a markdown COMPARISON TABLE:
   | Aspect | {Doc1Title} | {Doc2Title} | ({Doc3Title if present}) |
   Fill each cell with the key finding for that aspect from that document.
2. After the table, write a brief (2-3 paragraph) analysis highlighting the most important differences and their implications.

RULES:
- Place [N] citation markers after factual claims in both the table cells and the analysis.
- Use ONLY the context above. Do not use prior knowledge.
- If a document doesn't address a particular aspect, write "Not addressed" in that cell.
- Include 4-8 meaningful comparison aspects (rows) in the table.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context header.{user_context}

FORMAT: Return a response string (markdown table + analysis with [N] markers) and a citations list.
```

**Holistic system prompt (Step 6b):**
```
You are a compliance document comparison analyst for PolicyPal.

CONTEXT:
{per-doc grouped context block}

KEY THEMES IDENTIFIED: {theme1, theme2, theme3, ...}

TASK: Generate a comprehensive comparison report with these 5 sections:
### Overview
What each document covers and its primary purpose.
### Key Differences
Where the documents diverge on the identified themes.
### Similarities
Common ground and shared requirements across the documents.
### Unique Aspects
What is exclusive to each document (not found in others).
### Implications
Practical takeaways — what do these differences and similarities mean for compliance?

RULES:
- Place [N] citation markers after factual claims throughout all sections.
- Use ONLY the context above. Do not use prior knowledge.
- Address each identified theme across the relevant sections.
- Do not merge content from different documents without attribution.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context header.{user_context}

FORMAT: Return a response string (5-section markdown report with ### headings and [N] markers) and a citations list.
```

**Context block helper — `_build_compare_context()`:**
Same structure as Summarize's `_build_summarize_context()` with one critical difference: **docs with 0 matching chunks are NOT skipped** — they still get a `### DocTitle` heading followed by a `(No relevant passages found for this topic.)` placeholder line. This is essential so the LLM knows all tagged documents exist and writes "Not addressed" in the table column rather than silently omitting a doc from the comparison.

Sorting:
- Focused mode: chunks sorted by similarity desc within each doc (most relevant first)
- Holistic mode: chunks sorted by chunk_index asc within each doc (positional document flow)

The `sort_by` parameter (default `"similarity"`) controls this — one helper handles both modes cleanly.

**Why a separate helper instead of importing from Summarize?**
- Summarize silently skips docs with 0 chunks (correct — nothing to summarize)
- Compare must include all docs even with 0 chunks (critical for table columns and LLM awareness)
- The empty-doc placeholder text differs by use-case

These are fundamentally different behaviors. Merging them with a branch parameter would make both helpers harder to reason about.

**Edge cases handled:**
- `clean_query` empty → shortcut to holistic, skip classification LLM (saves $0.001 + latency)
- Classification fails (LLM error) → fallback to holistic (safer default — shows everything)
- Classification says focused but `topic` is null → use `clean_query` as topic. If clean_query is also empty, fall back to holistic.
- Focused: 0 chunks from ALL docs → skip context block construction, return early with "I couldn't find relevant content about '{topic}' in the selected documents." message, confidence=low, confidence_score=0.0.
- Focused: 0 chunks from SOME docs (partial miss) → placeholder `(No relevant passages found.)` per missing doc. LLM writes "Not addressed" in table cells for that doc. Other docs still contribute their columns.
- Holistic: 0 chunks from stratified_sample (document has no stored chunks, i.e. still processing) → same placeholder. Extremely rare since `validate_inputs` only passes `ready` documents, but defensive.
- 4-5 docs in focused table → wide table. `CitedMarkdown` has `overflow-x: auto` → horizontal scroll. No forced mode switch.
- Cost tracking: `classify_cost` + `theme_cost` (holistic only) + `generate_cost` — all summed and returned in `cost_usd` and `tokens_used`.

---

### Sub-phase 3.4: Builder Wiring
**Goal:** Replace the stub import with the real compare node.

**File:** `backend/app/graph/builder.py`

**Tasks:**
1. Change import: `from app.graph.nodes.stub_actions import (audit_action, compare_action,)` → `from app.graph.nodes.stub_actions import audit_action` + `from app.graph.nodes.compare import compare_action`
2. `audit_action` remains imported from `stub_actions` (stays as stub until Phase 4).
3. No edge changes — `"compare"` node name already exists in the graph.

**After this change, `stub_actions.py` still provides:**
- `audit_action` (stub until Phase 4)
- `_build_stub_response` helper (used only by audit stub)

The `summarize_action`, `inquire_action`, and `compare_action` functions in `stub_actions.py` are now dead code. Do NOT delete `stub_actions.py` — the audit stub still depends on it.

---

### Sub-phase 3.5: Final Integration Test

**Test scenarios — all 6 must pass:**

| # | Input | Expected Mode | Expected Output |
|---|-------|--------------|-----------------|
| C1 | `@Compare @BankNegara @MuscleBuilding capital requirements` | Focused | Markdown table (Aspect / BankNegara / MuscleBuilding) + analysis, citations, confidence from avg similarity |
| C2 | `@Compare @AtomicHabits @MuscleBuilding` (no text) | Holistic (shortcut) | 5-section report with ### headings, citations, confidence=high, confidence_score=1.0 |
| C3 | `@Compare @AtomicHabits @MuscleBuilding give me a thorough analysis of everything` | Holistic (LLM classifies) | 5-section report — LLM recognizes "everything" = holistic despite long text |
| C4 | `@Compare @AtomicHabits @MuscleBuilding how do they differ on goal setting?` | Focused | Table + analysis about goal setting, topic extracted by classification LLM |
| C5 | Refresh page after C1 | — | Confidence badge, cost, citations all persist (format_response handles this) |
| C6 | `@Compare @Web Search @AtomicHabits @MuscleBuilding` | Any | `validate_inputs` logs "dropping web search flag". Compare works normally — no web results in citations. |

**LangSmith trace should show (focused):**
```
intent_resolver → doc_resolver → validate_inputs → compare → format_response
```
- `compare` span contains: `rewrite_query` child span, `search_chunks` child spans (one per doc), `invoke_structured` (classification + generation)

**LangSmith trace should show (holistic):**
```
intent_resolver → doc_resolver → validate_inputs → compare → format_response
```
- `compare` span contains: `stratified_sample` child span, `extract_themes` child span, `invoke_structured` (generation)

**Regression — Inquire + Summarize must still work:**
- `@Inquire @AtomicHabits What is this about?` → normal RAG answer
- `@Summarize @MuscleBuilding` → structured summary with key points
- The builder change only swapped the compare import — other actions are untouched.

---

## Phase 4: Audit (~2 hrs)
**Both text mode + policy mode in MVP.**

**Overview:** Replace the audit stub with a real action node that has two pipelines: text mode (user's free text audited against tagged regulatory docs) and policy mode (uploaded company policy audited against tagged regulatory docs). Both modes share a common core: theme extraction → per-theme retrieval → GPT-4o structured findings. The difference is where themes come from (user text vs policy document). Short user text (< 200 chars) skips theme extraction and uses a single focused retrieval instead (cheaper, more accurate). Uses GPT-4o for generation (highest stakes — compliance risk analysis).

**Key architectural decisions:**
- **Mode detection is deterministic (no LLM, $0)** — query `doc_type` from the `documents` table. If a `company_policy` doc is present → policy mode. Otherwise → text mode.
- **Theme extraction in BOTH modes (with short-text optimization)** — policy mode always extracts themes from the source policy; text mode extracts themes from user text if ≥ 200 chars (smarter than raw-embedding a long email). Short text (< 200 chars) skips theme extraction and uses a single focused retrieval query — prevents diluted generic themes from a short sentence.
- **Multiple company_policy docs** — only the FIRST one is used as source. Others are discarded from this audit run with a note in the response. Users can audit one policy at a time for optimal results.
- **Severity indicators via emojis** — the LLM outputs `🔴 Critical`, `🟠 High`, `🟡 Medium`, `🔵 Low` in the markdown. The overall status banner uses `### 🔴 Major Violations` / `### 🟡 Minor Issues` / `### 🟢 Compliant`. All rendered by existing CitedMarkdown — zero frontend changes needed.
- **No web search** — audit operates only on uploaded documents. `validate_inputs` drops the flag (needs `"audit"` added to the cleanup list).

**Reuses from Phases 1-3:**
- `search_chunks()` — per-theme targeted retrieval against regulatory docs
- `stratified_sample()` — policy mode: sample source company_policy chunks
- `extract_themes()` from `theme_service.py` — policy mode always; text mode only when ≥ 200 chars (short text skips it)
- `rewrite_query()` with `"audit"` template — already built in `graph/utils.py`
- `Citation` Pydantic model, `LLMService.invoke_structured()` → `LLMResult`
- `format_response` metadata injection (no changes needed)
- `@traceable` for LangSmith observability

**Files changed:**

| File | Change Type |
|------|-------------|
| `backend/app/models/action_schemas.py` | Add `AuditResponse` schema |
| `backend/app/graph/nodes/audit.py` | **New file** — real audit action node |
| `backend/app/graph/builder.py` | Swap import from `stub_actions.audit_action` → `audit.audit_action` |
| `backend/app/graph/nodes/validate_inputs.py` | Add `"audit"` to web search cleanup + **remove Gate 2** (audit text check) |

**Files NOT changed:** `state.py`, `llm_service.py`, `retrieval_service.py`, `theme_service.py`, `graph/utils.py`, `chat.py`, `format_response.py`, all frontend files.

---

### Sub-phase 4.1: AuditResponse Schema
**Goal:** Add the Pydantic structured output schema for the audit LLM call.

**File:** `backend/app/models/action_schemas.py`

**Tasks:**
1. Add `AuditFinding(BaseModel)` with fields:
   - `severity: Literal["Critical", "High", "Medium", "Low"]` — compliance severity
   - `theme: str` — the compliance area this finding relates to (e.g. "Capital Requirements")
   - `description: str` — 1-2 sentence explanation of the gap or alignment
   - `suggestion: str` — actionable remediation step

2. Add `AuditResponse(BaseModel)` with fields:
   - `overall_status: Literal["Compliant", "Minor Issues", "Major Violations"]` — top-level verdict
   - `response: str` — full formatted markdown report with [N] citation markers, severity emojis, and professional structure
   - `findings: list[AuditFinding]` — structured findings list for potential future UI rendering
   - `citations: list[Citation]` — same Citation model as all other nodes

**Why separate `response` AND `findings`?** The `response` field contains the beautifully formatted markdown report that `CitedMarkdown` renders directly (with emoji badges, blockquotes, headings). The `findings` list is the structured data — useful for programmatic access, filtering, and future frontend severity-badge components. The LLM generates both from the same analysis in one call.

**Why NOT a separate `summary` field?** The summary is embedded as the first section of the `response` markdown (### Audit Summary). Extracting it to a separate field adds schema complexity for no benefit — the frontend renders `response` as-is.

---

### Sub-phase 4.2: validate_inputs — Audit Cleanup
**Goal:** Two changes: (1) drop `enable_web_search` flag for audit, (2) remove Gate 2 from `validate_inputs` — text-mode source-text validation moves into `audit_action` where mode context is available.

**File:** `backend/app/graph/nodes/validate_inputs.py`

**Tasks:**
1. Change web search cleanup: `if action in ("compare", "summarize")` → `if action in ("compare", "summarize", "audit")`
2. **Remove Gate 2 entirely** — delete the `elif action == "audit" and _is_audit_text_missing(state):` block and the `_is_audit_text_missing()` helper function.
3. Gate 1 (doc count check, `"audit": 1`) remains — audit always needs at least 1 target regulatory doc.

**Why move Gate 2?** `validate_inputs` doesn't know whether the audit is text mode or policy mode. In policy mode (`@Audit @OurPolicy against @BankNegara`), there IS no free text — the source is the tagged document. Gate 2 would incorrectly fire and ask the user for text they don't need to provide. The audit node determines the mode in Step 2, so it's the right place to check whether source text is needed (text mode only) and interrupt if missing.

---

### Sub-phase 4.3: Audit Action Node
**Goal:** Create the real `audit_action` that replaces the stub. Contains mode detection, theme extraction for both modes, per-theme retrieval, and GPT-4o structured generation.

**File:** `backend/app/graph/nodes/audit.py` (new file)

**Pipeline (11 steps):**

```
Step 1: Read state
  → resolved_doc_ids, resolved_doc_titles, clean_query, user_id, user_industry, user_location, messages

Step 2: Mode detection (deterministic, $0)
  → Query documents table: SELECT id, doc_type FROM documents WHERE id IN (resolved_doc_ids)
  → company_policies = [docs where doc_type = 'company_policy']
  → regulatory_docs = [docs where doc_type = 'regulatory_source']
  → If company_policies is not empty → POLICY MODE (first = source, regulatory = targets)
  → Else → TEXT MODE (user message text = source, all resolved docs = targets)
  → Use resolved_doc_titles from state for all title lookups (already built by doc_resolver, zero extra queries)

Step 2b: TEXT MODE — validate source text (Gate 2, moved from validate_inputs)
  → Only runs for text mode (policy mode has the document as source — no user text needed)
  → Check clean_query: strip @mentions, if < 50 chars → interrupt() asking for audit text
  → Cancel sentinel → return friendly cancel message via Command(goto="format_response")
  → Resume → use the provided text as clean_query, continue pipeline
  → Policy mode skips this step entirely — no text validation needed

Step 3: Handle multiple company_policy edge case
  → If len(company_policies) > 1 → only use first one, set discard_notice for response
  → "Note: Only '{first_policy_title}' was used as the audit source. Audit one policy at a time for optimal results."

Step 4: Extract source content
  ├── POLICY MODE: stratified_sample(user_id, [source_doc_id]) → ~16 source chunks
  └── TEXT MODE: clean_query text (already validated in Step 2b)

Step 5: Extract themes — mode-aware with short-text optimization
  ├── POLICY MODE: extract_themes(source_chunks, {source_doc_id: source_title}) → 3-5 themes (always)
  ├── TEXT MODE (≥ 200 chars): extract_themes(text_pseudo_chunks, {"user_text": "Audit Source"}) → 3-5 themes
  └── TEXT MODE (< 200 chars): SKIP theme extraction ($0). Use rewrite_query(clean_query, targets, "audit") directly
      → Single focused retrieval call (one topic, not diluted across 3-5 generic themes)
  → Track theme extraction cost/tokens (if applicable)

Step 6: Retrieval against target regulatory docs
  ├── MULTI-THEME path (policy mode OR long text mode):
  │   → For each theme (3-5 themes):
  │     → rewrite_query(theme, target_doc_titles, "audit") → optimized search query
  │     → search_chunks(optimized_query, user_id, target_doc_ids, k=5, threshold=0.6)
  │   → Merge all per-theme chunks (deduplicate by chunk ID)
  └── SINGLE-QUERY path (short text mode):
      → rewrite_query(clean_query, target_doc_titles, "audit") → one optimized query
      → search_chunks(optimized_query, user_id, target_doc_ids, k=10, threshold=0.6)
      → k=10 since there's only one query (not diluted across themes)
  → Confidence: average similarity across all chunks

Step 7: Build audit context block
  → _build_audit_context(source_content, theme_chunks, target_doc_titles)
  → Section 1: SOURCE MATERIAL (policy excerpts or user text)
  → Section 2: Per-theme regulatory context with [N] numbered chunks grouped by theme

Step 8: Build system prompt (mode-aware)
  → Include: themes list, source type (policy/text), target doc names
  → Formatting instructions: severity emojis, professional structure, visual hierarchy

Step 9: Build human message
  → POLICY MODE: "Audit the source policy against the regulatory targets for compliance gaps."
  → TEXT MODE: clean_query or "Audit the provided text against the regulatory documents."

Step 10: GPT-4o generation
  → invoke_structured("audit", AuditResponse, messages) → LLMResult
  → Track generation cost/tokens

Step 11: Return state update
  → Sum ALL costs: theme extraction + (rewrite_query per theme, untracked) + generation
  → Prepend discard_notice if applicable
  → Same return shape as other action nodes
```

**Mode detection helper — `_detect_audit_mode()`:**

```
Input: resolved_doc_ids, resolved_doc_titles (from AgentState), user_id
Output: {
  mode: "text" | "policy",
  source_doc_id: str | None,        # only for policy mode
  source_doc_title: str | None,     # from resolved_doc_titles, not re-fetched
  target_doc_ids: list[str],
  target_doc_titles: dict[str, str],  # subset of resolved_doc_titles
  discard_notice: str | None,        # if multiple company_policy docs
}
```

Implementation: one Supabase query — `SELECT id, doc_type FROM documents WHERE id IN (resolved_doc_ids)` (only `id` and `doc_type` — titles already in `resolved_doc_titles` from `AgentState`, no redundant fetch). Pure Python classification, $0 cost.

**Text mode — two paths based on text length:**
- **Long text (≥ 200 chars):** Wrap `clean_query` into pseudo-chunk dicts `[{"content": clean_query, "document_id": "user_text"}]` and pass to `extract_themes()`. This reuses the uniform `list[dict]` interface — `extract_themes` doesn't need to know where the text came from.
- **Short text (< 200 chars):** Skip theme extraction entirely. A single sentence like "We share data with third parties" produces diluted generic themes. Instead, use `rewrite_query(clean_query, target_doc_titles, "audit")` directly and do one retrieval pass with `k=10`. Cheaper ($0 theme cost) and more accurate for short inputs.

**Context block helper — `_build_audit_context()`:**

```
── SOURCE MATERIAL ──
{source description: "The following excerpts are from {title}:" or "The user provided this text for audit:"}
{source text/chunks — no [N] numbering, these are the AUDIT SOURCE not citation targets}

── REGULATORY CONTEXT (by theme) ──        ← multi-theme path
#### Theme: {theme_name}
[1] Source: {RegDocTitle} | Page: {page} | DocID: {uuid}
"{chunk content}"
[2] ...

── REGULATORY CONTEXT ──                   ← single-query path (no theme headers)
[1] Source: {RegDocTitle} | Page: {page} | DocID: {uuid}
"{chunk content}"
[2] ...
```

Only regulatory chunks get `[N]` numbering (they are the citation targets). Source material is shown for reference but doesn't get cited — the LLM cites the regulation that applies.

For the **single-query path** (short text, no themes extracted): the system prompt's `COMPLIANCE THEMES:` line is replaced with `AUDIT FOCUS: {clean_query}` — giving the LLM the user's original text as the audit topic rather than extracted themes.

**System prompt (shared by both modes):**

```
You are a compliance audit analyst for PolicyPal.

SOURCE ({mode_label}):
{source_section}

REGULATORY CONTEXT:
{regulatory_context_block}

COMPLIANCE THEMES: {themes_list}

TASK: Conduct a thorough compliance audit of the source material against the regulatory documents.

Structure your report as follows:

### {emoji} {Overall Status}
One sentence stating the overall compliance verdict.

#### Audit Summary
2-3 sentences summarising the key compliance position across all themes.

Then for each finding, use this format:
> {severity_emoji} **{severity}: {Theme}**
> **Gap:** {what is missing or misaligned}
> **Regulation requires:** {quote from regulatory doc} [N]
> **Suggestion:** {actionable fix}

Group findings by severity — Critical findings first, then High, Medium, Low.

After all findings:
#### Recommendations
A prioritised bullet list (3-5 bullets) of the most impactful actions to improve compliance.

SEVERITY EMOJIS:
- 🔴 Critical — immediate regulatory violation requiring urgent action
- 🟠 High — significant gap that should be addressed promptly
- 🟡 Medium — partial compliance, improvement recommended
- 🔵 Low — minor or best-practice enhancement

OVERALL STATUS EMOJIS:
- 🔴 Major Violations — at least one Critical finding
- 🟡 Minor Issues — no Critical, but High or Medium findings exist
- 🟢 Compliant — only Low findings or no findings

RULES:
- CITATION IDs: Each citation's `id` MUST equal the exact [N] number you wrote in the response.
- Cite regulatory passages with [N] when stating what the regulation requires.
- Use ONLY the context above. Do not use prior knowledge.
- Bold the regulatory requirement name in each finding.
- Use *italics* for document names.
- In each citation, copy the exact verbatim text from the source into the quote field.
- Set doc_id to the DocID value shown in the context header.{user_context}

FORMAT: Return overall_status, response (formatted markdown with severity emojis, > blockquotes, [N] markers), findings (structured list), and citations. Each citation id must match its [N] marker exactly.
```

**Edge cases handled:**
- Text mode + `clean_query` too short (< 50 chars after stripping) → Step 2b `interrupt()` inside `audit_action` asks for text
- Text mode + interrupt cancelled → return friendly cancel via `Command(goto="format_response")`
- Policy mode → Step 2b skipped entirely (source is the tagged document, no user text needed)
- 0 docs resolved → Gate 1 in `validate_inputs` catches this (already built)
- Multiple `company_policy` docs → first = source, others discarded + notice prepended
- Short user text (< 200 chars, text mode) → skip theme extraction, single focused retrieval with k=10
- Theme extraction fails → fallback themes from `theme_service.py` (already built)
- Per-theme retrieval returns 0 chunks for a theme → that theme gets no findings, LLM notes "no regulatory guidance found"
- ALL themes/queries return 0 chunks → respond with "No relevant regulatory passages found" + confidence=low
- Cost tracking: theme_result (if applicable) + generation_result summed into `tokens_used` and `cost_usd`
- Web search tagged → dropped by `validate_inputs` (sub-phase 4.2)

---

### Sub-phase 4.4: Builder Wiring
**Goal:** Replace the stub import with the real audit node.

**File:** `backend/app/graph/builder.py`

**Tasks:**
1. Change import: `from app.graph.nodes.stub_actions import audit_action` → `from app.graph.nodes.audit import audit_action`
2. No edge changes — `"audit"` node name already exists in the graph.
3. After this change, `stub_actions.py` only contains dead code (`_build_stub_response`, the old stubs). Can be deleted but not required.

---

### Sub-phase 4.5: Integration Tests

**Test scenarios — all must pass:**

| # | Input | Expected Mode | Expected Output |
|---|-------|--------------|-----------------|
| T1 | `@Audit We store customer data for 10 years and share it with third parties @BankNegara2024` | Text (short) | Single-query retrieval (< 200 chars, no theme extraction). Findings with severity emojis, blockquote format, regulatory citations |
| T2 | `@Audit @OurCompanyPolicy against @BankNegara2024` | Policy | Theme-based policy-vs-regulation findings with severity and recommendations |
| T3 | `@Audit @OurCompanyPolicy @SGIslamicBanking @BankNegara2024` | Policy | Source=OurCompanyPolicy, Targets=SG+BN. Multi-target audit. |
| T4 | `@Audit @PolicyA @PolicyB against @BankNegara2024` (both company_policy) | Policy | Source=PolicyA only. Response includes: "Note: Only 'PolicyA' was used as the audit source." |
| T5 | `@Audit @BankNegara2024` (no text, only regulatory doc) | Text | Step 2b interrupt inside audit_action → PalAssist asks for text → user provides → findings generated |
| T6 | `@Audit @Web Search @OurPolicy @BankNegara2024` | Policy | Web search dropped. Audit works normally. |
| T7 | `@Audit Our company retains all customer personal data for 10 years without review. We share full datasets including financial records with overseas third-party processors without DPIAs. Employee access is unrestricted across all departments. @BankNegara2024` | Text (long) | ≥ 200 chars → theme extraction → multi-theme retrieval. Themed findings grouped by severity. |
| T8 | Refresh page after T2 | — | Confidence badge, cost, citations all persist |

**LangSmith trace should show:**
```
intent_resolver → doc_resolver → validate_inputs → audit → format_response
```
- `audit` span contains: `extract_themes` child span (if multi-theme path), `rewrite_query` + `search_chunks` per theme (or single call for short-text path), `invoke_structured` (generation)

---

## Phase 5: Long Conversation Management (~30 min)
**Prevent context overflow for long conversations.**

- **Dedicated graph node `summarize_context`** (NOT a helper function — changed from original plan)
  - Placed between `validate_inputs` and action routing in graph builder
  - **Why a node instead of a helper:** Our SSE indicator system emits per-node. A helper inside an action node has no SSE visibility. A dedicated node naturally emits "Summarizing conversation..." via `NODE_STATUS_MAP` → `PalReasoning` shows it to the user.
- Add `conversation_summary: str` field to `AgentState`
- Add `"summarize_context": "Summarizing conversation..."` to `NODE_STATUS_MAP`
- **Node logic:**
  1. If messages ≤ 15 → return `{}` immediately (zero latency, no indicator shown for short conversations)
  2. If `conversation_summary` exists and is still fresh (not stale by 10+ messages) → return `{}` (reuse cached summary)
  3. Otherwise → call GPT-4o-mini to summarize old messages (1 to N-10) → return `{"conversation_summary": summary_text}`
- **Action nodes** (Inquire, Summarize, Compare, Audit) do a simple inline check:
  - If `state["conversation_summary"]` exists → send `[SystemMessage(summary)] + [last 10 messages]` to LLM
  - If not → send full `state["messages"]` to LLM (default behavior)
- **Never mid-run:** Summarization runs in its own node BEFORE the action node, as part of the same sequential graph flow. It cannot interrupt an action LLM call.
- **Graph flow update:** `validate_inputs → summarize_context → [route_to_action] → {action} → format_response`

**Test:** 20+ message conversation → "Summarizing conversation..." indicator appears briefly → then action runs → coherent response without context overflow. Short conversations (<15 msgs) → no indicator, no latency.

---

## Phase 6: Polish (~45 min)

- Sources panel: click citation in chat → scroll sources panel to that citation
- Confidence badge tooltips on hover
- Cost display formatting cleanup (money icon + compact format)
- Error states for failed retrieval
- Empty states when no citations

---

## Phase 7: Deploy (~30 min)

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

1. **Retrieval service is shared** — one RPC function (`match_chunks`) + one positional query (`stratified_sample`) + Python wrapper. All 4 actions use different strategies but share the service.
2. **Perplexity-style grouped citation bubbles** — LLM outputs `[N]` markers, frontend groups consecutive markers into clickable bubbles that highlight text + filter sources panel. Uses React Context to bridge ChatPanel↔SourcesPanel across route boundary.
3. **Markdown for all responses** — `react-markdown` handles tables, lists, bold, etc. natively.
4. **Confidence + cost persisted in AIMessage `additional_kwargs`** — `format_response` embeds `retrieval_confidence`, `cost_usd`, `tokens_used`, `citations`, `action` into the AIMessage. History reload shows same badges without re-computation.
5. **Manual summarization as dedicated graph node** — langmem incompatible with langgraph 1.0.7. `summarize_context` node enables SSE indicator + guarantees no mid-run summarization (see Research §4).
6. **Supabase RPC function** — for semantic search. Positional queries use standard Supabase table queries (stratified sampling).
7. **LangSmith is nearly free** — auto-traces all ChatOpenAI calls; just needs env var fix + `@traceable` on services.
8. **`extract_themes()` is shared** — Compare holistic + Audit policy mode both use the same sync theme extraction helper (DRY).
9. **Compare table capped at 3 docs** — more than 3 columns makes tables unreadable in chat. 4+ docs → paragraph format automatically.
10. **All services are SYNC** — graph nodes are `def` (sync). Tavily uses sync `TavilyClient`. Theme/retrieval/web services are all sync. No async/sync mismatch.
11. **`LLMService.invoke_structured()` returns `LLMResult(parsed, tokens_used, cost_usd)`** — uses `include_raw=True` to get AIMessage usage metadata alongside Pydantic output. All callers updated to destructure.
12. **Compare mode via mini-LLM classification** — GPT-4o-mini classifies focused vs holistic + extracts topic. More reliable than text-length heuristic, costs ~$0.001.
13. **Audit mode via `doc_type` from database** — deterministic: `company_policy` doc = source (policy mode), all `regulatory_source` = text mode. No LLM needed for detection.
14. **Citations stored as dicts in state** — action nodes call `.model_dump()` on Pydantic `Citation` objects before writing to `AgentState`. Prevents LangGraph checkpoint serialization errors.

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

**CRITICAL: This does NOT use `match_chunks` RPC.** Stratified sampling is positional, not semantic. It queries the `chunks` table directly by `chunk_index`.

**Implementation — `retrieval_service.stratified_sample()`:**
- For each resolved document:
  1. Query total chunk count: `SELECT COUNT(*) FROM chunks WHERE document_id = X AND user_id = Y`
  2. Compute strata boundaries: divide `[0, chunk_count)` into 4 equal bands
  3. From each band, select 3-4 evenly spaced chunks by index:
     ```sql
     SELECT id, document_id, chunk_index, page, content
     FROM chunks
     WHERE document_id = :doc_id AND user_id = :user_id
       AND chunk_index >= :band_start AND chunk_index < :band_end
     ORDER BY chunk_index
     LIMIT 4
     ```
  4. Total: ~12-16 chunks per doc, spread evenly across intro, body, and conclusion
- **Why not `match_chunks`?** Semantic search is biased — if a doc repeats "capital requirements" in 50 chunks, semantic search returns all 50. Stratified ensures we capture every section: governance, reporting, penalties, etc.
- **Multi-doc:** Run stratified sampling per document independently, then combine
- Confidence: always "high" for stratified (we're sampling the full document, not hoping for semantic relevance)
- **Supabase call:** Use `.from_("chunks").select("*").eq("document_id", doc_id).eq("user_id", user_id).gte("chunk_index", start).lt("chunk_index", end).order("chunk_index").limit(4).execute()` — standard Supabase table query, no RPC needed

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

### Usage Pattern (Sync — matches our sync graph nodes)

All graph nodes are `def` (sync). Tavily provides a sync `TavilyClient` alongside its async variant. We use the sync client to avoid async/sync mismatch.

```python
from tavily import TavilyClient

client = TavilyClient(api_key=settings.tavily_api_key)

response = client.search(
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
- Single function: `def web_search(query: str, max_results: int = 5) -> list[dict]` (sync — matches sync nodes)
- Returns normalized results: `[{ title, url, content, score }]`
- Called conditionally in action nodes when `state["enable_web_search"] == True`
- Results stored in `state["web_search_results"]` and converted to citations with `source_type: "web"`
- **Config fix required:** Add `tavily_api_key: str = ""` to `Settings` in `config.py` (optional field — empty default so app doesn't crash without it). Add `TAVILY_API_KEY` to `.env`.

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
4. **Structured output:** Use `LLMService.invoke_structured(action, schema, messages)` (sync) which returns `LLMResult(parsed, tokens_used, cost_usd)`.

### Our Existing Pattern (follow this — updated with LLMResult)

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

    # 4. Call LLM — invoke_structured now returns LLMResult(parsed, tokens_used, cost_usd)
    llm_result = llm_service.invoke_structured("inquire", ResponseSchema, [system, human])
    result = llm_result.parsed

    # 5. Return changed fields — citations must be .model_dump() (state expects dicts, not Pydantic)
    return {
        "response": result.response,
        "citations": [c.model_dump() for c in result.citations],
        "retrieved_chunks": chunks,
        "retrieval_confidence": confidence_tier,
        "tokens_used": llm_result.tokens_used,
        "cost_usd": llm_result.cost_usd,
    }
```

### Structured Output with LLMService

Our `LLMService.invoke_structured()` uses `ChatOpenAI.with_structured_output(schema, include_raw=True)` internally. Returns `LLMResult(parsed=PydanticModel, tokens_used=int, cost_usd=float)`.

**IMPORTANT — Citations type transition:** `AgentState.citations` is typed as `list[dict]`. Action nodes MUST call `.model_dump()` on Pydantic `Citation` objects before writing to state. Forgetting this causes serialization errors in LangGraph checkpointing.

Each action defines its own response Pydantic model:
- `InquireResponse`: `response: str, citations: list[Citation]`
- `SummarizeResponse`: `summary: str, key_points: list[str], citations: list[Citation]`
- `CompareResponse`: `comparison_table: list[ComparisonRow], summary: str, citations: list[Citation]`
- `AuditResponse`: `overall_status: str, findings: list[AuditFinding], summary: str`

### Cost Tracking — CRITICAL FIX NEEDED

**Bug discovered:** `invoke_structured()` uses `with_structured_output(schema)` which returns a Pydantic model — NOT an `AIMessage`. The current `_log_usage()` tries `getattr(result, "usage_metadata")` on the Pydantic model, gets `None`, and silently returns. **Cost has never been logged for structured calls.**

**Fix:** Use LangChain's `include_raw=True` option on `with_structured_output()`. This returns `{"raw": AIMessage, "parsed": PydanticModel}` — giving us both the validated object AND the usage metadata.

**Implementation (modify `invoke_structured` in `llm_service.py`):**
1. Change: `llm.with_structured_output(schema)` → `llm.with_structured_output(schema, include_raw=True)`
2. `raw_result = structured.invoke(messages)` → now returns dict, not Pydantic
3. Extract: `parsed = raw_result["parsed"]`, `raw_msg = raw_result["raw"]`
4. Log + return usage: `self._log_usage(action_type, model_name, raw_msg)` (now gets real metadata)
5. **Return a `LLMResult` NamedTuple** with `(parsed, tokens_used, cost_usd)` instead of just the Pydantic model

```python
class LLMResult(NamedTuple):
    parsed: Any       # the Pydantic model instance
    tokens_used: int  # total tokens (input + output)
    cost_usd: float   # calculated from model pricing
```

**Caller update (3 existing files):** `intent_resolver.py`, `doc_resolver.py`, `validate_inputs.py` change from:
```python
result = llm_service.invoke_structured("intent", Schema, msgs)
result.action  # direct attribute access
```
to:
```python
llm_result = llm_service.invoke_structured("intent", Schema, msgs)
result = llm_result.parsed
result.action  # same attribute access via .parsed
# llm_result.tokens_used, llm_result.cost_usd available but unused in these nodes
```

**Action nodes** accumulate cost naturally:
```python
llm_result = llm_service.invoke_structured("inquire", InquireResponse, msgs)
result = llm_result.parsed
return {
    "response": result.response,
    "citations": [c.model_dump() for c in result.citations],
    "tokens_used": llm_result.tokens_used,
    "cost_usd": llm_result.cost_usd,
}
```

**Multi-LLM-call nodes** (Compare holistic, Audit policy) sum costs across calls:
```python
theme_result = llm_service.invoke_structured("compare", ThemeSchema, msgs1)
report_result = llm_service.invoke_structured("compare", ReportSchema, msgs2)
total_tokens = theme_result.tokens_used + report_result.tokens_used
total_cost = theme_result.cost_usd + report_result.cost_usd
```

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

### Implementation: Dedicated graph node (revised)

**Original plan:** helper function inside action nodes. **Revised:** dedicated `summarize_context` graph node.

**Why the change:** The user needs a visible SSE indicator ("Summarizing conversation...") when summarization happens. Our SSE system emits per-node via `NODE_STATUS_MAP`. A helper function inside an action node has no SSE visibility — the user would see "Researching your question..." with no explanation for the delay. A dedicated node naturally slots into the existing indicator system.

**Graph flow change:**
```
validate_inputs → summarize_context → [route_to_action] → {action} → format_response
```

**Node: `backend/app/graph/nodes/summarize_context.py`**
```python
def summarize_context(state: AgentState) -> dict:
    messages = state.get("messages") or []
    if len(messages) <= 15:
        return {}  # instant pass-through, no SSE indicator shown

    existing_summary = state.get("conversation_summary") or ""
    if existing_summary and not _summary_is_stale(existing_summary, len(messages)):
        return {}  # cached summary still fresh

    old = messages[:-10]
    summary = llm_service.invoke_structured("intent", SummarySchema, [...])
    return {"conversation_summary": summary.parsed.text}
```

**Action nodes** read summary inline (3 lines, no helper needed):
```python
summary = state.get("conversation_summary")
messages = state.get("messages") or []
llm_messages = [SystemMessage(f"Summary: {summary}")] + messages[-10:] if summary else messages
```

**Safety guarantee:** Summarization runs in its own node BEFORE the action node. It is part of the sequential graph flow — it cannot interrupt or overlap with an action LLM call.

### State Change

Add to `AgentState`:
```python
conversation_summary: str  # cached rolling summary of old messages
```

### NODE_STATUS_MAP addition
```python
"summarize_context": "Summarizing conversation..."
```

### Why a separate graph node (revised reasoning)

- **SSE visibility:** Only way to show "Summarizing conversation..." indicator to the user
- **Short conversations pass through instantly:** `if len(messages) <= 15: return {}` — negligible latency
- **Never mid-run:** Sequential node execution guarantees summarization finishes before action starts
- **Clean separation:** Summarization logic isolated from action logic
- **No frontend changes:** `PalReasoning` already renders any `status.message` from `StatusEvent`

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
CitationProvider (wraps DashboardShell children)
  ├── state: activeCitations: Citation[]           — all citations from active message
  ├── state: highlightedGroup: CitationGroup | null — which group is clicked
  ├── state: sourcesCollapsed: boolean             — moved here from DashboardShell
  ├── auto-expand: useEffect watches activeCitations (0→N = expand)
  │
  ├── ChatPanel (center) — consumes context
  │     ├── calls setActiveCitations(citations) on new AI response
  │     ├── calls setHighlightedGroup(group) on bubble click
  │     └── renders CitedMarkdown (reads highlightedGroup from context)
  │
  └── SourcesPanel (right) — consumes context
        ├── reads: activeCitations, highlightedGroup, sourcesCollapsed, toggleSources
        ├── if highlightedGroup is null → render all citations
        └── if highlightedGroup set → render only highlightedGroup.citationIds
```

**DashboardShell becomes a thin layout wrapper** — wraps children in `<CitationProvider>`. No citation or panel-collapse state of its own.

**Why Context over props:** ChatPanel is rendered as `children` in the route layout, not a direct child of DashboardShell. Context avoids prop drilling through the route boundary.

**Why `sourcesCollapsed` in Context (not DashboardShell):** A component can't consume a context it provides. The auto-expand logic needs to watch `activeCitations` and set `sourcesCollapsed` — both must be in the same scope. Putting both in the Provider is the cleanest solution.

```typescript
// context/citation-context.ts
type CitationContextValue = {
  activeCitations: Citation[];
  highlightedGroup: CitationGroup | null;
  setActiveCitations: (citations: Citation[]) => void;
  setHighlightedGroup: (group: CitationGroup | null) => void;
  sourcesCollapsed: boolean;
  toggleSources: () => void;
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

def extract_themes(chunks: list[dict], max_themes: int = 5) -> list[str]:
    """
    Given sampled chunks from one or more documents, extract 3-5 key themes.
    Used by: Compare holistic mode, Audit policy mode.
    Model: GPT-4o-mini (classification task, cheap). Sync — matches sync nodes.
    Returns: ["Capital requirements", "Reporting obligations", "Penalties", ...]
    """
```

**Reuse map:**
- Compare holistic: `stratified_sample(all docs)` → `extract_themes()` → GPT-4o 5-section report
- Audit policy: `stratified_sample(source doc)` → `extract_themes()` → per-theme retrieval against targets → GPT-4o findings

---

## §6. Web Search Detection Architecture

**Already built** — no changes needed. Documented here for context when implementing action nodes.

### 3-Layer OR Detection (intent_resolver)

| Layer | Signal | Cost | How |
|-------|--------|------|-----|
| **Explicit** | Frontend `@Web Search` tag | Free | `enable_web_search: true` in ChatRequest |
| **Keyword scan** | Temporal words in message | Free | Regex: `latest\|recent\|current\|now\|today\|still\|2025\|2026` |
| **LLM** | Nuanced phrasing | Already paid | `enable_web_search: bool` in IntentClassification structured output |

`final_flag = frontend OR keyword OR llm_detection`

**Cleanup:** `validate_inputs` drops the flag if `action == "compare"` (comparing documents vs web = meaningless).

### Important: Query Generation Lives in Action Nodes

`intent_resolver` only decides **IF** web search happens. The action node generates **WHAT to search** — it has the full context (resolved docs + user question + action type) to craft a precise query. This is why `web_search_query` is set inside each action node, not during intent resolution.

### Design Rationale

OR logic favors recall over precision — better to run 1 unnecessary Tavily search ($0.001) than miss time-sensitive information and give an outdated compliance answer (high-stakes error).

### Known Gap (v1.1)

No automatic fallback to web search when retrieval confidence is low. MVP: web search is only triggered by the 3-layer detection above.

---

## §7. New Dependencies to Install

### Backend (`pip install`)
- `tavily-python` — Tavily web search SDK

### Frontend (`npm install`)
- `react-markdown` — render AI responses as markdown
- `remark-gfm` — GitHub Flavored Markdown (tables, strikethrough, etc.)

### NOT installing
- `langmem` — incompatible with langgraph 1.0.7 (see §4)
- `langchain-tavily` — unnecessary; we use tavily-python directly (simpler, fewer deps)

---

## §8. LangSmith Observability

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
def search_chunks(query, user_id, doc_ids, k, threshold):
    # ... pgvector search (sync)
    pass

@traceable(run_type="tool", name="tavily_web_search")
def web_search(query, max_results=5):
    # ... Tavily API call (sync)
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

---

## §9. Prompt Engineering for PolicyPal Action Nodes

**Sources:**
- https://www.getmaxim.ai/articles/a-practitioners-guide-to-prompt-engineering-in-2025/
- https://articles.chatnexus.io/knowledge-base/advanced-prompt-engineering-for-rag-applications/
- https://thomas-wiegold.com/blog/prompt-engineering-best-practices-2026/

### Core Prompt Structure (use for every action node)

Every system prompt follows this order — **most critical instructions first and last** (model attention degrades in the middle):

```
1. ROLE        — Who the model is and what it's doing
2. CONTEXT     — Retrieved chunks with metadata (source, page, doc title)
3. TASK        — The specific job for this call (one clear objective)
4. RULES       — Hard constraints: cite only from context, use [N] markers, no hallucination
5. FORMAT      — Exact output schema (matches Pydantic model fields)
```

### Prompt Length Target

- **System prompt: 150–250 words max.** Performance degrades past ~3,000 tokens total context from instructions alone. Keep prompts tight — context (retrieved chunks) consumes the token budget.
- **No preamble.** Start with the role, not "You are a helpful assistant that can..."
- **No repetition.** Each rule stated once. Trust the model.

### RAG-Specific Rules (include in every action prompt)

These lines must appear in every action node system prompt:
```
- Answer ONLY using the provided context. Do not use prior knowledge.
- Place citation markers [1], [2], etc. immediately after the claim they support.
- Multiple sources for one claim: write [1][2] together (no space).
- If the context does not answer the question, say so explicitly.
- Quote the exact source text in the `quote` field of each citation.
```

### Context Block Format

Pass retrieved chunks as structured text, not raw concatenation. Include metadata so the model can build accurate citations:

```
[1] Source: Bank Negara Policy Document 2024 | Page: 12
"The minimum capital adequacy ratio shall not fall below 8% at any time..."

[2] Source: FSA Regulations 2023 | Page: 45
"All licensed institutions must submit quarterly capital reports..."
```

### User Context Injection

Append to system prompt when profile data exists:
```
User context: Works in {industry} in {location}. Tailor regulatory references and examples to their jurisdiction.
```
Omit the whole line if profile is empty — never leave `{industry}` as a literal placeholder.

### Action-Specific Prompt Notes

| Action | Key instruction | Model |
|--------|----------------|-------|
| **Inquire** | "Answer the specific question concisely. Cite every factual claim." | GPT-4o-mini |
| **Summarize** | "Produce a structured summary. Each section corresponds to a document region. Do not merge unrelated sections." | GPT-4o-mini |
| **Compare (focused)** | "Output a markdown table only. Columns = documents. Rows = aspects of '{topic}'." | GPT-4o-mini |
| **Compare (holistic)** | "Write a 5-section report. Sections: Overview, Key Differences, Similarities, Unique Aspects, Implications." | GPT-4o |
| **Audit** | "For each finding, assign severity (Critical/High/Medium/Low) and provide a specific remediation suggestion. Ground every finding in an exact source quote." | GPT-4o |
| **Theme extraction** | "Extract 3–5 distinct regulatory themes. Output a JSON array of short strings only. No explanation." | GPT-4o-mini |
| **Compare intent** | "Classify the request as 'focused' or 'holistic'. If focused, extract the exact comparison topic as a short phrase." | GPT-4o-mini |

### Anti-Patterns to Avoid

- **Context dumping** — Never pass raw concatenated chunks without source labels. The model cannot cite what it can't identify.
- **Vague output instructions** — "Summarize the document" → bad. "Produce a summary with: 1 paragraph overview, 3–5 bullet key points, 1 sentence conclusion" → good.
- **Contradictory rules** — Don't say "be concise" and "include all details" in the same prompt.
- **Floating placeholders** — Always check `{variable}` substitutions before sending. Empty placeholders confuse the model.
- **Restating the schema** — With `with_structured_output(Schema)`, the Pydantic schema IS the format instruction. Don't re-describe it in the prompt — wastes tokens.
