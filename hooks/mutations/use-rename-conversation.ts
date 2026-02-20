"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { CONVERSATIONS_QUERY_KEY } from "@/hooks/queries/use-conversations";
import type { ConversationRow } from "@/lib/types/conversations";

type RenameConversationArgs = {
  conversation: ConversationRow;
  title: string;
};

export function useRenameConversation() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({
      conversation,
      title,
    }: RenameConversationArgs): Promise<ConversationRow> => {
      const { data, error } = await supabase
        .from("conversations")
        .update({ title })
        .eq("id", conversation.id)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return data as ConversationRow;
    },

    onMutate: async ({ conversation, title }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_QUERY_KEY });

      const previousConversations =
        queryClient.getQueryData<ConversationRow[]>(CONVERSATIONS_QUERY_KEY);

      queryClient.setQueryData<ConversationRow[]>(
        CONVERSATIONS_QUERY_KEY,
        (old) =>
          (old ?? []).map((c) =>
            c.id === conversation.id ? { ...c, title } : c
          )
      );

      return { previousConversations };
    },

    onSuccess: (updated) => {
      // Replace optimistic entry with confirmed server data
      queryClient.setQueryData<ConversationRow[]>(
        CONVERSATIONS_QUERY_KEY,
        (old) => (old ?? []).map((c) => (c.id === updated.id ? updated : c))
      );
    },

    onError: (_error, _variables, context) => {
      if (context?.previousConversations !== undefined) {
        queryClient.setQueryData(
          CONVERSATIONS_QUERY_KEY,
          context.previousConversations
        );
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    },
  });
}
