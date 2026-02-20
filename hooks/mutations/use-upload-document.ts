"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DOCUMENTS_QUERY_KEY } from "@/hooks/queries/use-documents";
import type {
  DocumentWithSet,
  IngestResponse,
  UploadDocumentPayload,
} from "@/lib/types/documents";

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UploadDocumentPayload): Promise<IngestResponse> => {
      const formData = new FormData();
      formData.set("file", payload.file);
      formData.set("title", payload.title);
      if (payload.version) formData.set("version", payload.version);
      formData.set("doc_type", payload.doc_type);
      if (payload.set_id) formData.set("set_id", payload.set_id);

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      return data as IngestResponse;
    },

    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: DOCUMENTS_QUERY_KEY });

      const previousDocs =
        queryClient.getQueryData<DocumentWithSet[]>(DOCUMENTS_QUERY_KEY);

      // Optimistic doc with temp ID — shown in "Ingesting" section while backend processes
      const tempId = `temp-${Date.now()}`;
      const optimisticDoc: DocumentWithSet = {
        id: tempId,
        user_id: "",
        title: payload.title,
        version: payload.version ?? null,
        doc_type: payload.doc_type,
        set_id: payload.set_id ?? null,
        storage_path: "",
        status: "processing",
        error_message: null,
        original_filename: payload.file.name,
        chunk_count: 0,
        created_at: new Date().toISOString(),
        sets: payload.setData ?? null,
      };

      queryClient.setQueryData<DocumentWithSet[]>(
        DOCUMENTS_QUERY_KEY,
        (old) => [optimisticDoc, ...(old ?? [])]
      );

      return { previousDocs, tempId };
    },

    onSettled: (_data, _error, _variables, context) => {
      // Remove temp optimistic doc and fetch real data regardless of outcome
      queryClient.setQueryData<DocumentWithSet[]>(
        DOCUMENTS_QUERY_KEY,
        (old) => (old ?? []).filter((doc) => doc.id !== context?.tempId)
      );
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },

    onError: (_error, _variables, context) => {
      if (context?.previousDocs !== undefined) {
        queryClient.setQueryData(DOCUMENTS_QUERY_KEY, context.previousDocs);
      }
    },
  });
}
