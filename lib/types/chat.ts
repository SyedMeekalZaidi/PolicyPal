// TypeScript types for the chat SSE pipeline.
// Mirrors backend/app/models/schemas.py 1:1 so the discriminated union
// switch(event.type) gives full type narrowing in useChatStream.
//
// NOTE: ChatRequest omits user_id — it is injected server-side by the
//       Next.js API proxy from the Supabase session, never trusted from the client.

import type { JSONContent } from "@tiptap/core";

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export type ChatRequest = {
  message: string;
  tiptap_json: JSONContent;
  thread_id: string;
  tagged_doc_ids: string[];
  tagged_set_ids: string[];
  action: string | null;
  enable_web_search: boolean;
};

export type ResumeValue = {
  type: "doc_choice" | "text_input" | "action_choice" | "retrieval_low" | "cancel";
  value: string | null;
};

export type ResumeRequest = {
  thread_id: string;
  resume_value: ResumeValue;
};

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

/** Emitted 0-N times during a graph run — one per node completion. */
export type StatusEvent = {
  type: "status";
  node: string;
  message: string;
  docs_found?: { id: string; title: string }[]; // only from doc_resolver
  web_query?: string;                            // only from action nodes with web search
};

// ---------------------------------------------------------------------------
// Citation types (shared by ChatResponse and CitedMarkdown)
// ---------------------------------------------------------------------------

/** A single source citation produced by an action node. Mirrors backend Citation schema. */
export type Citation = {
  id: number;
  source_type: "document" | "web";
  doc_id?: string;   // UUID of the document (document citations only)
  title: string;
  page?: number;     // PDF page number (document citations only)
  url?: string;      // URL (web citations only)
  quote: string;     // verbatim excerpt from the source
};

/**
 * Internal frontend state for a clicked citation bubble.
 * spanId matches the data-cite-group attribute of the highlighted text span.
 */
export type CitationGroup = {
  spanId: string;       // e.g. "msg123-g0" — globally unique across all messages
  citationIds: number[]; // which Citation ids this group references
};

/** Terminal event — the final AI response. Ends the SSE stream. */
export type ChatResponse = {
  type: "response";
  response: string;
  citations: Citation[];
  action: string;
  inference_confidence: string; // "high" | "medium" | "low"
  retrieval_confidence: string; // "high" | "medium" | "low"
  tokens_used: number;
  cost_usd: number;
};

/** Terminal event — graph paused, PalAssist should render. Ends the SSE stream. */
export type InterruptResponse = {
  type: "interrupt";
  interrupt_type: "doc_choice" | "text_input" | "action_choice" | "retrieval_low";
  message: string;
  options?: { id: string; label: string }[]; // null/absent for text_input
};

/**
 * Discriminated union of all possible SSE events.
 * Switch on `.type` for full TypeScript narrowing:
 *   case "status"    → StatusEvent
 *   case "response"  → ChatResponse
 *   case "interrupt" → InterruptResponse
 */
export type ChatStreamEvent = StatusEvent | ChatResponse | InterruptResponse;
