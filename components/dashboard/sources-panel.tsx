"use client";

// Dashboard right panel: collapsible sources/citations panel.
// Consumes CitationContext — no props needed.
//
// Rendering logic:
//   activeCitations empty  → empty state placeholder
//   highlightedGroup null  → show ALL activeCitations (grouped by type)
//   highlightedGroup set   → show only citations whose id is in highlightedGroup.citationIds
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Globe, PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CitationCard } from "@/components/dashboard/citation-card";
import { useCitationContext } from "@/context/citation-context";
import type { Citation } from "@/lib/types/chat";

export function SourcesPanel() {
  const {
    activeCitations,
    highlightedGroup,
    sourcesCollapsed,
    toggleSources,
  } = useCitationContext();

  // Determine which citations to display based on highlight state
  const visibleCitations: Citation[] =
    highlightedGroup
      ? activeCitations.filter((c) => highlightedGroup.citationIds.includes(c.id))
      : activeCitations;

  const docCitations = visibleCitations.filter((c) => c.source_type === "document");
  const webCitations = visibleCitations.filter((c) => c.source_type === "web");

  return (
    <div className="relative h-full">
      {/* Collapsed peek strip */}
      <AnimatePresence>
        {sourcesCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.2 }}
            onClick={toggleSources}
            className="absolute inset-y-0 right-0 w-3 cursor-pointer group z-10"
          >
            <div className="h-full w-full rounded-l-2xl glass-card-light glass-outline-rotating flex items-center justify-center transition-all group-hover:w-10 group-hover:shadow-lg">
              <PanelRightOpen className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded panel */}
      <AnimatePresence>
        {!sourcesCollapsed && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="glass-card-light rounded-2xl flex flex-col h-full overflow-hidden"
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-2 p-4 pb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Sources</h2>
                {activeCitations.length > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-1.5 h-4 min-w-[16px]">
                    {visibleCitations.length}
                    {highlightedGroup && activeCitations.length !== visibleCitations.length && (
                      <span className="text-muted-foreground">/{activeCitations.length}</span>
                    )}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSources}
                className="h-8 w-8 rounded-xl hover:bg-white/20"
                aria-label="Collapse sources panel"
              >
                <PanelRightClose className="h-4 w-4 text-muted-foreground" />
              </Button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-auto px-4 pb-4">
              {activeCitations.length === 0 ? (
                // Empty state — no citations yet
                <div className="space-y-4">
                  <EmptySection
                    icon={<FileText className="h-4 w-4" />}
                    title="Documents"
                    emptyText="Document citations will appear here when you chat."
                  />
                  <EmptySection
                    icon={<Globe className="h-4 w-4" />}
                    title="Web"
                    emptyText="Web sources will appear here when web search is used."
                  />
                </div>
              ) : (
                // Citations list — grouped by type
                <div className="space-y-4">
                  {docCitations.length > 0 && (
                    <CitationSection
                      icon={<FileText className="h-4 w-4" />}
                      title="Documents"
                      citations={docCitations}
                    />
                  )}
                  {webCitations.length > 0 && (
                    <CitationSection
                      icon={<Globe className="h-4 w-4" />}
                      title="Web"
                      citations={webCitations}
                    />
                  )}
                  {visibleCitations.length === 0 && (
                    // Filtered group has no matching citations (edge case)
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No citations for this selection.
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Section Components ───────────────────────────────────────────────────────

function CitationSection({
  icon,
  title,
  citations,
}: {
  icon: React.ReactNode;
  title: string;
  citations: Citation[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          {icon}
        </div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <span className="text-[10px] text-muted-foreground">({citations.length})</span>
      </div>
      <div className="space-y-2">
        {citations.map((citation) => (
          <CitationCard key={citation.id} citation={citation} />
        ))}
      </div>
    </div>
  );
}

function EmptySection({
  icon,
  title,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  emptyText: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          {icon}
        </div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{emptyText}</p>
    </div>
  );
}
