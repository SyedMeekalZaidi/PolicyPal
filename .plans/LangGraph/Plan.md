# LangGraph Agent — Planning Document
# Chat Memory + LangGraph Foundations

**Goal:** End-to-end working agent: user sends message → graph classifies intent → resolves docs → validates → routes to stub action → returns response. PalAssist fires on ambiguity. Chat history persists via PostgresSaver.

**Timeline:** Feb 20-22 (Days 8-10) — 3 days
**Status:** Not started

---

## System Architecture Overview

```
Browser (Next.js)
      │
      │  POST /api/chat  (Next.js proxy — injects user_id)
      ▼
Next.js API Route  ← pipes SSE stream through (does NOT buffer)
      │
      │  POST {BACKEND_URL}/chat  (internal, never exposed)
      ▼
FastAPI /chat endpoint  ← returns StreamingResponse (text/event-stream)
      │
      │  async for chunk in graph.astream(input, config, stream_mode="updates"):
      │    yield SSE status event per node  ← PalReasoning
      ▼
LangGraph Graph  ←──── PostgresSaver (Supabase)
      │                Loads + saves full state per thread_id
      │
      ├── intent_resolver node
      │       Step 1 (Python, free): keyword scan for temporal terms
      │         "latest", "recent", "2026", "current", "now", "today"
      │         → enable_web_search = True if found (OR with frontend flag)
      │       Step 2 (LLM): classify action + detect nuanced web search need
      │         structured output: { action, confidence, enable_web_search }
      │         catches: "Is this still valid?", "What's happening with..."
      │       OR logic: Python flag OR LLM flag = final enable_web_search
      │       NOTE: web_search_query NOT generated here — action nodes own it
      │       interrupt() on multi-action or low conf after retry
      │
      ├── doc_resolver node
      │       Stage 1: Python parses TipTap JSON (free)
      │       Stage 2: One LLM call (right-sized context)
      │       Stage 3: Fuzzy match unresolved names (free)
      │       interrupt() on medium/low conf
      │
      ├── validate_inputs node
      │       Pure Python — checks action requirements
      │       interrupt() on missing info
      │
      └── route_to_action node
              → stub action nodes (placeholder response for now)
              → format_response
              → update conversation_docs registry
              → END

On interrupt():
  FastAPI returns: { type: "interrupt", interrupt_type, message, options? }
  Frontend detects → shows PalAssist above chat input
  User responds → POST /api/chat/resume → graph.invoke(Command(resume=value))
  Graph continues from exact pause point
```

---

## How Chat History Works (PostgresSaver)

This is critical to understand before building:

- LangGraph **automatically saves full state** (including all messages) to Postgres after every node
- Each conversation = one `thread_id` (same as `conversation.id` in Supabase)
- When user sends Msg 5, graph loads ALL previous state (Msgs 1-4 + conversation_docs + action) from checkpoints
- **Chat history is not a separate feature** — it's automatic via PostgresSaver
- `conversations` table (existing) stores metadata (title, last_message_at) for sidebar UI
- `checkpoints` table (auto-created by PostgresSaver) stores the actual message history + state

```
First message:
  graph.invoke({ messages: [Msg1], explicit_doc_ids: [...] }, { thread_id: "abc" })
  → LangGraph creates new checkpoint for thread "abc"
  → State saved: { messages: [Msg1, AIMsg1], conversation_docs: { "BN2024": "uuid" }, ... }

Fifth message:
  graph.invoke({ messages: [Msg5], explicit_doc_ids: [...] }, { thread_id: "abc" })
  → LangGraph loads checkpoint for thread "abc"
  → Sees: messages=[Msg1, AI1, Msg2, AI2, ...], conversation_docs already has BN2024
  → Processes Msg5 with full context
```

---

## Data Flow: Frontend → Backend → Graph

```
1. User types: "Summarize @BankNegara2024 and what about income tax?"
   TipTap produces:
     text: "Summarize and what about income tax?"
     tiptap_json: { doc with mention node { id: "uuid-bn", label: "BankNegara2024" } }
     tagged_doc_ids: ["uuid-bn"]
     action: "summarize"
     enable_web_search: false

2. ChatInput.onSubmit(payload, doc) → useSendMessage hook

3. useSendMessage → POST /api/chat (Next.js route)
   Next.js injects: user_id (from Supabase session)
   Forwards to FastAPI: { message, tiptap_json, thread_id, tagged_doc_ids,
                          tagged_set_ids, action, enable_web_search, user_id }

4. FastAPI builds initial AgentState (TRANSIENT fields only — reset per turn):
   { messages: [HumanMessage(text)],
     explicit_doc_ids: ["uuid-bn"],
     tiptap_json: {...},            ← for Python pre-processor in doc resolver
     action: "summarize",           ← explicit tag, skip intent LLM
     enable_web_search: false,      ← starts from frontend (@WebSearch tag)
     web_search_query: null,        ← reset: action node sets it
     web_search_results: null,      ← reset: Tavily called in action node
     resolved_doc_ids: [],          ← reset: doc resolver sets it
     response: "",                  ← reset: action node sets it
     citations: [],                 ← reset: action node sets it
     tokens_used: 0,               ← reset: per-turn counter
     cost_usd: 0.0,                ← reset: per-turn counter
     user_id: "...",
     thread_id: "...",
     *** conversation_docs is EXCLUDED — persists from checkpoint ***
   }

5. graph.astream(state, config, stream_mode="updates") → PostgresSaver loads existing state
   → Merge rules: fields IN input REPLACE checkpoint values (transient fields reset)
   →              fields NOT in input PERSIST from checkpoint (conversation_docs survives)
   → messages uses add_messages reducer → APPENDS new message to checkpoint history

6. Graph runs as SSE stream — each node completion yields a status event:
   intent_resolver done  → yield { type: "status", node: "intent_resolver",
                                    message: "Clarifying intent..." }
   doc_resolver done     → yield { type: "status", node: "doc_resolver",
                                    message: "Finding documents...",
                                    docs_found: [{id, title}] }       ← enriched!
   validate_inputs done  → yield { type: "status", node: "validate_inputs",
                                    message: "Validating request..." }
   action node done      → yield { type: "status", node: "audit",
                                    message: "Auditing email against regulation..." }
   web_search (if any)   → yield { type: "status", node: "web_search",
                                    message: "Searching online \"BN 2026 rules\"" }
   format_response done  → yield { type: "response", ...full ChatResponse }  ← FINAL

   OR at any point:
   interrupt() fires     → yield { type: "interrupt", ...InterruptResponse }  ← stream ends

7. Frontend reads SSE stream event-by-event:
   type="status"    → update PalReasoning shimmer below user message
   type="response"  → clear PalReasoning → render AI message bubble
   type="interrupt"  → clear PalReasoning → show PalAssist above chat input
```

---

## conversation_docs Registry

```
What: AgentState field — { "Bank Negara 2024": "uuid-xyz" }
When: Updated at END of every successful (non-interrupted) graph run
How:  Backend queries: SELECT id, title FROM documents WHERE id = ANY(resolved_doc_ids)
      Merges results into existing registry (never clears, only adds)
Why:  Doc resolver uses it so LLM can match "those two docs" → UUIDs
      Without it: every message needs full history to resolve implicit refs
      With it: only need last 5 msgs + registry for 95% of cases
```

---

## Web Search Detection — Two-Stage, Two-Node Design

```
STAGE 1 — Intent Resolver (detects NEED):
  Python keyword scan (free):
    Terms: "latest", "recent", "current", "now", "today", "2025", "2026"
    Found? → enable_web_search = True immediately (no LLM cost)

  LLM structured output adds:
    enable_web_search: bool  ← catches nuanced cases Python misses
    Examples: "Is this still enforced?" / "What's happening with..."

  Final: enable_web_search = frontend_flag OR python_flag OR llm_flag
  State written: enable_web_search = True/False
  State NOT written: web_search_query (action nodes own this)

STAGE 2 — Action Nodes (generates QUERY, calls Tavily):
  Each action node that supports web search:
    IF enable_web_search = True:
      Generate web_search_query using full context:
        - user message text
        - resolved_doc_ids titles
        - user industry + location (from system prompt)
      Call Tavily with web_search_query
      Set web_search_results in state
      Merge with RAG chunks in response

  Per-action web search support:
    Inquire:  YES — Q&A benefits from latest external info
    Summarize: YES — supplement doc with current regulatory news
    Audit:    YES — "latest rules" means check current enforcement
    Compare:  NO  — comparison is always between uploaded docs
                    validate_inputs drops enable_web_search if action=compare

Edge cases:
  User says "latest" but docs are explicitly tagged:
    → enable_web_search = True but action node decides whether Tavily adds value
    → if query is fully answered by RAG chunks (high retrieval_confidence),
      skip Tavily to save cost (action node logic)
  @WebSearch explicit + temporal keyword:
    → both set enable_web_search = True — OR logic, no double-call
  Compare with "latest" keyword:
    → validate_inputs sets enable_web_search = False for compare
    → professional notice: "Web search not supported for Compare action"
```

---

## PalAssist Technical Flow

```
During graph execution, interrupt() is called when:
  - Intent resolver: low conf after 5-msg retry, or multi-action detected
  - Doc resolver: medium conf (multiple candidates) or low conf (no match)
  - Validation: missing required docs/info

interrupt() call:
  → Graph PAUSES (does not terminate)
  → Current state saved to Postgres checkpoint
  → LangGraph returns __interrupt__ payload to FastAPI
  → FastAPI shapes it into: { type: "interrupt", interrupt_type, message, options? }
  → Frontend receives → shows PalAssist

User responds (clicks option or types):
  → useResumeGraph → POST /api/chat/resume
  → FastAPI: graph.invoke(Command(resume=resume_value), { thread_id })
  → Graph continues from EXACT pause point (not from start)
  → Returns normal response

User cancels:
  → POST /api/chat/resume with { type: "cancel", value: null }
  → FastAPI: graph.astream(Command(resume=None), { thread_id })
  → Node receives None → returns defaults → graph reaches END → clean checkpoint
  → Frontend suppresses cancel response (not shown in chat)
  → conversation_docs registry preserved in checkpoint
  → Next message = fresh graph run from same thread (picks up registry)
```

---

## PalReasoning (SSE Status Events)

**What:** Real-time status messages shown to user while the graph runs. Each node completion emits a human-readable status event via SSE. Frontend renders as shimmering text below the user message.

**Why:** Builds trust (user sees exactly what the agent is doing), eliminates black-box feeling, matches modern AI UX (Gemini/ChatGPT thinking indicators), demonstrates advanced SSE architecture to employers.

**Transport:** Server-Sent Events (SSE) — NOT token streaming. Each event is a complete, self-contained JSON line. No partial parsing, no complex stream readers.

**Node-to-message mapping (Python config, zero LLM cost):**
```
NODE_STATUS_MAP = {
    "intent_resolver": "Clarifying intent...",
    "doc_resolver":    "Finding documents...",
    "validate_inputs": "Validating request...",
    "summarize":       "Summarizing documents...",
    "inquire":         "Researching your question...",
    "compare":         "Comparing documents...",
    "audit":           "Auditing against regulations...",
    "format_response": "Formatting response...",
}
```

**Enriched status events (special nodes):**
- `doc_resolver`: includes `docs_found: [{ id, title }]` → frontend shows doc pills
- Action nodes with web search: includes `web_query: "..."` → frontend shows search query
- These enrichments are read from AgentState after the node completes — zero extra cost

**SSE event format (one JSON object per line):**
```
data: { "type": "status", "node": "intent_resolver", "message": "Clarifying intent..." }

data: { "type": "status", "node": "doc_resolver", "message": "Finding documents...", "docs_found": [{"id": "uuid", "title": "BankNegara2024"}] }

data: { "type": "status", "node": "audit", "message": "Auditing email against regulation...", "web_query": null }

data: { "type": "response", "response": "...", "citations": [...], ... }
```

**Frontend rendering:**
```
User sends message → user bubble appears → PalReasoning appears below:

┌─── User bubble ──────────────────────────────┐
│ Audit this email against @BankNegara2024     │
└──────────────────────────────────────────────┘

  ✦ Clarifying intent...                  ← shimmer animation, blue text
    ↓ (replaced by)
  ✦ Finding documents...
    📄 BankNegara2024                     ← doc pill appears (confirms resolution)
    ↓
  ✦ Validating request...
    ↓
  ✦ Auditing email against regulation...
    ↓
  ✦ Formatting response...
    ↓
  (PalReasoning clears → AI message bubble appears)
```

**Interaction with PalAssist:**
If `interrupt()` fires during graph execution:
1. PalReasoning was showing "Finding documents..."
2. Interrupt event arrives → PalReasoning clears
3. PalAssist appears above chat input
4. User responds → resume → PalReasoning resumes from interrupt node
5. Remaining nodes emit status events normally

**Interaction with /chat/resume:**
Resume endpoint also uses SSE — remaining nodes after interrupt emit status events. PalReasoning works identically for initial calls and resumed calls.

**Edge cases:**
| Edge Case | Solution |
|---|---|
| Node completes in <50ms (e.g., validate_inputs) | Minimum display time: 300ms per status. Queue rapid events, show each for at least 300ms |
| Network drops mid-stream | Frontend timeout: 30s with no event → clear PalReasoning, show error toast |
| Explicit @action skips intent_resolver | No status event for intent_resolver — first event is doc_resolver |
| Pure @mentions skip doc_resolver LLM | Status still shows "Finding documents..." briefly, then doc pills appear |
| Cancel during PalAssist after PalReasoning | PalReasoning already cleared when interrupt arrived — no conflict |

---

## File Structure (New Files)

```
backend/app/
  routers/
    chat.py                    ← FastAPI /chat + /chat/resume endpoints
  graph/
    state.py                   ← AgentState TypedDict (full schema)
    graph.py                   ← Main StateGraph definition (nodes + edges)
    nodes/
      intent_resolver.py       ← Progressive context intent classification
      doc_resolver.py          ← 3-stage pipeline (Python → LLM → fuzzy)
      validate_inputs.py       ← Pure Python validation
      route_action.py          ← Conditional routing to action nodes
      stub_actions.py          ← Placeholder nodes (return "Action coming soon")
      format_response.py       ← Shape final response + update registry
  services/
    llm_service.py             ← LLM abstraction (model selection per action type)
    graph_service.py           ← PostgresSaver setup, graph compilation
  models/
    schemas.py                 ← ADD: ChatRequest, ChatResponse, InterruptResponse,
                                       ResumeRequest, ResumeValue

Frontend:
  app/api/chat/
    route.ts                   ← Next.js proxy POST /api/chat → FastAPI
  app/api/chat/resume/
    route.ts                   ← Next.js proxy POST /api/chat/resume → FastAPI
  lib/types/
    chat.ts                    ← ChatRequest, ChatResponse, InterruptResponse TS types
  hooks/
    use-chat-stream.ts         ← SSE stream reader for /chat and /chat/resume
                                  reads events, calls onStatus/onComplete/onInterrupt callbacks
                                  NOT React Query — manual fetch + ReadableStream
  components/chat/
    pal-assist.tsx             ← PalAssist UI (above chat input)
    pal-reasoning.tsx          ← PalReasoning UI (shimmer status below user message)
    chat-message.tsx           ← REPLACE throwaway: render from LangGraph response
  (modify) lib/chat/extract-mentions.ts  ← add tiptap_json to ChatSubmitPayload
  (modify) components/chat/chat-panel.tsx ← wire hooks, handle interrupt state
```

---

## API Contract

### POST /api/chat (new message)

**Request (Frontend → Next.js → FastAPI):**
```
{
  message: string              // plain text for LLM context
  tiptap_json: object          // raw TipTap JSON for Python pre-processor
  thread_id: string            // = conversation.id (same UUID)
  tagged_doc_ids: string[]     // pre-extracted UUIDs from @mention nodes
  tagged_set_ids: string[]     // pre-extracted set UUIDs
  action: string | null        // explicit action tag, null = let intent resolver classify
  enable_web_search: boolean   // from @WebSearch mention
  // user_id injected by Next.js API route (never from client)
}
```

**Response: SSE stream (text/event-stream) — multiple events, one per node:**

Status event (0-N per request, one per node):
```
data: {
  type: "status"
  node: string                 // node name (e.g., "intent_resolver", "audit")
  message: string              // human-readable status (e.g., "Clarifying intent...")
  docs_found?: { id: string, title: string }[]  // only from doc_resolver
  web_query?: string           // only from action nodes with web search
}
```

Final response event (exactly 1 per request — terminates the stream):
```
data: {
  type: "response"
  response: string
  citations: Citation[]
  action: string
  inference_confidence: string
  retrieval_confidence: string
  tokens_used: number
  cost_usd: number
}
```

OR Interrupt event (exactly 1 per request — terminates the stream):
```
data: {
  type: "interrupt"
  interrupt_type: "doc_choice" | "text_input" | "action_choice" | "retrieval_low"
  message: string
  options?: { id: string, label: string }[]
}
```

Stream always ends with exactly ONE terminal event: either "response" or "interrupt".

### POST /api/chat/resume (PalAssist response)

**Request:**
```
{
  thread_id: string
  resume_value: {
    type: "doc_choice" | "text_input" | "action_choice" | "cancel"
    value: string | null
  }
}
```

**Response:** Same SSE stream as /chat (status events for remaining nodes → response or interrupt)

---

## Phase 1: API Contract + Message Pipeline + PalReasoning (Day 8)

**Goal:** User sends a message, it reaches FastAPI via SSE, status events stream back as PalReasoning shimmer, then echo response renders. Establishes SSE transport, all types, and PalReasoning UI from day one.

**Backend tasks:**
1. Add ChatRequest, ChatResponse, InterruptResponse, StatusEvent, ResumeRequest to `schemas.py`
2. Create `backend/app/routers/chat.py` — `/chat` SSE endpoint (echo stub with simulated status events), `/chat/resume` SSE endpoint (echo stub)
3. Register chat router in `main.py`

**Frontend tasks:**
4. Update `ChatSubmitPayload` in `extract-mentions.ts` — add `tiptap_json: JSONContent`
5. Update `chat-input.tsx` — include `doc` (tiptap_json) in payload
6. Create `lib/types/chat.ts` — TypeScript types for request/response/status events
7. Create `app/api/chat/route.ts` — Next.js proxy that **pipes SSE stream through** (not .json())
8. Create `app/api/chat/resume/route.ts` — Next.js proxy for resume (also pipes SSE)
9. Create `hooks/use-chat-stream.ts` — SSE stream reader (fetch + ReadableStream, NOT React Query)
10. Create `components/chat/pal-reasoning.tsx` — shimmer status UI below user message
11. Update `chat-panel.tsx` — wire `useChatStream`, display PalReasoning during stream, render AI message on completion

**Test:** Type message → send → see PalReasoning shimmer ("Clarifying intent..." → "Finding documents..." → "Echo response") → AI message appears. PalReasoning clears.

---

## Phase 2: LangGraph Core + Chat History (Day 9)

**Goal:** Graph runs on every message. PostgresSaver stores state. Chat history loads on page refresh. Intent and doc resolvers classify correctly. Stub action returns placeholder. PalReasoning now shows **real** node status (not simulated).

**Backend tasks:**
1. Create `backend/app/services/graph_service.py` — PostgresSaver init + compiled graph singleton
2. Create `backend/app/graph/state.py` — AgentState TypedDict (full schema from features.md) + `NODE_STATUS_MAP` config
3. Create `backend/app/services/llm_service.py` — LLM abstraction (model selection by action)
4. Create `backend/app/graph/nodes/intent_resolver.py` — progressive context (1 msg → 5 msgs) + Python keyword scan (temporal terms) + LLM structured output with `enable_web_search: bool`; OR-merge with frontend flag
5. Create `backend/app/graph/nodes/doc_resolver.py` — 3-stage pipeline
6. Create `backend/app/graph/nodes/validate_inputs.py` — pure Python validation + drop `enable_web_search` flag if action=compare
7. Create `backend/app/graph/nodes/stub_actions.py` — returns placeholder response per action; stubs accept `web_search_query` field
8. Create `backend/app/graph/nodes/format_response.py` — shapes final response + updates conversation_docs
9. Create `backend/app/graph/graph.py` — StateGraph wiring (nodes + conditional edges)
10. Update `chat.py` router — replace echo stub with `graph.astream(stream_mode="updates")` loop; emit real `StatusEvent` per node completion using `NODE_STATUS_MAP` + enrichment logic (docs_found from doc_resolver, web_query from action nodes)

**Frontend tasks:**
11. Create `components/chat/chat-message.tsx` — render AI messages from LangGraph response (citations, confidence badge, cost)
12. Update `chat-panel.tsx` — load message history from checkpoints on mount (fetch via `/api/chat/history/{thread_id}`)
13. Create `app/api/chat/history/[threadId]/route.ts` — proxy to load messages

**Test:** Send messages → graph runs → PalReasoning shows real node status → response renders. Refresh → history reloads. LangSmith traces visible.

---

## Phase 3: PalAssist + Interrupt Flow (Day 10)

**Goal:** When resolvers have low/medium confidence, graph pauses and PalAssist appears. User picks option → graph resumes (also via SSE). Full interrupt lifecycle with PalReasoning context.

**Backend tasks:**
1. Add `interrupt()` calls in `intent_resolver.py` — multi-action, low conf after retry
2. Add `interrupt()` calls in `doc_resolver.py` — medium conf, low conf after fuzzy
3. Add `interrupt()` calls in `validate_inputs.py` — missing docs/info
4. SSE handles interrupts naturally — `astream(stream_mode="updates")` loop checks `__interrupt__` key before inner loop, yields InterruptEvent, ends stream
5. Update `chat/resume` endpoint — `graph.astream(Command(resume=value), config, stream_mode="updates")` returns SSE stream for remaining nodes

**Frontend tasks:**
6. Create `components/chat/pal-assist.tsx` — PalAssist component (above input, all 5 use case UIs)
7. Update `chat-panel.tsx` — manage `interruptPayload` state, show/hide PalAssist, wire resume via `useChatStream`
8. PalReasoning ↔ PalAssist transition: when interrupt arrives during stream, PalReasoning clears → PalAssist appears; when user resumes, PalReasoning resumes from interrupted node

**Test:** 
- Ambiguous doc ref → PalReasoning shows "Finding documents..." → interrupt fires → PalReasoning clears → PalAssist appears → user picks → PalReasoning resumes ("Validating..." → "Auditing...") → response renders
- Cancel → PalAssist clears → graph resumes with None in background (suppressed) → next message starts fresh

---

## Key Risks

| Risk | Mitigation |
|---|---|
| PostgresSaver connection format | Test early in Phase 2 Step 1. Use `database_url` from config. |
| LangGraph version API differences | Check langgraph version in requirements.txt before coding nodes |
| interrupt() payload shape | LangGraph returns `__interrupt__` as a list — need to extract correctly |
| ChatPanel state complexity | Keep `interruptPayload` + `reasoningStatus` as simple null/object states |
| Message history load on mount | Fetch from checkpoints endpoint, not a separate messages table |
| SSE through Next.js proxy | Next.js must NOT buffer — pipe stream directly with no `.json()` call |
| `astream(stream_mode="updates")` format | Test with minimal 2-node graph first — verify chunk is `{node_name: {updates}}` |
| Rapid node status flashing | Frontend queues events, enforces 300ms minimum display per status |
| Network timeout mid-stream | 30s no-event timeout on frontend → clear PalReasoning, show error toast |

---

## Success Criteria (all 3 phases done)

- [ ] User sends message → reaches LangGraph graph → response appears in chat
- [ ] Intent correctly classified from message text + explicit @action tag
- [ ] Docs correctly resolved from @tags + conversation history
- [ ] Validation catches missing requirements (e.g., compare with 1 doc)
- [ ] Chat history loads on refresh (PostgresSaver)
- [ ] PalAssist appears on ambiguous doc ref → user picks → graph continues
- [ ] Cancel clears PalAssist → next message is fresh graph run
- [ ] LangSmith traces show full graph execution
- [ ] Stub actions return placeholder response for all 4 action types
- [ ] PalReasoning shows node-by-node status during graph execution (shimmer text)
- [ ] PalReasoning clears when response or interrupt arrives
- [ ] doc_resolver status event shows resolved doc pills (enriched status)
- [ ] PalReasoning resumes seamlessly after PalAssist resume (SSE for /chat/resume too)
- [ ] Rapid node completions still display for minimum 300ms (no flash)

---
---

# DETAILED IMPLEMENTATION PLANS

---

## Phase 1: API Contract + Message Pipeline + PalReasoning

**Goal:** User sends a message through the full stack via SSE (ChatInput → Next.js proxy → FastAPI → SSE status events → echo response → PalReasoning shimmer → rendered AI message). No LangGraph yet. Establishes SSE transport, all types, PalReasoning UI, and every hook needed so Phase 2 only swaps the echo stub for `graph.astream(stream_mode="updates")`.

**Why SSE echo first:** Testing the SSE pipeline with simulated status events catches streaming bugs, proxy buffering issues, and frontend parsing problems BEFORE adding LangGraph. If the echo SSE stream works, switching to `graph.astream(stream_mode="updates")` is a loop replacement — the transport, proxy, hook, and UI are already proven.

**Why NOT React Query:** React Query mutations expect a single JSON response. SSE streams emit multiple events over time. We need a custom hook using raw `fetch()` + `ReadableStream` that can call `setState` per event. React Query stays for non-streaming operations (conversations, documents).

---

### Phase 1.1: Backend Types (Pydantic Models)

**Goal:** Define all request/response Pydantic models for the `/chat` and `/chat/resume` SSE endpoints. These are the contract the frontend will depend on. Every SSE event type gets its own model.

**File:** `backend/app/models/schemas.py` (MODIFY — append to existing file)

**What to add:**

ChatRequest model:
- `message: str` — plain text for LLM context
- `tiptap_json: dict` — raw TipTap JSON for Python pre-processor
- `thread_id: str` — conversation UUID (= conversation.id)
- `user_id: str` — injected by Next.js proxy, never from client
- `tagged_doc_ids: list[str]` — default empty list
- `tagged_set_ids: list[str]` — default empty list
- `action: str | None` — explicit action tag from @mention, null = classify
- `enable_web_search: bool` — default False

StatusEvent model (SSE status event — emitted per node):
- `type: Literal["status"]` — always "status"
- `node: str` — node name that just completed (e.g., "intent_resolver", "doc_resolver")
- `message: str` — human-readable status (e.g., "Clarifying intent...")
- `docs_found: list[dict] | None` — only populated by doc_resolver; list of `{ id, title }`
- `web_query: str | None` — only populated by action nodes with web search

ChatResponse model (SSE terminal event — final response):
- `type: Literal["response"]` — always "response"
- `response: str` — the AI's answer
- `citations: list[dict]` — empty list for now, populated when actions are built
- `action: str` — what action was performed
- `inference_confidence: str` — "high" | "medium" | "low"
- `retrieval_confidence: str` — "high" | "medium" | "low"
- `tokens_used: int` — default 0 for echo
- `cost_usd: float` — default 0.0 for echo

InterruptResponse model (SSE terminal event — PalAssist trigger):
- `type: Literal["interrupt"]` — always "interrupt"
- `interrupt_type: str` — "doc_choice" | "text_input" | "action_choice" | "retrieval_low"
- `message: str` — PalAssist prompt text
- `options: list[dict] | None` — clickable options `{ id, label }`, null for text_input

ResumeRequest model:
- `thread_id: str`
- `user_id: str` — injected by Next.js proxy
- `resume_value: ResumeValue`

ResumeValue model:
- `type: str` — "doc_choice" | "text_input" | "action_choice" | "cancel"
- `value: str | None` — UUID, free text, action name, or null (cancel)

NODE_STATUS_MAP (constant, not a model — define in same file or a constants module):
- Dict mapping node names to human-readable messages
- Used by the SSE generator to attach `message` to each StatusEvent
- This is the single source of truth — all nodes emit status via this map

**Why three separate event models (not one union):** Each has different fields. StatusEvent has `docs_found`/`web_query`. ChatResponse has `citations`/`cost_usd`. InterruptResponse has `options`/`interrupt_type`. Separate models = Pydantic validates each correctly. The `type` Literal field enables discriminated union on the frontend.

**Pattern to follow:** Same file structure as existing `IngestResponse` / `RetryResponse` — flat Pydantic models, no deep nesting.

**Test:** Import models in Python REPL, instantiate each with sample data, verify `model.model_dump()` produces clean JSON for SSE serialization. Verify StatusEvent correctly validates with optional `docs_found`/`web_query`.

---

### Phase 1.2: Backend SSE Echo Endpoint

**Goal:** FastAPI endpoint that receives a ChatRequest and returns an SSE stream with simulated status events followed by an echo response. This proves the entire SSE pipeline (streaming, proxy passthrough, frontend parsing) before LangGraph is added.

**File:** `backend/app/routers/chat.py` (NEW)

**Endpoint: POST /chat**

Accepts JSON body (not FormData — chat messages are JSON, unlike file uploads). Returns `StreamingResponse` with `media_type="text/event-stream"`.

Architecture:
1. Parse request body as ChatRequest (Pydantic auto-validates)
2. Validate `user_id` and `thread_id` are valid UUIDs (same helper pattern from documents.py)
3. Create async generator function that:
   a. Yields StatusEvent for "intent_resolver" (simulates node completion) + 300ms delay
   b. Yields StatusEvent for "doc_resolver" with fake `docs_found` if `tagged_doc_ids` is non-empty + 300ms delay
   c. Yields StatusEvent for "validate_inputs" + 200ms delay
   d. Yields StatusEvent for action node (using `request.action or "inquire"`) + 500ms delay
   e. Yields final ChatResponse (echo: `f"Echo: {request.message}"`)
4. Return `StreamingResponse(generator(), media_type="text/event-stream", headers={...})`

SSE format per event: `data: {json}\n\n` — each yield is one complete SSE event line.

Required response headers:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (prevents Nginx/reverse proxy buffering in production)

**Endpoint: POST /chat/resume**

Same SSE pattern but simpler:
1. Parse ResumeRequest, validate thread_id
2. Async generator yields 1-2 simulated status events + echo response
3. Return StreamingResponse

**Why simulate delays:** Without delays, all events arrive in one chunk (browser batches). The 200-500ms delays force real streaming behavior — tests that the frontend parses events incrementally and PalReasoning visually updates step-by-step.

**Error handling inside SSE stream:**
- If an error occurs during streaming (after headers are sent), yield an error event: `data: {"type": "error", "message": "..."}\n\n`
- If error occurs BEFORE streaming starts (bad UUID, missing fields), raise `HTTPException` normally — FastAPI returns JSON error, not SSE
- This distinction is important: once streaming starts, you can't change status codes

**File:** `backend/app/main.py` (MODIFY)
- Import and register chat router: `app.include_router(chat_router, tags=["chat"])`

**Test:** Use curl to POST to `http://localhost:8000/chat` with sample JSON body. Verify:
- Response streams incrementally (not all at once)
- Each `data: {...}\n\n` line is valid JSON
- Status events arrive before the final response event
- Content-Type header is `text/event-stream`

---

### Phase 1.3: Frontend Types

**Goal:** TypeScript type definitions mirroring the Pydantic models. These are the single source of truth for all frontend code that touches chat data. The discriminated union pattern enables `switch(event.type)` with full type narrowing.

**File:** `lib/types/chat.ts` (NEW)

Types to define:

ChatRequest:
- Mirrors ChatRequest Pydantic model exactly
- NOTE: `user_id` is NOT in this type — it's injected server-side by the Next.js API route
- All other fields match 1:1

StatusEvent:
- `type: "status"` (literal)
- `node: string` — which node completed
- `message: string` — human-readable status
- `docs_found?: { id: string; title: string }[]` — optional, from doc_resolver
- `web_query?: string` — optional, from action nodes with web search

ChatResponse:
- `type: "response"` (literal)
- All fields from Pydantic ChatResponse

InterruptResponse:
- `type: "interrupt"` (literal)
- All fields from Pydantic InterruptResponse
- `options` is optional array of `{ id: string; label: string }`

ChatStreamEvent (discriminated union — the core type for SSE parsing):
- `StatusEvent | ChatResponse | InterruptResponse`
- Frontend switches on `.type` field:
  - `"status"` → update PalReasoning
  - `"response"` → render AI message, clear PalReasoning
  - `"interrupt"` → show PalAssist, clear PalReasoning

ResumeRequest:
- `thread_id: string`
- `resume_value: { type: string; value: string | null }`

**File:** `lib/chat/extract-mentions.ts` (MODIFY)

Current `ChatSubmitPayload`:
```
{ text, action, tagged_doc_ids, tagged_set_ids, enable_web_search }
```

Add `tiptap_json` field (JSONContent type from @tiptap/core). This is the raw TipTap document that the backend Python pre-processor needs.

Update `extractMentions()`:
- Already receives `doc: JSONContent` as first parameter
- Add `tiptap_json: doc` to the returned payload
- Zero logic change — just passing through what's already available

**Why tiptap_json in the payload:** The backend needs it for the Python pre-processor (pure-mention detection, doc name extraction for `conversation_docs` registry). The doc is already passed to `onSubmit` as the second arg. Moving it into the payload simplifies data flow — one object carries everything needed for the API call.

**Test:** TypeScript compilation passes. No runtime test needed — types are compile-time only.

---

### Phase 1.4: Next.js API Proxy Routes (SSE Passthrough)

**Goal:** Two Next.js API routes that proxy chat requests to FastAPI, injecting `user_id` server-side. Unlike the document upload proxy (which returns JSON), these **pipe the SSE stream through** without buffering.

**File:** `app/api/chat/route.ts` (NEW)

**Critical difference from upload proxy:** The response is NOT parsed with `.json()`. The backend returns a stream (`text/event-stream`), and the proxy must forward that stream byte-for-byte to the browser.

Pattern:
1. Create Supabase server client
2. Get authenticated user via `supabase.auth.getUser()`
3. If no user → return `NextResponse.json({ error }, { status: 401 })`
4. Parse request body as JSON
5. Inject `user_id: user.id` into the body
6. `fetch()` to `${BACKEND_URL}/chat` with JSON body
7. **If backend response is NOT ok** → return JSON error (non-streaming error path)
8. **If backend response IS ok** → pipe the body stream through:
   - Read `backendResponse.body` as a `ReadableStream`
   - Return `new Response(readableStream, { headers })` where headers include:
     - `Content-Type: text/event-stream`
     - `Cache-Control: no-cache`
     - `Connection: keep-alive`
     - `Content-Encoding: none` — **CRITICAL:** prevents Next.js from gzip-compressing the stream (which would buffer all events until stream ends, defeating SSE)

**Why `Content-Encoding: none` matters:** Without it, Next.js may apply gzip compression. Gzip buffers the entire response before sending. This turns real-time SSE into "wait 5 seconds, then dump everything at once" — destroying PalReasoning's purpose. This single header is the difference between working and broken SSE.

**Piping approach — simplest option:**
- Backend returns a `ReadableStream` in the fetch response body
- Create a `ReadableStream` that reads chunks from the backend reader and enqueues them to the client
- Use `reader.read()` in a loop, enqueue each chunk, close on done
- Handle backend disconnects: if backend reader errors, close the client stream

**File:** `app/api/chat/resume/route.ts` (NEW)

Same SSE passthrough pattern:
1. Auth check → inject user_id
2. Forward to `${BACKEND_URL}/chat/resume` as JSON POST
3. Pipe SSE stream through (identical piping logic)

**Error handling (both routes):**
- No user → 401 JSON
- No BACKEND_URL → 503 JSON
- Network fetch fails → 502 JSON (can't start stream if fetch itself fails)
- Backend returns non-200 → read body as JSON, forward error with status code
- Backend stream disconnects mid-stream → client stream closes (browser handles this)

**Test:** Start Next.js + FastAPI. Open browser console:
```
fetch("/api/chat", { method: "POST", ... }).then(r => {
  const reader = r.body.getReader();
  // read and log each chunk — should see events arrive one by one, not all at once
})
```
Verify events arrive incrementally with visible delays (not batched).

---

### Phase 1.5: SSE Stream Hook (useChatStream)

**Goal:** A custom React hook that reads SSE events from `/api/chat` (or `/api/chat/resume`), parses them, and updates React state per event. This replaces what would have been two React Query mutations (`useSendMessage` + `useResumeGraph`).

**File:** `hooks/use-chat-stream.ts` (NEW)

**Why NOT React Query:** React Query's `useMutation` calls `mutationFn`, awaits a single return value, then triggers `onSuccess`. SSE streams emit multiple events over time — we need to update state on each event, not just at the end. A custom hook with `fetch()` + `ReadableStream` + `useState` is the right tool.

**Hook signature and return values:**

State exposed to components:
- `reasoningStatus: StatusEvent | null` — current PalReasoning status (updated per status event, cleared on terminal event)
- `isStreaming: boolean` — true while SSE stream is active
- `error: string | null` — error message if stream fails

Actions exposed to components:
- `sendMessage(payload)` — starts SSE stream to `/api/chat`, parses events
- `resumeGraph(threadId, resumeValue)` — starts SSE stream to `/api/chat/resume`, same parsing
- `cancel()` — aborts current stream (AbortController)

Callback props (passed by ChatPanel, called per event):
- `onStatus(event: StatusEvent)` — called on each status event
- `onResponse(event: ChatResponse)` — called when final response arrives
- `onInterrupt(event: InterruptResponse)` — called when interrupt arrives
- `onError(error: string)` — called on stream error

**Why callbacks instead of just state:** ChatPanel needs to DO things when events arrive (add AI message to local array, set interrupt payload, clear PalReasoning). State alone would require `useEffect` chains that react to state changes — messy and error-prone. Callbacks give ChatPanel direct control: "when response arrives, do these 3 things."

**Internal implementation flow (sendMessage):**

1. Cancel any existing stream (`abortControllerRef.current?.abort()`)
2. Create new AbortController, store in ref
3. Set `isStreaming = true`, `error = null`, `reasoningStatus = null`
4. Build ChatRequest body from payload fields
5. `fetch("/api/chat", { method: "POST", body, signal, headers })`
6. If `!response.ok` → parse JSON error → `setError(message)` → `setIsStreaming(false)` → return
7. Get reader from `response.body.getReader()`
8. Read loop:
   a. `reader.read()` → get chunk
   b. Decode chunk, append to buffer string
   c. Split buffer on `\n\n` (SSE event boundary)
   d. For each complete event:
      - Strip `data: ` prefix
      - `JSON.parse()` → get typed event
      - Switch on `event.type`:
        - `"status"` → `setReasoningStatus(event)` → call `onStatus(event)`
        - `"response"` → `setReasoningStatus(null)` → `setIsStreaming(false)` → call `onResponse(event)`
        - `"interrupt"` → `setReasoningStatus(null)` → `setIsStreaming(false)` → call `onInterrupt(event)`
   e. Keep incomplete event data in buffer (may span chunks)
   f. If `done` → break loop
9. Cleanup: `setIsStreaming(false)`

**resumeGraph uses the same internal stream reader** — only the URL (`/api/chat/resume`) and body shape (ResumeRequest) differ. Extract a shared `_startStream(url, body)` internal function.

**SSE parsing — the buffer pattern:**
Network chunks don't align with SSE event boundaries. A single `reader.read()` might contain:
- Exactly one event: `data: {...}\n\n`
- Multiple events: `data: {...}\n\ndata: {...}\n\n`
- A partial event: `data: {"type": "st` (rest comes in next chunk)
- An event split across two chunks: `...atus"}\n\n`

The buffer pattern handles all cases:
- Append each chunk to a running buffer string
- Split on `\n\n` — complete events are before the last split, incomplete data is after
- `events.pop()` returns the incomplete tail → becomes the new buffer
- Process all complete events, carry over the buffer

**Timeout handling:**
- Start a 30s timer on stream start
- Reset timer on each event received
- If 30s passes with no event → abort stream, set error ("Connection timed out"), clear PalReasoning

**Cleanup:**
- AbortController in `useRef` — persists across renders, doesn't cause re-renders
- `useEffect` cleanup function calls `abort()` on unmount
- `cancel()` exposed for ChatPanel to call when user navigates away or cancels manually
- AbortError caught in the read loop → silently ignored (not a real error)

**Error handling:**
- Non-200 from proxy → parse JSON error body, `setError(message)`
- Malformed SSE event (JSON parse fails) → `console.error`, skip event, continue stream
- Network drops → AbortError or TypeError → `setError("Connection lost")`
- Stream ends without terminal event → `setError("Unexpected stream end")`

**Test:** Import hook in a test component, call `sendMessage` with sample payload, verify:
- `isStreaming` goes true → status events update `reasoningStatus` → response arrives → `isStreaming` goes false
- Callbacks fire in correct order
- Aborting mid-stream clears state cleanly
- Navigating away doesn't leave orphaned streams

---

### Phase 1.6: PalReasoning Component

**Goal:** Visual component that shows the current agent status as shimmering text below the user's message. This is the user-facing part of PalReasoning.

**File:** `components/chat/pal-reasoning.tsx` (NEW)

**Props:**
- `status: StatusEvent | null` — current status from `useChatStream`
- When `null` → component renders nothing (unmounts or returns null)

**Rendering logic:**

When `status` is not null:
1. Show status message as text with shimmer/pulse animation (CSS animation, not JS)
   - Icon: sparkle (✦) or `Sparkles` from lucide-react
   - Text: `status.message` (e.g., "Clarifying intent...")
   - Style: blue accent text, subtle shimmer/glow animation, `text-sm`

2. If `status.docs_found` exists and is non-empty (from doc_resolver):
   - Below the status text, show small doc pills: `📄 DocTitle` for each found doc
   - Style: small glassmorphism pills, same style as mention pills in messages
   - This confirms to the user which documents were resolved — builds trust

3. If `status.web_query` exists (from action nodes with web search):
   - Below the status text, show: `🔍 "query text"` in small italic text
   - Confirms the web search being performed

**Minimum display time (300ms):**
- Problem: Some nodes complete in <50ms. Without a minimum, status text flashes too fast to read.
- Solution: When a new status arrives, DON'T immediately render it. Instead:
  - Track `lastUpdateTime` in a ref
  - If <300ms since last update → queue the new status with a `setTimeout` for the remaining time
  - If >=300ms → render immediately
- This is purely a UX concern — the data flow is unaffected

**Animation:**
- Use CSS `@keyframes` for the shimmer effect — lightweight, no JS animation library needed
- Tailwind `animate-pulse` is close but too aggressive — a gentler custom shimmer is better
- The component should feel like "thinking" — subtle, not distracting

**Positioning:**
- Rendered INSIDE the message list, below the last user message bubble
- NOT in a fixed position — scrolls with the conversation
- When PalReasoning clears and AI message appears, the AI message takes PalReasoning's position (smooth visual transition)

**What NOT to build yet:**
- PalReasoning for resumed graphs (Phase 3 — same component, just re-triggered by `resumeGraph`)
- Elaborate animations or transitions between statuses (keep simple, iterate later)

**Test:** 
- Render component with mock `StatusEvent` → verify text and shimmer appear
- Pass `status` with `docs_found` → verify doc pills render
- Pass `null` → verify component unmounts/hides
- Rapid status changes → verify 300ms minimum display (no flash)

---

### Phase 1.7: ChatPanel Integration (Wire SSE + PalReasoning)

**Goal:** Replace the local `useState` throwaway message flow with `useChatStream`. User sends message → PalReasoning shimmer appears → status events update it → echo response renders as AI message. The full loop.

**File:** `components/dashboard/chat-panel.tsx` (MODIFY)

**What changes:**

1. **Message type evolution:**
   - Current: `LocalMessage = { id, text, doc }` — user messages only
   - New: `ChatMessage = { id, role: "user" | "assistant", text, doc?, response?, citations?, confidence? }`
   - `role: "user"` → current rendering (blue bubble, right-aligned)
   - `role: "assistant"` → new rendering (left-aligned, different background, confidence badge)
   - Keep the type simple — this is still local state until Phase 2 replaces it with checkpoint data

2. **New hooks and state:**
   - Import and use `useChatStream` with callbacks
   - `const [interruptPayload, setInterruptPayload] = useState<InterruptResponse | null>(null)` — for Phase 3 PalAssist
   - `reasoningStatus` comes from `useChatStream` — no separate state needed

3. **Submit flow change (the core rewiring):**
   - Current: `handleSubmit` → adds to local state → done
   - New: `handleSubmit` → 
     a. Add user message to local `messages` state (instant feedback, same as now)
     b. Call `chatStream.sendMessage({ payload, threadId: conversationId })`
     c. Callbacks handle the rest:
       - `onStatus`: `reasoningStatus` auto-updates in the hook → PalReasoning re-renders
       - `onResponse`: add assistant message to local `messages` state, clear PalReasoning
       - `onInterrupt`: set `interruptPayload` state (Phase 3 renders PalAssist from this)
       - `onError`: show toast error message, clear loading state
     d. Auto-title logic stays the same (first message truncates to 50 chars, renames via `useRenameConversation`)

4. **PalReasoning in the message list:**
   - After the last user message, if `chatStream.isStreaming` is true:
     - Render `<PalReasoning status={chatStream.reasoningStatus} />`
   - When `isStreaming` goes false (response or error):
     - PalReasoning unmounts (status is null)
     - AI message bubble renders in its place

5. **Disable input while streaming:**
   - Pass `disabled={chatStream.isStreaming}` to `<ChatInput>`
   - Prevents sending a second message while the first is still streaming
   - Visual: input appears slightly dimmed/disabled

6. **AI message rendering (basic for now):**
   - Left-aligned bubble with different background color (`bg-card` or `bg-white`)
   - Shows `response.response` as plain text
   - Confidence badge: small colored dot (green = high, yellow = medium, red = low) based on `retrieval_confidence`
   - Cost display: `"🪙 {tokens} tokens · ${cost}"` in `text-xs text-muted` below the message
   - These are simple text renders — no elaborate formatting yet

7. **What NOT to build yet:**
   - PalAssist UI (Phase 3 — `interruptPayload` is stored but not rendered)
   - Chat history loading on mount (Phase 2 — needs PostgresSaver)
   - Citation tooltips (built when real actions produce citations)
   - Structured response formatting (tables, bullet lists — action-specific, comes with real actions)

8. **Scroll behavior:**
   - Existing auto-scroll effect should continue working (scrolls on `messages.length` change)
   - PalReasoning status updates DON'T trigger scroll (would be jittery) — only new messages do
   - When AI message appears (replacing PalReasoning), scroll triggers naturally via `messages` state change

**Test (the critical end-to-end verification):**
1. Open conversation → type "Hello world" → press Enter
2. User message appears instantly (blue bubble, right-aligned)
3. PalReasoning appears below: ✦ "Clarifying intent..." (shimmer)
4. Status updates: "Finding documents..." → "Validating request..." → "Researching your question..."
5. PalReasoning clears → AI message appears: "Echo: Hello world" (left-aligned)
6. Verify each status displayed for at least 300ms (no flash)
7. Type message with @doc mention → verify "Finding documents..." status includes doc pill
8. Open Network tab → verify SSE events arrive incrementally (not batched)
9. Kill FastAPI → send message → verify error toast (not crash, not infinite spinner)
10. Navigate away mid-stream → verify no console errors, no orphaned streams
11. Send message while previous stream hasn't finished → verify first stream aborted cleanly

---

### Phase 1 File Summary

```
NEW files:
  backend/app/routers/chat.py              ← SSE echo endpoints (1.2)
  lib/types/chat.ts                        ← TS type definitions + StatusEvent (1.3)
  app/api/chat/route.ts                    ← Next.js SSE passthrough proxy (1.4)
  app/api/chat/resume/route.ts             ← Next.js SSE passthrough proxy (1.4)
  hooks/use-chat-stream.ts                 ← SSE stream reader hook (1.5)
  components/chat/pal-reasoning.tsx         ← PalReasoning shimmer UI (1.6)

MODIFIED files:
  backend/app/models/schemas.py            ← Add chat + SSE Pydantic models (1.1)
  backend/app/main.py                      ← Register chat router (1.2)
  lib/chat/extract-mentions.ts             ← Add tiptap_json to payload (1.3)
  components/dashboard/chat-panel.tsx       ← Wire SSE hook + PalReasoning (1.7)
```

### Phase 1 Build Order (sequential — each depends on previous)

```
1.1 Backend types         → defines the contract (including StatusEvent) everything depends on
1.2 Backend SSE endpoint  → implements the contract as SSE stream with simulated delays
1.3 Frontend types        → mirrors the contract in TypeScript (StatusEvent + ChatStreamEvent union)
1.4 SSE proxy routes      → pipes SSE stream from FastAPI through Next.js (no buffering)
1.5 useChatStream hook    → reads SSE, parses events, updates React state per event
1.6 PalReasoning component→ renders shimmer status text + doc pills
1.7 ChatPanel wiring      → plugs hook + PalReasoning into the chat UI
```

### Phase 1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Next.js proxy buffers SSE stream | HIGH | PalReasoning is useless (all events arrive at once) | `Content-Encoding: none` header + verify with curl before building frontend |
| SSE events split across network chunks | MEDIUM | Malformed JSON parse errors | Buffer pattern in useChatStream: split on `\n\n`, carry over incomplete events |
| JSON body not parsed in FastAPI | MEDIUM | 422 Validation Error | FastAPI uses `ChatRequest` as param type (not `Form(...)`), test with curl first |
| PalReasoning status flashes too fast | MEDIUM | Bad UX — statuses unreadable | 300ms minimum display timer in PalReasoning component |
| tiptap_json serialization (JSONContent → Python dict) | LOW | Field arrives empty/malformed | JSONContent is plain JSON — no special serialization. Test with real TipTap output |
| AbortController cleanup on unmount | MEDIUM | Orphaned streams, memory leaks, stale state updates | useEffect cleanup + abort check inside read loop + AbortError catch |
| ChatPanel re-render storms from rapid status updates | MEDIUM | UI jank, dropped frames | reasoningStatus is a single object replacement (not array append) — minimal re-renders |

### Phase 1 Key Decision Log

| Decision | Why | Alternative Considered |
|---|---|---|
| SSE from Phase 1 (not added later) | Avoids rewriting JSON transport to SSE in Phase 2. Proves streaming works early. | Add SSE in Phase 2 after graph is working — but requires rewriting proxy, hook, and panel |
| Custom hook (not React Query) | React Query can't handle multi-event streams. useMutation expects single response. | React Query with streaming adapter — exists but adds complexity with no benefit |
| Callbacks (not pure state) | ChatPanel needs to DO things on events (add message, set interrupt). Effects that react to state changes are error-prone. | useEffect watching reasoningStatus — causes stale closure bugs, harder to reason about |
| Single hook for send + resume | Both read SSE the same way. Internal `_startStream(url, body)` shared. Different public methods. | Two separate hooks — duplicates 90% of SSE parsing logic |
| Simulated delays in echo | Without delays, SSE events arrive in one chunk. Can't test PalReasoning visually. | No delays — faster dev, but PalReasoning is untested until Phase 2 |

---
---

## Phase 2: LangGraph Core + Chat History

**Goal:** Replace the Phase 1 echo stub with a real LangGraph graph. User message → graph classifies intent → resolves docs → validates → routes to stub action → returns real response via SSE. PalReasoning shows **real** node status. Chat history loads on page refresh from PostgresSaver checkpoints.

**What Phase 2 does NOT build:**
- `interrupt()` calls (Phase 3 — all nodes always proceed, even with low confidence)
- PalAssist UI (Phase 3)
- Real action logic (Iterations 2-3 — stub actions only, no RAG retrieval)
- Long conversation summarization (Iteration 4)
- Web search calling (real Tavily integration — future iteration)

**Critical: Nodes SET confidence fields but don't ACT on them yet.** Phase 3 adds the interrupt gates at decision points. This separation keeps Phase 2 testable — every message always produces a response.

---

### Phase 2.1: Graph Infrastructure (PostgresSaver + AgentState + LLM Service)

**Goal:** Set up the three foundational services that every graph node depends on: the checkpointer (persistence), the state schema (contract between nodes), and the LLM abstraction (model routing).

---

#### Phase 2.1a: PostgresSaver Setup

**File:** `backend/app/services/graph_service.py` (NEW)

**What this file does:** Initializes PostgresSaver with a Supabase Postgres connection pool, compiles the graph, and exposes a singleton for the chat router to use.

**Required packages (NOT currently in requirements.txt — must add):**
- `langgraph-checkpoint-postgres` — provides `PostgresSaver` (separate from `langgraph-checkpoint`)
- `psycopg_pool` (or install via `psycopg[pool]`) — provides `ConnectionPool`
- Import: `from langgraph.checkpoint.postgres import PostgresSaver` and `from psycopg_pool import ConnectionPool`

**Connection setup:**
- Use `psycopg_pool.ConnectionPool` (sync) with `settings.database_url`
- Required kwargs: `autocommit=True` (checkpoints need it), `prepare_threshold=0` (Supabase uses transaction pooler on port 6543, which doesn't support prepared statements), `row_factory=dict_row` (PostgresSaver accesses rows by column name)
- Call `checkpointer.setup()` on startup — this creates the `checkpoints` and `checkpoint_writes` tables automatically

**Connection string consideration:**
- `settings.database_url` (port 6543) = Supabase's transaction pooler → works if `prepare_threshold=0` is set
- `settings.direct_url` (port 5432) = direct session connection → always works but limited connections
- Start with `database_url` + `prepare_threshold=0`. If connection issues → fall back to `direct_url`

**Graph compilation:**
- Import the graph builder from `graph.py` (Phase 2.5)
- Compile with checkpointer: `builder.compile(checkpointer=checkpointer)`
- Expose as `get_compiled_graph()` singleton (cached, created once)

**Startup hook:**
- The graph_service module initializes lazily — first call to `get_compiled_graph()` creates the pool + checkpointer + compiled graph
- No FastAPI lifespan event needed for initial setup (lazy init is simpler and avoids async complexity)

**Test:** Import `get_compiled_graph()`, verify it returns a `CompiledGraph` instance. Check Supabase SQL editor for `checkpoints` table created.

---

#### Phase 2.1b: AgentState Definition

**File:** `backend/app/graph/state.py` (NEW)

**What this file does:** Defines the full `AgentState` TypedDict that flows through the graph. Every node reads from and writes to this shared state.

**AgentState fields (from features.md):**

Core conversation fields:
- `messages: Annotated[list[AnyMessage], add_messages]` — the `add_messages` reducer automatically APPENDS new messages and deduplicates by ID. This is what makes chat history work — new messages add to existing, never replace
- `thread_id: str` — same as `conversation.id`, set once per run
- `user_id: str` — for Supabase queries, set once per run

Action routing fields:
- `action: str` — "summarize" | "inquire" | "compare" | "audit". Set by intent_resolver (or from frontend explicit tag)
- `enable_web_search: bool` — OR'd from frontend flag + Python keyword scan + LLM detection
- `web_search_query: str | None` — generated by action nodes (NOT intent resolver)
- `web_search_results: list | None` — Tavily results (future)

Document resolution fields:
- `explicit_doc_ids: list[str]` — UUIDs from frontend @mentions (set once per run from input)
- `tiptap_json: dict` — raw TipTap JSON for Python pre-processor (set once per run)
- `resolved_doc_ids: list[str]` — final docs to use (written by doc_resolver)
- `inference_source: str` — "explicit" | "inferred" | "fuzzy_match" (written by doc_resolver)
- `set_id: str | None` — if user tagged a set
- `conversation_docs: dict[str, str]` — `{ title: uuid }` registry, persisted across turns, updated by format_response
- `has_implicit_refs: bool` — written by doc_resolver
- `inferred_doc_ids: list[str]` — written by doc_resolver LLM
- `unresolved_names: list[str]` — written by doc_resolver LLM → consumed by fuzzy match
- `inference_confidence: str` — "high" | "medium" | "low" (written by doc_resolver)
- `inference_reasoning: str | None` — LLM explanation for LangSmith debugging
- `suggested_doc_ids: list[str]` — options for PalAssist medium-confidence (Phase 3 uses this)

Retrieval result fields (set by action nodes):
- `retrieved_chunks: list` — RAG chunks (empty for stub actions)
- `retrieval_confidence: str` — "high" | "medium" | "low"
- `confidence_score: float` — 0.0-1.0 avg similarity

Response fields:
- `response: str` — final AI response text
- `citations: list[dict]` — citation objects
- `tokens_used: int` — total tokens for this run
- `cost_usd: float` — total cost for this run

**State merge behavior (CRITICAL — the most important architectural rule in the graph):**

When `graph.astream(initial_input, config)` is called, LangGraph loads the checkpoint and merges:
- `messages` uses `add_messages` reducer → new messages APPEND to checkpoint history
- All other fields → if field IS in initial_input, it REPLACES the checkpoint value
- All other fields → if field is NOT in initial_input, checkpoint value PERSISTS

**This means: including `conversation_docs: {}` in initial_input would WIPE the registry.**

**Field classification (enforced in Phase 2.6 state building):**

PERSISTENT (NEVER include in initial_input — let checkpoint persist):
- `conversation_docs` — the name→UUID registry, built up over conversation turns

TRANSIENT (ALWAYS include in initial_input — reset to defaults each turn):
- `explicit_doc_ids`, `tiptap_json`, `action`, `enable_web_search` — from frontend input
- `web_search_query`, `web_search_results` — null until action node
- `resolved_doc_ids`, `inference_source`, `has_implicit_refs`, `inferred_doc_ids`, `unresolved_names`, `inference_confidence`, `inference_reasoning`, `suggested_doc_ids` — reset, doc_resolver sets them
- `retrieved_chunks`, `retrieval_confidence`, `confidence_score` — reset, action node sets them
- `response`, `citations`, `tokens_used`, `cost_usd` — reset, action/format node sets them

**First message (no checkpoint exists):** All fields start empty/default. Nodes access persistent fields via `state.get("conversation_docs", {})` — gracefully defaults to empty dict.

**NODE_STATUS_MAP constant (same file):**
- Dict mapping node names to human-readable PalReasoning messages
- Used by chat router to generate StatusEvent for each node completion
- Single source of truth — add a new node, add a new status message here

**Test:** Import `AgentState`, verify TypedDict works. Instantiate with sample data, verify `add_messages` appends correctly.

---

#### Phase 2.1c: LLM Service Abstraction

**File:** `backend/app/services/llm_service.py` (NEW)

**What this file does:** Wraps `ChatOpenAI` with action-based model routing. Nodes call `llm_service.invoke_structured(action_type, schema, messages)` — they never know which model they're using.

**Model map:**
- `"summarize"` → `gpt-4o-mini` (extraction task, cost-efficient)
- `"inquire"` → `gpt-4o-mini` (targeted Q&A)
- `"compare"` → `gpt-4o` (multi-theme synthesis needs stronger reasoning)
- `"audit"` → `gpt-4o` (legal risk analysis, highest stakes)
- `"intent"` → `gpt-4o-mini` (classification, simple task)
- `"doc_resolution"` → `gpt-4o-mini` (name matching, simple task)

**Service structure:**
- Create one `ChatOpenAI` instance per model name (reuse across calls — connection pooling)
- `invoke_structured(action_type, schema, messages)` → returns validated Pydantic instance
- `invoke(action_type, messages)` → returns raw AIMessage (for cases without structured output)
- Use `temperature=0` for all compliance outputs (deterministic)
- Pass `api_key` from `get_settings().openai_api_key`

**Why "intent" and "doc_resolution" as separate action types:** These are always `gpt-4o-mini` regardless of the final action. The user's action hasn't been classified yet when intent_resolver runs. Having explicit types prevents a chicken-and-egg problem.

**Error handling:**
- Wrap LLM calls in try/except for `openai.RateLimitError`, `openai.APITimeoutError`, `openai.APIError`
- On rate limit → retry once after 1s delay
- On timeout → retry once with extended timeout
- On other API error → raise with clean message for graph error handling
- Log token usage on every call (for cost tracking): `response.usage_metadata`

**Singleton pattern:** `get_llm_service()` function with module-level caching (same as `get_supabase()`)

**Test:** Call `llm_service.invoke_structured("intent", IntentSchema, [HumanMessage("Summarize this doc")])` → verify returns validated Pydantic object. Check LangSmith for trace.

---

### Phase 2.2: Intent Resolver Node

**Goal:** Classify the user's intended action from their message. Uses progressive context (start cheap, expand if needed). Also detects web search need via Python keyword scan + LLM output.

**File:** `backend/app/graph/nodes/intent_resolver.py` (NEW)

**Pydantic schema for LLM structured output (define in same file):**

IntentClassification:
- `action: Literal["summarize", "inquire", "compare", "audit"]`
- `confidence: Literal["high", "medium", "low"]`
- `enable_web_search: bool` — LLM detects nuanced recency: "Is this still enforced?"
- `multi_action_detected: bool` — user asked for two things at once
- `reasoning: str` — for LangSmith debugging (never shown to user)

**Node logic (function signature: `def intent_resolver(state: AgentState) -> dict`):**

Step 0 — Explicit action shortcut:
- If `state["action"]` is already set (from frontend @Action tag) → skip LLM entirely
- Still run Python keyword scan for `enable_web_search` (free)
- Return: `{ action: state["action"], enable_web_search: scanned_flag }`
- Cost: $0

Step 1 — Python keyword scan (free, always runs):
- Check latest message text for temporal terms: "latest", "recent", "current", "now", "today", "2025", "2026"
- If found → set `python_web_flag = True`
- This is OR'd with the frontend flag and LLM flag later

Step 2 — First pass LLM call (latest message only):
- Build messages: `[SystemMessage(intent_prompt), HumanMessage(last_msg.content)]`
- The intent prompt instructs: "Classify the user's intent. Check for implicit web search need. Detect multi-action."
- Call `llm_service.invoke_structured("intent", IntentClassification, messages)`
- If confidence == "high" AND NOT multi_action → done

Step 3 — Second pass (if low/medium confidence):
- Expand context: add last 5 messages from `state["messages"]` (not just the latest)
- Rebuild messages: `[SystemMessage(intent_prompt), *last_5_messages, HumanMessage(last_msg.content)]`
- Call LLM again with richer context
- Use whatever confidence comes back (even if still low — Phase 3 handles interrupts)

Step 4 — "Summarize X about Y" rule:
- If LLM returned action="summarize" BUT the message contains a specific topic/question about the document → override to "inquire"
- This is a Python post-processing check on the LLM output
- Example: "Summarize the capital requirements in BankNegara2024" → actually an Inquire (specific topic)
- Check: if `reasoning` mentions a specific topic and action is "summarize" → may need to override
- Note: keep this simple. The LLM prompt should handle most cases. Only override for obvious misclassifications.

Final — merge web search flags:
- `enable_web_search = state["enable_web_search"] OR python_web_flag OR llm_result.enable_web_search`
- OR logic across all three sources

**Return value (partial state update):**
```
{
  "action": classification.action,
  "enable_web_search": merged_web_flag,
  # multi_action_detected is available for Phase 3 interrupt logic
}
```

**Action confidence is NOT written to state** — `inference_confidence` is owned by doc_resolver (document resolution confidence). The intent_resolver logs `classification.confidence` + `classification.reasoning` for LangSmith tracing (visible in the node trace) but does not set a state field. This avoids a silent field collision where doc_resolver would overwrite it.

**Important: In Phase 2, multi_action_detected is logged but NOT interrupted.** The first action is used. Phase 3 adds interrupt().

**Cost per message:**
- Explicit @action: $0 (skip LLM)
- High confidence first pass: ~$0.0005 (1 LLM call, gpt-4o-mini)
- Low confidence (retry): ~$0.001 (2 LLM calls)

**Test:**
- Send "Summarize @Doc1" with explicit @Summarize tag → verify action="summarize", no LLM call
- Send "What are the capital requirements?" → verify action="inquire", high confidence
- Send ambiguous "Tell me about that document" → verify retry with 5 messages
- Send "Is BankNegara still enforced?" → verify `enable_web_search=True`

---

### Phase 2.3: Doc Resolver Node (3-Stage Pipeline)

**Goal:** Resolve which documents the user is referring to. Uses the 3-stage pipeline: Python pre-processor → LLM → fuzzy match. Most complex node in the graph.

**File:** `backend/app/graph/nodes/doc_resolver.py` (NEW)

**Pydantic schema for LLM structured output:**

DocResolution:
- `resolved_uuids: list[str]` — UUIDs matched from registry
- `unresolved_names: list[str]` — names LLM couldn't match → fuzzy match targets
- `inference_confidence: Literal["high", "medium", "low"]`
- `has_implicit_refs: bool`
- `reasoning: str` — for LangSmith debugging

**Node logic (function: `def doc_resolver(state: AgentState) -> dict`):**

**Stage 1 — Python pre-processor (free):**

a. Extract explicit UUIDs from `state["tiptap_json"]`:
   - Walk the TipTap JSON tree recursively
   - Find all mention nodes with `category == "document"`
   - Collect their `id` attributes → `explicit_uuids`
   - Also extract mention labels → for conversation_docs registry later

b. Check for "pure mention" (no free text):
   - If message text (stripped of mention labels) is empty or just whitespace → pure mention
   - Pure mention = all docs are explicitly tagged, no inference needed
   - Return immediately: `resolved_doc_ids = explicit_uuids`, `inference_source = "explicit"`, `inference_confidence = "high"`
   - Cost: $0

c. If free text present → determine LLM context scope:
   - Get `conversation_docs` from state (the `{ title: uuid }` registry)
   - Check: does any registry key appear verbatim in the message text? (case-insensitive substring match)
   - YES (registry hit) → cheap path: context = latest message + registry only
   - NO (pronouns, unknown names) → history path: context = latest message + last 5 messages + registry

**Stage 2 — One LLM call (right-sized context):**

a. Build the LLM prompt:
   - System message: "You are a document resolver. Given the user's message and their document registry, identify which documents are referenced."
   - Include: `conversation_docs` registry as context (so LLM can map names → UUIDs)
   - Include: `state["action"]` so LLM knows expected doc pattern (compare needs 2+, audit needs source + targets)
   - Include: already-resolved `explicit_uuids` (for hybrid mode — LLM merges these with implicit refs)
   - User message(s): selected context from Stage 1

b. Call `llm_service.invoke_structured("doc_resolution", DocResolution, messages)`

c. Merge results: `resolved_doc_ids = explicit_uuids ∪ llm_result.resolved_uuids`

**Stage 3 — Python fuzzy match (only if `unresolved_names` is non-empty):**

a. For each name in `llm_result.unresolved_names`:
   - Query Supabase: `SELECT id, title FROM documents WHERE user_id = state["user_id"]`
   - Calculate Levenshtein similarity between unresolved name and each doc title
   - Match ≥ 85% → add UUID to `resolved_doc_ids`, mark `inference_source = "fuzzy_match"`
   - No match → keep in unresolved (Phase 3 will interrupt for these)

b. Use `python-Levenshtein` or `rapidfuzz` library for fast fuzzy matching
   - Check if already in `requirements.txt` — if not, add `rapidfuzz`

**Supabase dependency:**
- Stage 3 queries all user documents for fuzzy matching
- `format_response` also queries doc titles for registry updates
- Both use `get_supabase()` admin client with `user_id` filter
- Consider caching user doc titles within a single graph run (avoid duplicate queries)

**Return value (partial state update):**
```
{
  "resolved_doc_ids": merged_uuids,
  "inference_source": "explicit" | "inferred" | "fuzzy_match",
  "inference_confidence": confidence,
  "has_implicit_refs": llm_result.has_implicit_refs (or False if Stage 1 short-circuited),
  "inferred_doc_ids": llm_result.resolved_uuids,
  "unresolved_names": remaining_unresolved,
  "inference_reasoning": llm_result.reasoning,
  "suggested_doc_ids": candidates_for_palassist  # Phase 3 reads this for medium conf
}
```

**Important: In Phase 2, even low confidence proceeds.** `unresolved_names` is set but no interrupt fires. Phase 3 adds interrupt gates.

**Cost per message:**
- Pure @mentions: $0 (Stage 1 short-circuit)
- Registry hit: ~$0.001 (1 LLM call with minimal context)
- History path: ~$0.002 (1 LLM call with 5 messages)
- Fuzzy match: $0 (Python only, after LLM)

**Test:**
- Send "Compare @Doc1 and @Doc2" → verify pure mention shortcut, $0 cost
- Send "What about BankNegara?" (after previous turn used BankNegara) → verify registry hit path
- Send "What about that regulation?" → verify history path (5 messages included)
- Send "What about XYZ guidelines?" (no match) → verify fuzzy match attempted, unresolved_names populated

---

### Phase 2.4: Validate Inputs + Stub Actions + Format Response

**Goal:** Build the three simpler nodes that complete the graph pipeline. Validation catches requirements, stubs return placeholder responses, format_response shapes output and updates the conversation_docs registry.

---

#### Phase 2.4a: Validate Inputs Node

**File:** `backend/app/graph/nodes/validate_inputs.py` (NEW)

**Pure Python — no LLM calls, $0 cost.**

**Validation rules (function: `def validate_inputs(state: AgentState) -> dict`):**

1. Action-specific doc requirements:
   - Compare: needs 2+ `resolved_doc_ids` → if <2, flag missing
   - Audit: needs source text (in message) + 1+ target `resolved_doc_ids` → if 0 targets, flag missing
   - Summarize: needs 1+ `resolved_doc_ids` → if 0, flag missing (but web-only summarize is not supported)
   - Inquire: 0+ docs is fine (can be web-only or general knowledge)

2. Web search flag cleanup:
   - If `action == "compare"` AND `enable_web_search == True` → set `enable_web_search = False`
   - Compare is always between uploaded docs — web search is not meaningful

3. Set IDs:
   - If `state["set_id"]` is provided, resolve all doc IDs in that set from Supabase
   - Merge with any explicitly tagged docs

**Return value:**
- Returns `{"enable_web_search": cleaned_flag}` if web search was dropped
- Otherwise returns empty dict `{}` (no state changes needed)
- Phase 3 will add interrupt() calls for missing requirements. In Phase 2, validation just logs warnings and proceeds.

**Test:**
- Compare with 1 doc → verify warning logged (Phase 2), continues anyway
- Compare with web search flag → verify flag is dropped to False

---

#### Phase 2.4b: Stub Action Nodes

**File:** `backend/app/graph/nodes/stub_actions.py` (NEW)

**Four stub functions — one per action type. Each returns a placeholder response with no real RAG retrieval.**

**Function signatures:**
- `def summarize_action(state: AgentState) -> dict`
- `def inquire_action(state: AgentState) -> dict`
- `def compare_action(state: AgentState) -> dict`
- `def audit_action(state: AgentState) -> dict`

**Each stub returns:**
```
{
  "response": f"[{action} action coming soon] Query: {last_message}. Resolved docs: {resolved_doc_ids}",
  "citations": [],
  "retrieved_chunks": [],
  "retrieval_confidence": "high",   # Hardcoded for stubs
  "confidence_score": 1.0,          # Hardcoded
  "tokens_used": 0,
  "cost_usd": 0.0,
  "messages": [AIMessage(content=response)]   # Appended via add_messages reducer
}
```

**Why include `AIMessage` in the return:** The `add_messages` reducer appends it to the conversation history. When the user sends the next message, PostgresSaver loads this AI message as part of the history. Without it, the conversation would only have human messages.

**Why separate functions (not one with a switch):** Each becomes a separate graph node. LangGraph tracks node execution individually — separate functions mean separate traces in LangSmith and separate StatusEvent entries for PalReasoning.

**Web search stub:** If `state["enable_web_search"]` is True, include in response text: `"[Web search would be performed here for: {topic}]"`. Don't call Tavily yet.

**Test:** Invoke each stub function with sample state → verify response text includes action name and resolved doc IDs.

---

#### Phase 2.4c: Format Response Node

**File:** `backend/app/graph/nodes/format_response.py` (NEW)

**What this node does:** Shapes the final response, updates the `conversation_docs` registry, and calculates any remaining metadata. This is the LAST node before END.

**Function: `def format_response(state: AgentState) -> dict`**

Step 1 — Update conversation_docs registry:
- Get existing registry: `state.get("conversation_docs", {})`
- Query Supabase for titles of all `state["resolved_doc_ids"]`: `SELECT id, title FROM documents WHERE id = ANY(resolved_doc_ids)`
- Merge: `{**existing_registry, **{title: uuid for uuid, title in query_results}}`
- Return merged dict as `conversation_docs` (replaces field — this is the full merged registry)

Step 2 — Shape response metadata:
- `response`: already set by action node
- `citations`: already set by action node (empty for stubs)
- `tokens_used`: already set (0 for stubs)
- `cost_usd`: already set (0 for stubs)

Step 3 — Return partial state:
```
{
  "conversation_docs": merged_registry
}
```

**Why this is a separate node (not inside action nodes):** Single Responsibility. Action nodes own retrieval + generation. format_response owns registry updates + metadata cleanup. If we later add cost aggregation, citation deduplication, or response formatting, it goes here without touching action logic.

**Test:** Run format_response with `resolved_doc_ids: ["uuid-1", "uuid-2"]` → verify conversation_docs updated with titles from Supabase. Verify existing registry entries preserved.

---

### Phase 2.5: Graph Wiring (StateGraph + Conditional Edges)

**Goal:** Wire all nodes into a LangGraph StateGraph with the correct edges and conditional routing. Compile with PostgresSaver checkpointer.

**File:** `backend/app/graph/graph.py` (NEW)

**Graph structure:**

```
START → intent_resolver → doc_resolver → validate_inputs → route_to_action
                                                              │
                                                    ┌────────┴────────┐─────────────┐──────────────┐
                                                    ▼                 ▼              ▼              ▼
                                              summarize_action  inquire_action  compare_action  audit_action
                                                    │                 │              │              │
                                                    └────────┬────────┘──────────────┘──────────────┘
                                                              ▼
                                                       format_response → END
```

**Node registration:**
- `builder.add_node("intent_resolver", intent_resolver)`
- `builder.add_node("doc_resolver", doc_resolver)`
- `builder.add_node("validate_inputs", validate_inputs)`
- `builder.add_node("summarize", summarize_action)`
- `builder.add_node("inquire", inquire_action)`
- `builder.add_node("compare", compare_action)`
- `builder.add_node("audit", audit_action)`
- `builder.add_node("format_response", format_response)`

**Edge registration:**
- `builder.add_edge(START, "intent_resolver")`
- `builder.add_edge("intent_resolver", "doc_resolver")`
- `builder.add_edge("doc_resolver", "validate_inputs")`
- `builder.add_conditional_edges("validate_inputs", route_to_action, { "summarize": "summarize", "inquire": "inquire", "compare": "compare", "audit": "audit" })`
- `builder.add_edge("summarize", "format_response")`
- `builder.add_edge("inquire", "format_response")`
- `builder.add_edge("compare", "format_response")`
- `builder.add_edge("audit", "format_response")`
- `builder.add_edge("format_response", END)`

**Routing function:**
```
def route_to_action(state: AgentState) -> str:
    return state["action"]  # Returns "summarize" | "inquire" | "compare" | "audit"
```

**Note on `route_to_action`:** This is a pure routing function, NOT a node. It's passed as the second arg to `add_conditional_edges`. It reads `state["action"]` (set by intent_resolver) and returns the node name to route to.

**Graph builder function:**
- `def build_graph() -> StateGraph` — creates and returns the uncompiled graph builder
- `graph_service.py` calls `build_graph().compile(checkpointer=checkpointer)` to produce the compiled graph

**Phase 3 changes:** Will add conditional edges from `intent_resolver` and `doc_resolver` that route to an interrupt check before proceeding. The current linear flow will become conditional.

**Test:** Call `build_graph()` → verify returns `StateGraph`. Compile with in-memory checkpointer (for unit testing). Invoke with sample state → verify all nodes execute in order. Check that `conversation_docs` is updated at the end.

---

### Phase 2.6: Chat Router → Real Graph (SSE with astream)

**Goal:** Replace the Phase 1 echo SSE generator with real `graph.astream()` calls. Each node completion emits a real StatusEvent. The format_response node's output becomes the terminal ChatResponse event.

**File:** `backend/app/routers/chat.py` (MODIFY — replace echo generator)

**Streaming approach — `stream_mode="updates"` (NOT `astream_events`):**

Why `stream_mode="updates"` instead of `astream_events`:
- `astream_events` emits events for ALL internal runnables (LLM calls, reducers, etc.) — needs heavy filtering
- `stream_mode="updates"` emits exactly one event per node completion — perfect for PalReasoning
- Each yielded chunk is `{ "node_name": { state_updates_from_node } }` — we know exactly which node and what it returned
- Simpler to parse, less filtering, fewer edge cases

**The SSE generator function (`async def stream_chat_response(request, graph)`):**

Step 1 — Build initial state from ChatRequest (TRANSIENT fields only):

Include these fields (resets them for this turn):
- `messages: [HumanMessage(content=request.message)]` — appended via add_messages reducer
- `explicit_doc_ids: request.tagged_doc_ids`
- `tiptap_json: request.tiptap_json`
- `action: request.action` (None if no explicit tag)
- `enable_web_search: request.enable_web_search`
- `set_id: request.tagged_set_ids[0] if request.tagged_set_ids else None`
- `user_id: request.user_id`
- `thread_id: request.thread_id`
- `web_search_query: None`
- `web_search_results: None`
- `resolved_doc_ids: []`
- `inference_source: ""`
- `has_implicit_refs: False`
- `inferred_doc_ids: []`
- `unresolved_names: []`
- `inference_confidence: ""`
- `inference_reasoning: None`
- `suggested_doc_ids: []`
- `retrieved_chunks: []`
- `retrieval_confidence: ""`
- `confidence_score: 0.0`
- `response: ""`
- `citations: []`
- `tokens_used: 0`
- `cost_usd: 0.0`

**EXCLUDE these fields** (persist from checkpoint):
- `conversation_docs` — the name→UUID registry built across turns. First message defaults via `state.get("conversation_docs", {})` in nodes.

**Why this matters:** Including a field in initial_input REPLACES the checkpoint value. Excluding it lets the checkpoint value persist. Getting this wrong wipes `conversation_docs` every turn — the doc_resolver loses its memory.

Step 2 — Stream graph execution:
```
config = {"configurable": {"thread_id": request.thread_id}}

async for chunk in graph.astream(initial_state, config, stream_mode="updates"):
    for node_name, updates in chunk.items():
        # Skip internal nodes (if any)
        if node_name not in NODE_STATUS_MAP:
            continue

        # Build and yield StatusEvent
        status = StatusEvent(
            type="status",
            node=node_name,
            message=NODE_STATUS_MAP[node_name],
            docs_found=None,
            web_query=None
        )

        # Enrich for doc_resolver (doc pills)
        if node_name == "doc_resolver" and updates.get("resolved_doc_ids"):
            # Query doc titles for the resolved IDs
            status.docs_found = get_doc_titles(updates["resolved_doc_ids"], request.user_id)

        # Enrich for action nodes with web search
        if updates.get("web_search_query"):
            status.web_query = updates["web_search_query"]

        yield f"data: {status.model_dump_json()}\n\n"

        # Check if this is format_response (terminal node)
        if node_name == "format_response":
            # Get final state to build response
            final_state = graph.get_state(config)
            vals = final_state.values
            response = ChatResponse(
                type="response",
                response=vals.get("response", ""),
                citations=vals.get("citations", []),
                action=vals.get("action", "inquire"),
                inference_confidence=vals.get("inference_confidence", "high"),
                retrieval_confidence=vals.get("retrieval_confidence", "high"),
                tokens_used=vals.get("tokens_used", 0),
                cost_usd=vals.get("cost_usd", 0.0)
            )
            yield f"data: {response.model_dump_json()}\n\n"
            return
```

Step 3 — Post-loop interrupt detection:
- If the loop ends WITHOUT yielding a ChatResponse (no format_response node ran), check for interrupt:
- `state = graph.get_state(config)` → check `state.tasks` for interrupt data
- If interrupt found → yield InterruptResponse (terminal event)
- Note: In Phase 2, no interrupts fire (no interrupt() calls yet). This is prep for Phase 3.

**Helper function for doc title enrichment:**
- `get_doc_titles(doc_ids, user_id)` → queries Supabase, returns `[{ "id": uuid, "title": name }]`
- Used by both StatusEvent enrichment and format_response registry update
- Put in a shared utility (e.g., `backend/app/services/doc_utils.py` or in `format_response.py`)

**Also update `/chat/resume` endpoint:**
- Same SSE generator pattern but with `graph.astream(Command(resume=value), config, stream_mode="updates")`
- In Phase 2, this won't be called (no interrupts yet). But the endpoint structure should be ready.

**Error handling in SSE stream:**
- Wrap the entire generator in try/except
- If error occurs mid-stream → yield error event: `data: {"type": "error", "message": "..."}\n\n`
- If error occurs before stream starts → raise HTTPException normally
- Log full traceback for debugging

**Test (critical — proves the SSE pipeline works with real graph):**
1. Send message → verify SSE events arrive for each node: intent_resolver → doc_resolver → validate_inputs → action → format_response
2. Verify PalReasoning in browser updates with each status
3. Verify final ChatResponse has correct action, confidence, response text
4. Verify LangSmith shows full graph trace with all node executions
5. Send second message in same conversation → verify PostgresSaver loads previous state (conversation_docs persists)
6. Kill OpenAI API → send message → verify error event arrives (not infinite hang)

---

### Phase 2.7: Chat History Loading (Backend + Frontend)

**Goal:** When user opens an existing conversation (or refreshes the page), load message history from PostgresSaver checkpoints. No separate messages table needed — checkpoints ARE the source of truth.

---

#### Phase 2.7a: Chat History Backend Endpoint

**File:** `backend/app/routers/chat.py` (MODIFY — add GET endpoint)

**Endpoint: GET /chat/history/{thread_id}**

Steps:
1. Validate `thread_id` UUID
2. Validate `user_id` (injected by proxy) → verify conversation ownership: query `conversations` table, check `user_id` matches
3. Call `graph.get_state({"configurable": {"thread_id": thread_id}})`
4. Extract `messages` from `state.values`
5. Serialize messages for frontend:
   - For each BaseMessage in messages:
     - `id`: message ID (from LangChain)
     - `role`: "user" (HumanMessage) or "assistant" (AIMessage)
     - `content`: message text
     - `metadata`: `additional_kwargs` (may contain citations, confidence, etc. — added by format_response when it appends AIMessage)
   - Filter out SystemMessages (don't show in chat)
6. Return JSON: `{ thread_id, messages: [...] }`

**Empty thread (no checkpoints yet):**
- `state.values` will be empty or messages list will be empty
- Return `{ thread_id, messages: [] }` — frontend shows empty chat

**Important: This is NOT SSE — it's a regular JSON GET request.** History loading is a one-time fetch on mount, not a stream.

**Test:** Create a conversation with 3 messages (via /chat SSE). Call GET /chat/history/{thread_id} → verify returns all 6 messages (3 human + 3 AI) in order.

---

#### Phase 2.7b: Chat History Frontend (Proxy + Hook + ChatPanel)

**File:** `app/api/chat/history/[threadId]/route.ts` (NEW)

Next.js API proxy — same auth pattern as other routes:
1. Auth check → get user_id
2. Forward to `${BACKEND_URL}/chat/history/${threadId}?user_id=${user_id}`
3. Return JSON response (regular proxy, not SSE)

**File:** `hooks/queries/use-chat-history.ts` (NEW)

React Query hook — this IS appropriate for React Query (single JSON response, not streaming):
- `queryKey: ["chat-history", threadId]`
- `queryFn`: fetch from `/api/chat/history/${threadId}`
- `enabled: !!threadId` — only fetch when threadId exists
- `staleTime: Infinity` — history doesn't change until a new message is sent
- `refetchOnWindowFocus: false` — expensive operation, don't auto-refetch

**File:** `components/dashboard/chat-panel.tsx` (MODIFY)

Changes:
1. Import and call `useChatHistory(conversationId)`
2. On mount (or `conversationId` change):
   - If `history.data?.messages` has content → populate local `messages` state from history
   - Map backend format to local `ChatMessage` format: `{ id, role, text: content, ... }`
3. On new message sent (SSE response):
   - Invalidate chat history query: `queryClient.invalidateQueries(["chat-history", conversationId])`
   - This ensures if user refreshes mid-conversation, latest messages are loaded
   - Note: invalidation doesn't re-fetch automatically (staleTime=Infinity). It just marks as stale for the next mount.

**Loading state:**
- While `useChatHistory.isLoading` → show skeleton messages in chat (shimmer placeholders)
- When loaded → render messages normally
- On error → show error state with retry button

**Data flow on page load:**
```
User navigates to /dashboard/[conversationId]
  → ChatPanel mounts
  → useChatHistory fires (React Query)
  → GET /api/chat/history/{threadId}
  → Backend loads from PostgresSaver checkpoint
  → Returns serialized messages
  → ChatPanel populates messages state
  → Messages render in chat
```

**Test:**
1. Send 3 messages in a conversation → verify all render
2. Refresh page → verify same 3 messages + 3 AI responses load from checkpoints
3. Open different conversation → verify history switches
4. Open brand-new conversation (no messages) → verify empty state

---

### Phase 2 File Summary

```
NEW files:
  backend/app/services/graph_service.py          ← PostgresSaver + compiled graph singleton (2.1a)
  backend/app/graph/state.py                     ← AgentState TypedDict + NODE_STATUS_MAP (2.1b)
  backend/app/services/llm_service.py            ← LLM abstraction + model routing (2.1c)
  backend/app/graph/nodes/intent_resolver.py     ← Progressive context intent classification (2.2)
  backend/app/graph/nodes/doc_resolver.py        ← 3-stage doc resolution pipeline (2.3)
  backend/app/graph/nodes/validate_inputs.py     ← Pure Python validation (2.4a)
  backend/app/graph/nodes/stub_actions.py        ← 4 placeholder action functions (2.4b)
  backend/app/graph/nodes/format_response.py     ← Registry update + response shaping (2.4c)
  backend/app/graph/graph.py                     ← StateGraph builder + routing function (2.5)
  app/api/chat/history/[threadId]/route.ts       ← Next.js history proxy (2.7b)
  hooks/queries/use-chat-history.ts              ← React Query hook for loading history (2.7b)

MODIFIED files:
  backend/app/routers/chat.py                    ← Replace echo with graph.astream() SSE (2.6)
  components/dashboard/chat-panel.tsx             ← Load history on mount (2.7b)
  backend/requirements.txt                       ← Add langgraph-checkpoint-postgres, psycopg_pool, rapidfuzz (2.1a, 2.3)
```

### Phase 2 Build Order

```
2.1a PostgresSaver setup       → foundation: persistence layer
2.1b AgentState + NODE_STATUS  → foundation: state contract between all nodes
2.1c LLM Service               → foundation: model abstraction for resolver LLM calls
  ↓
2.2 Intent Resolver            → first real node (test with LLM call)
2.3 Doc Resolver               → most complex node (3-stage pipeline)
2.4 Validate + Stubs + Format  → remaining simple nodes
  ↓
2.5 Graph Wiring               → connect all nodes into StateGraph
2.6 Router → Real Graph        → replace echo stub with astream() SSE
  ↓
2.7 Chat History               → backend endpoint + frontend loading
```

**2.1 → 2.4 are parallelizable in testing** (each node can be unit-tested independently). But **2.5-2.6 are sequential** (graph must be wired before replacing the router).

### Phase 2 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PostgresSaver connection issues with Supabase pooler (port 6543) | MEDIUM | Graph can't persist state | Use `prepare_threshold=0`. If fails, switch to `direct_url` (port 5432) |
| `astream(stream_mode="updates")` doesn't emit expected format | MEDIUM | SSE events wrong shape | Test with minimal 2-node graph first. Fall back to `astream_events` with filtering |
| LLM structured output parsing failure (intent or doc resolver) | LOW | Node crashes mid-graph | Use `include_raw=True` during dev. Add fallback: if parse fails, use default values |
| `add_messages` reducer doesn't merge correctly with checkpoint state | MEDIUM | Messages duplicated or lost | Test message append behavior with 3-turn conversation. Verify checkpoint state in DB |
| Fuzzy matching performance with many docs (100+) | LOW | Slow doc resolver | `rapidfuzz` is C-optimized. For 100 docs, <10ms. Only an issue at 10k+ docs |
| `conversation_docs` overwritten instead of merged | HIGH | Registry resets each turn | EXCLUDED from initial_input (persists from checkpoint). format_response reads existing dict, merges new, writes full merged dict. First message defaults via `state.get()`. |
| Node returns wrong field names (typo in state key) | MEDIUM | Silent state corruption | TypedDict helps but doesn't enforce at runtime. Add logging of state updates per node |
| History endpoint returns messages in wrong order | LOW | Chat display scrambled | LangGraph maintains message order. Verify with multi-turn test |

### Phase 2 Key Decision Log

| Decision | Why | Alternative Considered |
|---|---|---|
| `stream_mode="updates"` over `astream_events` | One event per node, perfect for StatusEvents. No filtering needed. | `astream_events` — too many events, heavy filtering, complex metadata parsing |
| Sync PostgresSaver (not Async) | Simpler setup, avoids async pool lifecycle issues. LangGraph handles threading. | AsyncPostgresSaver — more complex, known issues with interrupt + Python 3.10 |
| Nodes don't interrupt in Phase 2 | Keeps every message producing a response. Testable without PalAssist UI. | Add interrupts now — but can't test without PalAssist (Phase 3) |
| `rapidfuzz` for fuzzy matching | C-optimized, 10x faster than `python-Levenshtein`, better API | `python-Levenshtein` — slower, less maintained |
| Separate stub per action (not one function) | Each becomes a graph node with its own LangSmith trace + PalReasoning status | Single stub with switch — fewer files but loses per-action observability |
| `conversation_docs` without custom reducer | format_response always reads existing, merges, writes full dict. No race condition risk in sequential graph. | Custom dict reducer — adds complexity, not needed for sequential execution |
| Chat history from checkpoints (not separate table) | Single source of truth, no sync issues. LangGraph already stores everything. | Separate `messages` table — duplicates data, requires sync logic |
| React Query for history (not useChatStream) | History is a one-time JSON fetch on mount, not a stream. Perfect for React Query. | Same SSE hook — overengineered for a single JSON response |

---
---

## Phase 3: PalAssist + Interrupt Flow

**Goal:** When resolver nodes have low/medium confidence, the graph pauses via `interrupt()` and PalAssist appears above the chat input. User picks an option or types a response → graph resumes from the pause point via SSE → PalReasoning resumes → response renders. Full interrupt lifecycle working end-to-end.

**What Phase 2 already provides:**
- Graph running with real nodes (intent_resolver, doc_resolver, validate_inputs, stubs, format_response)
- SSE pipeline (FastAPI → Next.js proxy → useChatStream → PalReasoning)
- `interruptPayload` state already declared in ChatPanel (Phase 1.7 — just not rendered)
- `onInterrupt` callback already wired in useChatStream (Phase 1.5)
- `/chat/resume` endpoint already structured (Phase 2.6 — ready for `Command(resume=value)`)
- Post-loop `__interrupt__` detection logic already scaffolded (Phase 2.6 Step 3)

**What Phase 3 adds:**
- `interrupt()` calls in 3 nodes (intent_resolver, doc_resolver, validate_inputs)
- Interrupt payload shaping (node → InterruptResponse)
- `__interrupt__` detection in SSE loop (activate the Phase 2 scaffold)
- `/chat/resume` endpoint fully working with `Command(resume=value)` + SSE
- PalAssist UI component (5 use cases)
- ChatPanel wiring: PalReasoning ↔ PalAssist transitions, resume flow, cancel flow
- Chat history display of PalAssist prompts (audit trail)

**Critical understanding — node restart on resume:**
When `interrupt()` fires and the user responds with `Command(resume=value)`, the **entire node re-executes from the beginning**. The `interrupt()` call returns the user's resume value, and the node continues. This means:
- Code BEFORE `interrupt()` runs twice (once on initial call, once on resume)
- All logic before `interrupt()` MUST be idempotent (safe to re-run)
- Side effects (LLM calls, DB writes) should happen AFTER `interrupt()` or be skipped on re-run
- For our nodes: the LLM classification already happened before interrupt → on resume, re-running the classification is wasteful. Solution: check if confidence fields are already set in state, skip LLM if so.

---

### Phase 3.1: Interrupt Payload Design (Contract Between Nodes and Frontend)

**Goal:** Define exactly what each `interrupt()` call passes as its payload and how the SSE generator transforms it into an InterruptResponse. This is the contract PalAssist depends on.

**Design: The interrupt payload is a dict with type and context:**

Every `interrupt()` call across all nodes passes a dict:
```
interrupt({
    "interrupt_type": "doc_choice" | "text_input" | "action_choice" | "retrieval_low",
    "message": "Human-readable prompt for PalAssist",
    "options": [{"id": "uuid-or-key", "label": "Display Name"}] | None
})
```

This dict maps 1:1 to InterruptResponse fields. The SSE generator in `chat.py` just wraps it:
```
InterruptResponse(type="interrupt", **interrupt_payload)
```

**Interrupt types and which node fires them:**

| interrupt_type | Fired by | When | options? |
|---|---|---|---|
| `action_choice` | intent_resolver | Multi-action detected, or low confidence after retry | Yes: `[{id: "summarize", label: "Summarize"}, {id: "audit", label: "Audit"}]` |
| `doc_choice` | doc_resolver | Medium confidence — multiple candidate docs | Yes: `[{id: "uuid-1", label: "BankNegara2024"}, {id: "uuid-2", label: "Deriv2024"}, {id: "all", label: "All of these"}]` |
| `text_input` | doc_resolver OR validate_inputs | Low confidence (no doc match) or missing required info (e.g., audit email) | No options — user types free text or tags a doc |
| `retrieval_low` | check_retrieval_conf (future) | RAG similarity < 0.5 | Yes: `[{id: "tag_docs", label: "📄 Tag specific documents"}, {id: "web_search", label: "🌐 Search the web"}, {id: "continue", label: "Continue anyway"}]` |

**Note: `retrieval_low` is NOT implemented in Phase 3.** It fires after action nodes (which are stubs). It will be added when real actions with RAG are built (Iterations 2-3). Phase 3 only implements `action_choice`, `doc_choice`, and `text_input`.

**Resume value processing — what the node does with it:**

| interrupt_type | Resume value | Node behavior on resume |
|---|---|---|
| `action_choice` | `{type: "action_choice", value: "audit"}` | Sets `state["action"] = value` and continues |
| `doc_choice` | `{type: "doc_choice", value: "uuid-1"}` | Adds UUID to `resolved_doc_ids`, sets confidence to "high" |
| `doc_choice` | `{type: "doc_choice", value: "all"}` | Uses all candidate docs |
| `text_input` | `{type: "text_input", value: "some text or @doc tag"}` | Re-processes with new info (tag new doc, provide missing text) |
| `cancel` | `{type: "cancel", value: null}` | Node returns empty/default state, graph proceeds to END gracefully |

---

### Phase 3.2: Add interrupt() to Intent Resolver

**File:** `backend/app/graph/nodes/intent_resolver.py` (MODIFY)

**Current behavior (Phase 2):** Classifies action, sets confidence, always proceeds.

**New behavior:** After classification, check for interrupt conditions:

**Condition 1 — Multi-action detected:**
- If `llm_result.multi_action_detected == True`:
  - Build options list from detected actions (e.g., `[{id: "summarize", label: "Summarize"}, {id: "audit", label: "Audit"}]`)
  - Call `interrupt({"interrupt_type": "action_choice", "message": "I can only perform one action at a time. Which would you like to do first?", "options": options})`
  - On resume: `resume_value` is the chosen action string → set `state["action"] = resume_value`

**Condition 2 — Low confidence after retry:**
- If confidence is still "low" after the 5-message retry (Step 3 in Phase 2):
  - Build options from top-2 most likely actions
  - Call `interrupt({"interrupt_type": "action_choice", "message": "I'm not sure what action you'd like. Please choose:", "options": options})`
  - On resume: same handling as multi-action

**Idempotency on resume — the re-run problem:**
- When resumed, the entire `intent_resolver` function re-runs from Step 0
- Problem: The LLM call (Step 2/3) would run again, wasting money
- Solution: At the TOP of the function, check if `state["action"]` is already set AND has a reasonable confidence:
  - If the interrupt was for multi_action or low_conf, the state already has the LLM's first-pass results
  - On re-run, detect this: "I already classified but was interrupted" → skip LLM → go straight to interrupt
  - The `interrupt()` call returns the user's choice → use it and return

**Cancel handling:**
- If resume_value is `{type: "cancel", value: null}` → the `interrupt()` returns `None`
- Node detects `None` → returns default state (action="inquire")
- Graph continues to doc_resolver → validate → stub action → format_response
- The response will be a generic fallback (acceptable for cancel)

**Test:**
- Send "Summarize and audit this document" → verify PalAssist appears with [Summarize] [Audit] buttons
- Pick "Audit" → verify graph resumes, PalReasoning shows remaining nodes, audit stub response renders
- Cancel → verify graph completes with default response

---

### Phase 3.3: Add interrupt() to Doc Resolver

**File:** `backend/app/graph/nodes/doc_resolver.py` (MODIFY)

**Current behavior (Phase 2):** Resolves docs via 3-stage pipeline, sets confidence, always proceeds.

**New behavior:** After resolution, check for interrupt conditions:

**Condition 1 — Medium confidence (multiple candidates):**
- After Stage 2 (LLM) returns multiple possible docs with `inference_confidence == "medium"`:
  - Build options from `suggested_doc_ids` (candidates): `[{id: uuid, label: title}, ..., {id: "all", label: "All of these"}]`
  - Need doc titles for labels → query from Supabase or from conversation_docs registry
  - Call `interrupt({"interrupt_type": "doc_choice", "message": "Which document would you like to [action] against?", "options": options})`
  - On resume: `resume_value` is chosen UUID → add to `resolved_doc_ids`, set confidence to "high"

**Condition 2 — Low confidence (no match after fuzzy):**
- After Stage 3 (fuzzy match) still has unresolved names AND `inference_confidence == "low"`:
  - Call `interrupt({"interrupt_type": "text_input", "message": "Please tag the document you'd like to reference.", "options": null})`
  - On resume: `resume_value` is free text or a doc UUID
    - If it looks like a UUID → add to `resolved_doc_ids`
    - If it's text → treat as a new message text, re-run doc resolution (but this gets complex — simplify: just ask user to tag with @mention, which gives a UUID)

**Idempotency on resume:**
- Same pattern as intent_resolver: check if resolution already happened
- On re-run, State already has `resolved_doc_ids` from the first pass + `inference_confidence` set
- Skip Stages 1-3, go directly to the interrupt check
- `interrupt()` returns the user's choice → merge into resolved_doc_ids and return

**Cancel handling:**
- If resume_value is `None` (user cancelled) → `interrupt()` returns `None`
- Node detects `None` → keeps whatever `resolved_doc_ids` exist from the first pass (may be empty), sets `inference_confidence = "low"`
- Graph continues to validate_inputs → stub action → format_response with minimal/no docs
- Frontend suppresses the cancel response

**"All of these" option:**
- When user picks "All of these" → resume value is `"all"`
- Node reads `suggested_doc_ids` from state → sets `resolved_doc_ids = suggested_doc_ids`

**Interaction with PalReasoning:**
- Before interrupt fires, the SSE stream already emitted StatusEvent for doc_resolver ("Finding documents...")
- The `__interrupt__` event arrives → SSE generator yields InterruptResponse
- Frontend: PalReasoning was showing "Finding documents..." → clears → PalAssist appears

**Test:**
- Send ambiguous "Audit against the regulation" (2 matching docs in registry) → PalAssist shows doc choices
- Pick one doc → graph resumes → PalReasoning shows "Validating..." → "Auditing..." → response renders
- Send "What about XYZ?" (no match) → PalAssist shows "Please tag the document" text input
- Cancel → graph completes with default response

---

### Phase 3.4: Add interrupt() to Validate Inputs

**File:** `backend/app/graph/nodes/validate_inputs.py` (MODIFY)

**Current behavior (Phase 2):** Checks requirements, logs warnings, always proceeds.

**New behavior:** When requirements are missing, interrupt instead of proceeding:

**Condition 1 — Compare with < 2 docs:**
- `interrupt({"interrupt_type": "text_input", "message": "Compare requires at least 2 documents. Please tag the additional document.", "options": null})`
- On resume: user provides another doc UUID → add to `resolved_doc_ids`

**Condition 2 — Audit with no source text:**
- If action == "audit" and message has no substantial text (just mentions, no email/policy text):
  - `interrupt({"interrupt_type": "text_input", "message": "Please enter the text you'd like to audit (e.g., an email or policy excerpt).", "options": null})`
  - On resume: user provides text → append to messages or set as source_text in state

**Condition 3 — Summarize with 0 docs:**
- `interrupt({"interrupt_type": "text_input", "message": "Please tag the document you'd like to summarize.", "options": null})`
- On resume: user tags a doc → add to resolved_doc_ids

**Note: validate_inputs is pure Python — no LLM calls.** Re-running on resume is free. No idempotency concerns.

**Cancel handling:**
- If resume_value is `None` (user cancelled) → `interrupt()` returns `None`
- Node proceeds with whatever state exists — missing docs/text remain missing
- Graph continues to stub action → format_response with incomplete data
- Stub action returns a generic "missing information" response
- Frontend suppresses the cancel response (not shown in chat)

**Test:**
- Send "@Compare @Doc1" (only 1 doc) → PalAssist: "Compare requires at least 2 documents"
- Tag @Doc2 → graph resumes → compare stub response
- Send "@Audit @Doc1" (no email text) → PalAssist: "Please enter the text you'd like to audit"

---

### Phase 3.5: SSE Interrupt Detection + Resume Endpoint (Backend)

**Goal:** Activate the `__interrupt__` detection in the SSE generator (Phase 2 scaffolded this) and make the `/chat/resume` endpoint fully functional with SSE.

**File:** `backend/app/routers/chat.py` (MODIFY)

**Activating interrupt detection in the SSE loop:**

The Phase 2 SSE generator loops over `graph.astream(stream_mode="updates")`. When `interrupt()` fires inside a node, the stream yields a chunk containing `"__interrupt__"` key. The Phase 2 plan noted "post-loop detection" but with the new research, we know interrupts appear IN the stream.

Update the SSE loop:
- BEFORE the `for node_name, updates in chunk.items()` inner loop, add a top-level check on the chunk:
  - `if "__interrupt__" in chunk` → this chunk IS the interrupt signal, not a node update
  - Extract payload: `chunk["__interrupt__"][0].value` → this is the dict we passed to `interrupt()`
  - Shape into InterruptResponse: `InterruptResponse(type="interrupt", **payload)`
  - Yield as SSE event → return (end stream)
  - Skip the inner loop entirely — `__interrupt__` is not a node name
- If `__interrupt__` is NOT in chunk → proceed with the normal `for node_name, updates` loop

**Ordering: StatusEvent THEN InterruptResponse:**
- When doc_resolver calls `interrupt()`, the stream may yield the doc_resolver's StatusEvent first (from the node starting), then the `__interrupt__` event
- Actually — when a node calls `interrupt()`, the node hasn't "completed" — it paused. So `stream_mode="updates"` may NOT yield a node update for the interrupted node
- This means: if doc_resolver interrupts, the StatusEvent for doc_resolver may or may not appear depending on whether updates were committed before interrupt
- Safe approach: the status event for the PREVIOUS completed node was already emitted. The interrupting node's status might not appear. This is fine — PalReasoning was already showing the previous status ("Clarifying intent..."), and now PalAssist replaces it

**The `/chat/resume` endpoint — fully functional:**
- Receives ResumeRequest (thread_id + resume_value)
- Calls `graph.astream(Command(resume=resume_value.model_dump()), config, stream_mode="updates")`
- Same SSE generator logic as `/chat` — emits StatusEvents for remaining nodes → ChatResponse at the end
- PalReasoning picks up from the interrupted node and continues

**Resume SSE flow example (doc_resolver interrupted, user picks a doc):**
```
POST /chat/resume { thread_id: "abc", resume_value: { type: "doc_choice", value: "uuid-1" } }

SSE stream:
  → data: { type: "status", node: "doc_resolver", message: "Finding documents...", docs_found: [...] }  ← node re-runs, now with user's choice
  → data: { type: "status", node: "validate_inputs", message: "Validating request..." }
  → data: { type: "status", node: "audit", message: "Auditing against regulations..." }
  → data: { type: "status", node: "format_response", message: "Formatting response..." }
  → data: { type: "response", response: "...", ... }
```

**Cancel handling in resume:**
- If `resume_value.type == "cancel"`:
  - Pass `Command(resume=None)` → node receives `None` from `interrupt()`, returns default/minimal state, graph continues to END
  - This is MANDATORY — not optional. An interrupted graph waits indefinitely; abandoning without resuming leaves the thread permanently stuck.
  - Frontend suppresses the cancel response (does not add to chat messages)

**Error handling:**
- If `thread_id` has no pending interrupt (user tries to resume a non-interrupted graph) → return 400 error
- Check `state.tasks` before resuming → if no tasks with interrupts → "No pending action to resume"

**Test:**
- Trigger interrupt → verify InterruptResponse SSE event arrives
- Resume with doc_choice → verify remaining nodes emit StatusEvents → response arrives
- Cancel → verify graph completes gracefully
- Try to resume a non-interrupted thread → verify 400 error

---

### Phase 3.6: PalAssist UI Component

**Goal:** Build the PalAssist component that renders above the chat input when an interrupt is active. Supports 4 use cases: doc choice, action choice, text input, and retrieval low.

**File:** `components/chat/pal-assist.tsx` (NEW)

**Props:**
- `interrupt: InterruptResponse` — the interrupt payload from the SSE stream
- `onRespond: (resumeValue: ResumeValue) => void` — callback when user picks an option or submits text
- `onCancel: () => void` — callback when user clicks Cancel
- `disabled: boolean` — true while resume stream is active (prevent double-submit)

**Component renders based on `interrupt.interrupt_type`:**

**1. `action_choice` — Button options:**
- Message text from `interrupt.message`
- Row of `Button` components for each option in `interrupt.options`
- Each button: glassmorphism style, shows `option.label`
- Click → calls `onRespond({ type: "action_choice", value: option.id })`
- Cancel button at the end

**2. `doc_choice` — Button options with doc pills:**
- Same structure as action_choice but doc-styled
- Each option shows as a doc pill (small glassmorphism card with doc icon + title)
- "All of these" option styled differently (secondary button)
- Click → calls `onRespond({ type: "doc_choice", value: option.id })`

**3. `text_input` — Free text or @mention:**
- Message text from `interrupt.message`
- The regular ChatInput below PalAssist stays enabled — user types there
- PalAssist just shows the prompt + Cancel button
- When user submits via ChatInput → ChatPanel intercepts: if PalAssist is active, route to resume instead of new message
- The submitted text/mentions become the resume value: `onRespond({ type: "text_input", value: extractedText })`

**4. `retrieval_low` — Multiple action buttons (future):**
- "Tag specific documents" → dismiss PalAssist, focus ChatInput with @mention mode
- "Search the web" → `onRespond({ type: "retrieval_low", value: "web_search" })`
- "Continue anyway" → `onRespond({ type: "retrieval_low", value: "continue" })`
- Not implemented in Phase 3 (stub actions don't have real retrieval). Structure the component to support it.

**Styling (from design-documentation.mdc):**
- Position: above the ChatInput, inside the chat panel
- Background: glassmorphism card (`.glass-card-light` or similar)
- Icon: 🤖 or a Sparkles icon with "PalAssist" label
- Buttons: rounded, primary blue for main options, secondary for Cancel
- Animation: slide-up on appear, fade-out on dismiss (Framer Motion or CSS transition)
- Width: matches chat input width (not full-width)

**Accessibility:**
- Cancel button always visible and keyboard-accessible
- Options should be focusable with Tab key
- Enter on focused option = click

**Test:**
- Render with `action_choice` interrupt → verify buttons show
- Click an option → verify `onRespond` called with correct value
- Render with `doc_choice` → verify doc pills show
- Render with `text_input` → verify prompt text and Cancel visible
- Click Cancel → verify `onCancel` called

---

### Phase 3.7: ChatPanel Wiring (PalAssist + Resume + Transitions)

**Goal:** Wire PalAssist into ChatPanel. Handle the full lifecycle: interrupt arrives → PalAssist appears → user responds → PalReasoning resumes → response renders. Also handle cancel and the PalReasoning ↔ PalAssist transition.

**File:** `components/dashboard/chat-panel.tsx` (MODIFY)

**State changes:**
- `interruptPayload` already exists from Phase 1.7 — now it gets RENDERED
- Add: `isResuming: boolean` — true while the resume SSE stream is active (used to disable PalAssist buttons)

**The full interrupt lifecycle in ChatPanel:**

**Step 1 — Interrupt arrives (from `onInterrupt` callback):**
- `useChatStream.onInterrupt` fires with InterruptResponse
- ChatPanel: `setInterruptPayload(interruptResponse)`
- PalReasoning was showing a status → `isStreaming` goes false → PalReasoning clears
- PalAssist renders because `interruptPayload !== null`
- Visual: PalReasoning shimmer disappears → PalAssist slides up above chat input

**Step 2 — User responds (clicks option):**
- PalAssist calls `onRespond(resumeValue)`
- ChatPanel handler:
  a. `setIsResuming(true)` — disable PalAssist buttons (prevent double-click)
  b. `setInterruptPayload(null)` — hide PalAssist
  c. Call `chatStream.resumeGraph(conversationId, resumeValue)`
  d. PalReasoning reappears (isStreaming goes true) — shows remaining node statuses
  e. On `onResponse`: add AI message to local state, `setIsResuming(false)`
  f. On `onInterrupt` (nested interrupt): set new interruptPayload (PalAssist reappears with new prompt)
  g. On `onError`: show toast, `setIsResuming(false)`

**Step 3 — User cancels:**
- PalAssist calls `onCancel()`
- ChatPanel handler:
  a. `setInterruptPayload(null)` — hide PalAssist
  b. Set `isCancellingRef.current = true` — flag to suppress the cancel response
  c. Call `chatStream.resumeGraph(conversationId, { type: "cancel", value: null })`
  d. Backend receives cancel → `Command(resume=None)` → node receives `None` from `interrupt()` → returns default/minimal state → graph continues to END → checkpoint is clean
  e. `onResponse` callback fires → checks `isCancellingRef.current` → skips adding AI message to chat (suppressed)
  f. `setIsCancellingRef.current = false` after stream ends
  g. **Why we MUST resume (not abandon):** An interrupted graph waits indefinitely at the `interrupt()` call. If we just clear the UI without resuming, the thread's checkpoint is stuck at the interrupt. The next user message on this thread would hit the old interrupt again instead of starting a fresh run. Resuming with `None` lets the graph complete cleanly, leaving a valid checkpoint at END.
  h. User sees: PalAssist disappears → brief pause (graph completing in background) → ready for next message

**Step 4 — User types while PalAssist is active (only possible for `text_input`):**
- ChatInput is disabled for `doc_choice` and `action_choice` interrupts (Step 2 buttons only)
- ChatInput stays enabled ONLY for `text_input` interrupts (user needs to type their response)
- When user submits while `interruptPayload.interrupt_type === "text_input"`:
  - Treat as resume: extract text/mentions → `onRespond({ type: "text_input", value: text })`
  - This is NOT a new message — it's the user's response to the interrupt
- No "new message during option-based interrupt" scenario exists because ChatInput is disabled for those types

**PalAssist in chat history (audit trail):**
- When PalAssist was active and user responded, the PalAssist prompt should be visible in the conversation history
- Implementation: when interrupt arrives, add a special message to local state:
  `{ id: uuid, role: "system", text: interrupt.message, type: "pal_assist_prompt" }`
- Render as small, muted text (not a full bubble) — like a system notice
- When user responds, their response appears as a normal user message below the PalAssist prompt
- This creates a readable audit trail: "PalAssist asked → User chose → AI responded"

**Chat history loading with interrupts:**
- If user refreshes while an interrupt was active:
  - `useChatHistory` loads messages from checkpoint → renders conversation up to the interrupt point
  - Check `graph.get_state(config).tasks` → if pending interrupt exists → restore PalAssist
  - This requires the history endpoint to also return interrupt status
  - Update the GET `/chat/history/{thread_id}` response: add `pending_interrupt: InterruptResponse | null`
  - ChatPanel: on history load, if `pending_interrupt` → set `interruptPayload`

**Disable ChatInput during PalAssist for option-based interrupts:**
- For `doc_choice` and `action_choice` → user should click an option, not type
- Disable ChatInput (or show a hint: "Please select an option above")
- For `text_input` → ChatInput stays enabled (user needs to type)
- Logic: `disabled = interruptPayload && interruptPayload.interrupt_type !== "text_input"`

**Test (the critical end-to-end flow):**
1. Send ambiguous message → PalReasoning shows "Clarifying intent..." → "Finding documents..." → interrupt fires → PalReasoning clears → PalAssist slides up with doc options
2. Click a doc option → PalAssist disappears → PalReasoning resumes ("Validating..." → "Auditing...") → AI response renders
3. Trigger multi-action → PalAssist shows action buttons → pick one → graph completes
4. Trigger text_input → type in ChatInput → submit → graph resumes
5. Cancel → PalAssist disappears → graph resumes with None in background → cancel response suppressed → next message starts fresh
6. Refresh while interrupt is active → PalAssist restores from checkpoint
7. Nested interrupt (rare: doc_resolver interrupts, user responds, validate_inputs interrupts again) → PalAssist shows new prompt
8. Cancel → immediately send new message → verify cancel completes first, then new message processes (no race condition)

---

### Phase 3.8: Chat History Endpoint Update (Pending Interrupt)

**Goal:** When loading chat history, also return any pending interrupt so PalAssist can restore on page refresh.

**File:** `backend/app/routers/chat.py` (MODIFY — update GET /chat/history/{thread_id})

**Change to history response:**
- After loading state via `graph.get_state(config)`:
  - Check `state.tasks` for pending interrupts
  - If interrupt exists: extract payload → include as `pending_interrupt` in response
  - If no interrupt: `pending_interrupt: null`

**Response shape update:**
```
{
  thread_id: string,
  messages: [...],
  pending_interrupt: InterruptResponse | null    ← NEW
}
```

**File:** `hooks/queries/use-chat-history.ts` (MODIFY)
- Update return type to include `pending_interrupt`

**File:** `components/dashboard/chat-panel.tsx` (MODIFY)
- On history load: if `history.data.pending_interrupt` → `setInterruptPayload(history.data.pending_interrupt)`

**Test:**
- Trigger interrupt → don't respond → refresh page → PalAssist reappears with same prompt
- Respond to interrupt → refresh → no PalAssist (interrupt cleared)

---

### Phase 3 File Summary

```
NEW files:
  components/chat/pal-assist.tsx                 ← PalAssist UI component (3.6)

MODIFIED files:
  backend/app/graph/nodes/intent_resolver.py     ← Add interrupt() for multi-action + low conf (3.2)
  backend/app/graph/nodes/doc_resolver.py        ← Add interrupt() for medium + low conf (3.3)
  backend/app/graph/nodes/validate_inputs.py     ← Add interrupt() for missing requirements (3.4)
  backend/app/routers/chat.py                    ← Activate __interrupt__ SSE detection + resume endpoint (3.5)
  components/dashboard/chat-panel.tsx             ← Wire PalAssist + resume + transitions (3.7)
  backend/app/routers/chat.py                    ← History endpoint returns pending_interrupt (3.8)
  hooks/queries/use-chat-history.ts              ← Return type update for pending_interrupt (3.8)
  lib/types/chat.ts                              ← Update history response type (3.8)
```

### Phase 3 Build Order

```
3.1 Interrupt payload design    → define the contract (dict shape) all nodes use
3.2 Intent resolver interrupt   → first interrupt implementation (simplest: button choice)
3.3 Doc resolver interrupt      → most complex interrupt (3 confidence tiers)
3.4 Validate inputs interrupt   → simplest interrupt (missing requirements)
  ↓
3.5 SSE interrupt detection + resume endpoint → backend handles interrupt SSE + resume
  ↓
3.6 PalAssist component        → UI for all interrupt types
3.7 ChatPanel wiring           → full lifecycle (interrupt → PalAssist → resume → PalReasoning → response)
3.8 History endpoint update    → restore PalAssist on page refresh
```

**3.2-3.4 can be built in parallel** (each node is independent). **3.5 must come before 3.6-3.7** (backend must handle interrupts before frontend renders them). **3.8 is optional polish** (can defer if behind schedule — PalAssist just won't restore on refresh).

### Phase 3 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Node re-run on resume wastes LLM call | HIGH | Double cost per interrupted message | Check if classification already done in state → skip LLM on re-run |
| `__interrupt__` chunk format different from expected | MEDIUM | SSE generator doesn't detect interrupt | Test with minimal graph + single interrupt() first. Log raw chunks. |
| PalAssist ↔ ChatInput conflict for text_input | MEDIUM | User types but submit goes to wrong handler | Explicit check: if `interruptPayload` is text_input, route submit to resume |
| Cancel leaves stuck checkpoint if abandoned | HIGH | Thread permanently stuck at interrupt — next message re-triggers old interrupt | Cancel MUST resume with `Command(resume=None)`. Node receives None → returns defaults → graph reaches END → clean checkpoint. Never abandon without resuming. |
| Nested interrupts (interrupt after resume) | LOW | PalAssist flickers or shows wrong prompt | Each interrupt is independent. New interrupt payload replaces old. Test with validate_inputs interrupting after doc_resolver resume. |
| Resume SSE stream doesn't emit status for resumed node | MEDIUM | PalReasoning skips a step visually | The resumed node re-runs → it should appear in stream_mode="updates". Test explicitly. |
| Chat history restore of interrupt on refresh | MEDIUM | PalAssist doesn't appear after refresh | Requires history endpoint to check state.tasks. Test interrupt → refresh → PalAssist cycle. |

### Phase 3 Key Decision Log

| Decision | Why | Alternative Considered |
|---|---|---|
| Cancel = always resume with `Command(resume=None)` | LangGraph interrupted graphs wait indefinitely. Abandoning leaves thread stuck — next message re-triggers old interrupt. Resuming with None lets nodes return defaults, graph reaches END, clean checkpoint. Frontend suppresses the cancel response (not shown in chat). | Abandon without resuming → simpler frontend but thread stuck permanently. REJECTED — fundamentally broken. |
| Interrupt payload is a plain dict (not typed class) | `interrupt()` requires JSON-serializable. Dict maps 1:1 to InterruptResponse. No translation layer needed. | Typed InterruptPayload class → requires serialization/deserialization inside nodes. Over-engineering. |
| Re-run skip via state check (not checkpoint metadata) | Nodes check existing state to know if LLM already ran: intent_resolver checks `state["action"]`, doc_resolver checks `state["resolved_doc_ids"]`. Simple and works. | Store "interrupted_at" in state → more explicit but adds a field solely for plumbing. |
| text_input uses ChatInput (not PalAssist inline input) | ChatInput already has TipTap + @mentions. Reuse, don't duplicate. | Inline text field in PalAssist → loses @mention support, duplicates input logic. |
| PalAssist prompt shown in chat history as system message | Audit trail: user can see what PalAssist asked. Important for compliance officers. | Don't show → cleaner UI but loses context. Compliance users need traceability. |
| History endpoint returns pending_interrupt | Enables PalAssist restore on refresh. Without it, user loses the interrupt context. | Separate endpoint for interrupt status → extra API call, unnecessary complexity. |
