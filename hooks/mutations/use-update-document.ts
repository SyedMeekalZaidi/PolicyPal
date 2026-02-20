"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_QUERY_KEY } from "@/hooks/queries/use-documents";
import { SETS_QUERY_KEY } from "@/hooks/queries/use-sets";
import type {
  DocumentWithSet,
  SetRow,
  UpdateDocumentPayload,
} from "@/lib/types/documents";

type UpdateDocumentArgs = {
  document: DocumentWithSet;
  updates: UpdateDocumentPayload;
  /** Updated set row for optimistic UI — pass null to remove from set */
  updatedSetData?: SetRow | null;
};

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({
      document,
      updates,
    }: UpdateDocumentArgs): Promise<DocumentWithSet> => {
      const { data, error } = await supabase
        .from("documents")
        .update(updates)
        .eq("id", document.id)
        .select("*, sets(*)")
        .single();

      if (error) throw new Error(error.message);
      return data as DocumentWithSet;
    },

    onMutate: async ({ document, updates, updatedSetData }) => {
      await queryClient.cancelQueries({ queryKey: DOCUMENTS_QUERY_KEY });

      const previousDocs =
        queryClient.getQueryData<DocumentWithSet[]>(DOCUMENTS_QUERY_KEY);

      queryClient.setQueryData<DocumentWithSet[]>(
        DOCUMENTS_QUERY_KEY,
        (old) =>
          (old ?? []).map((doc) =>
            doc.id === document.id
              ? {
                  ...doc,
                  ...updates,
                  sets:
                    updatedSetData !== undefined
                      ? updatedSetData
                      : doc.sets,
                }
              : doc
          )
      );

      return { previousDocs };
    },

    onSuccess: (updatedDoc) => {
      // Replace optimistic doc with real server data
      queryClient.setQueryData<DocumentWithSet[]>(
        DOCUMENTS_QUERY_KEY,
        (old) =>
          (old ?? []).map((doc) =>
            doc.id === updatedDoc.id ? updatedDoc : doc
          )
      );
    },

    onError: (_error, _variables, context) => {
      if (context?.previousDocs !== undefined) {
        queryClient.setQueryData(DOCUMENTS_QUERY_KEY, context.previousDocs);
      }
    },

    onSettled: () => {
      // Refresh sets in case a new set was created inline
      queryClient.invalidateQueries({ queryKey: SETS_QUERY_KEY });
    },
  });
}
