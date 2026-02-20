"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { DocumentWithSet } from "@/lib/types/documents";

export const DOCUMENTS_QUERY_KEY = ["documents"] as const;

export function useDocuments() {
  const supabase = createClient();

  return useQuery({
    queryKey: DOCUMENTS_QUERY_KEY,
    queryFn: async (): Promise<DocumentWithSet[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("*, sets(*)")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data as DocumentWithSet[]) ?? [];
    },
  });
}
