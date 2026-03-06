[PM MODE]

Here’s a focused implementation plan for cleaning up LangSmith traces while keeping real failures visible.

---

### 🎯 Scope & Goal

- **Problem:** LangSmith marks many successful chat runs as errors due to `GeneratorExit` / cancellation bubbling out of the streaming generator, even though the UI got a full answer.
- **User impact:** Traces look flaky in your portfolio, hiding the fact that the system actually works well.
- **Goal:**  
  - Treat **normal stream shutdowns** (client disconnects, cancellations, generator close) as **non-errors** (green traces).  
  - Keep **true failures** (LLM errors, DB errors, schema issues) as red errors in LangSmith.
- **Demo-critical:** Yes. Observability is part of what you’re selling here.

---

### Current Architecture (relevant pieces)

- `backend/app/routers/chat.py`
  - `_stream_graph()` async generator:
    - Wraps `graph.astream(..., stream_mode="updates")` in `ls.tracing_context(...)` → everything is traced.
    - Yields `StatusEvent`, `InterruptResponse`, and `ChatResponse` SSE events.
    - On `Exception`, logs traceback and yields an SSE `{type:"error"}`.
  - `chat()` / `resume_chat()` return `StreamingResponse(_stream_graph(...))`.
- Frontend: `hooks/use-chat-stream.ts`
  - Uses `fetch` + `ReadableStream` + `AbortController`.
  - Treats `"AbortError"` as an intentional cancel, and shows **client-side** timeout/connection messages.

**Key observation:**  
- Successful conversations already emit a terminal `response` or `interrupt` SSE event.
- The `GeneratorExit` in LangSmith happens **after** that, during generator shutdown, and should be considered a **lifecycle event**, not a logical error.

---

### Implementation Plan: Fix LangSmith Traces

#### API Contract (unchanged)

- **Frontend → Backend**: `POST /api/chat` and `/api/chat/resume` remain the same. No contract changes.
- **Backend → Frontend**: SSE events keep the same shapes:
  - `StatusEvent` (type `"status"`)
  - `InterruptResponse` (type `"interrupt"`)
  - `ChatResponse` (type `"response"`)
  - Error events (type `"error"`, `message: string`)

We’re only changing **how exceptions are classified and surfaced**, not the wire format.

---

### Phase 1 — Classify Shutdown vs Real Errors in `_stream_graph`

**Goal:** Stop treating normal shutdown signals as “errors” in LangSmith.

**Files:**
- `backend/app/routers/chat.py`

**Tasks:**

1. **Research**  
   - Confirm how `asyncio.CancelledError` and `GeneratorExit` arise in `StreamingResponse`:
     - Client disconnect / abort → `asyncio.CancelledError`
     - Generator finished / closed → `GeneratorExit`
   - Confirm that AnyIO’s internal `CancelledError` type is *not needed* in the router (and that importing it is brittle / version-dependent).

2. **Refine exception handling in `_stream_graph`**
   - Keep the main `async for chunk in graph.astream(...)` loop and status/response emission logic as-is.
   - Introduce a **dedicated exception branch**:
     - `except (GeneratorExit, asyncio.CancelledError):`
       - Treat this as **normal shutdown**:
         - Do **not** yield an SSE `"error"` event.
         - Do **not** log as an error.
         - Simply `return` from the generator.
   - Keep a separate:
     - `except Exception as exc:`
       - This remains the “real error” path and will be adjusted in Phase 2.

3. **Cleanup**
   - Remove any unused AnyIO-specific imports (`from anyio import CancelledError`).
   - Ensure imports reflect only what we actually use.

**Test (manual)**
- Start backend, send a normal chat:
  - Verify: UI receives full answer, no server crash.
  - Check logs: no error log around `GeneratorExit`.
  - Verify in LangSmith (once MCP is working again): run is **green**, no `GeneratorExit` stack in the error field.

---

### Phase 2 — Preserve Real Errors as Red in LangSmith

**Goal:** Keep the UX-friendly SSE error message *and* make sure LangSmith still sees genuine failures as errors.

**Files:**
- `backend/app/routers/chat.py`

**Tasks:**

1. **Clarify “real error” behavior**
   - For any non-shutdown exception (e.g. OpenAI error, DB error, unexpected bug), we want:
     - The frontend to receive an SSE error event (`{ type: "error", message: ... }`) so it can show a friendly toast.
     - LangSmith to mark the run as **errored**, with traceback.

2. **Adjust generic exception branch**
   - In `except Exception as exc:`:
     - Log the stack trace (already present).
     - Yield a single **terminal** SSE `"error"` event with a user-friendly message.
     - Then **re-raise** the exception so the LangSmith tracing context can record the run as errored.

3. **Check that only one terminal event is emitted**
   - Ensure we never send both a `response`/`interrupt` *and* then an `"error"` for the same run.
   - Current logic (return immediately after `format_response`) already enforces a single terminal event.

**Test**
- Force a backend error (e.g., mock a failure in one node):
  - UI should show an error via onError callback.
  - LangSmith should show the run as **error** with stack trace.
- Confirm that **successful** runs (Phase 1) remain green.

---

### Phase 3 — Scenario & Edge-Case Validation

**Goal:** Confirm behavior matches the intended matrix across common and tricky scenarios.

**Files:**
- Backend: `chat.py`
- Frontend: `hooks/use-chat-stream.ts` (read-only; no changes expected)

**Scenarios to validate:**

1. **Normal success**
   - User sends a message, gets status events, then a `response`.
   - Connection closes.
   - **Expected:** No error logged; LangSmith ✅; UI shows answer.

2. **Interrupt (PalAssist)**
   - Query that triggers `interrupt()`.
   - **Expected:** `interrupt` terminal event; LangSmith ✅; no error stack.

3. **Client abort after success**
   - After receiving answer, quickly navigate away or abort in devtools.
   - **Expected:** No extra error in logs; LangSmith ✅ for that run.

4. **Client abort mid-run**
   - Abort the request while statuses are streaming.
   - Frontend already treats this as `"Connection lost"` or similar.
   - **Expected:** No error event from server; LangSmith ✅ (classified as normal shutdown).

5. **Frontend timeout (120s)**
   - Simulate slow backend (e.g. long sleep in a node) and let the 120s timeout abort.
   - **Expected:** Frontend shows timeout message; backend sees `asyncio.CancelledError`, swallows it; LangSmith ✅.

6. **Real backend error**
   - Force a non-shutdown exception in an action node.
   - **Expected:** SSE `"error"` event; LangSmith ❌ with traceback.

---

### Demo Considerations

- **Performance:** No extra network calls; only minor exception branching in `_stream_graph` — negligible overhead.
- **Reliability:** Narrow, targeted change inside a single router module; does not affect core graph logic or schemas.
- **Observability:**  
  - Good runs: green traces, clean logs.  
  - Bad runs: red traces, stack trace, and user-visible error.  
  This is exactly what interviewers expect in a production-grade agent.

---

### 📋 Plan Summary: “Fix LangSmith Streaming Traces”

**Phases:** 3 phases, ~1 hour total

1. **Phase 1 – Shutdown classification**
   - Treat `GeneratorExit` + `asyncio.CancelledError` as normal (no SSE error, no red trace).
2. **Phase 2 – Real error propagation**
   - Keep SSE error UX, re-raise real exceptions so LangSmith marks runs as errored.
3. **Phase 3 – Scenario validation**
   - Validate behavior across success, interrupt, client abort, timeout, and real failures.

**Key decisions:**
- Don’t tie router logic to AnyIO’s internal exception types; rely on `asyncio.CancelledError` + `GeneratorExit`.
- One and only one terminal SSE event per run (`response` / `interrupt` / `error`).

**Risks & mitigation:**
- **Risk:** In rare cases, client might not receive the final SSE error before disconnect.  
  **Mitigation:** Frontend already has robust timeout + disconnect handling; LangSmith still correctly records the failure.
- **Risk:** Misclassification of a real error as a shutdown.  
  **Mitigation:** Exception taxonomy is narrow: only `GeneratorExit` and cancellation are swallowed; everything else is treated as real error.

If you’re happy with this plan, next step is to implement Phases 1–2 in `chat.py` (we’ve already partially moved in this direction; we’d now align it exactly to this plan) and then test against the scenario matrix.