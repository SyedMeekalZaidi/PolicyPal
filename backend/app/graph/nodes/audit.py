# Audit action node — compliance audit in text mode or policy mode.
#
# Pipeline:
#   1. Read state: resolved_doc_ids, resolved_doc_titles, clean_query, user context
#   2. Mode detection ($0): query doc_type → "policy" if company_policy present, else "text"
#   2b. Text mode Gate 2: validate source text (< 50 chars → interrupt for text)
#   3. Multiple company_policy guard: first = source, rest discarded + discard_notice
#   4. Source content extraction:
#        policy → stratified_sample([source_doc_id]) → ~16 positional chunks
#        text   → clean_query (already validated in 2b)
#   5. Theme extraction (mode + length aware):
#        policy mode           → extract_themes(source_chunks)  → 3-5 themes (multi-theme path)
#        text mode ≥ 200 chars → extract_themes(pseudo_chunks)  → 3-5 themes (multi-theme path)
#        text mode <  200 chars → SKIP ($0), single-query path
#   6. Retrieval against target regulatory docs:
#        multi-theme  → per-theme rewrite_query + search_chunks (k=5, deduplicate by chunk ID)
#        single-query → rewrite_query + search_chunks (k=10)
#   7. _build_regulatory_context(): [N]-numbered chunks grouped by theme or flat
#   8. GPT-4o generation → AuditResponse (overall_status, response, findings, citations)
#   9. Return state update — all LLM costs summed

import logging

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langsmith import traceable
from langgraph.types import Command, interrupt

from app.graph.state import CANCEL_SENTINEL, AgentState
from app.graph.utils import rewrite_query
from app.models.action_schemas import AuditResponse
from app.services.llm_service import get_llm_service
from app.services.retrieval_service import search_chunks, stratified_sample
from app.services.supabase_client import get_supabase
from app.services.theme_service import extract_themes

logger = logging.getLogger(__name__)

# User text shorter than this uses single focused retrieval instead of theme extraction
_SHORT_TEXT_THRESHOLD = 200


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _score_confidence(similarities: list[float]) -> tuple[str, float]:
    """Convert a list of cosine similarities to a confidence tier + average."""
    if not similarities:
        return "low", 0.0
    avg = sum(similarities) / len(similarities)
    if avg >= 0.7:
        return "high", avg
    elif avg >= 0.5:
        return "medium", avg
    return "low", avg


def _detect_audit_mode(
    resolved_doc_ids: list[str],
    resolved_doc_titles: dict[str, str],
) -> dict:
    """
    Classify doc IDs into policy mode or text mode via one Supabase query.

    Fetches only id + doc_type — titles come from resolved_doc_titles (already in state).
    Returns a classification dict consumed by audit_action.
    """
    try:
        resp = (
            get_supabase()
            .table("documents")
            .select("id, doc_type")
            .in_("id", resolved_doc_ids)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        logger.error("audit | mode detection query failed: %s — defaulting to text mode", exc)
        return {
            "mode": "text",
            "source_doc_id": None,
            "source_doc_title": None,
            "target_doc_ids": resolved_doc_ids,
            "target_doc_titles": resolved_doc_titles,
            "discard_notice": None,
        }

    company_policies = [r for r in rows if r.get("doc_type") == "company_policy"]
    regulatory_docs = [r for r in rows if r.get("doc_type") == "regulatory_source"]

    if company_policies:
        source_id = company_policies[0]["id"]
        source_title = resolved_doc_titles.get(source_id, "Policy Document")
        discard_notice: str | None = None

        if len(company_policies) > 1:
            extra_titles = [
                resolved_doc_titles.get(r["id"], r["id"])
                for r in company_policies[1:]
            ]
            plural = "were" if len(extra_titles) > 1 else "was"
            discard_notice = (
                f"*Note: Only **{source_title}** was used as the audit source. "
                f"{', '.join(f'*{t}*' for t in extra_titles)} {plural} not audited in this run. "
                "Audit one policy at a time for optimal results.*\n\n"
            )

        target_ids = [r["id"] for r in regulatory_docs]
        target_titles = {
            doc_id: resolved_doc_titles.get(doc_id, "Regulatory Document")
            for doc_id in target_ids
        }
        return {
            "mode": "policy",
            "source_doc_id": source_id,
            "source_doc_title": source_title,
            "target_doc_ids": target_ids,
            "target_doc_titles": target_titles,
            "discard_notice": discard_notice,
        }

    # Text mode: all resolved docs are regulatory targets
    return {
        "mode": "text",
        "source_doc_id": None,
        "source_doc_title": None,
        "target_doc_ids": resolved_doc_ids,
        "target_doc_titles": resolved_doc_titles,
        "discard_notice": None,
    }


def _format_policy_chunks(chunks: list[dict]) -> str:
    """
    Format policy source chunks as readable excerpts — no [N] numbering.
    Source material is the AUDIT SUBJECT, not the citation target.
    """
    if not chunks:
        return "(No source excerpts available.)"
    parts = []
    for i, chunk in enumerate(chunks, start=1):
        page_str = f"Page {chunk['page']}" if chunk.get("page") is not None else "Page N/A"
        parts.append(f"Excerpt {i} ({page_str}):\n\"{chunk['content']}\"")
    return "\n\n".join(parts)


def _build_regulatory_context(
    regulatory_chunks: list[dict],
    themes: list[str] | None,
    target_doc_titles: dict[str, str],
) -> str:
    """
    Build the [N]-numbered regulatory context block for the system prompt.

    Multi-theme path: chunks grouped by the "theme" key tagged during retrieval.
    Single-query path: flat list with no theme headers.
    Only regulatory chunks are numbered — source material is never cited.
    """
    if not regulatory_chunks:
        return "(No relevant regulatory passages found.)"

    n = 1  # global [N] counter
    parts: list[str] = []

    if themes:
        # Group by "theme" key attached during per-theme retrieval
        theme_to_chunks: dict[str, list[dict]] = {t: [] for t in themes}
        for chunk in regulatory_chunks:
            t = chunk.get("theme")
            if t and t in theme_to_chunks:
                theme_to_chunks[t].append(chunk)
            else:
                # Rare: deduplicated chunk lost its theme tag — assign to first theme
                theme_to_chunks[themes[0]].append(chunk)

        for theme in themes:
            theme_chunks = theme_to_chunks.get(theme, [])
            if not theme_chunks:
                continue
            parts.append(f"#### Theme: {theme}")
            for chunk in theme_chunks:
                title = (
                    chunk.get("doc_title")
                    or target_doc_titles.get(chunk["document_id"], "Document")
                )
                page_str = str(chunk["page"]) if chunk.get("page") is not None else "N/A"
                parts.append(
                    f'[{n}] Source: {title} | Page: {page_str} | DocID: {chunk["document_id"]}\n'
                    f'"{chunk["content"]}"'
                )
                n += 1
    else:
        # Single-query path: flat list
        for chunk in regulatory_chunks:
            title = (
                chunk.get("doc_title")
                or target_doc_titles.get(chunk["document_id"], "Document")
            )
            page_str = str(chunk["page"]) if chunk.get("page") is not None else "N/A"
            parts.append(
                f'[{n}] Source: {title} | Page: {page_str} | DocID: {chunk["document_id"]}\n'
                f'"{chunk["content"]}"'
            )
            n += 1

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# System prompt template
# ---------------------------------------------------------------------------
# Structure: ROLE → SOURCE → REGULATORY CONTEXT → FOCUS → TASK → SEVERITY → RULES → FORMAT

_SYSTEM_PROMPT = """\
You are a compliance audit analyst for PolicyPal.

SOURCE ({source_label}):
{source_content}

REGULATORY CONTEXT:
{regulatory_context}

{focus_line}

TASK: Conduct a thorough compliance audit of the source material against the regulatory context above.

Structure your report EXACTLY as follows:

### [Overall Status Emoji + Status]
One sentence stating the overall compliance verdict.

### Audit Summary
2-3 sentences summarising the key compliance position.

Then for each finding, use this EXACT blockquote format:
> [Severity Emoji] **[Severity]: [Theme/Area]**
> **Gap:** What is missing or misaligned in the source material
> **Regulation requires:** Exact regulatory obligation stated in plain text [N]
> **Suggestion:** One specific, actionable remediation step

Do NOT use italics inside blockquotes. All blockquote text must be plain (no `*` or `_` wrapping).

Group findings by severity: Critical first, then High, Medium, Low.

After all findings:
### Recommendations
A prioritised bullet list (3-5 bullets). **Bold** the action on each bullet.

SEVERITY EMOJIS:
- 🔴 Critical — immediate regulatory violation requiring urgent action
- 🟠 High — significant gap that should be addressed promptly
- 🟡 Medium — partial compliance, improvement recommended
- 🔵 Low — minor or best-practice enhancement

OVERALL STATUS:
- ### 🔴 Major Violations — at least one Critical finding
- ### 🟡 Minor Issues — no Critical, but High or Medium findings exist
- ### 🟢 Compliant — only Low findings or no findings

RULES:
- CITATION IDs: Each citation's `id` MUST equal the exact [N] number you wrote in the response. \
Never renumber 1, 2, 3... — if you wrote [7] in the text, the citation object must have id=7.
- Cite ONLY from the REGULATORY CONTEXT using [N]. Source material is the subject, not a citation target.
- Use ONLY the context above. Do not use prior knowledge or external information.
- In each citation, copy the exact verbatim text from the regulatory passage into the quote field.
- Set doc_id to the DocID value shown in the context header for that passage.
- Bold the key regulatory requirement or obligation in each finding.
- Never use italics inside > blockquote findings. Plain text only inside blockquotes.{user_context}

FORMAT: Return overall_status (exactly one of "Compliant", "Minor Issues", "Major Violations"), \
response (full markdown report with severity emojis, > blockquotes, [N] markers), \
findings (structured list mirroring the report findings), and citations list. \
Each citation id must exactly match its [N] marker in response.\
"""


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


@traceable(run_type="chain", name="audit_action")
def audit_action(state: AgentState) -> dict | Command:
    """
    LangGraph node: audit source material against regulatory documents.

    Returns partial state update with response, citations, retrieval metadata, and cost.
    May return Command(goto="format_response") for interrupt cancel or missing-target cases.
    """
    resolved_doc_ids: list[str] = state.get("resolved_doc_ids") or []
    resolved_doc_titles: dict[str, str] = state.get("resolved_doc_titles") or {}
    clean_query: str = state.get("clean_query") or ""
    user_id: str = state.get("user_id") or ""
    user_industry: str = state.get("user_industry") or ""
    user_location: str = state.get("user_location") or ""

    llm = get_llm_service()
    total_tokens = 0
    total_cost = 0.0

    logger.info(
        "audit | docs=%d query_len=%d",
        len(resolved_doc_ids), len(clean_query),
    )

    # ── Step 2: Mode detection ────────────────────────────────────────────────
    mode_info = _detect_audit_mode(resolved_doc_ids, resolved_doc_titles)
    mode: str = mode_info["mode"]
    source_doc_id: str | None = mode_info["source_doc_id"]
    source_doc_title: str | None = mode_info["source_doc_title"]
    target_doc_ids: list[str] = mode_info["target_doc_ids"]
    target_doc_titles: dict[str, str] = mode_info["target_doc_titles"]
    discard_notice: str | None = mode_info["discard_notice"]

    logger.info(
        "audit | mode=%s source=%r targets=%d",
        mode, source_doc_title, len(target_doc_ids),
    )

    # ── Step 2b: Text mode Gate 2 — validate source text ─────────────────────
    # Policy mode skips this entirely — source is the tagged document.
    if mode == "text":
        if len(clean_query.strip()) < 50:
            logger.info("audit | Gate 2: source text missing or too short — interrupting")
            resume_val = interrupt({
                "interrupt_type": "text_input",
                "message": (
                    "Please enter the text you'd like to audit "
                    "(e.g. a policy excerpt, email, or procedure description)."
                ),
                "options": None,
            })
            if resume_val not in (None, CANCEL_SENTINEL):
                clean_query = str(resume_val)
                logger.info("audit | Gate 2 resume: received %d chars", len(clean_query))
            else:
                cancel_msg = (
                    "I need the text you'd like to audit. "
                    "Please include it in your next message along with a @tagged regulation document."
                )
                logger.info("audit | Gate 2 cancel → stopping with feedback")
                return Command(
                    update={
                        "response": cancel_msg,
                        "messages": [AIMessage(content=cancel_msg)],
                    },
                    goto="format_response",
                )

    # ── Guard: policy mode needs at least one regulatory target ───────────────
    if not target_doc_ids:
        fallback_msg = (
            "To run an audit in policy mode, please also @tag the regulatory documents "
            "you want to audit against. Your company policy was found, but I need "
            "at least one regulatory document as the audit target."
        )
        logger.warning("audit | policy mode with no regulatory targets — aborting")
        return Command(
            update={
                "response": fallback_msg,
                "messages": [AIMessage(content=fallback_msg)],
            },
            goto="format_response",
        )

    # ── Step 4: Extract source content ───────────────────────────────────────
    source_chunks: list[dict] = []
    source_label: str
    source_content: str

    if mode == "policy":
        retrieval = stratified_sample(user_id=user_id, doc_ids=[source_doc_id])
        source_chunks = retrieval["chunks"]
        source_label = f"Policy Document: {source_doc_title}"
        source_content = _format_policy_chunks(source_chunks)
        logger.info(
            "audit | policy mode: sampled %d chunks from %r",
            len(source_chunks), source_doc_title,
        )
    else:
        source_label = "User-Provided Text"
        source_content = clean_query
        logger.info("audit | text mode: %d chars", len(clean_query))

    # ── Step 5: Theme extraction ──────────────────────────────────────────────
    themes: list[str] | None = None
    is_multi_theme = False

    if mode == "policy":
        theme_result = extract_themes(
            source_chunks,
            {source_doc_id: source_doc_title or "Policy Document"},
        )
        themes = theme_result.parsed.themes
        total_tokens += theme_result.tokens_used
        total_cost += theme_result.cost_usd
        is_multi_theme = True
        logger.info(
            "audit | policy themes: %s | tokens=%d cost=$%.6f",
            themes, theme_result.tokens_used, theme_result.cost_usd,
        )
    elif len(clean_query) >= _SHORT_TEXT_THRESHOLD:
        pseudo_chunks = [{"content": clean_query, "document_id": "user_text"}]
        theme_result = extract_themes(pseudo_chunks, {"user_text": "Audit Source Text"})
        themes = theme_result.parsed.themes
        total_tokens += theme_result.tokens_used
        total_cost += theme_result.cost_usd
        is_multi_theme = True
        logger.info(
            "audit | text themes: %s | tokens=%d cost=$%.6f",
            themes, theme_result.tokens_used, theme_result.cost_usd,
        )
    else:
        logger.info(
            "audit | short text (%d chars < %d) → single-query path, skipping theme extraction",
            len(clean_query), _SHORT_TEXT_THRESHOLD,
        )

    # ── Step 6: Retrieval ─────────────────────────────────────────────────────
    regulatory_chunks: list[dict] = []
    all_similarities: list[float] = []

    if is_multi_theme and themes:
        seen_ids: set[str] = set()
        for theme in themes:
            retrieval_query = rewrite_query(theme, target_doc_titles, "audit").retrieval
            result = search_chunks(
                query_text=retrieval_query,
                user_id=user_id,
                doc_ids=target_doc_ids,
                k=5,
                threshold=0.6,
            )
            for chunk in result["chunks"]:
                if chunk["id"] not in seen_ids:
                    seen_ids.add(chunk["id"])
                    chunk["theme"] = theme  # tag for grouping in context builder
                    regulatory_chunks.append(chunk)
                    if "similarity" in chunk:
                        all_similarities.append(chunk["similarity"])

        logger.info(
            "audit | multi-theme retrieval: %d unique chunks across %d themes",
            len(regulatory_chunks), len(themes),
        )
    else:
        retrieval_query = rewrite_query(clean_query, target_doc_titles, "audit").retrieval
        result = search_chunks(
            query_text=retrieval_query,
            user_id=user_id,
            doc_ids=target_doc_ids,
            k=10,
            threshold=0.6,
        )
        regulatory_chunks = result["chunks"]
        all_similarities = [c.get("similarity", 0.0) for c in regulatory_chunks]
        logger.info("audit | single-query retrieval: %d chunks", len(regulatory_chunks))

    confidence_tier, avg_similarity = _score_confidence(all_similarities)

    # Guard: no regulatory context found at all
    if not regulatory_chunks:
        no_context_msg = (
            "I couldn't find relevant regulatory passages in the tagged documents for this audit. "
            "Please verify that your regulatory documents have been uploaded and processed, "
            "then try again."
        )
        logger.warning("audit | no regulatory chunks retrieved — aborting")
        return Command(
            update={
                "response": no_context_msg,
                "citations": [],
                "retrieved_chunks": [],
                "retrieval_confidence": "low",
                "confidence_score": 0.0,
                "tokens_used": total_tokens,
                "cost_usd": total_cost,
                "messages": [AIMessage(content=no_context_msg)],
            },
            goto="format_response",
        )

    # ── Step 7: Build regulatory context block ────────────────────────────────
    regulatory_context = _build_regulatory_context(
        regulatory_chunks=regulatory_chunks,
        themes=themes if is_multi_theme else None,
        target_doc_titles=target_doc_titles,
    )

    # ── Step 8: Build system prompt ───────────────────────────────────────────
    user_context_line = ""
    if user_industry or user_location:
        ctx_parts = [p for p in [user_industry, user_location] if p]
        user_context_line = (
            f"\nUser context: Works in {' / '.join(ctx_parts)}. "
            "Tailor regulatory references and examples to their jurisdiction."
        )

    focus_line = (
        f"COMPLIANCE THEMES: {', '.join(themes)}"
        if themes
        else f"AUDIT FOCUS: {clean_query[:300]}"
    )

    system_content = _SYSTEM_PROMPT.format(
        source_label=source_label,
        source_content=source_content,
        regulatory_context=regulatory_context,
        focus_line=focus_line,
        user_context=user_context_line,
    )

    # ── Step 9: Build human message ───────────────────────────────────────────
    if mode == "policy":
        human_content = (
            "Audit the source policy against the regulatory documents for compliance gaps."
        )
    else:
        human_content = (
            clean_query.strip()
            or "Audit the provided text against the regulatory documents."
        )

    llm_messages = [
        SystemMessage(content=system_content),
        HumanMessage(content=human_content),
    ]

    # ── Step 10: GPT-4o generation ────────────────────────────────────────────
    llm_result = llm.invoke_structured("audit", AuditResponse, llm_messages)
    parsed: AuditResponse = llm_result.parsed

    total_tokens += llm_result.tokens_used
    total_cost += llm_result.cost_usd

    logger.info(
        "audit | LLM done: mode=%s status=%r findings=%d citations=%d tokens=%d cost=$%.6f",
        mode, parsed.overall_status, len(parsed.findings), len(parsed.citations),
        llm_result.tokens_used, llm_result.cost_usd,
    )

    # ── Step 11: Return state update ──────────────────────────────────────────
    final_response = (discard_notice or "") + parsed.response

    return {
        "response": final_response,
        "citations": [c.model_dump() for c in parsed.citations],
        "retrieved_chunks": regulatory_chunks,
        "retrieval_confidence": confidence_tier,
        "confidence_score": avg_similarity,
        "tokens_used": total_tokens,
        "cost_usd": total_cost,
        "messages": [AIMessage(content=final_response)],
    }
