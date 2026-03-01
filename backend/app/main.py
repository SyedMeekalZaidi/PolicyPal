# load_dotenv() must be called before any app module imports so that
# LANGSMITH_TRACING and other env vars are in os.environ when the SDK initialises.
# Explicit path + override=True: works regardless of CWD and always wins over stale OS env vars.
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

# Backward-compat aliases: some langchain_core / langsmith versions check LANGCHAIN_* prefix.
# Set them programmatically so we don't duplicate secrets in the .env file.
if os.environ.get("LANGSMITH_API_KEY") and not os.environ.get("LANGCHAIN_API_KEY"):
    os.environ["LANGCHAIN_API_KEY"] = os.environ["LANGSMITH_API_KEY"]
if os.environ.get("LANGSMITH_TRACING") and not os.environ.get("LANGCHAIN_TRACING_V2"):
    os.environ["LANGCHAIN_TRACING_V2"] = os.environ["LANGSMITH_TRACING"]

logging.basicConfig(level=logging.INFO)
_startup_logger = logging.getLogger(__name__)

# Show key prefix so quote-pollution (e.g. "lsv2_..." vs lsv2_...) is instantly visible
_raw_key = os.environ.get("LANGSMITH_API_KEY", "")
_key_preview = (_raw_key[:10] + "...") if len(_raw_key) > 10 else _raw_key or "(not set)"
_startup_logger.info(
    "LangSmith | tracing=%s project=%s endpoint=%s key_preview=%s",
    os.environ.get("LANGSMITH_TRACING"),
    os.environ.get("LANGSMITH_PROJECT"),
    os.environ.get("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com"),
    _key_preview,
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.chat import router as chat_router
from app.routers.documents import router as documents_router

app = FastAPI(title="PolicyPal API")


@app.on_event("startup")
def _verify_langsmith() -> None:
    """Validate LangSmith API key is set and reachable."""
    api_key = os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY")
    project = os.environ.get("LANGSMITH_PROJECT", "default")

    if not api_key:
        _startup_logger.warning("LangSmith ✗ LANGSMITH_API_KEY is not set — tracing disabled")
        return

    try:
        from langsmith import Client
        client = Client(api_key=api_key)
        next(client.list_projects(limit=1), None)
        _startup_logger.info("LangSmith ✓ API key valid — project=%s", project)
    except Exception as exc:
        _startup_logger.warning("LangSmith ✗ API check FAILED: %s", exc)

# Allow Next.js frontend to call backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router, tags=["documents"])
app.include_router(chat_router, tags=["chat"])


@app.get("/")
def read_root():
    return {"message": "PolicyPal API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
