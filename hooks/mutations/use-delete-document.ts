"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_QUERY_KEY } from "@/hooks/queries/use-documents";
import type { DocumentWithSet } from "@/lib/types/documents";

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (document: DocumentWithSet): Promise<void> => {
      // Safe delete order:
      // 1. Delete from Storage (lose the file)
      // 2. Delete DB record (CASCADE removes chunks)
      // Never delete DB first — would lose storage_path needed for cleanup
      if (document.storage_path) {
        try {
          await supabase.storage
            .from("documents")
            .remove([document.storage_path]);
        } catch {
          // Storage delete failure is non-blocking — DB cleanup takes priority
          // Orphaned storage files can be cleaned up manually if needed
        }
      }

      const { error } = await supabase
        .from("documents")
        .delete()
        .eq("id", document.id);

      if (error) throw new Error(error.message);
    },

    onMutate: async (document) => {
      await queryClient.cancelQueries({ queryKey: DOCUMENTS_QUERY_KEY });

      const previousDocs =
        queryClient.getQueryData<DocumentWithSet[]>(DOCUMENTS_QUERY_KEY);

      // Optimistically remove from cache for instant UI feedback
      queryClient.setQueryData<DocumentWithSet[]>(
        DOCUMENTS_QUERY_KEY,
        (old) => (old ?? []).filter((d) => d.id !== document.id)
      );

      return { previousDocs };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousDocs !== undefined) {
        queryClient.setQueryData(DOCUMENTS_QUERY_KEY, context.previousDocs);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });
}
