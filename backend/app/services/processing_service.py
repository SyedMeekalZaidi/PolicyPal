# PDF text extraction and chunking service.
# Uses pypdf directly (no temp files) + RecursiveCharacterTextSplitter.
# Preserves page numbers through the splitting process via LangChain Document metadata.

from dataclasses import dataclass
from io import BytesIO

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from pypdf.errors import PdfStreamError

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
MIN_TEXT_LENGTH = 50  # Below this = likely scanned/corrupted/empty PDF


@dataclass
class ChunkData:
    content: str
    page: int  # 1-based page number
    chunk_index: int  # 0-based position within document


def extract_and_chunk(file_bytes: bytes) -> list[ChunkData]:
    """
    Extract text from PDF bytes and split into overlapping chunks.
    Raises ValueError with a user-friendly message on empty/unreadable PDFs.
    """
    try:
        reader = PdfReader(BytesIO(file_bytes))
    except (PdfStreamError, Exception) as e:
        raise ValueError(
            "Could not read the PDF file. It may be corrupted or password-protected."
        ) from e

    # Extract text page-by-page, tracking page numbers
    documents: list[Document] = []
    for page_num, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            documents.append(
                Document(
                    page_content=text,
                    metadata={"page": page_num + 1},  # 1-based for citations
                )
            )

    # Validate we have extractable text before embedding
    total_text = " ".join(doc.page_content for doc in documents)
    if len(total_text.strip()) < MIN_TEXT_LENGTH:
        raise ValueError(
            "No extractable text found. "
            "The PDF may be image-based (scanned), corrupted, or password-protected."
        )

    # Split into chunks while preserving page metadata
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    split_docs = splitter.split_documents(documents)

    return [
        ChunkData(
            content=doc.page_content,
            page=doc.metadata.get("page", 1),
            chunk_index=i,
        )
        for i, doc in enumerate(split_docs)
    ]
