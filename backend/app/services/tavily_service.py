# Tavily web search service — sync, matches our sync graph nodes.
#
# Called conditionally by action nodes when state["enable_web_search"] is True.
# Returns normalized results consumed as "web" citations in action node prompts.
#
# Cost: 1 credit per basic search (1,000 free credits/month on Tavily free tier).
# If TAVILY_API_KEY is unset, returns [] silently so the graph continues without web results.

import logging

from langsmith import traceable

from app.config import get_settings

logger = logging.getLogger(__name__)


@traceable(name="web_search", run_type="tool")
def web_search(query: str, max_results: int = 5) -> list[dict]:
    """
    Perform a synchronous Tavily web search.

    Args:
        query:       search string (action node generates this from user's question)
        max_results: 1-10; default 5 (balances coverage vs token cost)

    Returns:
        List of dicts: [{title, url, content, score}]
        Empty list if API key is missing or the search fails.
    """
    settings = get_settings()
    api_key = settings.tavily_api_key

    if not api_key:
        logger.warning("tavily | TAVILY_API_KEY not set — skipping web search for query=%r", query[:80])
        return []

    try:
        from tavily import TavilyClient  # deferred import: only needed when key is set

        client = TavilyClient(api_key=api_key)
        response = client.search(
            query=query,
            search_depth="basic",       # 1 credit per search
            max_results=max_results,
            topic="general",
            include_answer=False,       # skip LLM-generated summary (we generate our own)
            include_raw_content=False,  # skip full HTML (save bandwidth + tokens)
        )

        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "score": r.get("score", 0.0),
            }
            for r in (response.get("results") or [])
        ]

        logger.info(
            "tavily | query=%r → %d results (top score=%.2f)",
            query[:60],
            len(results),
            results[0]["score"] if results else 0.0,
        )
        return results

    except Exception as e:
        logger.warning("tavily | web_search failed for query=%r: %s", query[:80], e)
        return []
