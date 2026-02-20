# Supabase Storage operations for PDF files.
# Storage path convention: {user_id}/{document_id}/{filename}
# This ensures user isolation and prevents filename collisions.

from supabase import Client

BUCKET = "documents"


def upload_file(
    client: Client,
    file_bytes: bytes,
    user_id: str,
    document_id: str,
    filename: str,
) -> str:
    """Upload PDF bytes to Supabase Storage. Returns the storage path."""
    path = f"{user_id}/{document_id}/{filename}"
    client.storage.from_(BUCKET).upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": "application/pdf"},
    )
    return path


def download_file(client: Client, storage_path: str) -> bytes:
    """Download a file from Supabase Storage by its full path."""
    return client.storage.from_(BUCKET).download(storage_path)


def file_exists(client: Client, user_id: str, document_id: str) -> bool:
    """Check if any file exists in the document's storage folder."""
    try:
        folder = f"{user_id}/{document_id}"
        files = client.storage.from_(BUCKET).list(folder)
        return len(files) > 0
    except Exception:
        return False


def delete_file(client: Client, storage_path: str) -> None:
    """Delete a file from Supabase Storage by its full path."""
    client.storage.from_(BUCKET).remove([storage_path])
