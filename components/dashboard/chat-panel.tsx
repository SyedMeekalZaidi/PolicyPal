"use client";

// Dashboard center column: active conversation chat panel.
// Local message state is THROWAWAY — will be replaced by LangGraph checkpoint
// messages when the backend is wired in the next feature.
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { JSONContent } from "@tiptap/core";

import { ChatInput } from "@/components/chat/chat-input";
import { useRenameConversation } from "@/hooks/mutations/use-rename-conversation";
import type { ChatSubmitPayload } from "@/lib/chat/extract-mentions";
import type { ConversationRow } from "@/lib/types/conversations";

type Props = {
  conversationId: string;
  initialTitle: string;
};

type LocalMessage = {
  id: string;
  text: string;
  doc?: JSONContent;
};

/**
 * Walks a TipTap doc and renders text + mention nodes as React elements.
 * Each top-level paragraph becomes a block so Shift+Enter line breaks are preserved.
 * Falls back to plain text if doc is absent (e.g. legacy messages, HMR state).
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

export function ChatPanel({ conversationId, initialTitle }: Props) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasAutoTitled = useRef(false);

  const rename = useRenameConversation();

  // Sync title if conversation changes (e.g. navigating between chats)
  useEffect(() => {
    setTitle(initialTitle);
    setMessages([]);
    hasAutoTitled.current = false;
  }, [conversationId, initialTitle]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(
    (payload: ChatSubmitPayload, doc: JSONContent) => {
      const text = payload.text.trim();
      if (!text) return;

      // Store message locally (throwaway — replaced by LangGraph later)
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), text, doc },
      ]);

      // Auto-title: set conversation title from first message (truncated to 50 chars)
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
    [conversationId, title, rename]
  );

  return (
    <section className="glass-card-medium rounded-2xl flex flex-col h-full overflow-hidden">
      {/* Header: conversation title (left) + branding (right) */}
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
        {messages.length === 0 ? (
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
            {messages.map((m) => (
              <div
                key={m.id}
                className="self-end max-w-[75%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-white leading-relaxed"
              >
                {renderMessageContent(m.doc, m.text)}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 pt-3">
        <ChatInput onSubmit={handleSubmit} />
      </div>
    </section>
  );
}
