from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_secret_key: str
    database_url: str
    direct_url: str
    
    # OpenAI
    openai_api_key: str
    
    # LangSmith — field names map 1:1 to env var names (case-insensitive).
    # LANGSMITH_TRACING is the var the SDK reads from os.environ to enable tracing.
    langsmith_api_key: str
    langsmith_tracing: str = "true"
    langsmith_project: str = "policypal"
    langsmith_endpoint: str = "https://api.smith.langchain.com"

    # Tavily web search (optional — empty default allows startup without the key)
    tavily_api_key: str = ""
    
    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()