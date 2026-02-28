# Singleton service for the compiled LangGraph graph.
#
# Uses AsyncPostgresSaver + AsyncConnectionPool so every checkpoint operation
# (aget_state, astream) works inside FastAPI's async event loop without blocking.
#
# Lazy init: first request to get_compiled_graph() bootstraps the pool,
# runs setup(), and compiles the graph. All subsequent calls return instantly.
#
# Connection note:
#   settings.database_url → Supabase transaction pooler (port 6543)
#   prepare_threshold=None disables prepared statements — required because
#   the pooler shares physical connections; prepared statements collide.

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.config import get_settings

if TYPE_CHECKING:
    from langgraph.graph.state import CompiledStateGraph

logger = logging.getLogger(__name__)

# Module-level singletons — created once per process, reused across requests
_pool: AsyncConnectionPool | None = None
_compiled_graph: "CompiledStateGraph | None" = None
# Lock prevents two concurrent first-requests from both trying to initialise
_init_lock = asyncio.Lock()


async def _get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        logger.info("Initializing async Postgres connection pool...")
        # open=False defers connection opening until pool.open() is awaited below
        _pool = AsyncConnectionPool(
            conninfo=settings.database_url,
            max_size=10,
            open=False,
            kwargs={
                "autocommit": True,         # Required by AsyncPostgresSaver
                "prepare_threshold": None,  # Disable prepared statements — Supabase transaction pooler shares connections
                "row_factory": dict_row,    # Checkpointer reads rows by column name
            },
        )
        await _pool.open()
        logger.info("Async connection pool ready.")
    return _pool


async def get_compiled_graph() -> "CompiledStateGraph":
    """
    Return the singleton compiled LangGraph graph with AsyncPostgresSaver checkpointer.

    First call (guarded by asyncio.Lock to prevent race on concurrent requests):
      1. Opens the async Postgres connection pool
      2. Runs AsyncPostgresSaver.setup() — creates checkpoint tables if absent
      3. Imports and compiles the graph from app.graph.builder

    Subsequent calls return the cached graph immediately.
    """
    global _compiled_graph

    # Fast path — already initialised
    if _compiled_graph is not None:
        return _compiled_graph

    async with _init_lock:
        # Re-check inside lock — another coroutine may have initialised while we waited
        if _compiled_graph is not None:
            return _compiled_graph

        pool = await _get_pool()

        checkpointer = AsyncPostgresSaver(pool)
        logger.info("Running AsyncPostgresSaver.setup()...")
        await checkpointer.setup()
        logger.info("Checkpoint tables ready.")

        from app.graph.builder import build_graph

        logger.info("Compiling LangGraph graph...")
        _compiled_graph = build_graph().compile(checkpointer=checkpointer)
        logger.info("Graph compiled successfully.")

    return _compiled_graph
