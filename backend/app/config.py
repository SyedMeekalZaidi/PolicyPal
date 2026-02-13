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
    
    # LangSmith
    langsmith_api_key: str
    langsmithtracing_v2: str = "true"
    langsmith_project: str = "policypal"
    
    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()