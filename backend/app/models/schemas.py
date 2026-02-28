# Pydantic models for:
#   - Document ingestion request/response validation (existing)
#   - Chat SSE endpoint request/response types (new)
#
# SSE event models use Literal "type" fields so the frontend can do
# discriminated union switching: switch(event.type) { "status" | "response" | "interrupt" }

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class DocType(str, Enum):
    company_policy = "company_policy"
    regulatory_source = "regulatory_source"


class DocumentStatus(str, Enum):
    processing = "processing"
    ready = "ready"
    failed = "failed"


class IngestResponse(BaseModel):
    document_id: str
    status: DocumentStatus
    chunk_count: Optional[int] = None
    message: Optional[str] = None
    error_message: Optional[str] = None


class RetryResponse(BaseModel):
    document_id: str
    status: DocumentStatus
    chunk_count: Optional[int] = None
    message: Optional[str] = None
    error_message: Optional[str] = None


# ---------------------------------------------------------------------------
# Chat SSE request / response models
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str
    tiptap_json: dict
    thread_id: str
    user_id: str  # injected server-side by Next.js proxy — never trusted from client
    tagged_doc_ids: list[str] = Field(default_factory=list)
    tagged_set_ids: list[str] = Field(default_factory=list)
    action: Optional[str] = None  # None = let intent_resolver classify
    enable_web_search: bool = False


class StatusEvent(BaseModel):
    """SSE event emitted after each graph node completes (0-N per request)."""

    type: Literal["status"] = "status"
    node: str
    message: str
    docs_found: Optional[list[dict]] = None  # populated by doc_resolver only
    web_query: Optional[str] = None  # populated by action nodes when web search runs


class ChatResponse(BaseModel):
    """Terminal SSE event — the final AI response. Ends the stream."""

    type: Literal["response"] = "response"
    response: str
    citations: list[dict] = Field(default_factory=list)
    action: str
    inference_confidence: str  # "high" | "medium" | "low" — set by doc_resolver
    retrieval_confidence: str  # "high" | "medium" | "low" — set by action node
    tokens_used: int = 0
    cost_usd: float = 0.0


class InterruptResponse(BaseModel):
    """Terminal SSE event — graph paused, PalAssist should render. Ends the stream."""

    type: Literal["interrupt"] = "interrupt"
    interrupt_type: str  # "doc_choice" | "text_input" | "action_choice" | "retrieval_low"
    message: str  # human-readable prompt shown in PalAssist
    options: Optional[list[dict]] = None  # [{ id, label }] for choice types; None for text_input


class ResumeValue(BaseModel):
    type: str  # "doc_choice" | "text_input" | "action_choice" | "cancel"
    value: Optional[str] = None  # UUID / free text / action name / null (cancel)


class ResumeRequest(BaseModel):
    thread_id: str
    user_id: str  # injected server-side by Next.js proxy
    resume_value: ResumeValue


# ---------------------------------------------------------------------------
# Chat history response models (Phase 2.7a)
# ---------------------------------------------------------------------------


class ChatHistoryMessage(BaseModel):
    """A single serialised LangChain message from the checkpoint store."""

    id: str                  # message.id — generated UUID, stable across loads
    role: str                # "user" | "assistant"
    content: str             # plain text content
    metadata: dict = Field(default_factory=dict)  # additional_kwargs (citations etc.)


class ChatHistoryResponse(BaseModel):
    thread_id: str
    messages: list[ChatHistoryMessage]
    pending_interrupt: Optional[InterruptResponse] = None


# ---------------------------------------------------------------------------
# NODE_STATUS_MAP — re-exported from graph/state.py (canonical location).
# chat.py and any other importer can continue using `from app.models.schemas
# import NODE_STATUS_MAP` without change.
# ---------------------------------------------------------------------------

from app.graph.state import NODE_STATUS_MAP as NODE_STATUS_MAP  # noqa: F401
