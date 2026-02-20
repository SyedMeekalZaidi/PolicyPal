"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { ConversationRow } from "@/lib/types/conversations";

export const CONVERSATIONS_QUERY_KEY = ["conversations"] as const;

export function useConversations() {
  const supabase = createClient();

  return useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
