from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.chat import router as chat_router
from app.routers.documents import router as documents_router

app = FastAPI(title="PolicyPal API")

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