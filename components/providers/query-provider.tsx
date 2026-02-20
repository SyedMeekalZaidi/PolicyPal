"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useRef ensures the QueryClient is created once per component instance,
  // not recreated on every render
  const clientRef = useRef<QueryClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30 * 1000,
          retry: 1,
        },
      },
    });
  }

  return (
    <QueryClientProvider client={clientRef.current}>
      {children}
    </QueryClientProvider>
  );
}
