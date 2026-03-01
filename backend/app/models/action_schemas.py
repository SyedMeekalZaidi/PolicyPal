# Pydantic schemas for LLM structured output across all action nodes.
#
# Used with llm_service.invoke_structured(action, Schema, messages) → LLMResult.
# All action nodes import from this file to avoid duplication.
# Phases 2-4 add SummarizeResponse, CompareIntent, CompareResponse, AuditResult here.

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Citation(BaseModel):
    """A single source citation produced by an action node LLM call."""

    id: int = Field(
        description="The [N] number used in the response text for this citation (1-indexed)"
    )
    source_type: Literal["document", "web"] = Field(
        description="'document' for uploaded regulatory docs, 'web' for Tavily web results"
    )
    doc_id: Optional[str] = Field(
        default=None,
        description="UUID of the source document (from DocID in context block). Null for web sources.",
    )
    title: str = Field(
        description="Document title or web page title"
    )
    page: Optional[int] = Field(
        default=None,
        description="Page number from the document. Null if unavailable or web source.",
    )
    url: Optional[str] = Field(
        default=None,
        description="URL for web sources. Null for document sources.",
    )
    quote: str = Field(
        description="Verbatim excerpt from the source that directly supports the cited claim"
    )


class InquireResponse(BaseModel):
    """Structured output for the Inquire action node."""

    response: str = Field(
        description=(
            "Full answer to the user's question with inline [N] citation markers. "
            "Place each marker immediately after the claim it supports, e.g. "
            "'The minimum capital ratio is 8% [1]. Quarterly reports are required [2][3].'"
        )
    )
    citations: list[Citation] = Field(
        description=(
            "One Citation entry per unique [N] marker used in the response. "
            "id must match the [N] number. Ordered by first appearance."
        )
    )
