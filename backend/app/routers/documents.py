# Document ingestion router.
# POST /ingest  — upload + process new PDF
# POST /retry/{document_id} — re-process a failed document from stored file
#
# Security: user_id is injected by the Next.js proxy from the Supabase session.
# The backend validates it is a valid UUID and verifies document ownership.
# The Supabase admin client bypasses RLS, so every query filters by user_id explicitly.

import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.models.schemas import DocType, DocumentStatus, IngestResponse, RetryResponse
from app.services.embedding_service import embed_texts
from app.services.processing_service import extract_and_chunk
from app.services.storage_service import (
    delete_file,
    download_file,
    file_exists,
    upload_file,
)
from app.services.supabase_client import get_supabase

router = APIRouter()

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


def _validate_uuid(value: str, field_name: str) -> None:
    """Raise 400 if value is not a valid UUID."""
    try:
        uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format")


def _set_failed(document_id: str, error_message: str) -> None:
    """Update document status to failed with a user-friendly error message."""
    get_supabase().table("documents").update(
        {"status": "failed", "error_message": error_message}
    ).eq("id", document_id).execute()


@router.post("/ingest", response_model=IngestResponse)
async def ingest_document(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    title: str = Form(...),
    version: Optional[str] = Form(None),
    doc_type: DocType = Form(...),
    set_id: Optional[str] = Form(None),
):
    """
    Upload and process a PDF document:
    1. Validate inputs
    2. Create document record (status=processing)
    3. Upload PDF to Supabase Storage
    4. Extract text + chunk + embed
    5. Save chunks atomically + mark status=ready
    """
    # Validate user_id and optional set_id are valid UUIDs
    _validate_uuid(user_id, "user_id")
    if set_id:
        _validate_uuid(set_id, "set_id")

    # Validate file is a PDF
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400, detail="File too large. Maximum size is 20MB"
        )

    original_filename = file.filename or "document.pdf"
    supabase = get_supabase()

    # Pre-generate document_id so storage path can be set upfront
    document_id = str(uuid.uuid4())
    storage_path = f"{user_id}/{document_id}/{original_filename}"

    # Step 1: Create document record with status=processing
    supabase.table("documents").insert(
        {
            "id": document_id,
            "user_id": user_id,
            "title": title,
            "version": version,
            "doc_type": doc_type.value,
            "set_id": set_id,
            "storage_path": storage_path,
            "status": "processing",
            "original_filename": original_filename,
            "chunk_count": 0,
        }
    ).execute()

    # Step 2: Upload PDF to Supabase Storage
    try:
        upload_file(supabase, file_bytes, user_id, document_id, original_filename)
    except Exception:
        _set_failed(document_id, "Failed to upload file to storage. Please try again.")
        return IngestResponse(
            document_id=document_id,
            status=DocumentStatus.failed,
            error_message="Failed to upload file to storage. Please try again.",
        )

    # Steps 3-6: Extract, chunk, embed, save
    try:
        chunks = extract_and_chunk(file_bytes)
        texts = [c.content for c in chunks]
        embeddings = embed_texts(texts)

        chunk_records = [
            {
                "user_id": user_id,
                "document_id": document_id,
                "chunk_index": chunk.chunk_index,
                "page": chunk.page,
                "content": chunk.content,
                "embedding": embedding,
            }
            for chunk, embedding in zip(chunks, embeddings)
        ]

        # Insert all chunks in one batch (atomic at the API level)
        supabase.table("chunks").insert(chunk_records).execute()

        # Mark document as ready
        supabase.table("documents").update(
            {"status": "ready", "chunk_count": len(chunks)}
        ).eq("id", document_id).execute()

        return IngestResponse(
            document_id=document_id,
            status=DocumentStatus.ready,
            chunk_count=len(chunks),
            message="Document processed successfully",
        )

    except ValueError as e:
        # User-fixable errors (empty PDF, scanned PDF, etc.)
        error_msg = str(e)
        _set_failed(document_id, error_msg)
        return IngestResponse(
            document_id=document_id,
            status=DocumentStatus.failed,
            error_message=error_msg,
        )

    except Exception:
        _set_failed(
            document_id,
            "Processing failed. Please try again or check that the PDF contains readable text.",
        )
        return IngestResponse(
            document_id=document_id,
            status=DocumentStatus.failed,
            error_message="Processing failed. Please try again or check that the PDF contains readable text.",
        )


@router.post("/retry/{document_id}", response_model=RetryResponse)
async def retry_document(document_id: str, user_id: str = Form(...)):
    """
    Re-process a failed document using its already-stored PDF file.
    No re-upload needed — downloads from Supabase Storage and re-runs the pipeline.
    """
    _validate_uuid(user_id, "user_id")
    _validate_uuid(document_id, "document_id")

    supabase = get_supabase()

    # Fetch document and verify ownership + status
    result = (
        supabase.table("documents")
        .select("id, user_id, status, storage_path, original_filename")
        .eq("id", document_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = result.data

    if doc["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Document does not belong to this user")

    if doc["status"] != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Document cannot be retried (current status: {doc['status']})",
        )

    storage_path = doc["storage_path"]

    # Check file exists in storage before marking as processing
    if not file_exists(supabase, user_id, document_id):
        raise HTTPException(
            status_code=404,
            detail="Original file not available in storage. Please delete this document and re-upload.",
        )

    # Mark as processing so UI shows shimmer immediately
    supabase.table("documents").update(
        {"status": "processing", "error_message": None}
    ).eq("id", document_id).execute()

    # Delete any partial chunks from previous attempt
    supabase.table("chunks").delete().eq("document_id", document_id).execute()

    # Re-process from stored file
    try:
        file_bytes = download_file(supabase, storage_path)
        chunks = extract_and_chunk(file_bytes)
        texts = [c.content for c in chunks]
        embeddings = embed_texts(texts)

        chunk_records = [
            {
                "user_id": user_id,
                "document_id": document_id,
                "chunk_index": chunk.chunk_index,
                "page": chunk.page,
                "content": chunk.content,
                "embedding": embedding,
            }
            for chunk, embedding in zip(chunks, embeddings)
        ]

        supabase.table("chunks").insert(chunk_records).execute()
        supabase.table("documents").update(
            {"status": "ready", "chunk_count": len(chunks)}
        ).eq("id", document_id).execute()

        return RetryResponse(
            document_id=document_id,
            status=DocumentStatus.ready,
            chunk_count=len(chunks),
            message="Document reprocessed successfully",
        )

    except ValueError as e:
        error_msg = str(e)
        _set_failed(document_id, error_msg)
        return RetryResponse(
            document_id=document_id,
            status=DocumentStatus.failed,
            error_message=error_msg,
        )

    except Exception:
        _set_failed(
            document_id,
            "Reprocessing failed. Please try again or check that the PDF contains readable text.",
        )
        return RetryResponse(
            document_id=document_id,
            status=DocumentStatus.failed,
            error_message="Reprocessing failed. Please try again or check that the PDF contains readable text.",
        )
