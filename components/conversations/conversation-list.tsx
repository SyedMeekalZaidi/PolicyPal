"use client";

// Scrollable list of conversations for the sidebar Chats tab.
// Loading → empty state → list of ConversationItem rows.
import { Loader2, MessageCircle } from "lucide-react";

import { useConversations } from "@/hooks/queries/use-conversations";
import { ConversationItem } from "@/components/conversations/conversation-item";

export function ConversationList() {
  const { data: conversations = [], isLoading } = useConversations();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="h-full rounded-xl border border-white/10 bg-white/10 p-4 flex items-center justify-center text-center">
        <div className="max-w-[200px]">
          <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">
            No conversations yet
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Click <span className="font-medium text-foreground">+</span> to
            start your first chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 h-full overflow-y-auto pr-0.5 -mr-0.5 min-h-0">
      {conversations.map((conversation) => (
        <ConversationItem key={conversation.id} conversation={conversation} />
      ))}
    </div>
  );
}
