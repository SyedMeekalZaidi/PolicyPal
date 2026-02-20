# Pydantic models for document ingestion request/response validation.
# These define the data shapes that FastAPI validates automatically.

from enum import Enum
from typing import Optional

from pydantic import BaseModel


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
