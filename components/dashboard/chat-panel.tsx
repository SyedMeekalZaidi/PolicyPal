"use client";

// Dashboard center column: active conversation chat panel.
// Loads history from PostgresSaver checkpoints on mount via useChatHistory.
// New messages stream via useChatStream (SSE). Local state is source of truth
// during a session; checkpoint is loaded on next navigation.
//
// PalAssist lifecycle (Phase 3):
//   interrupt arrives → PalAssist renders above ChatInput
//   user responds     → isResuming=true, PalAssist hides, resumeGraph() starts
//   response arrives  → isResuming=false, AI message added
//   cancel            → graph jumps to format_response with feedback message; shown as AI bubble
import { useCallback, useEffect, useRef, useState } from "react";
import { DollarSign, RefreshCw, Sparkles } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { JSONContent } from "@tiptap/core";

import { ChatInput } from "@/components/chat/chat-input";
import { CitedMarkdown } from "@/components/chat/cited-markdown";
import { PalAssist } from "@/components/chat/pal-assist";
import { PalReasoning } from "@/components/chat/pal-reasoning";
import { useCitationContext } from "@/context/citation-context";
import { useRenameConversation } from "@/hooks/mutations/use-rename-conversation";
import { chatHistoryQueryKey, useChatHistory } from "@/hooks/queries/use-chat-history";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { ChatSubmitPayload } from "@/lib/chat/extract-mentions";
import type { ChatResponse, InterruptResponse, ResumeValue } from "@/lib/types/chat";
import type { ConversationRow } from "@/lib/types/conversations";

type Props = {
  conversationId: string;
  initialTitle: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "pal_assist"; // pal_assist = audit trail notice
  text: string;
  doc?: JSONContent;       // user messages: raw TipTap JSON for rich rendering
  response?: ChatResponse; // assistant messages: full event payload
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Walks a TipTap doc and renders text + mention nodes as React elements.
 * Each top-level paragraph becomes a block so Shift+Enter line breaks are preserved.
 */
function renderMessageContent(doc: JSONContent | undefined, fallback: string): React.ReactNode {
  if (!doc?.content) return fallback;

  function walkInline(node: JSONContent, keyPrefix: string): React.ReactNode {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return <br key={keyPrefix} />;
    if (node.type === "mention") {
      const label = node.attrs?.label ?? node.attrs?.id ?? "";
      return (
        <span
          key={keyPrefix}
          className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-white/25 border border-white/40 text-white backdrop-blur-sm leading-snug"
        >
          @{label}
        </span>
      );
    }
    return node.content?.map((child, i) => walkInline(child, `${keyPrefix}-${i}`));
  }

  const blocks = doc.content.map((para, i) => (
    <span key={i} className="block">
      {para.content?.map((child, j) => walkInline(child, `${i}-${j}`)) ?? ""}
    </span>
  ));

  return blocks.length > 0 ? blocks : fallback;
}

function ConfidenceDot({ confidence }: { confidence: string }) {
  const color =
    confidence === "high"
      ? "bg-green-500"
      : confidence === "medium"
      ? "bg-amber-400"
      : "bg-red-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color} flex-shrink-0`} />;
}

/** Shimmer skeleton shown while history is loading from checkpoint. */
function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4 animate-pulse">
      <div className="self-end h-9 w-52 rounded-2xl rounded-br-md bg-white/30" />
      <div className="self-start flex flex-col gap-1.5">
        <div className="h-14 w-64 rounded-2xl rounded-bl-md bg-white/30" />
        <div className="h-2.5 w-20 rounded-full bg-white/20 ml-1" />
      </div>
      <div className="self-end h-9 w-40 rounded-2xl rounded-br-md bg-white/30" />
      <div className="self-start flex flex-col gap-1.5">
        <div className="h-10 w-56 rounded-2xl rounded-bl-md bg-white/30" />
        <div className="h-2.5 w-16 rounded-full bg-white/20 ml-1" />
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatPanel({ conversationId, initialTitle }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const [interruptPayload, setInterruptPayload] = useState<InterruptResponse | null>(null);
  // true while the resume SSE stream is active — disables PalAssist buttons
  const [isResuming, setIsResuming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasAutoTitled = useRef(false);

  // Citation state lives in CitationContext — shared with SourcesPanel across the route boundary
  const { setActiveCitations, setHighlightedGroup } = useCitationContext();

  const rename = useRenameConversation();
  const queryClient = useQueryClient();

  // Load checkpoint history for this conversation
  const history = useChatHistory(conversationId);

  const chatStream = useChatStream({
    onResponse: useCallback(
      (event: ChatResponse) => {
        setIsResuming(false);

        if (!event.response) return; // suppress empty responses

        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", text: event.response, response: event },
        ]);

        // Populate Sources Panel with this message's citations and clear any active highlight
        setActiveCitations(event.citations ?? []);
        setHighlightedGroup(null);

        // Mark history as stale so the next navigation reloads from checkpoint.
        // refetchType:'none' — just mark stale, do NOT refetch while mounted.
        // Without this, invalidateQueries triggers a background refetch that
        // overwrites client-side messages (PalAssist audit trail, etc.).
        queryClient.invalidateQueries({ queryKey: chatHistoryQueryKey(conversationId), refetchType: "none" });
      },
      [conversationId, queryClient, setActiveCitations, setHighlightedGroup]
    ),

    onInterrupt: useCallback((event: InterruptResponse) => {
      // Could be a first interrupt OR a nested interrupt after a resume
      setIsResuming(false);
      setInterruptPayload(event);
      // Audit trail: add a muted system notice so the question is readable in history
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "pal_assist", text: event.message },
      ]);
    }, []),

    onError: useCallback((error: string) => {
      setIsResuming(false);
      toast.error(error);
    }, []),
  });

  // Reset local state when navigating between conversations
  useEffect(() => {
    chatStream.cancel();
    setTitle(initialTitle);
    setMessages([]);
    setInterruptPayload(null);
    setIsResuming(false);
    // Clear citation state so Sources Panel resets when switching conversations
    setActiveCitations([]);
    setHighlightedGroup(null);
    hasAutoTitled.current = false;
  // chatStream.cancel is stable (useCallback with no deps change), but
  // we intentionally omit it here to avoid a double-cancel on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialTitle]);

  // Populate messages from checkpoint history when it loads.
  // Only runs when history.data changes (once per conversation load due to staleTime=Infinity).
  // The reset effect above clears messages first, so history data always wins on navigation.
  // Also restores a pending interrupt (PalAssist) if the user refreshed mid-conversation.
  useEffect(() => {
    if (!history.data) return;

    const historyMessages = history.data.messages.map((m) => ({
      id: m.id,
      role: m.role as ChatMessage["role"],
      text: m.content,
      // doc and response are not stored in checkpoints — shown as plain text for history
    }));

    if (history.data.pending_interrupt) {
      setInterruptPayload(history.data.pending_interrupt);
      // Append pal_assist audit trail notice so the interrupt is contextually visible
      setMessages([
        ...historyMessages,
        {
          id: crypto.randomUUID(),
          role: "pal_assist" as const,
          text: history.data.pending_interrupt.message,
        },
      ]);
    } else if (historyMessages.length > 0) {
      setMessages(historyMessages);
    }
  }, [history.data]);

  // Auto-scroll when new messages arrive (NOT on status updates — avoids jitter)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── PalAssist handlers ────────────────────────────────────────────────────

  const handleRespond = useCallback(
    (resumeValue: ResumeValue) => {
      setIsResuming(true);
      setInterruptPayload(null);
      chatStream.resumeGraph(conversationId, resumeValue);
    },
    [conversationId, chatStream]
  );

  const handleCancel = useCallback(() => {
    setInterruptPayload(null);
    // MUST resume — abandoning without resuming leaves the thread permanently stuck.
    // Backend node receives CANCEL_SENTINEL, writes feedback, jumps to format_response.
    chatStream.resumeGraph(conversationId, { type: "cancel", value: null });
  }, [conversationId, chatStream]);

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    (payload: ChatSubmitPayload, doc: JSONContent) => {
      const text = payload.text.trim();
      if (!text) return;

      // If a text_input interrupt is active, route this submit as the resume value.
      // This is NOT a new message — it's the user's answer to PalAssist.
      if (interruptPayload?.interrupt_type === "text_input") {
        // Show what the user typed as a user bubble (audit trail continuity)
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text, doc }]);
        // If the user @tagged a document, send its UUID (backend expects UUID, not label text).
        // Otherwise send raw text (e.g. audit text input).
        const value = payload.tagged_doc_ids.length > 0 ? payload.tagged_doc_ids[0] : text;
        handleRespond({ type: "text_input", value });
        return;
      }

      // Normal new message flow
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text, doc }]);
      setInterruptPayload(null);
      chatStream.sendMessage({ payload, threadId: conversationId });

      // Auto-title on first message
      if (!hasAutoTitled.current && title === "New conversation") {
        hasAutoTitled.current = true;
        const autoTitle = text.length > 50 ? `${text.slice(0, 50)}…` : text;
        setTitle(autoTitle);

        const fakeConv: ConversationRow = {
          id: conversationId,
          title,
          user_id: "",
          last_message_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        rename.mutate({ conversation: fakeConv, title: autoTitle });
      }
    },
    [conversationId, title, rename, chatStream, interruptPayload, handleRespond]
  );

  return (
    <section className="glass-card-medium rounded-2xl flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 p-4 pb-3">
        <h2
          className="text-sm font-semibold text-foreground truncate"
          title={title}
        >
          {title}
        </h2>
        <span className="text-sm font-bold text-primary flex-shrink-0">
          PolicyPal
        </span>
      </header>

      {/* Messages area */}
      <div className="flex-1 mx-4 rounded-xl border border-white/10 bg-white/10 overflow-auto">
        {/* Loading skeleton — while checkpoint history is being fetched */}
        {history.isLoading ? (
          <HistorySkeleton />
        ) : history.isError ? (
          /* Error state — history fetch failed */
          <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load conversation history.
            </p>
            <button
              onClick={() => history.refetch()}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        ) : messages.length === 0 && !chatStream.isStreaming && !interruptPayload ? (
          <div className="h-full w-full flex items-center justify-center text-center p-4">
            <div className="max-w-[340px]">
              <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Ask a question
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Use{" "}
                <span className="font-medium text-foreground">@</span> to tag
                actions, documents, or sets.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-4">
            {messages.map((m) =>
              m.role === "user" ? (
                // User bubble — right-aligned, blue background
                <div
                  key={m.id}
                  className="self-end max-w-[75%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-white leading-relaxed"
                >
                  {renderMessageContent(m.doc, m.text)}
                </div>
              ) : m.role === "pal_assist" ? (
                // PalAssist audit trail notice — muted system-level text
                <div
                  key={m.id}
                  className="self-center flex items-center gap-1.5 px-2 py-1 rounded-full text-xs text-muted-foreground bg-white/30 border border-white/40"
                >
                  <span className="text-primary/70">🤖</span>
                  <span>{m.text}</span>
                </div>
              ) : (
                // Assistant bubble — left-aligned, white background
                <div key={m.id} className="self-start max-w-[85%] flex flex-col gap-1">
                  <div className="rounded-2xl rounded-bl-md bg-white/80 backdrop-blur-sm border border-white/60 px-3.5 py-2 text-sm text-foreground">
                    <CitedMarkdown
                      content={m.text}
                      citations={m.response?.citations ?? []}
                      messageId={m.id}
                    />
                  </div>
                  {m.response && (
                    <div className="flex items-center gap-1.5 px-1">
                      <ConfidenceDot confidence={m.response.retrieval_confidence} />
                      <span className="text-xs text-muted-foreground capitalize">
                        {m.response.retrieval_confidence} confidence
                      </span>
                      {m.response.tokens_used > 0 && (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {m.response.tokens_used} tokens · ${m.response.cost_usd.toFixed(4)}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            )}

            {/* PalReasoning — visible while the graph is streaming */}
            {chatStream.isStreaming && (
              <PalReasoning status={chatStream.reasoningStatus} />
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 pt-3 flex flex-col gap-2">
        {/* PalAssist — slides up above ChatInput when an interrupt is active */}
        <AnimatePresence>
          {interruptPayload && (
            <PalAssist
              interrupt={interruptPayload}
              onRespond={handleRespond}
              onCancel={handleCancel}
              disabled={isResuming}
            />
          )}
        </AnimatePresence>

        {/* ChatInput:
            - Disabled while the graph is streaming a new message
            - Disabled for choice-type interrupts (doc_choice / action_choice) —
              user must click a button, not type. Enabled for text_input so user
              can type their free-text response to PalAssist.               */}
        <ChatInput
          onSubmit={handleSubmit}
          disabled={
            chatStream.isStreaming ||
            (!!interruptPayload && interruptPayload.interrupt_type !== "text_input")
          }
        />
      </div>
    </section>
  );
}
