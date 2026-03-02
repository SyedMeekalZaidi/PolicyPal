# Pydantic schemas for LLM structured output across all action nodes.
#
# Used with llm_service.invoke_structured(action, Schema, messages) → LLMResult.
# All action nodes import from this file to avoid duplication.

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


class SummarizeResponse(BaseModel):
    """Structured output for the Summarize action node."""

    summary: str = Field(
        description=(
            "Full structured summary of the document(s) with inline [N] citation markers. "
            "For multiple documents, use '### DocumentTitle' markdown headings to separate each section. "
            "Place [N] markers immediately after each specific claim, e.g. "
            "'Training frequency should be 2-4 times per week [1].'"
        )
    )
    key_points: list[str] = Field(
        description=(
            "3-7 concise key takeaways distilled from the document(s). "
            "Each entry is 1-2 sentences covering a distinct insight. "
            "No citation markers needed — these complement the summary."
        )
    )
    citations: list[Citation] = Field(
        description=(
            "One Citation entry per unique [N] marker used in the summary. "
            "id must match the [N] number. Ordered by first appearance. "
            "source_type is always 'document' for Summarize (no web sources)."
        )
    )


class CompareIntent(BaseModel):
    """Structured output for the Compare mode classification step.

    A cheap GPT-4o-mini call that runs before retrieval to decide which
    pipeline to use: targeted per-doc semantic search (focused) or
    stratified full-doc sampling + theme extraction (holistic).
    """

    mode: Literal["focused", "holistic"] = Field(
        description=(
            "'focused' if the user asks about a specific topic or aspect of the documents. "
            "'holistic' if they want a general, comprehensive, or full comparison."
        )
    )
    topic: Optional[str] = Field(
        default=None,
        description=(
            "The specific comparison topic extracted from the user's request (2-10 words). "
            "Only set for 'focused' mode. Null for 'holistic' mode."
        ),
    )


class CompareResponse(BaseModel):
    """Structured output for the Compare action node (both focused and holistic modes).

    Mode-specific structure is encoded in the markdown via prompt instructions:
    - Focused: comparison TABLE + 2-3 paragraph analysis
    - Holistic: 5-section report with ### headings
    The frontend CitedMarkdown component renders both formats correctly.
    """

    response: str = Field(
        description=(
            "Markdown-formatted comparison with inline [N] citation markers. "
            "Focused mode: starts with a comparison table (| Aspect | Doc1 | Doc2 |) "
            "followed by a 2-3 paragraph analysis. "
            "Holistic mode: a 5-section report with '### Overview', '### Key Differences', "
            "'### Similarities', '### Unique Aspects', '### Implications' headings. "
            "Place [N] markers immediately after factual claims in both table cells and prose."
        )
    )
    citations: list[Citation] = Field(
        description=(
            "One Citation entry per unique [N] marker used in the response. "
            "id must match the [N] number. Ordered by first appearance. "
            "source_type is always 'document' for Compare (no web sources)."
        )
    )


class AuditFinding(BaseModel):
    """A single structured compliance finding from the Audit action node.

    Parallel to the markdown blockquote entries in AuditResponse.response — the LLM
    generates both from the same analysis in one call. This structured list enables
    programmatic access and future severity-badge UI components.
    """

    severity: Literal["Critical", "High", "Medium", "Low"] = Field(
        description=(
            "Compliance severity: "
            "'Critical' = immediate regulatory violation requiring urgent action, "
            "'High' = significant gap to address promptly, "
            "'Medium' = partial compliance, improvement recommended, "
            "'Low' = minor or best-practice enhancement."
        )
    )
    theme: str = Field(
        description="The compliance area this finding relates to (e.g. 'Capital Requirements', 'Data Retention')."
    )
    description: str = Field(
        description="1-2 sentence explanation of the gap or area of alignment between the source material and the regulation."
    )
    suggestion: str = Field(
        description="One actionable remediation step the organisation should take to address this finding."
    )


class AuditResponse(BaseModel):
    """Structured output for the Audit action node (both text mode and policy mode).

    response: beautifully formatted markdown rendered directly by CitedMarkdown
              (severity emojis, blockquotes, ### headings — zero frontend changes needed).
    findings: structured list for programmatic access and future UI severity badges.
    Both are generated from the same LLM analysis in one call.
    """

    overall_status: Literal["Compliant", "Minor Issues", "Major Violations"] = Field(
        description=(
            "Top-level compliance verdict: "
            "'Major Violations' if at least one Critical finding exists, "
            "'Minor Issues' if no Critical but High or Medium findings exist, "
            "'Compliant' if only Low findings or no findings."
        )
    )
    response: str = Field(
        description=(
            "Full markdown audit report with inline [N] citation markers, severity emojis, "
            "and professional structure. Starts with '### {emoji} {overall_status}', "
            "followed by '#### Audit Summary', then per-finding blockquotes grouped by severity "
            "(Critical first, then High, Medium, Low), ending with '#### Recommendations'. "
            "Place [N] markers after every regulatory requirement cited."
        )
    )
    findings: list[AuditFinding] = Field(
        description=(
            "One AuditFinding entry per compliance gap or notable observation identified. "
            "Must mirror the findings described in the response field. "
            "Ordered by severity: Critical first, then High, Medium, Low."
        )
    )
    citations: list[Citation] = Field(
        description=(
            "One Citation entry per unique [N] marker used in the response. "
            "id must match the [N] number exactly. Ordered by first appearance. "
            "source_type is always 'document' for Audit (no web sources). "
            "Only regulatory document chunks are cited — source material is never cited."
        )
    )
