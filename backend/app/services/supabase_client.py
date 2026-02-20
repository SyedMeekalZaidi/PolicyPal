# Shared Supabase admin client for backend operations.
# Uses the service key to bypass RLS — all queries MUST include user_id
# explicitly for data isolation. Never expose this client to the browser.

from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache()
def get_supabase() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_secret_key)
