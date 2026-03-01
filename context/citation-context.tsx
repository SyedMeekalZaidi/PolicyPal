"use client";

// Global citation state shared between ChatPanel (center) and SourcesPanel (right).
//
// Why context (not props): ChatPanel is injected as route children — it never receives
// props from DashboardShell. Context is the only clean channel across the route boundary.
//
// Why sourcesCollapsed lives here (not DashboardShell): DashboardShell provides this
// context, so it cannot also consume it. The auto-expand logic needs to write both
// `activeCitations` and `sourcesCollapsed` in the same scope → both must be in the Provider.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { Citation, CitationGroup } from "@/lib/types/chat";

type CitationContextValue = {
  activeCitations: Citation[];
  highlightedGroup: CitationGroup | null;
  setActiveCitations: (citations: Citation[]) => void;
  setHighlightedGroup: (group: CitationGroup | null) => void;
  sourcesCollapsed: boolean;
  toggleSources: () => void;
};

const CitationContext = createContext<CitationContextValue | null>(null);

export function CitationProvider({ children }: { children: ReactNode }) {
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
  const [highlightedGroup, setHighlightedGroup] = useState<CitationGroup | null>(null);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);

  // Auto-expand the sources panel whenever new citations arrive (0 → N)
  useEffect(() => {
    if (activeCitations.length > 0) {
      setSourcesCollapsed(false);
    }
  }, [activeCitations.length]);

  const toggleSources = useCallback(() => {
    setSourcesCollapsed((prev) => !prev);
  }, []);

  return (
    <CitationContext.Provider
      value={{
        activeCitations,
        highlightedGroup,
        setActiveCitations,
        setHighlightedGroup,
        sourcesCollapsed,
        toggleSources,
      }}
    >
      {children}
    </CitationContext.Provider>
  );
}

export function useCitationContext(): CitationContextValue {
  const ctx = useContext(CitationContext);
  if (!ctx) throw new Error("useCitationContext must be used inside <CitationProvider>");
  return ctx;
}
