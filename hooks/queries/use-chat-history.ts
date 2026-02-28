"use client";

// React Query hook for loading conversation history from PostgresSaver checkpoints.
//
// staleTime: Infinity — history doesn't change during an active session.
// Invalidated (but NOT re-fetched while mounted) after each AI response so
// the next navigation to this conversation loads fresh checkpoint data.

import { useQuery } from "@tanstack/react-query";
import type { InterruptResponse } from "@/lib/types/chat";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
};

export type ChatHistoryData = {
  thread_id: string;
  messages: HistoryMessage[];
  pending_interrupt: InterruptResponse | null;
};

export const chatHistoryQueryKey = (threadId: string) =>
  ["chat-history", threadId] as const;

export function useChatHistory(threadId: string | null) {
  return useQuery({
    queryKey: ["chat-history", threadId ?? ""],
    queryFn: async (): Promise<ChatHistoryData> => {
      const res = await fetch(`/api/chat/history/${threadId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to load chat history");
      }
      return res.json() as Promise<ChatHistoryData>;
    },
    enabled: !!threadId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
