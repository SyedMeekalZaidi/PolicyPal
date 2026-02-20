"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DOCUMENTS_QUERY_KEY } from "@/hooks/queries/use-documents";
import type { DocumentWithSet, IngestResponse } from "@/lib/types/documents";

export function useRetryDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string): Promise<IngestResponse> => {
      const response = await fetch(`/api/documents/retry/${documentId}`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || "Retry failed");
      }

      return data as IngestResponse;
    },

    onMutate: async (documentId) => {
      await queryClient.cancelQueries({ queryKey: DOCUMENTS_QUERY_KEY });

      const previousDocs =
        queryClient.getQueryData<DocumentWithSet[]>(DOCUMENTS_QUERY_KEY);

      // Optimistically flip status to processing so shimmer shows immediately
      queryClient.setQueryData<DocumentWithSet[]>(
        DOCUMENTS_QUERY_KEY,
        (old) =>
          (old ?? []).map((doc) =>
            doc.id === documentId
              ? { ...doc, status: "processing", error_message: null }
              : doc
          )
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
