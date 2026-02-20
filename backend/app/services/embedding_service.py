# OpenAI embedding service.
# Wraps text-embedding-3-small with batching to handle large documents.
# Batch size of 2000 stays within OpenAI's per-request limit.

from openai import OpenAI

from app.config import get_settings

MODEL = "text-embedding-3-small"
BATCH_SIZE = 2000


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using OpenAI text-embedding-3-small.
    Batches requests for documents with >2000 chunks.
    Returns a list of 1536-dimensional float vectors in the same order as input.
    """
    client = OpenAI(api_key=get_settings().openai_api_key)
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        response = client.embeddings.create(model=MODEL, input=batch)
        # Sort by index to guarantee order matches input
        sorted_data = sorted(response.data, key=lambda x: x.index)
        all_embeddings.extend([item.embedding for item in sorted_data])

    return all_embeddings
