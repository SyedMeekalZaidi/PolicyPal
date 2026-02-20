"use client";

// Deletes a conversation row. Navigation away (if active) is the component's responsibility
// via the onSuccess callback — hooks don't own routing.
// TODO (LangGraph): Also delete orphaned checkpoints for this conversation's thread_id.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { CONVERSATIONS_QUERY_KEY } from "@/hooks/queries/use-conversations";
import type { ConversationRow } from "@/lib/types/conversations";

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (conversation: ConversationRow): Promise<void> => {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversation.id);

      if (error) throw new Error(error.message);
    },

    onMutate: async (conversation) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_QUERY_KEY });

      const previousConversations =
        queryClient.getQueryData<ConversationRow[]>(CONVERSATIONS_QUERY_KEY);

      queryClient.setQueryData<ConversationRow[]>(
        CONVERSATIONS_QUERY_KEY,
        (old) => (old ?? []).filter((c) => c.id !== conversation.id)
      );

      return { previousConversations };
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
