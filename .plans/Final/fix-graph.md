# Graph Fix Plan: Document Resolution + Query Intelligence

## 1. Current Graph Flow (Accurate Data Flow)

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (ChatRequest)                    │
│  message: "@Inquire @Muscle Building Guide Explain"         │
│  action: "inquire"           ← from @Inquire mention        │
│  tagged_doc_ids: ["80b7..."] ← from @MBG mention UUID       │
│  tiptap_json: { mention nodes + text nodes (structured) }   │
│  enable_web_search: false                                    │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   1. INTENT RESOLVER                         │
│  INPUT:  state.action, messages, enable_web_search           │
│  LOGIC:  action="inquire" already set → skip LLM ($0)        │
│  OUTPUT: { action: "inquire", enable_web_search: false }     │
│  STATUS: ✅ Working correctly                                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   2. DOC RESOLVER                            │
│  INPUT:  tiptap_json, conversation_docs, action, messages    │
│                                                              │
│  Stage 1a: Walk TipTap → explicit_uuids=["80b7..."]         │
│            free_text=" Explain"                              │
│  Stage 1b: free_text NOT empty → skip pure-mention shortcut │
│  Stage 1c: Check free_text against registry → context scope  │
│                                                              │
│  Stage 2: LLM call receives:                                │
│    - Registry: {"Atomic Habits":"b98a...", "MBG":"80b7..."}  │
│    - Explicit block: UUID 80b7... ("Muscle Building Guide")  │
│    - Latest message: " Explain"  ← ⚠️ ONLY free_text!       │
│    LLM output: resolved=["80b7..."], reasoning="The user     │
│    did NOT explicitly mention any doc..." ← ⚠️ WRONG         │
│                                                              │
│  Merge: explicit ∪ LLM = ["80b7..."]                        │
│  OUTPUT: { resolved_doc_ids: ["80b7..."], confidence: high } │
│  STATUS: ⚠️ Functionally OK but LLM reasoning is inaccurate │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 3. VALIDATE INPUTS                            │
│  INPUT:  action="inquire", resolved_doc_ids=["80b7..."]      │
│  LOGIC:  inquire needs 0+ docs → pass                        │
│  OUTPUT: {} (nothing changed)                                │
│  STATUS: ✅ Working correctly                                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   4. INQUIRE ACTION                           │
│  INPUT:  messages, resolved_doc_ids, user_id                 │
│                                                              │
│  Step 1: _extract_query(messages)                            │
│    Raw message: "@Inquire @Muscle Building Guide Explain"    │
│    Regex @\S+: strips "@Inquire" and "@Muscle"               │
│    Result: "Building Guide Explain" ← 🔴 BROKEN!            │
│    "Muscle" (key semantic word) is LOST                      │
│    "Building Guide" (noise) REMAINS                          │
│                                                              │
│  Step 2: search_chunks("Building Guide Explain",            │
│           docs=["80b7..."], threshold=0.5)                   │
│    → Embedding created for garbage query                     │
│    → match_chunks returns 0 chunks (best sim = 0.297)        │
│    → 🔴 ZERO CONTEXT for LLM                                │
│                                                              │
│  Step 3: LLM gets "(No relevant documents found)" as context │
│    → Responds: "No relevant documents found to explain..."   │
│                                                              │
│  OUTPUT: { response: "no context", confidence: "low" }       │
│  STATUS: 🔴 BROKEN — garbage query → zero retrieval          │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 5. FORMAT RESPONSE                            │
│  INPUT:  resolved_doc_ids, conversation_docs, messages        │
│  LOGIC:  Update registry, inject metadata into AIMessage     │
│  OUTPUT: { conversation_docs: {...}, messages: [updated_ai] }│
│  STATUS: ✅ Working correctly                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Root Cause Analysis: 3 Critical Issues

### Issue A: `_extract_query()` Regex is Broken (🔴 Primary Cause)

**Location:** `inquire.py` line 67

**Bug:** `re.sub(r"@\S+", "", text)` strips `@` + first non-whitespace word only.
- `@Muscle Building Guide` → strips `@Muscle`, leaves `Building Guide`
- `@Atomic Habits` → strips `@Atomic`, leaves `Habits` (accidentally works!)

**Impact:** Query becomes "Building Guide Explain" — loses "Muscle", gains noise.

**Why Atomic Habits "works":** The leaked word "Habits" is a perfect keyword match
for Atomic Habits content. Pure luck, not correct behavior.

### Issue B: No Query Intelligence (🔴 Critical Gap)

**Even with perfect mention stripping**, "Explain" is a terrible search query.
Direct user text → embedding → semantic search has no intelligence layer.

**Proof (direct DB similarity scores):**

| Query                          | Muscle BG | Threshold? |
|-------------------------------|-----------|------------|
| "Building Guide Explain"       | 0.297     | ❌ NO      |
| "Explain"                      | ~0.15     | ❌ NO      |
| "Explain the Muscle Building Guide" | 0.606 | ✅ YES    |
| "muscle growth training tips"  | 0.680     | ✅ YES     |

The embedding model needs MEANINGFUL queries. A user typing "Explain" shouldn't
mean zero retrieval — our system should be smart enough to construct:
"Explain the key concepts in the Muscle Building Guide"

### Issue C: Doc Resolver LLM Gets Truncated Context (⚠️ Confusing + Risky)

**Location:** `doc_resolver.py` line 307

The LLM receives only `free_text` (" Explain") as the latest message — the @mention
nodes were already stripped by the TipTap walk before the LLM ever sees the message.
The LLM never sees "@Muscle Building Guide" in its natural position in the sentence.

**Result from trace:**
- LLM says: "user did NOT explicitly mention any doc" — factually wrong
- The Python merge layer compensates (explicit_uuids ∪ LLM resolved), so the UUID is
  still passed forward correctly
- But `inference_source = "inferred"` instead of `"explicit"` — wrong metadata
- In edge cases (e.g. user tags 2 docs but only 1 is in registry yet), the LLM
  reasoning about the second doc will be confused because it can't see the first tag

**Why heuristics to skip the LLM call are risky:**
We considered expanding the pure-mention shortcut to also skip when "free_text has no
doc-like references." However, this creates a new class of error: for messages like
"Compare them" or "What about that policy?", we'd incorrectly skip the LLM which
is needed to resolve the implicit reference. validate_inputs is a safety net for doc
count but cannot reason about WHICH doc the user meant.

**The correct fix:** Send the full original message (including @mention label text)
to the LLM. The `ALREADY EXPLICITLY TAGGED` block already tells it which UUIDs are
pre-confirmed — so it won't double-count. This way:
- LLM accurately sees "user explicitly tagged @Muscle Building Guide"
- Reasoning in LangSmith is correct and trustworthy for debugging
- Implicit references in mixed messages are still correctly detected
- No new heuristics, no new failure modes

---

## 3. Proposed Improved Graph

### Key Change: Add `query_rewriter` utility (cheap LLM) before retrieval

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (ChatRequest)                    │
│  Same as before — no frontend changes needed                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   1. INTENT RESOLVER                         │
│  No changes — works correctly                                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               2. DOC RESOLVER (IMPROVED)                     │
│                                                              │
│  FIX A: TipTap walk → free_text stored as clean_query       │
│                                                              │
│  FIX B: Stage 2 LLM receives FULL original message          │
│    → accurate reasoning + correct inference_source           │
│                                                              │
│  FIX C: Build resolved_doc_titles from data already in hand: │
│    - explicit: doc_mentions {uuid: label} from TipTap walk  │
│    - inferred: inverted conversation_docs {uuid: title}     │
│    - fuzzy: from _fuzzy_match title→uuid mapping            │
│    → Zero extra DB calls                                     │
│                                                              │
│  Pure-mention shortcut: UNCHANGED                            │
│                                                              │
│  OUTPUT: + clean_query + resolved_doc_titles in state        │
│  STATUS: ✅ Accurate, efficient, complete title data          │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 3. VALIDATE INPUTS                            │
│  No changes — works correctly                                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          4. ACTION NODES (INQUIRE/COMPARE/AUDIT)             │
│                                                              │
│  NEW Step 1: rewrite_query() — GPT-4o-mini (~$0.0001)       │
│    INPUT: clean_query, resolved_doc_titles, action           │
│    Action-aware prompt branching:                            │
│      inquire → rephrase question + add doc name context      │
│      compare → include both doc names + comparison topic     │
│      audit   → extract compliance themes from audit text     │
│    No docs → return clean_query unchanged (general question) │
│    OUTPUT: optimized search query for embedding model        │
│                                                              │
│  Step 2: search_chunks(query=REWRITTEN_QUERY, ...)           │
│    → similarity 0.60+ → chunks retrieved ✅                  │
│                                                              │
│  Step 3: Dual-mode system prompt in action LLM:              │
│    IF chunks exist → strict RAG: "use ONLY context, cite"    │
│    IF chunks empty → general mode: "answer from general      │
│      knowledge, note this is not from uploaded documents"     │
│    → No more "no context found" dead ends ✅                 │
│    → Low confidence badge still shows (correct signal) ✅    │
│                                                              │
│  Step 4-6: Same as before (LLM → response → format)         │
│  STATUS: ✅ Smart retrieval + graceful general fallback       │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 5. FORMAT RESPONSE                            │
│  No changes — works correctly                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Plan

**Overview:** 4 sequential phases. Each phase is independently testable with no breaking changes between steps. Total files changed: 5. No frontend changes.

**Files changed:**
| File | Change Type |
|------|-------------|
| `backend/app/graph/state.py` | Add 2 fields |
| `backend/app/routers/chat.py` | Add 2 fields to transient reset |
| `backend/app/graph/nodes/doc_resolver.py` | 3 targeted changes |
| `backend/app/graph/utils.py` | **New file** — `rewrite_query()` |
| `backend/app/services/llm_service.py` | Add 1 action type to routing table |
| `backend/app/graph/nodes/inquire.py` | Replace query extraction + dual-mode prompt |

**Files NOT changed:** `builder.py`, `graph_service.py`, `validate_inputs.py`, `format_response.py`, `intent_resolver.py`, `stub_actions.py`, all frontend files.

---

### Phase 1 — State Schema Extension
**Goal:** Add `clean_query` and `resolved_doc_titles` to AgentState safely, with transient resets.

**Files:**
- `backend/app/graph/state.py`
- `backend/app/routers/chat.py`

**Tasks:**

**1a. `state.py` — Add 2 new fields to AgentState** (in the "Query intelligence" group, after `retrieved_chunks`):

```
clean_query: str
  - Set by: doc_resolver (from TipTap walk free_text — already computed there)
  - Read by: inquire, compare, audit action nodes
  - Why: doc_resolver already extracts free_text from TipTap. Storing it in state
    replaces the broken per-node regex in every action node. Computed once, used by all.

resolved_doc_titles: dict  # {uuid: title}
  - Set by: doc_resolver (built from data already in memory — zero DB calls)
  - Read by: rewrite_query(), action nodes for citation enrichment
  - Why: Action nodes need document names for smart query construction and citations.
    doc_resolver already has all this data from TipTap labels + conversation_docs registry.
    Passing it forward avoids per-node Supabase roundtrips.
```

Both fields use `total=False` inherited from AgentState. Existing nodes read with
`state.get("clean_query", "")` and `state.get("resolved_doc_titles", {})` — no breakage.

**1b. `chat.py` — Add both fields to initial_state transient reset block** (lines 299-332):

Add alongside existing resets:
```
"clean_query": "",
"resolved_doc_titles": {},
```

**Why transient?** Both are per-turn computed values. If not reset, a stale `clean_query`
from the previous turn would leak into the current turn's retrieval.

**Edge cases:**
- `conversation_summary` and `conversation_docs` are NOT transient — intentionally absent from reset. These two fields MUST never be reset here. This change does not touch them.

**Test:** Start server, send any message — no Pydantic validation errors. Check that `initial_state` in logs contains the two new keys.

---

### Phase 2 — Fix doc_resolver (3 targeted changes)
**Goal:** Full message to LLM, `clean_query` written to state, `resolved_doc_titles` built and written.

**File:** `backend/app/graph/nodes/doc_resolver.py`

**Tasks:**

**2a. Fix `latest_message_text` (line 307) — send full message to LLM**

Current code:
```python
latest_message_text = free_text or (
    str(messages[-1].content) if messages else ""
)
```
The `or` means: if free_text is non-empty (e.g. " Explain"), use ONLY that.
This strips all @mention labels from what the LLM sees.

Fix: Always use the full message. The LLM prompt already has an
`ALREADY EXPLICITLY TAGGED` block that prevents double-counting.
```python
latest_message_text = (
    str(messages[-1].content) if messages else free_text
)
```

**Why this is safe:** `_build_llm_messages` signature is unchanged. Only the argument
value changes. Merge logic, interrupt gates, and all downstream nodes unaffected.

**2b. Build `resolved_doc_titles` dict AFTER the fuzzy match block (after line ~355)**

⚠️ **Timing is critical:** `merged_uuids` starts at line 342 but Stage 3 (fuzzy match,
lines 348–355) can add MORE UUIDs to it. Build `resolved_doc_titles` only AFTER line ~355
so it reflects the final, fully-merged UUID list.

⚠️ **`all_docs` scope fix required:** `all_docs` is currently defined INSIDE the fuzzy
if-block (`if remaining_unresolved and user_id`). Referencing it outside crashes with
`NameError` when fuzzy never ran. Fix: initialize `all_docs = []` BEFORE line ~348
(before the fuzzy block starts). This is a one-line addition that makes it always in scope.

With that fixed, build titles from 3 sources in priority order:

1. `doc_mentions` (`{uuid: label}`) — TipTap walk, most accurate (current turn labels)
2. Inverted `conversation_docs` (`{title: uuid}` → `{uuid: title}`) — historical registry
3. `{d["id"]: d["title"] for d in all_docs}` — fuzzy results (`[]` if fuzzy never ran)

For each UUID in `merged_uuids`, look up priority 1 → 2 → 3. If not found in any
(defensive: LLM-resolved UUID not in registry), fall back to the UUID string itself.

**Note:** `_uuid_to_title = {v: k for k, v in conversation_docs.items()}` (line 374)
is already built for interrupt gates but it's inside Gate 1's condition. Move it up
to just after the merge (line ~343) so it doubles as source 2 above. Single refactor,
no logic change.

**2c. Add `clean_query` and `resolved_doc_titles` to `base_result` and pure-mention shortcut**

`base_result` dict (line 361) gets two new keys:
```
"clean_query": free_text.strip(),
"resolved_doc_titles": resolved_doc_titles,  # built in 2b
```

The pure-mention shortcut (line 274) must ALSO return these. When it's a pure mention
(free_text is empty), `clean_query = ""` and `resolved_doc_titles` is built purely
from `doc_mentions`: `{uid: label for uid, label in doc_mentions.items()}`.

**Why the shortcut needs titles too:** Even for pure mentions, the next node (`rewrite_query`)
needs document names. Without them, rewrite_query would fallback to `clean_query=""` which
produces a weak query. With titles, even a pure mention like `@Summarize @Atomic Habits`
gives `resolved_doc_titles = {"abc": "Atomic Habits"}` which `rewrite_query` uses.

**All resume paths:** Both Gate 1 and Gate 2 return `{**base_result, ...}` — since
`clean_query` and `resolved_doc_titles` are in `base_result`, all interrupt paths
automatically include them. No additional changes needed to the interrupt gates.

**Test:** Send `@Inquire @Muscle Building Guide Explain`. Check LangSmith trace:
- `doc_resolver` reasoning should say "user explicitly tagged..."
- `inference_source` should be `"explicit"`
- `clean_query` in state = `"Explain"`
- `resolved_doc_titles` = `{"80b7...": "Muscle Building Guide"}`

---

### Phase 3 — Query Rewrite Utility + LLM Routing
**Goal:** New `rewrite_query()` utility that builds an optimized search query per action.

**Files:**
- `backend/app/graph/utils.py` (new file)
- `backend/app/services/llm_service.py`

**Tasks:**

**3a. `llm_service.py` — Add `query_rewrite` to `_ACTION_TO_MODEL`** (line 48):
```
"query_rewrite": "gpt-4o-mini",
```
Rationale: Query rewriting is a simple reformulation task. GPT-4o-mini at ~$0.0001 per
call. Using `gpt-4o` here would be 20x more expensive with no quality benefit for this task.

**3b. Create `backend/app/graph/utils.py`**

New file with one exported function: `rewrite_query(clean_query, doc_titles, action) -> str`

**Logic flow:**
```
IF doc_titles is empty:
    return clean_query as-is  # general question, no doc context to add
ELSE:
    build action-aware prompt → call LLM → return optimized string
```

**Pydantic output schema** (simple, defined inline in utils.py):
```python
class _QueryRewriteResult(BaseModel):
    optimized_query: str
```

**Action-aware prompt branching:**

`inquire`:
```
Given this user question about [doc titles], generate a semantic search query (15-25 words)
that will find the most relevant passages. Include the document subject and the specific
question topic. Return ONLY the query.
```

`compare`:
```
Generate a semantic search query (15-25 words) to find content about [specific topic]
in these documents: [doc titles]. Return ONLY the query.
```

`audit`:
```
From this audit/policy text, extract the 3 most important compliance themes as a search query
(15-25 words) suitable for finding matching clauses in regulatory documents. Return ONLY the query.
```

`default` (fallback for any other action):
```
Rephrase this user message as a semantic search query (15-25 words) for documents [doc titles].
Return ONLY the query.
```

**Edge cases in `rewrite_query`:**
- `clean_query` is empty (pure mention like `@Summarize @Doc`) → prompt still works because
  we can derive intent from `action`: "Generate a query to retrieve comprehensive overview content
  from [doc title] for summarization." No empty-query crash.
- LLM fails / throws → catch exception, log warning, return `clean_query` as fallback.
  Never let a non-critical utility crash the graph run.
- `doc_titles` values are UUIDs (couldn't look up title) → still pass them; query quality
  degrades but doesn't break.

**Tracing:** Decorate with `@traceable(run_type="tool", name="rewrite_query")` so every
rewrite call appears as a distinct span in LangSmith. This is critical for debugging
retrieval quality — you can see exactly what query the embedding model received.

**Test:** Call directly in a test script:
- `rewrite_query("Explain", {"80b7": "Muscle Building Guide"}, "inquire")`
  → expect something like `"Explain the key training principles in the Muscle Building Guide"`
- `rewrite_query("", {}, "inquire")` → returns `""` (no LLM call, no crash)
- `rewrite_query("What is capital interest?", {}, "inquire")` → returns query unchanged

---

### Phase 4 — Fix inquire_action
**Goal:** Use `clean_query` from state, call `rewrite_query`, add dual-mode system prompt.

**File:** `backend/app/graph/nodes/inquire.py`

**Tasks:**

**4a. Replace `_extract_query()` with state read**

Current: `query = _extract_query(messages)` (broken regex)

Fix:
```
query = state.get("clean_query") or _extract_query(messages)
```

Why the fallback `_extract_query`? Defensive: if `clean_query` is somehow empty (e.g.
edge case where doc_resolver's TipTap walk got an empty `tiptap_json`), the old regex
is still better than crashing. Over time, once `clean_query` is always populated, the
fallback can be removed. For now it prevents a regression.

The `_extract_query` function is kept in the file but its call is demoted to fallback.
Do NOT delete it yet — it's still the fallback and documents the old broken approach.

**4b. Call `rewrite_query()` before `search_chunks()`**

At the top of `inquire_action`, add to the state reads:
```
resolved_doc_titles: dict = state.get("resolved_doc_titles") or {}
```

Then after `query` is set, call:
```
from app.graph.utils import rewrite_query
retrieval_query = rewrite_query(query, resolved_doc_titles, "inquire")
```

Note: action is hardcoded as `"inquire"` — `inquire_action` never runs for any other action,
so reading `state.get("action")` is unnecessary indirection. Each action node knows its own name.

Pass `retrieval_query` to **both**:
1. `search_chunks(query_text=retrieval_query, ...)` — embedding search benefits from the enriched query
2. Web search: `web_search_query = retrieval_query[:200]` — replaces the current `query[:200]`.
   Tavily benefits equally from the rewritten query (e.g. "capital requirements in BankNegara2024"
   vs raw "Explain") for better web results.

**Why separate variables?** Keep `query` (the original clean user text) for:
- The human turn in `llm_messages` (LLM sees the user's natural question, not the engineered one)
- Log messages (`inquire | query=...` for debugging)
Use `retrieval_query` for ALL retrieval calls (embedding + web). This keeps generation
decoupled from retrieval quality optimization.

**4c. Dual-mode system prompt**

**Two conditions, two prompt modes:**

**Mode A — Strict RAG** (when `len(chunks) > 0 OR len(web_results) > 0` — actual content exists):
```
You are a compliance document analyst. Answer using ONLY the provided context.
[context block with chunks]
RULES: cite every claim with [N], do not use general knowledge...
```

**Mode B — General Knowledge** (when `len(chunks) = 0 AND len(web_results) = 0 AND resolved_doc_ids = []`):
```
You are a compliance document analyst. No documents were attached to this conversation.
Answer from your general knowledge. 
IMPORTANT: Clearly state this is general knowledge, not sourced from uploaded documents.
Keep the response concise and accurate.
[no context block]
```

**Mode C — Document Found But No Relevant Chunks** (when `len(chunks) = 0 AND len(web_results) = 0 AND resolved_doc_ids non-empty`):
```
You are a compliance document analyst.
The document(s) [doc titles] were found but no relevant passages matched your question.
RULES: Do NOT answer from general knowledge. Explain that the specific content 
wasn't found in the attached documents and suggest the user refine their question.
```

**Mode selection logic (evaluated at Step 5, after web search runs):**
```
if len(chunks) > 0 or len(web_results) > 0:   → Mode A
elif resolved_doc_ids:                          → Mode C
else:                                           → Mode B
```
This must run AFTER Step 3 (web search) so `web_results` is populated before the check.
In the current code, system prompt is built at Step 5 — correct placement.

**Why Mode C is important:** If a user tags a specific compliance document and asks
about something not in it, we must NOT silently switch to general knowledge — that would
be dangerous for a compliance tool (false confidence). We explicitly tell them the content
wasn't found.

**Confidence mapping:**
| Mode | `retrieval_confidence` | `confidence_score` |
|------|----------------------|-------------------|
| A (chunks found) | existing tier (high/medium/low) | existing avg_similarity |
| B (no docs) | `"low"` | `0.0` |
| C (docs but no chunks) | `"low"` | `0.0` |

**Test — 4 scenarios:**

| Scenario | Input | Expected Behavior |
|----------|-------|-------------------|
| S1: Explicit doc, clear query | `@Inquire @MBG Explain` | `rewrite_query` → optimized query → chunks found → RAG answer with citations |
| S2: Explicit doc, short query | `@Inquire @Atomic Habits Summary` | `rewrite_query` → `"Summary of key habits in Atomic Habits"` → chunks found |
| S3: No docs, general question | `What is capital interest?` | no docs resolved, no chunks → general knowledge mode → low confidence badge |
| S4: Doc resolved, content not found | `@Inquire @MBG What is quantum physics?` | chunks=0, doc present → Mode C response: "not found in document" |

---

### Phase 5 — Final Integration Check

**Regression test — all existing behaviors must still work:**
- Pure mention `@Summarize @Atomic Habits` → pure mention shortcut fires → `clean_query=""`
  and `resolved_doc_titles = {"abc...": "Atomic Habits"}` written to state → summarize node
  reads `resolved_doc_titles` directly for its stratified sampling call (NO `rewrite_query`
  call — summarize uses positional chunk sampling, not semantic search).
- PalAssist interrupt flow → `base_result` always includes `clean_query` + `resolved_doc_titles`
  → both Gate 1 and Gate 2 resume paths automatically forward them via `{**base_result, ...}`
- Cancel flow → `Command(goto="format_response")` path unchanged; no new fields affect it
- LangSmith tracing → `rewrite_query` appears as a `tool` span inside `inquire_action`, between
  the state reads and the `search_chunks` call

**`rewrite_query` is called by:** `inquire` only (in this phase). Compare and audit nodes
will add it when they are implemented in Phase 2 and 3 of `final-plan.md`.
**`rewrite_query` is NOT called by:** `summarize` (stratified sampling — no semantic search)

---

## 5. What This Fixes

| Issue | Before | After |
|-------|--------|-------|
| Multi-word mention stripping | `@Muscle` stripped → `Building Guide` leaked | TipTap walk → `clean_query` in state (no leakage) |
| Query quality | "Building Guide Explain" (sim=0.29) | Action-aware rewriter: "Explain key concepts from MBG" (sim=0.60+) |
| Retrieval success | 0 chunks returned | 5+ relevant chunks returned |
| Doc resolver LLM context | Sees `" Explain"` → wrong reasoning | Sees full message → accurate reasoning in LangSmith |
| `inference_source` metadata | `"inferred"` when doc was explicitly tagged | `"explicit"` — correct |
| General questions | Dead end: "No relevant documents found" | General knowledge mode with low confidence badge |
| Doc found but content missing | Silent general answer (wrong for compliance) | Mode C: explicitly tells user content not in document |
| Audit retrieval | Generic query for compliance audit | Action-aware prompt extracts compliance themes |
| Doc titles in action nodes | Action nodes query DB for names | `resolved_doc_titles` in state — zero extra DB calls |
| Implicit ref safety | Heuristic expansion = new failure modes | Full message to LLM + unchanged pure-mention shortcut |
