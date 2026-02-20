"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { SetRow } from "@/lib/types/documents";

export const SETS_QUERY_KEY = ["sets"] as const;

export function useSets() {
  const supabase = createClient();

  return useQuery({
    queryKey: SETS_QUERY_KEY,
    queryFn: async (): Promise<SetRow[]> => {
      const { data, error } = await supabase
        .from("sets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
