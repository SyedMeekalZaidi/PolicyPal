# Chat SSE router.
# POST /chat        — streams graph.astream(stream_mode="updates") events + final ChatResponse
# POST /chat/resume — streams graph.astream(Command(resume=value), ...) for PalAssist
#
# SSE format: each yield is one complete event line -> "data: {json}\n\n"
# Once streaming starts the status code is locked — errors after that point are
# yielded as {"type": "error", "message": "..."} events, not HTTP error responses.

import json
import logging
import traceback
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command

from app.models.schemas import (
    NODE_STATUS_MAP,
    ChatHistoryMessage,
    ChatHistoryResponse,
    ChatRequest,
    ChatResponse,
    InterruptResponse,
    ResumeRequest,
    StatusEvent,
)
from app.graph.state import CANCEL_SENTINEL
from app.services.graph_service import get_compiled_graph
from app.services.supabase_client import get_supabase

router = APIRouter()
logger = logging.getLogger(__name__)

# SSE headers required for correct browser + proxy behaviour.
# Content-Encoding: none prevents Next.js / Nginx from gzip-buffering the stream,
# which would cause all events to arrive at once instead of incrementally.
_SSE_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "none",
}


def _validate_uuid(value: str, field_name: str) -> None:
    """Raise 400 if value is not a valid UUID string."""
    try:
        uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format")


def _sse(event_model) -> str:
    """Serialise a Pydantic model to an SSE data line."""
    return f"data: {event_model.model_dump_json()}\n\n"


def _sse_error(message: str) -> str:
    """Serialise a plain error message to an SSE data line."""
    return f"data: {json.dumps({'type': 'error', 'message': message})}\n\n"


def _get_doc_titles_for_status(doc_ids: list[str], user_id: str) -> list[dict]:
    """
    Query document titles for the resolved doc IDs.
    Returns [{"id": uuid, "title": name}] for StatusEvent docs_found enrichment.
    Silently returns [] on error — status enrichment is best-effort, not critical.
    """
    if not doc_ids:
        return []
    try:
        supabase = get_supabase()
        result = (
            supabase.table("documents")
            .select("id, title")
            .in_("id", doc_ids)
            .eq("user_id", user_id)
            .execute()
        )
        return [{"id": row["id"], "title": row["title"]} for row in (result.data or [])]
    except Exception:
        logger.warning("_get_doc_titles_for_status failed silently", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Shared SSE streaming generator
# ---------------------------------------------------------------------------

def _yield_interrupt(interrupt_val) -> str:
    """
    Serialise an interrupt payload to an SSE InterruptResponse line.

    interrupt_val is the dict passed to interrupt() inside a node:
      {"interrupt_type": "...", "message": "...", "options": [...] | None}
    """
    if not isinstance(interrupt_val, dict):
        # Unexpected format — fall back to a generic text_input prompt
        logger.warning("_yield_interrupt: unexpected value type %s", type(interrupt_val))
        interrupt_val = {
            "interrupt_type": "text_input",
            "message": "Please provide more information.",
            "options": None,
        }
    return _sse(InterruptResponse(
        interrupt_type=interrupt_val.get("interrupt_type", "text_input"),
        message=interrupt_val.get("message", "Please provide more information."),
        options=interrupt_val.get("options"),
    ))


async def _stream_graph(input_or_command, config: dict, user_id: str = ""):
    """
    Core async generator — drives graph.astream(stream_mode="updates") and
    yields SSE data lines.

    Yields (in order):
      - StatusEvent lines for each node completion (one per node, keyed by NODE_STATUS_MAP)
      - InterruptResponse if a node called interrupt() [terminal]
      - ChatResponse after format_response runs [terminal]
      - Error line on any unhandled exception [terminal]

    Chunk shapes from stream_mode="updates":
      Normal node:   { "node_name": { state_keys_written } }
      Interrupt:     { "__interrupt__": (Interrupt(value={...}, id="..."), ...) }

    The "__interrupt__" key is checked FIRST on every chunk — it is not a node
    name and must not be iterated as one.  A post-loop safety net (state.tasks
    inspection) catches any interrupts that didn't appear inline.
    """
    graph = await get_compiled_graph()
    response_yielded = False

    try:
        async for chunk in graph.astream(input_or_command, config, stream_mode="updates"):

            # ── Inline interrupt detection (primary path) ────────────────────
            # When a node calls interrupt(), LangGraph emits a chunk whose only
            # key is "__interrupt__".  Detect it here before the inner loop so
            # we never try to look it up in NODE_STATUS_MAP.
            if "__interrupt__" in chunk:
                interrupts = chunk["__interrupt__"]
                if interrupts:
                    logger.info(
                        "_stream_graph | __interrupt__ chunk detected, thread=%s",
                        config.get("configurable", {}).get("thread_id"),
                    )
                    yield _yield_interrupt(interrupts[0].value)
                return  # Stream ends — graph is paused

            # ── Normal node update processing ────────────────────────────────
            for node_name, updates in chunk.items():
                # Skip internal LangGraph bookkeeping nodes (e.g. __start__)
                if node_name not in NODE_STATUS_MAP:
                    continue

                # Some nodes return None instead of a dict when they write no keys
                if updates is None:
                    updates = {}

                # Emit a StatusEvent for every known node
                status = StatusEvent(
                    node=node_name,
                    message=NODE_STATUS_MAP[node_name],
                    docs_found=None,
                    web_query=None,
                )

                # Enrich doc_resolver status with resolved document pills
                if node_name == "doc_resolver":
                    resolved = updates.get("resolved_doc_ids") or []
                    if resolved and user_id:
                        status.docs_found = _get_doc_titles_for_status(resolved, user_id)

                # Enrich any action node that performed web search
                if updates.get("web_search_query"):
                    status.web_query = updates["web_search_query"]

                yield _sse(status)

                # After format_response, read final state and emit ChatResponse
                if node_name == "format_response":
                    final_state = await graph.aget_state(config)
                    vals = final_state.values
                    yield _sse(ChatResponse(
                        response=vals.get("response", ""),
                        citations=vals.get("citations", []),
                        action=vals.get("action", "inquire"),
                        # Default "low" — unknown confidence should surface as cautious, not falsely certain
                        inference_confidence=vals.get("inference_confidence") or "low",
                        retrieval_confidence=vals.get("retrieval_confidence") or "low",
                        tokens_used=vals.get("tokens_used", 0),
                        cost_usd=vals.get("cost_usd", 0.0),
                    ))
                    response_yielded = True
                    return  # Stream complete

        # ── Post-loop safety net ─────────────────────────────────────────────
        # Catches any interrupt that didn't appear as an inline "__interrupt__"
        # chunk (e.g. LangGraph version differences or ordering edge cases).
        #
        # Payload contract (Phase 3.1):
        #   interrupt({"interrupt_type": "...", "message": "...", "options": [...]})
        #   → InterruptResponse(type="interrupt", interrupt_type=..., ...)
        if not response_yielded:
            state = await graph.aget_state(config)
            for task in (state.tasks or []):
                interrupts = getattr(task, "interrupts", ())
                if interrupts:
                    logger.info(
                        "_stream_graph | interrupt detected via post-loop state.tasks, thread=%s",
                        config.get("configurable", {}).get("thread_id"),
                    )
                    yield _yield_interrupt(interrupts[0].value)
                    return

            # No interrupt and no response — unexpected graph state
            logger.error(
                "Stream ended without response or interrupt. thread_id=%s",
                config.get("configurable", {}).get("thread_id"),
            )
            yield _sse_error("Graph completed without producing a response.")

    except Exception as exc:
        logger.error("Graph streaming error:\n%s", traceback.format_exc())
        yield _sse_error(f"An error occurred: {str(exc)}")


# ---------------------------------------------------------------------------
# POST /chat
# ---------------------------------------------------------------------------

@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Accepts a chat message and streams SSE events:
      - StatusEvent per node (PalReasoning)
      - InterruptResponse if a node paused on interrupt() (PalAssist)
      - ChatResponse when the full graph run completes

    Initial state includes all TRANSIENT fields (reset each turn).
    conversation_docs is intentionally EXCLUDED so the checkpoint registry persists.
    """
    _validate_uuid(request.user_id, "user_id")
    _validate_uuid(request.thread_id, "thread_id")

    # Build initial state — TRANSIENT fields only.
    # CRITICAL: do NOT include conversation_docs here.
    # Including it (even as {}) would overwrite the checkpoint registry, wiping
    # the name->UUID map built across previous turns.
    initial_state = {
        # Core fields
        "messages": [HumanMessage(content=request.message)],
        "thread_id": request.thread_id,
        "user_id": request.user_id,
        # Action routing
        "action": request.action,               # None -> intent_resolver classifies
        "enable_web_search": request.enable_web_search,
        "set_id": request.tagged_set_ids[0] if request.tagged_set_ids else None,
        # Document resolution inputs
        "explicit_doc_ids": request.tagged_doc_ids,
        "tiptap_json": request.tiptap_json,
        # --- TRANSIENT resets (prevent stale values from previous turn) ---
        "web_search_query": None,
        "web_search_results": None,
        "resolved_doc_ids": [],
        "inference_source": "",
        "has_implicit_refs": False,
        "inferred_doc_ids": [],
        "unresolved_names": [],
        "inference_confidence": "",
        "inference_reasoning": None,
        "suggested_doc_ids": [],
        "retrieved_chunks": [],
        "retrieval_confidence": "",
        "confidence_score": 0.0,
        "response": "",
        "citations": [],
        "tokens_used": 0,
        "cost_usd": 0.0,
    }

    config = {"configurable": {"thread_id": request.thread_id}}

    return StreamingResponse(
        _stream_graph(initial_state, config, user_id=request.user_id),
        headers=_SSE_HEADERS,
    )


# ---------------------------------------------------------------------------
# POST /chat/resume
# ---------------------------------------------------------------------------

@router.post("/chat/resume")
async def resume_chat(request: ResumeRequest):
    """
    Accepts a PalAssist resume value and streams remaining graph nodes + final ChatResponse.

    Command(resume=value) wakes the graph from its interrupt() call:
      - confirm/choice: resume=<selected_value> (str) — node receives the string, continues
      - cancel:         resume=None — node receives None from interrupt(), returns
                        default/minimal state, graph continues to END.
                        Frontend suppresses the resulting empty ChatResponse for cancel.

    Raises 400 if the thread has no pending interrupt (prevents spurious resumes).
    Validation happens BEFORE the StreamingResponse — once streaming starts the
    status code is locked at 200 and errors can only be sent as SSE error events.
    """
    _validate_uuid(request.user_id, "user_id")
    _validate_uuid(request.thread_id, "thread_id")

    config = {"configurable": {"thread_id": request.thread_id}}

    # Validate that this thread actually has a pending interrupt.
    # Must happen before starting the StreamingResponse (status code would lock).
    graph = await get_compiled_graph()
    state = await graph.aget_state(config)
    has_pending_interrupt = any(
        getattr(task, "interrupts", ())
        for task in (state.tasks or [])
    )
    if not has_pending_interrupt:
        raise HTTPException(
            status_code=400,
            detail="No pending action to resume for this conversation.",
        )

    # Use CANCEL_SENTINEL instead of None — LangGraph 1.0.x has an unbound variable
    # bug in _loop._first() that crashes when Command(resume=None) is passed.
    resume_val = request.resume_value.value
    command = Command(resume=CANCEL_SENTINEL if resume_val is None else resume_val)

    return StreamingResponse(
        _stream_graph(command, config, user_id=request.user_id),
        headers=_SSE_HEADERS,
    )


# ---------------------------------------------------------------------------
# GET /chat/history/{thread_id}
# ---------------------------------------------------------------------------

@router.get("/chat/history/{thread_id}", response_model=ChatHistoryResponse)
async def get_chat_history(thread_id: str, user_id: str):
    """
    Return the full message history for a conversation thread.

    Reads directly from the PostgresSaver checkpoint — no separate messages
    table needed. The checkpoint IS the source of truth for message history.

    user_id is injected as a query parameter by the Next.js proxy from the
    Supabase session. We verify the conversation belongs to that user before
    reading the checkpoint to prevent cross-user data access.

    Returns empty messages list for a thread with no checkpoint yet
    (new conversation that hasn't had a message sent yet).
    """
    _validate_uuid(thread_id, "thread_id")
    _validate_uuid(user_id, "user_id")

    # Verify conversation ownership — thread_id == conversation.id in our schema
    supabase = get_supabase()
    ownership = (
        supabase.table("conversations")
        .select("id, user_id")
        .eq("id", thread_id)
        .single()
        .execute()
    )
    if not ownership.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if ownership.data["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Conversation does not belong to this user")

    # Read checkpoint state — contains full message history via add_messages reducer
    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    state = await graph.aget_state(config)

    # Empty state means no messages have been sent yet in this conversation
    raw_messages = (state.values or {}).get("messages", [])

    serialised: list[ChatHistoryMessage] = []
    for msg in raw_messages:
        if isinstance(msg, HumanMessage):
            role = "user"
        elif isinstance(msg, AIMessage):
            role = "assistant"
        else:
            # Skip SystemMessages, ToolMessages, etc. — not shown in chat UI
            continue

        serialised.append(ChatHistoryMessage(
            id=msg.id or str(uuid.uuid4()),
            role=role,
            content=msg.content if isinstance(msg.content, str) else str(msg.content),
            metadata=msg.additional_kwargs or {},
        ))

    # Check for a pending interrupt in this checkpoint — allows PalAssist to
    # restore on page refresh if the user hasn't responded to the interrupt yet.
    pending_interrupt: Optional[InterruptResponse] = None
    for task in (state.tasks or []):
        interrupts = getattr(task, "interrupts", ())
        if interrupts:
            iv = interrupts[0].value
            if isinstance(iv, dict):
                pending_interrupt = InterruptResponse(
                    interrupt_type=iv.get("interrupt_type", "text_input"),
                    message=iv.get("message", "Please provide more information."),
                    options=iv.get("options"),
                )
            break

    return ChatHistoryResponse(
        thread_id=thread_id,
        messages=serialised,
        pending_interrupt=pending_interrupt,
    )
