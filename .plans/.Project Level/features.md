# PolicyPal - Feature Specification

High-level summary and architecture decisions.

---

## Stack (Locked)


| Layer                 | Decision                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| **Frontend**          | Next.js + React + Shadcn + React Query + Zod + **TipTap**                         |
| **Backend**           | Python + FastAPI                                                                  |
| **Orchestration**     | LangGraph                                                                         |
| **Observability**     | LangSmith (mandatory)                                                             |
| **LLM**               | **GPT-4o + GPT-4o-mini** (hybrid: high-stakes = 4o, routine = 4o-mini)            |
| **Model Selection**   | LLM service abstraction (action-based routing)                                    |
| **Embeddings**        | text-embedding-3-small ($0.02/1M tokens)                                          |
| **Vector DB**         | Supabase pgvector                                                                 |
| **Auth & data**       | Supabase (Auth, Postgres, pgvector, Storage)                                      |
| **Hosting**           | Vercel (Next.js), Render (FastAPI)                                                |
| **Web search**        | Tavily (1k free/month)                                                            |
| **Security**          | Next.js API routes proxy; backend never exposed                                   |
| **Isolation**         | Per-user; all chunks/queries scoped by `user_id` (data isolation maintained)      |
| **Document sets**     | Custom-defined sets with dropdown autocomplete (e.g., "Bank Negara", "ISO 27001") |
| **Memory**            | PostgresSaver (persistent, survives restarts/refreshes)                           |
| **Streaming**         | SSE (PalReasoning: node-by-node status events, NOT token streaming)               |
| **@ Mentions**        | TipTap rich text editor with Mention extension (Cursor-style autocomplete)        |
| **Multi-doc support** | 1-5 documents per action (batch retrieval, per-doc findings)                      |


### Cost Summary (16-Day Testing)

- **GPT-4o + 4o-mini (hybrid):** ~$5–7 (250 queries: 30% high-stakes 4o, 70% routine 4o-mini)
- **Embeddings:** ~$0.01 (10 docs + 250 queries)
- **Tavily:** $0 (under 1k free tier)
- **Total:** ~$7–9 of $20–30 budget

**Cost Breakdown by Model:**

- High-stakes (GPT-4o): Audit, Compare-holistic → ~$0.08-0.09/query (75 queries = $6-7)
- Routine (GPT-4o-mini): Summarize, Inquire, Compare-focused → ~$0.004-0.006/query (175 queries = $0.70-1.05)
- Mixed workload: 60% cost reduction vs all-GPT-4o

**Cost Optimizations:**

- Concise system prompts (20% savings)
- Top 3 chunks per document (balance context vs cost)
- **Prompt caching:** Static system prompt prefix with user context at start → OpenAI caches (10–15% savings)
- **Multi-doc batching:** Single audit against 5 docs = $0.12 vs 5 separate audits = $0.25 (54% savings)
- **Context resolution scope:** Only looks at current conversation (not all user docs) → fast, cheap inference
- **Hybrid model selection:** GPT-4o-mini for routine tasks (94% cheaper), GPT-4o for compliance-critical (60% overall savings)

---

## App Layout (Locked)

### Public Pages

- **Landing page** (`/`) — Navbar + Hero + Features + CTA + Footer. Navbar shows UserMenu pill if authenticated (with "Go to Dashboard" CTA in hero).
- **Auth pages** (`/auth/`*) — Split-screen: left branding panel + right glass card form.
- **Onboarding** (`/onboarding`) — Animated welcome + glass form (Company Name, Country, Industry, Description). Gates dashboard access.

### Dashboard (`/dashboard`) — 3-Panel Layout (full viewport, `h-screen`)

```
┌─────────────┬──────────────────────┬────────────┐
│  Left Panel │     Chat Panel       │  Sources   │
│  (320px)    │     (fluid)          │  (300px)   │
│             │                      │ collapsible│
│ [Chats|Docs]│  Chat Name    Brand  │            │
│  tab toggle │                      │ Documents  │
│             │  Messages area       │ Web        │
│  List of    │  (citations,         │            │
│  items      │   confidence)        │ Citation   │
│             │                      │ excerpts   │
│             │  ┌────────────────┐  │            │
│             │  │ TipTap @input  │  │    [x]     │
│ [UserInfo]  │  └────────────────┘  │            │
└─────────────┴──────────────────────┴────────────┘
```

**Left Panel** — Tabbed (Chats / Documents):

- Tab bar at top toggles between conversation list and document library
- Plus button: creates new chat (Chats tab) or opens upload modal (Documents tab)
- UserInfoBar at bottom: initials avatar, user name, settings icon

**Chat Panel** — Center (fluid width):

- Header: conversation title (left) + "PolicyPal" branding (right)
- Messages area: user/AI messages with inline citation icons + confidence badges
- Input: TipTap rich text editor with @ mention autocomplete (Actions, Sets, Documents, Web)

**Sources Panel** — Right (collapsible):

- Shows document citations and web sources used in current chat
- Citation click in chat → loads relevant excerpts vertically (scrollable)
- Collapse: animates right, leaves glass peek strip with rotating outline
- Auto-opens when user clicks a citation icon in chat

### Component References (for AI context)


| Name             | Path                                        | Description                             |
| ---------------- | ------------------------------------------- | --------------------------------------- |
| `LeftPanel`      | `components/dashboard/left-panel.tsx`       | Tabbed Chats/Documents with user footer |
| `ChatPanel`      | `components/dashboard/chat-panel.tsx`       | Messages + TipTap input                 |
| `SourcesPanel`   | `components/dashboard/sources-panel.tsx`    | Collapsible citations panel             |
| `DashboardShell` | `components/dashboard/dashboard-shell.tsx`  | 3-panel layout + shared state           |
| `UserInfoBar`    | `components/dashboard/user-info-bar.tsx`    | Bottom bar in left panel                |
| `UserMenu`       | `components/shared/user-menu.tsx`           | Navbar pill (landing page)              |
| `SearchSelect`   | `components/shared/search-select.tsx`       | Reusable combobox with search           |
| `OnboardingForm` | `components/onboarding/onboarding-form.tsx` | Animated onboarding flow                |


---

## Features (Locked)

### 1. Auth & User Profile

- **Signup flow:** User signs up (Supabase Auth) → generates `user_id`
- **User profile (optional):** Industry/sector, location (stored on user record for agent context)
- **Purpose:** Lightweight context for web search, policy relevance, agent responses (e.g., "User in Malaysian banking")
- **Architecture:** All data scoped by `user_id` from Day 1 (simple, single-user MVP)

### 2. Document Management

- **Upload:** PDFs → Supabase Storage (organized by `user_id`)
- **Required metadata:**
  - **Title:** User-defined (e.g., "Bank Negara Capital Guidelines")
  - **Version/Year:** Text field (e.g., "2024", "Q1 2025")
  - **Doc Type:** Dropdown - "Company Policy" (internal) or "Regulatory Source" (governing body)
- **Optional metadata:**
  - **Set:** Custom-defined with dropdown autocomplete (e.g., "Bank Negara", "ISO 27001", "Internal")
    - First upload: User types new set name (creates it) + selects color from 6-8 presets
    - Future uploads: Existing sets appear in dropdown (reusable, prevents typos)
    - No set = "global" (searchable across all docs)
- **Color coding (UI polish):**
  - **Doc type colors (fixed):** Gold accent = Regulatory Source, Green accent = Company Policy (side color/shadow)
  - **Set colors (user-defined):** User selects from preset palette on set creation → applied to all docs in that set
  - **Purpose:** Quick visual scanning in document lists (compliance officers manage 50+ docs)
- **Document library UI:**
  - Group by Set in sidebar/list view
  - Display format: "Title (Version)" (e.g., "Capital Guidelines (2024)")
  - Color-coded cards with set color + doc type accent
- **Public demo PDF:** Pre-loaded for try-before-upload (not tied to any user)

### 3. SmartIngest (RAG)

- **Processing:** PyPDFLoader + RecursiveCharacterTextSplitter → chunks in pgvector
- **Chunk parameters:** 1000 chars, 150 overlap (optimized for policy paragraph-length context)
- **Metadata per chunk:**
  - `user_id` (scoping), `title`, `version`, `doc_type`, `set` (optional)
  - `source` (filename), `page`, `chunk_id` (for citations)
  - **Note:** Line extraction from PDFs tested in implementation; fallback to chunk_id if needed
- **Embeddings:** text-embedding-3-small (batch embed for speed)
- **Citations format:** (source_type icon, title, page/URL, exact 2-3 sentence quote extracted by LLM)
- **Storage:** Raw PDFs in Supabase Storage; chunks + embeddings in pgvector

### 4. Agent (One LangGraph, 4 Actions)

**Actions:**

1. **Summarize:** Reads 1-5 docs, optionally searches web, considers user context → general + context-specific summary
2. **Inquire:** Q&A across 1-5 docs; retrieves, optionally searches web, evaluates, answers or asks for clarification
3. **Compare:** Compares 2-5 policy versions/documents, shows changes, maps to user's current policy for update needs
4. **Audit:** Audits user's policy/text against 1-5 regulatory sources simultaneously, flags violations per-source with severity + business context

**Multi-Document Support (All Actions):**

- **Min:** 1 document required per action
- If the user doesn't tag the docuemnt, we should infer what document they are referring to from past chat context and their message. 
  Ex: 
  Msg 1: Compare @doc1 and @Doc2
  Msg 2: Now audit this email against those two docs (we can infer here user is referring to doc1 and doc2)
- **Max:** 5 documents per action (balance between utility and context window)
- **Why 5?** Real-world compliance rarely checks >5 sources simultaneously. Beyond that, findings get overwhelming.
- **Cost benefit:** Single audit against 5 docs = $0.12 vs 5 separate audits = $0.25 (54% savings)
- **Token budget:** 5 docs × 3 chunks × 1000 tokens = 15k tokens (well under GPT-4o's 128k limit)**Action Details & Retrieval Strategies:**

---

**1. Summarize**

**Retrieval Strategy: Adaptive Stratified Sampling**

```
Input: 1-5 documents
    ↓
Step 1: Analyze document size (per doc)
    - Count total chunks per document
    - Calculate retrieval target per doc
    ↓
Step 2: Adaptive chunk selection (percentage-based with bounds)
    - Formula: chunks_to_retrieve = N × 15-20%
    - Min bound: 10 chunks (ensures minimum context)
    - Max bound: 30 chunks (token budget limit)
    - Examples:
      • 20-chunk doc → 10 chunks (hit min)
      • 100-chunk doc → 18 chunks (15-20%)
      • 500-chunk doc → 30 chunks (hit max)
    ↓
Step 3: Stratified sampling (diverse coverage)
    - Divide doc into equal segments
    - Sample chunks evenly across segments (beginning/middle/end)
    - Avoids clustering in one section
    ↓
Step 4: LLM summarization
    - Input: Doc metadata + stratified chunks
    - Output: Key points, rules, requirements
    - Multi-doc: Per-doc sections with attribution
```

**Why this strategy:**

- ✅ Scales with document size (tiny vs massive policies)
- ✅ Diverse coverage (not just similar sections)
- ✅ No page-number assumptions (PDFs vary)
- ✅ Token-efficient (bounded by max 30 chunks)

**Output format:**

- Single doc: Consolidated summary with key takeaways
- Multi-doc: Per-doc sections ("Bank Negara requires...", "FSA states...")
- Citations: Chunk references for verification

**v1.1 Enhancement:** Similarity threshold cutoff (Adaptive-k) for 60% token reduction

**Model:** GPT-4o-mini (extraction task, RAG provides context)

---

**2. Inquire**

**Retrieval Strategy: Targeted Semantic Search (Adaptive-k)**

```
Input: User question + 0-5 documents (optional)
    ↓
Step 1: Determine search scope
    - Docs tagged? → Search within those specific docs
    - No docs? → Search all user's docs OR trigger web search (if temporal keywords)
    ↓
Step 2: Adaptive retrieval (similarity threshold)
    - Retrieve chunks until similarity drops < 0.6 (Adaptive-k)
    - Per-doc limit: 3-5 chunks per document (multi-doc balance)
    - Total limit: 15 chunks max (token budget)
    - Single-pass operation (no iterative retrieval)
    ↓
    Step 3: Web search (conditional — if enable_web_search = True in state)
    - Flag already set upstream by intent_resolver (keyword scan + LLM detection)
    - "No docs tagged + general question" also triggers web search here (Inquire-specific)
    - Action node generates web_search_query with full context (resolved docs + user profile)
    - Calls Tavily → sets web_search_results in state
    - Combine doc chunks + web results for generation
    ↓
Step 4: Calculate confidence (avg similarity score)
    - > 0.75: High → Generate answer with ✅
    - 0.5-0.75: Medium → Generate with ⚠️ caution flag
    - < 0.5: Low → Offer options before generating
    ↓
If LOW confidence:
    Stop and ask user:
    "I couldn't find strong matches. Would you like me to:
     [🌐 Search the web] [📄 Tag specific documents] [Continue anyway]"
    → Wait for user choice → Execute
    ↓
If MEDIUM/HIGH:
    - Generate answer with citations
    - Multi-doc: Attribute each fact to source doc
    - Show confidence badge + cost
```

**Why this strategy:**

- ✅ Single-pass retrieval (fast, cost-efficient)
- ✅ Adaptive-k stops at natural relevance boundary (no arbitrary 3→6→9)
- ✅ Multi-doc aware (3-5 chunks per doc, not total)
- ✅ Web search as automated fallback (before asking user)
- ✅ Fast path for 80% of queries (high confidence = direct answer)

**Output format:**

- Direct answer with inline citations (📄 or 🌐)
- Multi-doc: Clear attribution ("Bank Negara states...", "FSA requires...")
- Confidence badge visible to user

**v1.1 Enhancement:** Query expansion for better recall

**Model:** GPT-4o-mini (targeted Q&A, high-relevance chunks)

---

**3. Compare**

**Retrieval Strategy: Semantic Theme-Based Comparison**

Supports two comparison modes:

**Mode 1: Holistic Comparison** (full document analysis)

```
Input: 2-5 documents
    ↓
Step 1: Retrieve broad context (per doc)
    - Stratified sampling: 15-20 chunks per doc
    - Ensures diverse coverage across each document
    ↓
Step 2: Theme extraction (1 LLM call)
    - Auto-detect 3-5 common themes across docs
    - Example themes: "Capital requirements", "Reporting", "Penalties"
    - Semantic clustering (not section-based)
    ↓
Step 3: Cross-theme analysis
    - For each theme:
      • How do docs differ?
      • What's similar?
      • What's unique to each doc?
    ↓
Step 4: Generate comparison report
    - Overview: Purpose of each doc
    - Key differences: Cross-document synthesis
    - Key similarities: Common ground
    - Unique aspects: What each doc covers alone
    - Implications: What it means for user (context-aware)
```

**Mode 2: Focused Comparison** (specific aspect)

```
Input: 2-5 documents + focus topic
Example: "Compare capital requirements between these docs"
    ↓
Step 1: Targeted retrieval (per doc)
    - Semantic search on focus topic
    - 3-5 chunks per doc (high similarity)
    - Same as Inquire retrieval strategy
    ↓
Step 2: Single-theme analysis
    - Extract specific values/rules per doc
    - Identify differences
    ↓
Step 3: Generate difference table
    - Doc1: 8% capital requirement
    - Doc2: 10% capital requirement
    - Doc3: Exempt if revenue < $1M
```

**Why theme-based (not section-based):**

- ✅ Handles different doc structures (sections vary widely)
- ✅ Semantic clustering finds comparable topics automatically
- ✅ Focuses on content, not formatting
- ✅ Groups related info even if in different sections

**Output format:**

- Holistic: 5-section report (overview, diffs, similarities, unique, implications)
- Focused: Difference table with clear per-doc breakdown
- Both include citations for verification

**Key difference from Inquire:**

- Same retrieval (focused mode), different output format
- Inquire: Unified synthesis answer
- Compare: Difference table/contrast view

**v1.1 Enhancement:** Visual diff highlighting, side-by-side view

**Model Selection:**

- Holistic comparison: **GPT-4o** (multi-theme synthesis, business implications require full reasoning)
- Focused comparison: **GPT-4o-mini** (simple difference table, targeted retrieval)

---

**4. Audit**

**Retrieval Strategy: Dual-Mode Hybrid Approach**

Supports two audit modes based on source type:

**Mode 1: Text vs Reg Docs** (short source)

```
Input: Email/marketing text (< 1000 words) + 1-5 target docs
Example: "Audit this email against @BankNegara and @FSA"
    ↓
Step 1: Direct semantic search
    - Embed full source text (short enough)
    - Search against all target docs
    - 3-5 chunks per target (high similarity)
    - Total: 15-25 chunks
    ↓
Step 2: Audit analysis (1 LLM call)
    - Input: Source text + target chunks
    - LLM identifies claims + checks violations
    - Output: Per-target findings (structured)
    ↓
Cost: ~$0.20-0.30 per audit
```

**Mode 2: Policy vs Reg Docs** (long source)

```
Input: Company policy (10-50 pages) + 1-5 target docs
Example: "Audit @OurPolicy against @BankNegara2024 and @FSA"
    ↓
Step 1: Source stratified sampling
    - 10 representative chunks from company policy
    - Diverse coverage (not just beginning)
    ↓
Step 2: Theme extraction (1 lightweight LLM call)
    - Input: 10 sampled chunks
    - Output: 3-5 key themes
    - Example: ["Capital allocation", "Reporting", "Dividends"]
    - Cost: ~$0.02-0.03
    ↓
Step 3: Per-theme retrieval (parallel)
    - For EACH theme:
      • Semantic search against all targets
      • 2-3 chunks per target per theme
    - Example: 5 themes × 2 targets × 2 chunks = 20 target chunks
    - Total: 10 source + 20 target = 30 chunks
    ↓
Step 4: Audit analysis (1 LLM call)
    - Input: Source chunks + target chunks (grouped by theme)
    - LLM cross-references per theme, per target
    - Output: Per-target findings with theme attribution
    ↓
Cost: ~$0.35-0.40 per audit
```

**Why dual-mode:**

- ✅ Short sources don't need theme extraction (saves cost + complexity)
- ✅ Long sources need per-theme retrieval (prevents bias to first topic)
- ✅ Balanced coverage across all source themes vs all targets
- ✅ Fixed approach for MVP (no adaptive complexity)

**Structured output (per-target findings):**

```json
{ 
  overall_status: "Compliant" | "Minor Issues" | "Major Violations",
  findings: [{ 
    target_doc_id: "uuid",
    target_doc_title: "Bank Negara Guidelines",
    theme: "Capital allocation",  // Only for Mode 2
    severity: "Critical" | "High" | "Medium" | "Low",
    consequence: "Potential penalties under Bank Negara Section X.Y",
    source_quote: "Exact text from user's policy/text",
    target_quote: "Exact text from regulatory doc",
    suggestion: "Update clause to include...",
    confidence_score: 0.85
  }],
  summary: "Cross-doc compliance insights",
  targets_checked: 2,
  themes_analyzed: 5  // Only for Mode 2
}
```

**Why per-target findings:**

- User sees exactly which regulation flagged which issue (actionable)
- Theme attribution (Mode 2) shows which policy area has gaps
- Confidence score from retrieval similarity (trust mechanism)

**Output format:**

- Grouped by target doc (all findings for BankNegara, then all for FSA)
- Within each target: grouped by severity (Critical → High → Medium → Low)
- Business context via `consequence` field
- Citations for verification

**Model:** GPT-4o (legal risk, consequence analysis requires full reasoning - 6.7% accuracy gain over 4o-mini for compliance tasks)

**v1.1 Enhancement:** Adaptive chunk/theme selection based on document length

- **Use cases:** Audit uploaded policies, draft emails, marketing copy, social posts against multiple regulatory docs simultaneously

**Agentic Flow (Sequential Design):**

```
USER MESSAGE
    ↓
[1. INTENT RESOLVER] (0-2 LLM calls, progressive context)
    - Explicit action tagged? (@Audit, @Summarize) → Use it, skip LLM entirely
    - No tag? → Classify from latest message only (first pass, cheap)
    - Low/medium confidence? → Retry with last 5 messages (second pass)
    - Still low after retry → interrupt() → PalAssist: ask user to confirm action; cancel → AI feedback: "I wasn't sure which action to perform. Try again using @Summarize, @Inquire, @Compare, or @Audit."
    - Multi-action detected? → interrupt() → PalAssist: ask user to choose one; cancel → same feedback
    - "Summarize X about topic Y"? → Classify as Inquire (specific topic = targeted Q&A)
    - Output: action + confidence
    ↓
[2. DOCUMENT RESOLVER] (3-stage pipeline, intent-aware)
    Python keyword scan (free, before LLM):
      • Terms: "latest", "recent", "current", "now", "today", "2025", "2026"
      • Found? → enable_web_search = True (OR with frontend @WebSearch flag)
      • Result: enable_web_search = frontend_flag OR python_flag OR llm_flag (step below)
    LLM call (progressive context):
      • Structured output: { action, confidence, reasoning, enable_web_search }
      • enable_web_search catches nuanced cases: "Is this still enforced?", "What's happening with..."
      • web_search_query NOT generated here — action nodes own it (they have doc + user context)
    Stage 1 — Python pre-processor (free, instant):
      • Parse TipTap JSON → extract all @mention UUIDs
      • Pure @mentions only (no free text)? → Skip LLM, use UUIDs directly
      • Free text present? → Select context:
          - Registry key found verbatim in text? → latest msg + registry (cheap path)
          - Otherwise (pronouns, unknown names) → latest + 5 msgs + registry
    Stage 2 — One LLM call (right-sized context):
      • Receives: selected context + already-resolved tag UUIDs + state["action"]
      • Knows expected doc shape per action:
          - Summarize: 1+ docs
          - Inquire: 0+ docs (optional, can be web-only)
          - Compare: 2+ docs required
          - Audit: source (doc or text) + 1-5 target docs
      • Returns: { resolved_uuids[], unresolved_names[], confidence }
    Stage 3 — Python fuzzy match (for unresolved_names only):
      • Levenshtein similarity ≥85% vs all user doc titles from Supabase
      • Match → use UUID, high confidence
      • No match → low confidence → interrupt() → PalAssist
    Output: resolved_doc_ids + inference_confidence
    ↓
[3. VALIDATION CHECK] (pure Python, free)
    - Action requirements met?
      • Compare but only 1 doc? → interrupt() → PalAssist: tag 2nd doc; cancel → AI feedback: "Compare requires at least 2 documents. Please @tag them and try again."
      • Audit but no targets? → interrupt() → PalAssist: tag regulation doc; cancel → AI feedback: "I need a regulation document to run Audit. Please @tag one and try again."
      • Audit with no source text? → interrupt() → PalAssist: provide text; cancel → AI feedback: "I need the text you'd like to audit. Please include it with a @tagged regulation document."
      • Web search needed but disabled? → interrupt() → PalAssist: suggest enabling
      • action=compare AND enable_web_search=True? → drop flag silently, Compare never uses web search
    ↓
[4. ROUTE TO ACTION]
    - Each action node has custom retrieval strategy
    - Retrieval happens INSIDE action node (not before)
```

**Why Sequential (Intent → Document → Validate → Route):**

- ✅ **Efficiency:** Skip doc resolution for web-only queries (~20% of cases)
- ✅ **Intent-aware:** Document resolver knows what pattern to expect (1 doc vs 2+ docs)
- ✅ **Fail fast:** Validate early, clear error messages before expensive LLM action calls
- ✅ **Accuracy over speed:** Fewer wasted LLM calls, no ambiguous states
- ✅ **Progressive context:** Intent resolver starts lean (1 msg), expands only if needed — saves ~60% of intent resolution cost

**Frontend Data Contract:**

**New message (standard):**

- **Frontend sends:** `{ message, tiptap_json, explicit_doc_ids[], explicit_action?, enable_web_search }`
- `tiptap_json` — raw TipTap JSON for Python pre-processor to extract @mention UUIDs
- **Backend receives:** Clean UUIDs (no text parsing needed)

**Response transport (both /chat and /chat/resume):**

- **SSE stream (text/event-stream):** Backend returns `StreamingResponse`. Next.js proxy pipes through without buffering.
- **Status events** (0-N per request): `{ type: "status", node, message, docs_found?, web_query? }`
- **Terminal event** (exactly 1 per request, ends stream): `{ type: "response", ... }` OR `{ type: "interrupt", ... }`
- Frontend reads event-by-event: `status` → update PalReasoning, `response` → render AI message, `interrupt` → show PalAssist

**Graph resume (after PalAssist interrupt):**

- **Frontend sends:** `{ thread_id, resume_value: { type, value } }`
- `type`: `"doc_choice"` | `"text_input"` | `"action_choice"` | `"cancel"`
- `value`: UUID string (doc_choice), free text (text_input), action string (action_choice), null (cancel)
- **Backend:** Calls `graph.astream(Command(resume=resume_value), config, stream_mode="updates")` — returns SSE stream for remaining nodes
- **Cancel:** Frontend sends `{ type: "cancel", value: null }` → backend converts to `CANCEL_SENTINEL` string (workaround for LangGraph 1.0.x `Command(resume=None)` bug) → node receives sentinel → returns `Command(update={feedback_msg, AIMessage}, goto="format_response")` — skips all downstream nodes, jumps directly to `format_response` → SSE `ChatResponse` emits feedback as AI bubble → `conversation_docs` registry preserved; next message starts fresh run with full prior context available

**Smart Context Resolution (Document Resolver Details):**

Handles 3 resolution modes via a 3-stage pipeline:


| Mode              | Trigger                                  | Example                                                     |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------- |
| **Explicit only** | All docs tagged via TipTap, no free text | "Compare @Doc1 and @Doc2" → Python extracts UUIDs, skip LLM |
| **Implicit only** | No tags, needs full inference            | "What about those guidelines?" → LLM resolves from history  |
| **Hybrid**        | Some tagged + implicit references        | "Audit @Doc2 against the policy above" → LLM merges both    |


**3-Stage Pipeline:**

```
Stage 1 — Python pre-processor (free):
  Parse TipTap JSON → extract all @mention UUIDs
  Pure @mentions, no free text? → skip LLM, done
  Free text present? → select LLM context:
    - Any conversation_docs registry key found verbatim in text?
        YES → send: latest msg + registry (cheap path)
    - NO (pronouns / unknown name) →
        send: latest msg + 5 msgs + registry (history path)

Stage 2 — One LLM call:
  Input:  selected context
        + already-resolved tag UUIDs (hybrid merge)
        + conversation_docs registry { "Bank Negara 2024": "uuid-xyz" }
        + state["action"] (intent-aware doc shape)
  
  Prompt task:
    "Identify which documents the user is referring to.
     Match names to the registry. Return UUIDs you find.
     Return unresolved names you cannot match."
  
  Output (structured):
    {
      resolved_uuids: ["uuid-our-policy", "uuid-bank-negara"],
      unresolved_names: [],          ← names LLM couldn't find in registry/history
      inference_confidence: "high",
      has_implicit_refs: true,
      reasoning: "'regulation above' = Bank Negara 2024 from Msg1"
    }

Stage 3 — Python fuzzy match (only if unresolved_names exists):
  For each name in unresolved_names:
    Run Levenshtein similarity vs all user doc titles in Supabase
    Match ≥85% → grab UUID, mark high confidence
    No match → mark low confidence → interrupt() → PalAssist

Final: resolved_doc_ids = explicit_uuids ∪ resolved_uuids ∪ fuzzy_matched_uuids
```

**conversation_docs Registry:**

- Stored in `AgentState` as `conversation_docs: dict[str, str]` — `{ title: uuid }`
- Built after every successful turn: backend queries Supabase for titles of all `resolved_doc_ids`, merges into registry
- Persisted via PostgresSaver — survives browser refresh, server restart
- Enables implicit resolution across ALL previous turns in a conversation without re-sending full history

**Inference Confidence Tiers:**


| Confidence | When                                           | Behavior                                                                                                                                |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **High**   | Single clear match, doc in registry or history | Proceed silently                                                                                                                        |
| **Medium** | Multiple candidates, one likely                | interrupt() → PalAssist: show clickable doc options; cancel → AI feedback: "I can't proceed with {action} without a specific document." |
| **Low**    | No match after fuzzy search                    | interrupt() → PalAssist: ask user to tag doc explicitly; cancel → same feedback                                                         |


**Example Flows (All 3 Modes):**

```
EXPLICIT ONLY — Python skips LLM entirely:
  Msg: "Compare @BankNegara2024 and @BankNegara2025"
  → TipTap JSON has 2 mention nodes with UUIDs
  → No free text → skip LLM, cost $0

IMPLICIT ONLY — High confidence (registry hit):
  Msg1: "Compare @Doc1 and @Doc2"           ← registry now has Doc1, Doc2
  Msg2: "What are the key differences in capital requirements?"
  → "Doc1" and "Doc2" found verbatim in registry (from Msg1)
  → Python selects: latest msg + registry (cheap path)
  → LLM resolves both from registry, high confidence
  → Proceed silently

HYBRID — High confidence:
  Msg1: "Summarize @BankNegara2024"         ← registry: BankNegara2024
  Msg2: "Does @OurPolicy comply with that regulation?"
  → explicit: [OurPolicy UUID], free text: "that regulation"
  → "that regulation" not in registry verbatim → history path (5 msgs)
  → LLM: "that regulation" = BankNegara2024, merges both
  → Proceed: "Auditing Our Policy against Bank Negara 2024."

HYBRID — Medium confidence → PalAssist:
  Msg1: "Summarize @Doc1"
  Msg2: "Summarize @Doc2"
  Msg3: "Audit @Doc3 against the policy"
  → explicit: [Doc3], "the policy" = Doc1 or Doc2?
  → Medium confidence (multiple candidates)
  → interrupt() → PalAssist above chat input:
    "Which document would you like to audit against?"
    [Doc1]  [Doc2]  [Both]  [Cancel]

IMPLICIT — Low confidence (unknown name) → PalAssist:
  Msg: "What about the FSA guidelines?"
  → "FSA" not in registry, not in last 5 msgs
  → Stage 3 fuzzy match: no match ≥85%
  → interrupt() → PalAssist:
    "Please tag the document you'd like to reference."
    [@ mention input]  [Cancel]
```

**Why this approach:**

- ✅ Natural conversation flow (no re-tagging every message)
- ✅ Progressive cost: $0 for explicit, ~$0.001 for registry match, ~$0.002 for history path
- ✅ LLM understands context semantically (not brittle keyword matching)
- ✅ Fuzzy match recovers from typos/year variants without LLM retry
- ✅ interrupt() preserves graph state — no context lost on clarification

**Cost impact:** ~$0 for 39% of queries (explicit + fuzzy), ~$0.001 for 25% (registry match), ~$0.002 for 35% (history path), ~$0.003 for 1% (unknown name + doc list)

**Confidence System (Two Separate Systems):**

**1. Inference Confidence** — set by `doc_resolver`, reflects "did I find the right documents?"

- `high`: explicit tag or strong registry/fuzzy match
- `medium`: multiple candidates → PalAssist doc_choice interrupt
- `low`: no match → PalAssist text_input interrupt

**2. Retrieval Confidence** — set by action nodes, reflects "did the RAG chunks actually answer the question?" Based on average cosine similarity across retrieved chunks:


| Confidence | Similarity | Behavior             | UI Display                                                                            |
| ---------- | ---------- | -------------------- | ------------------------------------------------------------------------------------- |
| **High**   | > 0.75     | Proceed normally     | ✅ Green checkmark badge                                                               |
| **Medium** | 0.5 - 0.75 | Proceed with caution | ⚠️ Yellow caution icon + tooltip: "Medium confidence—further investigation suggested" |
| **Low**    | < 0.5      | STOP, ask user       | 🔴 Red badge + action prompt                                                          |


SSE fallback: if either confidence field is empty/missing, defaults to `"low"` — unknown confidence is cautious, not falsely certain. Intent resolver confidence (`classification.confidence`) is used internally for retry logic only; not written to state.

**Low confidence behavior (stops execution):**

```
"I couldn't find strong matches in the documents. Would you like me to:

[📄 Tag specific documents] - Opens TipTap autocomplete
[🌐 Search the web] - Enables Tavily search
[Continue anyway] - Proceed with disclaimer"
```

**Why 3 tiers matter:**

- **High:** Compliance officer can trust the answer
- **Medium:** Answer provided, but flagged for verification (common in regulatory work)
- **Low:** Prevents hallucination—better to ask than guess wrong

**Technical implementation:**

```python
def calculate_confidence(chunks: list[Chunk]) -> tuple[str, float]:
    if not chunks:
        return ("low", 0.0)
    
    avg_similarity = mean([c.similarity_score for c in chunks])
    
    if avg_similarity > 0.75:
        return ("high", avg_similarity)
    elif avg_similarity > 0.50:
        return ("medium", avg_similarity)
    else:
        return ("low", avg_similarity)
```

**Purpose:** Trust mechanism for compliance officers (no silent hallucinations)

**Citation format:**

- **Inline display:** Use icons (📄 document, 🌐 web) instead of numbered markers
- **Quote extraction:** LLM extracts exact 2-3 supporting sentences (max 300 chars) via structured output
- **Unified model:** Both document and web citations use same format with `source_type` discriminator
- **Fallback:** If quote > 300 chars, sentence-split and take first 2-3 sentences

**Response Tone (Professional & Corporate):**

All agent responses maintain a professional, corporate tone suitable for compliance officers and financial professionals:


| Situation          | ❌ Casual                           | ✅ Professional                                                                   |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| **Confirmation**   | "I think you mean Doc1, right?"    | "I will proceed to audit against Doc1. Please confirm."                          |
| **Proceeding**     | "Okay, let me check those docs..." | "Analyzing compliance across the specified documents."                           |
| **Clarification**  | "Which one did you mean?"          | "Please specify which document you would like to reference."                     |
| **Low confidence** | "I'm not sure about this..."       | "Limited information available. Verification with source documents recommended." |
| **Error**          | "Oops, something went wrong!"      | "Unable to process request. Please try again or contact support."                |


**Tone guidelines in system prompt:**

```
## Communication Style
- Maintain professional, corporate tone at all times
- Be direct and concise—compliance officers value efficiency
- Use formal language: "I will proceed" not "I'll go ahead"
- State actions clearly: "Analyzing..." "Auditing..." "Comparing..."
- Avoid casual phrases: "Let me...", "Okay so...", "I think..."
- When uncertain, be precise: "Please confirm" not "Is that right?"
```

**Why professional tone matters:**

- Target users are compliance officers, legal teams, financial professionals
- Builds trust in AI-assisted compliance decisions
- Matches enterprise software expectations
- Distinguishes from consumer chatbots

### 5. Tools

- **Retrieval tool:** 
  - pgvector semantic search, scoped by `user_id`
  - **Modes:**
    1. Specific docs (UUIDs from frontend) → Fetch chunks by `document_id` (exact retrieval, no search)
    2. Set filter (`set_id` from frontend) → Semantic search within that set
    3. No filters → Semantic search across all user's docs
  - **Multi-document batch retrieval:**
    - Input: List of document UUIDs (1-5 docs)
    - Output: Top 3 chunks per document (parallel retrieval)
    - Total: Up to 15 chunks for 5-doc queries (15k tokens max)
  - Returns chunks + metadata (doc_id, doc_title, page, chunk_id, similarity score)
  - **Why 3 chunks per doc:** Balance between per-doc context and total token budget
- **Web search tool:** 
  - Tavily basic search (1 credit/query)
  - **Returns:** title, URL, snippet (100-200 words), relevance score
  - **When `enable_web_search` is set (three sources, OR logic):**
    1. User explicitly tags `@WebSearch` → frontend sets flag before graph runs
    2. Python keyword scan in intent_resolver: "latest", "recent", "2026", "current", "now", "today"
    3. LLM in intent_resolver detects nuanced recency need: "Is this still enforced?", "What's happening with..."
  - **Per-action support:**
    - Inquire: ✅ Q&A + latest external info; also triggers for "no docs + general question" (Inquire-specific)
    - Summarize: ✅ Supplement doc summary with current regulatory news
    - Audit: ✅ "Latest rules" means check current enforcement context
    - Compare: ❌ Not supported — comparison is always between uploaded docs; validate_inputs drops flag
  - **Query generation:** Action nodes (not intent resolver) generate `web_search_query` with full context
  - **Citations:** Integrated with document citations using unified icon format (🌐)
  - **Limit handling:** Show "⚠️ Web Search Limit Reached (1000/month)" if exceeded

### 6. Chatbox & Conversation UI

**Chat List Sidebar:**

- **Conversation threads:** Display all user's past conversations (ChatGPT-style)
- **Preview:** Show last message + timestamp (e.g., "Conversation from Jan 30, 2026")
- **New conversation:** "+ New Chat" button creates fresh thread_id
- **Load conversation:** Click thread → loads full message history
- **Persistence:** All conversations stored in Supabase (survives browser refresh, server restart)

**Chatbox Interface:**

- **TipTap Rich Text Editor with Mention Extension:**
  - **Why TipTap:** Battle-tested rich text editor with first-class @ mention support (used by Notion, Linear)
  - **Autocomplete behavior (Cursor-style):**
    - User types `@` → Dropdown appears immediately with filtered suggestions
    - Typing filters list: `@ban` shows "Bank Negara 2024", "Bank Negara 2025"
    - Arrow keys navigate, Enter/click selects
    - Selected item inserts as styled "pill" (e.g., `[📄 Bank Negara 2024]`)
  - **Categorized dropdown sections:**
    ```
    ┌─────────────────────────────┐
    │ ⚡ Actions                   │  ← Matches "@sum", "@aud", etc.
    │   Summarize                 │
    │   Inquire                   │
    │   Compare                   │
    │   Audit                     │
    ├─────────────────────────────┤
    │ 📁 Sets                     │  ← Matches set names
    │   Bank Negara               │
    │   ISO 27001                 │
    ├─────────────────────────────┤
    │ 📄 Documents                │  ← Matches doc titles (most common)
    │   Bank Negara 2024          │
    │   Bank Negara 2025          │
    │   Our AML Policy v3         │
    ├─────────────────────────────┤
    │ 🌐 Web Search               │  ← Matches "@web"
    └─────────────────────────────┘
    ```
  - **ID resolution on selection (key architecture change):**
    - When user selects "Bank Negara 2024" from dropdown → TipTap stores:
      - Display text: "Bank Negara 2024"
      - Data attribute: `data-doc-id="uuid-123-456"`
    - On message submit → Frontend extracts all mention data attributes → Sends to backend:
      ```typescript
      {
        message: "Compare these two docs",
        tagged_doc_ids: ["uuid-123", "uuid-456"],
        tagged_set_ids: [],
        action: "compare",
        enable_web_search: false
      }
      ```
    - **Result:** Backend receives clean UUIDs, zero parsing needed
  - **Benefits over text parsing:**
    - ✅ No ambiguity: UUID is exact, no title matching
    - ✅ No typos: User selects from list, can't misspell
    - ✅ Metadata display: Show doc type icon, set color in pill
    - ✅ Multi-doc UX: Easy to tag 5 docs without typing each name
    - ✅ Type safety: Frontend Zod schema validates before send
  - **Multi-document tagging (1-5 docs):**
    - User can tag up to 5 documents in a single message
    - Visual feedback: Pills stack naturally in text
    - Example: "Audit @[Our Policy] against @[BankNegara2024], @[FSA], and @[AMLRules]"
    - Validation: If >5 docs tagged, show warning: "Max 5 documents per query"
- **Response display:**
  - **Citations:** 
    - **📄 Document citations:** Inline icon, hover tooltip shows (title, page, 2-3 sentence quote)
    - **🌐 Web citations:** Inline icon, hover tooltip shows (title, domain, 2-3 sentence quote), click opens URL in new tab
    - **Quote extraction:** LLM structured output (exact supporting sentences, max 300 chars)
    - **Fallback validation:** If quote > 300 chars, sentence-split and take first 2-3
  - **Retrieval Confidence indicators (3-tier UI):**
    - These badges reflect RAG similarity scores — "did I find strong evidence?" (set INSIDE action nodes, AFTER retrieval)
    - **High (>0.75):** ✅ Green checkmark badge next to response
    - **Medium (0.5-0.75):** ⚠️ Yellow caution icon + hover tooltip: "Medium confidence—further investigation suggested"
    - **Low (<0.5):** PalAssist `retrieval_low` interrupt triggers — user can tag specific docs, search the web, or continue anyway with disclaimer
- **PalAssist — AI Companion (above chat input, powered by LangGraph interrupt()):**
  - Appears **above the chat input bar** (never inline in message history — keeps conversation clean)
  - Graph is paused mid-execution; state saved to Postgres; user must respond or cancel to continue
  - When a user sends a message while PalAssist was active, the PalAssist prompt text is shown in smaller text above that message in the chat history (for conversation audit trail)
  - Cancel → `Command(goto="format_response")` with context-specific feedback message — graph stops immediately, no downstream nodes execute, feedback shown as AI bubble in chat history and persisted in checkpoint
  **Inference confidence — low (no document match):**
  ```
  ┌──────────────────────────────────────────────────────┐
  │ 🤖 PalAssist                                         │
  │ Please tag the document you'd like to reference.     │
  │                                          [Cancel]    │
  └──────────────────────────────────────────────────────┘
  [ TipTap input with @ mention enabled ]
  ```
  **Inference confidence — medium (multiple candidates):**
  ```
  ┌──────────────────────────────────────────────────────┐
  │ 🤖 PalAssist                                         │
  │ Which document would you like to audit against?      │
  │  [BankNegara2024]   [Deriv2024]   [Both]  [Cancel]  │
  └──────────────────────────────────────────────────────┘
  ```
  **Action conflict — multi-action or low intent confidence:**
  ```
  ┌─────────────────────────────────────────────────────────┐
  │ 🤖 PalAssist                                            │
  │ I can only perform one action at a time.                │
  │ Which would you like to do first?                       │
  │  [Summarize]   [Audit]                      [Cancel]   │
  └─────────────────────────────────────────────────────────┘
  ```
  **Missing source text (e.g., Audit with no email provided):**
  ```
  ┌─────────────────────────────────────────────────────────┐
  │ 🤖 PalAssist                                            │
  │ Please enter the email to proceed with auditing.        │
  │                                            [Cancel]     │
  └─────────────────────────────────────────────────────────┘
  [ chat input ]
  ```
  **Retrieval confidence — low (RAG found no strong matches):**
  ```
  ┌────────────────────────────────────────────────────────┐
  │ 🤖 PalAssist                                           │
  │ I couldn't find strong matches in the documents.       │
  │                                                        │
  │  [📄 Tag specific documents]  [🌐 Search the web]      │
  │                                                        │
  │  [Continue anyway with disclaimer]      [Cancel]       │
  └────────────────────────────────────────────────────────┘
  ```
  - **Audit results:** Severity badges (Critical = red, High = orange, Medium = yellow, Low = blue)
  - **Consequence text:** Shows below each violation for business context
  - **Cost tracking:** Per-message token usage + cost display (e.g., "🪙 125 tokens · $0.001")
- **PalReasoning — Real-Time Agent Status (SSE, below user message):**
  - **What:** Node-by-node status text shown while graph runs. Each node completion emits an SSE event; frontend renders as shimmering blue text below the user's message bubble.
  - **Why:** Builds trust (user sees what agent is doing), eliminates "black box" feeling, demonstrates advanced SSE architecture. Zero LLM cost — statuses are from a static Python config map.
  - **Transport:** Server-Sent Events (SSE) — NOT token streaming. Each event is one complete JSON line. Backend: `graph.astream(stream_mode="updates")` → `StreamingResponse`. Next.js proxy pipes stream (no buffering). Frontend: `fetch()` + `ReadableStream`.
  **Status messages (static config, per node):**
  ```
  intent_resolver   → "Clarifying intent..."
  doc_resolver      → "Finding documents..."
  validate_inputs   → "Validating request..."
  summarize         → "Summarizing documents..."
  inquire           → "Researching your question..."
  compare           → "Comparing documents..."
  audit             → "Auditing against regulations..."
  format_response   → "Formatting response..."
  ```
  **Enriched events (special nodes, read from AgentState — zero extra cost):**
  - `doc_resolver`: appends `docs_found: [{ id, title }]` → frontend shows resolved doc name pills
  - Action nodes with web search: appends `web_query: "..."` → frontend shows search query text
  **UI mockup:**
  ```
  ┌─── User bubble ──────────────────────────────────┐
  │ Audit this email against @BankNegara2024         │
  └──────────────────────────────────────────────────┘

    ✦ Finding documents...                 ← shimmer animation, blue accent text
      📄 BankNegara2024                    ← doc pill (confirms resolution)
      ↓ (replaced by next status)
    ✦ Auditing against regulations...
      ↓
    (PalReasoning clears → AI message bubble appears below)
  ```
  **PalReasoning ↔ PalAssist interaction:**
  - If `interrupt()` fires mid-graph (e.g., during doc resolver): PalReasoning clears → PalAssist appears above input
  - User responds to PalAssist → graph resumes → PalReasoning resumes from the interrupted node onward
  - `/chat/resume` also returns an SSE stream — PalReasoning works identically for initial and resumed calls
  **Edge cases:**
  - Node completes in <50ms (e.g., validate_inputs) → minimum 300ms display per status (frontend queues rapid events)
  - Network timeout (30s with no event) → clear PalReasoning, show error toast
  - Explicit @action skips intent_resolver → first status event is doc_resolver (no flash)
  - Cancel during PalAssist → PalReasoning already cleared when interrupt arrived — no conflict

### 7. Architecture & Technical Details

**LLM Service Architecture:**

Abstraction layer for intelligent model selection based on action type:

```python
# Model selection mapping
MODEL_MAP = {
    "summarize": "gpt-4o-mini",         # Extraction task
    "inquire": "gpt-4o-mini",           # Targeted Q&A
    "compare_focused": "gpt-4o-mini",   # Simple difference table
    "compare_holistic": "gpt-4o",       # Multi-theme synthesis
    "audit": "gpt-4o",                  # Legal risk analysis
}

# Single service call
llm_service.generate(
    prompt=prompt,
    action_type="audit",              # Determines model
    response_schema=AuditResponse,    # Pydantic schema
    temperature=0.1
)
```

**Why abstraction layer:**

- ✅ Action nodes don't know about model selection
- ✅ Easy to change mappings (just update MODEL_MAP)
- ✅ Cost tracking per model
- ✅ Future-proof (add GPT-5 by updating map)

**Database schema (Supabase):**

```sql
users (
  id UUID PRIMARY KEY,
  email TEXT,
  industry TEXT,    -- Optional: for agent context (e.g., "Banking", "Insurance")
  location TEXT,    -- Optional: for agent context (e.g., "Malaysia")
  created_at TIMESTAMP
)

sets (
  id UUID PRIMARY KEY,
  user_id UUID,
  name TEXT,        -- e.g., "Bank Negara", "ISO 27001"
  color TEXT,       -- Hex code from preset palette (e.g., "#3B82F6")
  created_at TIMESTAMP
)

conversations (
  thread_id UUID PRIMARY KEY,
  user_id UUID,
  title TEXT,              -- Auto-generated from first message
  last_message_at TIMESTAMP,
  created_at TIMESTAMP
)

documents (
  id UUID PRIMARY KEY,
  user_id UUID,
  title TEXT,
  version TEXT,
  doc_type TEXT, -- "Company Policy" | "Regulatory Source"
  set TEXT,      -- Optional, nullable (references sets.name)
  storage_path TEXT, -- Supabase Storage path
  uploaded_at TIMESTAMP
)

chunks (
  id UUID PRIMARY KEY,
  user_id UUID,     -- Scoping field
  document_id UUID FK,
  title TEXT,       -- Denormalized for retrieval
  version TEXT,
  doc_type TEXT,
  set TEXT,
  page INTEGER,
  chunk_id TEXT,    -- For citations
  chunk_text TEXT,
  embedding VECTOR(1536), -- text-embedding-3-small dimension
  created_at TIMESTAMP
)

-- LangGraph checkpointer table (auto-created by PostgresSaver)
checkpoints (
  thread_id UUID,
  checkpoint_id TEXT,
  parent_checkpoint_id TEXT,
  checkpoint JSONB,        -- Full agent state snapshot
  metadata JSONB,          -- {user_id, action, timestamp}
  created_at TIMESTAMP,
  PRIMARY KEY (thread_id, checkpoint_id)
)
```

**Authentication flow:**

1. User logs in (Supabase Auth) → Next.js gets `user_id`
2. Next.js stores `user_id` in React context
3. All API calls to FastAPI include `user_id` + user profile (industry, location)
4. FastAPI filters all queries: `WHERE user_id = $1`

**System prompt with user context (prompt caching):**

```python
# Static prefix (cached by OpenAI) + dynamic user context
SYSTEM_PROMPT = """You are PolicyPal, an AI compliance assistant for regulatory policy analysis.

## User Context
- Industry: {user_industry}
- Location: {user_location}

Tailor all advice to this user's regulatory environment. For example:
- Malaysian banking → reference Bank Negara guidelines
- UK insurance → reference FCA regulations

## Your Capabilities
1. **Summarize:** Condense complex regulatory documents into clear overviews
2. **Inquire:** Answer questions with citations from uploaded documents + web search
3. **Compare:** Highlight differences between policy versions
4. **Audit:** Identify compliance gaps with severity, consequences, and suggestions

## Communication Style
- Maintain professional, corporate tone at all times
- Be direct and concise—compliance officers value efficiency
- Use formal language: "I will proceed" not "I'll go ahead"
- State actions clearly: "Analyzing..." "Auditing..." "Comparing..."
- Avoid casual phrases: "Let me...", "Okay so...", "I think..."
- When confirming, be precise: "Please confirm" not "Is that right?"
- When uncertain, state clearly: "Please specify which document you would like to reference."

## Citation Rules
- Always cite sources with exact quotes (2-3 sentences max)
- Use 📄 for document sources, 🌐 for web sources
- Never make claims without supporting evidence

## Confidence
- If retrieval similarity < 0.5, ask user to specify documents or enable web search
- If similarity 0.5-0.75, proceed with caution notice: "Medium confidence—verification recommended."
- If similarity > 0.75, proceed with full confidence
"""

# Why this structure:
# 1. Static prefix ("You are PolicyPal...") → cached by OpenAI (10-15% cost savings)
# 2. User context at top → tailors all responses without per-message injection
# 3. Communication style → enforces professional tone
# 4. Capabilities list → helps routing and response quality
# 5. Citation/confidence rules → enforces structured output
```

**Type Safety:**

- **Backend:** Pydantic models for request/response validation (included with FastAPI)
- **Frontend:** Zod schemas for form validation and API response parsing
- **Purpose:** Ensures type safety across Next.js ↔ FastAPI boundary, prevents runtime errors

**LangGraph State (Full Schema):**

```python
class AgentState(TypedDict):
    # Core conversation
    messages: list[BaseMessage]
    thread_id: str
    user_id: str
    
    # Action routing
    action: str  # "summarize" | "inquire" | "compare" | "audit"
    
    # Document resolution
    explicit_doc_ids: list[str]      # From frontend TipTap @mention UUIDs
    resolved_doc_ids: list[str]      # Final docs to use (explicit OR inferred OR fuzzy-matched)
    inference_source: str            # "explicit" | "inferred" | "fuzzy_match"
    set_id: str | None               # If user tagged a set
    enable_web_search: bool          # True if: @WebSearch tag OR temporal keyword OR LLM detected
                                     # OR logic across all three sources — set in intent_resolver
    web_search_query: str | None     # Generated by action nodes (not intent resolver)
                                     # Formulated with full context: resolved docs + user industry
    web_search_results: list | None  # Tavily results — set by action nodes, used in citations
    
    # Smart Context Resolution
    conversation_docs: dict[str, str]  # Registry: { "Bank Negara 2024": "uuid-xyz" }
                                       # Accumulated across all turns, persisted via checkpointer
                                       # Updated after every successful turn
    has_implicit_refs: bool            # LLM detected implicit references in message
    inferred_doc_ids: list[str]        # Docs inferred from conversation history
    unresolved_names: list[str]        # Names LLM couldn't match → fuzzy match targets
    inference_confidence: str          # "high" | "medium" | "low"
    inference_reasoning: str | None    # LLM explanation (for LangSmith debugging)
    suggested_doc_ids: list[str]       # Options shown in PalAssist medium-confidence prompt
    
    # Retrieval results (set inside action nodes)
    retrieved_chunks: list[Chunk]
    retrieval_confidence: str        # "high" | "medium" | "low" — separate from inference_confidence
    confidence_score: float          # 0.0 - 1.0 (avg similarity score from RAG)
    
    # Response
    response: str
    citations: list[Citation]
    tokens_used: int
    cost_usd: float
```

**Two confidence fields — critical distinction:**

- `inference_confidence` — set by Doc Resolver. "Did I understand which documents you mean?" Drives PalAssist (before action runs).
- `retrieval_confidence` — set inside action nodes after RAG retrieval. "Did I find strong supporting evidence?" Drives inline response quality badges (after action runs).

**Multi-turn conversation & persistence:**

- **Checkpointer:** PostgresSaver (database-backed, survives restarts/refreshes)
- **State persistence:** Full conversation history, retrieved docs, citations stored in `checkpoints` table
- **Thread management:**
  - Each conversation = unique `thread_id` (UUID)
  - Next.js creates thread on first message, stores in React state + URL param
  - All subsequent messages include `thread_id` in API calls
  - FastAPI loads state: `graph.invoke(input, config={"configurable": {"thread_id": "..."}})`
- **Context resolution:** Smart Context Resolver reads message history to infer doc references
- **Use case examples:**
  - Day 1: "Summarize Bank Negara 2024" → Day 2: "Compare this with 2025" (✅ works, inferred)
  - Browser refresh mid-conversation → conversation continues seamlessly (✅ persists)
- **Conversation metadata:** Store in `conversations` table (thread_id, title, last_message_at) for sidebar UI

**Long Conversation Management (Context Window Strategy):**

```
Message arrives for thread with 50+ messages
    ↓
Step 1: Load all messages from PostgresSaver
    ↓
Step 2: Check conversation length
    - ≤ 15 messages: Use full history
    - > 15 messages: Apply windowing + summarization
    ↓
Step 3: Windowing strategy (for long conversations)
    - Keep last 10 messages verbatim (recent context)
    - Compress messages 1-(N-10) into summary
    ↓
Step 4: Generate summary (once, cached)
    - Input: Old messages (1 to N-10)
    - Model: GPT-4o-mini (summarization task, cost-efficient)
    - Output: Compact summary (~200-300 tokens)
      • Key topics discussed
      • Documents referenced
      • User intent/decisions
    - Cache summary with last_message_index
    ↓
Step 5: Send to action LLM
    - Context: [Summary message] + [Last 10 messages] + [Current query]
    - Token count: 300 (summary) + 2k (recent) = 2.3k vs 10k (77% savings)
```

**Why this strategy:**

- ✅ Maintains context for inference (doc references preserved in summary)
- ✅ Reduces token costs by 75% for long conversations
- ✅ Recent messages preserved (highest relevance)
- ✅ One-time summary cost (~$0.005 per conversation)
- ✅ Cache-friendly (summary doesn't change unless conversation grows)

**Summarization trigger:**

- First 15 messages: Full history
- At message 16: Generate first summary (messages 1-5)
- At message 26: Regenerate summary (messages 1-15)
- Pattern: Every 10 messages, extend summary window

**Summary format (concise):**

```
"Conversation summary (Messages 1-40):
User discussed Bank Negara capital requirements. Compared BankNegara2024 
and BankNegara2025 versions. Key finding: capital ratio increased from 8% 
to 10%. Documents referenced: @BankNegara2024, @BankNegara2025, @OurPolicy."
```

**v1.1 Enhancement:** Incremental summarization, thread TTL cleanup, OpenAI Compaction API

**Retrieval logic:**

```python
def retrieve(query: str, user_id: str, doc_tags: list[str] = None, set: str = None):
    filter = {"user_id": user_id}
    
    if doc_tags:
        # User tagged specific docs: "@BankNegara2024"
        filter["title"] = {"$in": doc_tags}  # Exact doc retrieval (fuzzy match on title+version)
    elif set:
        # User tagged set: @BankNegara
        filter["set"] = set
    # else: search all user's docs
    
    chunks = vector_search(query, filter, limit=4)
    return chunks  # Includes similarity scores for confidence calculation
```

**Citation extraction logic:**

```python
# LLM system prompt: "For each fact, extract the EXACT 2-3 sentences that support it. Max 300 chars per citation."

class Citation(BaseModel):
    id: int                          # Sequential across all citations
    source_type: Literal["document", "web"]  # Determines icon (📄 or 🌐)
    title: str                       # Doc title OR webpage title
    page: int | None = None          # For documents only
    url: str | None = None           # For web sources only
    quote: str                       # Max 300 chars, LLM-extracted 2-3 sentences
    
    @validator('quote')
    def truncate_quote(cls, v):
        # Fallback: If LLM returns > 300 chars, take first 2-3 sentences
        if len(v) > 300:
            sentences = v.split('. ')
            return '. '.join(sentences[:2]) + '.' if len(sentences) > 1 else v[:297] + '...'
        return v

# Example citation output:
# [📄1] "Starting 2026, corporate tax increases to 9%. All entities must comply."
# [🌐2] "Bank Negara announced the new rate in Q4 2025. Implementation begins January 2026."
```

**Conversation management logic:**

```python
# Initialize PostgresSaver checkpointer
from langgraph.checkpoint.postgres import PostgresSaver

checkpointer = PostgresSaver.from_conn_string(
    conn_string=os.getenv("SUPABASE_CONNECTION_STRING")
)

# Create new conversation
def create_conversation(user_id: str) -> str:
    thread_id = str(uuid.uuid4())
    # Store in conversations table for sidebar UI
    supabase.table("conversations").insert({
        "thread_id": thread_id,
        "user_id": user_id,
        "title": "New Conversation",  # Updated after first message
        "created_at": datetime.now()
    }).execute()
    return thread_id

# Load conversation state
def invoke_agent(user_message: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    response = graph.invoke({"messages": [user_message]}, config=config)
    
    # Update conversation metadata
    supabase.table("conversations").update({
        "last_message_at": datetime.now(),
        "title": generate_title(response)  # e.g., first 50 chars of first message
    }).eq("thread_id", thread_id).execute()
    
    return response
```

### **LangGraph Flow (Visual - Updated Sequential Design):**

```
                              START
                                │
                                ▼
                    ┌───────────────────────┐
                    │   intent_resolver     │ ◄── 1. Classify action
                    │                       │     Pass 1: latest msg only
                    │                       │     Pass 2: +5 msgs (if low/med)
                    └───────────────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              │                 │                  │
              ▼                 ▼                  ▼
          high conf         low/med conf       multi-action
              │                 │                  │
              │       interrupt() → PalAssist  interrupt() → PalAssist
              │       (confirm action)         (choose one action)
              │                 │                  │
              │         user responds / cancel     │
              │                 │                  │
              └─────────────────┴──────────────────┘
                                │
                                ▼
                    ┌───────────────────────────────────┐
                    │  document_resolver                │ ◄── 2. Resolve docs
                    │  Stage 1: Python pre-processor    │     (3-stage pipeline)
                    │  Stage 2: One LLM call            │
                    │  Stage 3: Python fuzzy match      │
                    └───────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
          high conf         med conf           low conf
          (proceed)         (confirm?)         (no match)
              │                 │                 │
              │       interrupt() → PalAssist  interrupt() → PalAssist
              │       (confirm doc choice)     (tag doc in chat)
              │                 │                 │
              │         user responds / cancel    │
              └─────────────────┴─────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   validate_inputs     │ ◄── 3. Check requirements
                    │   (pure Python, free) │     (Python only, no LLM)
                    └───────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
           all_valid                         missing info
              │                                   │
              │                      interrupt() → PalAssist
              │                      (missing docs or info)
              │                                   │
              │                        user responds / cancel
              │                                   │
              └───────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │    route_to_action    │ ◄── 4. Route to action node
                    └───────────────────────┘
                                │
              ┌─────────┬───────┴───────┬─────────┐
              ▼         ▼               ▼         ▼
         [Summarize] [Inquire]      [Compare]  [Audit]
              │    (Each node owns its retrieval strategy)
              └─────────────────┬───────────────────┘
                                ▼
                    ┌───────────────────────┐
                    │  check_retrieval_conf │ ◄── Retrieval confidence check
                    │  (avg RAG similarity) │     SEPARATE from inference_confidence
                    └───────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
         low (<0.5)       med (0.5-0.75)    high (>0.75)
              │                 │                 │
    interrupt() →          proceed with ⚠️   proceed with ✅
    PalAssist:                  │                 │
    [Tag docs]                  └────────┬─────────┘
    [Search web]                         ▼
    [Continue anyway]       ┌───────────────────────┐
                            │   format_response     │ ◄── Citations + badges + cost
                            └───────────────────────┘
                                         │
                                       update
                                  conversation_docs
                                    registry
                                         │
                                         ▼
                                       END
```

**Key Changes from Generic Flow:**

1. **Intent → Document** (sequential, not parallel)
2. **Progressive intent resolution** (1 msg → retry with 5 msgs if low confidence, before PalAssist)
3. **3-stage doc resolver** (Python pre-processor → LLM → Python fuzzy match — not a single LLM call)
4. **interrupt() replaces ask_user → END** (graph pauses, not terminates — context fully preserved)
5. **Validation node** (pure Python, checks action requirements before routing, free)
6. **Retrieval inside action nodes** (not before routing)
7. **Two separate confidence systems** (inference confidence from resolver, retrieval confidence from RAG)
8. **conversation_docs registry** updated at END of every successful turn — enables implicit resolution across all past turns

**conversation_docs Registry (persistence detail):**

- Stored in `AgentState`, persisted by PostgresSaver checkpointer
- Updated at the END node: backend queries `SELECT id, title FROM documents WHERE id = ANY($resolved_doc_ids)`
- Merges new `{ title: uuid }` entries into existing registry (never overwrites, only accumulates)
- Powers all implicit name→UUID resolution without needing to re-send full message history

**LangSmith integration:**

- All LangGraph runs traced (prompt, retrieval, LLM calls, tokens)
- **Purpose:** Debug agent decisions, tune prompts, track costs
- **Future enhancement:** Expose traces to user as "audit trail"

**Cost tracking:**

- **Per-message display:** Show token usage + cost in chatbox footer (e.g., "🪙 125 tokens · $0.001")
- **Calculation:** Track input tokens (retrieval chunks + prompt) + output tokens (response)
- **Log in LangSmith:** All token usage tracked for debugging and optimization
- **Purpose:** Demonstrates cost management awareness (key for production AI systems)

**Error handling:**

- Retry policies (add after first integration):
  - Retrieval: 3 attempts (handle pgvector timeouts)
  - Tavily: 2 attempts (handle rate limits)
  - LLM: 2 attempts (handle OpenAI API errors)
- LLM-recoverable errors: If GPT-4o returns malformed JSON → retry with corrected prompt
- User-fixable errors: "I don't have enough docs to answer this—upload more policies"

**Deployment:**

- **FastAPI:** Python app on Render (not Docker) with `requirements.txt`
- **Cold start mitigation:** Next.js pings FastAPI on page load (wake server)
- **CORS:** FastAPI allows only Vercel domain (Next.js proxy)
- **Env vars:** 
  - OPENAI_API_KEY, TAVILY_API_KEY, LANGSMITH_API_KEY
  - SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_CONNECTION_STRING (for PostgresSaver)
  - INTERNAL_API_KEY (Next.js ↔ FastAPI)

**No PDF generation in MVP:** Only summarization, Q&A, comparison, audit (defer to Tier 2/3)

---

## Remaining Open Questions

### Next Phase (Before Building)

1. **API contract:** Define request/response shapes for `/ingest`, `/query`, `/compare`, `/audit` endpoints
2. **Database setup:** Manual Supabase schema creation vs Alembic migrations (recommend manual for MVP)
3. **Env vars checklist:** Full list documented for deployment

### v1.1 Features (After MVP)

1. **Multi-step flows:** Chain actions like "Compare @X @Y, then audit @Z" (max 2 steps)
  - Requires: Conditional edges in LangGraph, context passing between nodes
  - Why deferred: Master single-step routing first, then add chaining
2. **Streaming:** Word-by-word response display (improves perceived latency)

### Tier 3 / Post-MVP (Cut if Behind Schedule)

1. **Basic evals:** Informal testing for MVP (5-10 test queries per action)
2. **Document re-ingestion:** First version = manual "delete + re-upload"; improve later with version tracking

---

## Status

✅ **Stack locked:** GPT-4o, embeddings, Tavily, Supabase (Auth, Postgres, pgvector, Storage), LangGraph, LangSmith, PostgresSaver, FastAPI + Pydantic, Next.js + Zod + TipTap  
✅ **Features locked:** User-scoped auth, structured document management (title/version/set), SmartIngest (RAG), 4-action agent with @ tagging (single-step), Smart Context Resolution, 3-tier confidence system, conversation persistence, chat list UI  
✅ **Architecture decisions:** 

- Per-user isolation (`user_id` scoping from Day 1, maintains data privacy)
- **TipTap @ tagging (Cursor-style):** Autocomplete dropdown with UUID resolution, categorized sections
- **Smart Context Resolution:** 3 modes (explicit/implicit/hybrid), LLM-based detection, inference confidence tiers
- **3-Tier Retrieval Confidence:** High (✅) / Medium (⚠️ caution icon) / Low (🔴 ask user)
- **Professional tone:** Corporate language suitable for compliance officers (no casual chatbot speak)
- **User context in system prompt:** Industry/location injected for tailored responses + prompt caching
- **Multi-doc support:** 1-5 documents per action, batch retrieval, per-doc findings
- Audit with business context (structured output including consequence + per-target findings)
- Custom sets with dropdown autocomplete (prevents typos, enables reuse)
- **Inline citations:** Icon-based (📄 document, 🌐 web), hover tooltips with 2-3 sentence quotes
- **Persistent conversations:** PostgresSaver checkpointer, thread-based, survives restarts/refreshes
- **Chat list UI:** Sidebar with all conversations (ChatGPT-style), shows title + timestamp

✅ **Cost projected:** ~$10–13 for 250 test queries (includes context resolution calls, well within $20-30 budget)  
✅ **Remaining questions:** 3 pre-build items (API contract, DB setup, env vars) + 2 v1.1 features + 2 Tier 3 deferrals  
✅ **Cost management:** Per-message token/cost tracking in UI (shows production maturity)  
✅ **Memory system:** Full conversation history, smart context inference, windowed context (last 10-15 messages + summary for long chats), persists across sessions

**Architecture Notes:** 

- **Single-user scoping (`user_id`):** Chosen for MVP to focus on AI Engineering demonstration. Multi-tenant (company_id) deferred as a 2-hour refactor.
- **Single-step actions:** MVP uses one action per query. Multi-step chaining (Compare → Audit) is v1.1 learning goal.
- **Smart Context Resolution cost:** +$0.01-0.02 per message without explicit tags (~30% of queries = ~20-30% cost increase for conversational flows)
- **User context in system prompt:** Industry/location injected once per conversation for tailored responses + prompt caching benefits.

**Next:** Define API contract shapes and create detailed implementation plan with timeline

---

## Feature Integration Summary

**End-to-end flow:**

```
USER SIGNUP
    ↓
User signs up (Supabase Auth) → user_id generated
Optional: Set industry + location in profile
    ↓
USER UPLOADS "Bank Negara 2024"
    ↓
Upload form: Title="Bank Negara Capital Guidelines", Version="2024", Set="Bank Negara"
    ↓
FastAPI /ingest: PyPDFLoader → Chunks → Embeddings → pgvector (scoped by user_id)
    ↓
USER STARTS CONVERSATION
    ↓
Next.js: Create thread_id → Store in conversations table
    ↓
USER QUERY: "Audit @OurAMLPolicy against @BankNegara2024 and @FSAGuidelines"
    ↓
Next.js: User types "@" → TipTap autocomplete dropdown appears
  - User types "@ban" → filters to matching docs
  - User selects → pill inserted with hidden UUID
  - On submit: Extract doc UUIDs from TipTap data attributes
  - Send to backend: { action: "audit", source_doc_id: "uuid-1", target_doc_ids: ["uuid-2", "uuid-3"] }
    ↓
LangGraph (with thread_id + user context):
  - Load state from PostgresSaver checkpointer
  - Inject system prompt with user's industry/location (cached prefix)
    ↓
  [Context Resolver Node]:
    - Explicit doc_ids provided? → Use directly (inference_source = "explicit")
    - No tags? → Infer from conversation history (1 LLM call)
    - Ambiguous? → Return confirmation prompt to user
    ↓
  [Retrieval + Confidence Check]:
    - Fetch top 3 chunks per document (batch retrieval)
    - Calculate avg similarity → confidence tier (high/medium/low)
    - Low confidence? → Return action prompt (tag docs / web search / continue)
    - Medium confidence? → Proceed with caution flag
    - High confidence? → Proceed normally
    ↓
  [Action Node] (Audit):
    - GPT-4o: Audit → structured output with per-target findings
    - Attach confidence badge + citations
    - Save state to checkpointer
    ↓
Next.js Chatbox:
  - Display audit results with severity badges (Critical=red, High=orange...)
  - Show consequence text for each violation
  - Show inline citations (📄 🌐) with hover tooltips
  - Display confidence indicator
  - Show cost tracking (🪙 tokens · $cost)
  - Update conversation metadata (title, last_message_at)
    ↓
USER RETURNS NEXT DAY
    ↓
Click conversation in sidebar → Load thread_id → Full history restored ✅
```

**Action-Specific Retrieval (Each Action Controls Its Own Strategy):**


| Action                 | Model   | Retrieval Strategy                                           | Chunk Target                               | Cost/Query | Why Different                                             |
| ---------------------- | ------- | ------------------------------------------------------------ | ------------------------------------------ | ---------- | --------------------------------------------------------- |
| **Summarize**          | 4o-mini | Adaptive stratified sampling (15-20% of doc, min 10, max 30) | 10-30 per doc                              | $0.005     | Needs broad coverage, RAG provides context                |
| **Inquire**            | 4o-mini | Targeted semantic search (Adaptive-k, similarity > 0.6)      | 3-5 per doc, 15 max                        | $0.004     | Targeted Q&A with clear chunks                            |
| **Compare (holistic)** | 4o      | Theme-based stratified sampling                              | 15-20/doc                                  | $0.08      | Multi-theme synthesis needs full reasoning                |
| **Compare (focused)**  | 4o-mini | Targeted semantic search                                     | 3-5/doc                                    | $0.005     | Simple difference table                                   |
| **Audit**              | 4o      | Dual-mode: Text (direct) OR Policy (per-theme)               | Text: 3-5/target, Policy: 2-3/target/theme | $0.35-0.40 | Legal risk requires full reasoning + consequence analysis |


**Why retrieval happens INSIDE action nodes (not before routing):**

- ✅ Each action optimizes for its specific needs
- ✅ No one-size-fits-all compromise
- ✅ Better results = demonstrates proper AI Engineering understanding
- ✅ Research-backed strategies (2026 best practices: adaptive > fixed)

**v1.1 Enhancement:** Multi-step flows ("Compare @X @Y, then audit @Z against them")

**Key integration points:**

1. **user_id scoping:** All data/retrieval filtered by user (maintains data isolation, simple architecture)
2. **TipTap @ tagging (Cursor-style):** Autocomplete dropdown, UUID resolution, raw TipTap JSON sent to backend for Python pre-processor
3. **Smart Context Resolution:** 3-stage pipeline (Python → LLM → Python fuzzy match), 3 modes (explicit/implicit/hybrid)
4. **conversation_docs registry:** `{ title: uuid }` dict in AgentState, updated after every successful turn, enables implicit resolution across full conversation history
5. **PalAssist:** LangGraph `interrupt()` pauses graph mid-execution; frontend detects `__interrupt_`_ payload, renders PalAssist above chat input; user responds via `Command(resume=...)` or cancels
6. **Inference confidence** (from doc/intent resolver): High (proceed) / Medium (PalAssist confirm) / Low (PalAssist tag) — fires BEFORE the action runs
7. **Retrieval confidence** (from RAG similarity scores): High (✅) / Medium (⚠️ caution badge) / Low (PalAssist: tag docs/web/continue) — fires AFTER action retrieval
8. **Professional tone:** Corporate language throughout — "Please confirm" not "Is that right?"
9. **User context in system prompt:** Industry/location injected → tailored responses + prompt caching (10-15% savings)
10. **Single-step routing:** LangGraph routes to one action per query (Summarize/Inquire/Compare/Audit)
11. **Structured metadata:** Title + Version + Set enables versioning, organization, precise retrieval
12. **Business context in Audit:** `consequence` field + per-target findings shows "why this matters"
13. **Citation system:** Unified model for document + web sources, LLM-extracted quotes, icon-based display
14. **Persistent memory:** PostgresSaver checkpointer, thread-based conversations, windowed context (last 10-15 messages + summary), full history survives restarts/refreshes
15. **Chat list UI:** Sidebar displays all conversations (ChatGPT-style), click to load, shows title + timestamp
16. **PalReasoning (SSE):** Node-by-node status events via `graph.astream(stream_mode="updates")`, zero LLM cost, enriched events for doc_resolver (doc pills) and web search (query text), 300ms minimum display, both `/chat` and `/chat/resume` use SSE transport

**v1.1:** Multi-step flows (Compare → Audit chaining with conditional LangGraph edges)