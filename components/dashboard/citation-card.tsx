"use client";

// Individual citation card rendered in the Sources Panel.
// Shows icon, title, page/url metadata, and a truncated quote from the source.

import { FileText, Globe } from "lucide-react";

import type { Citation } from "@/lib/types/chat";

type Props = {
  citation: Citation;
};

export function CitationCard({ citation }: Props) {
  const isWeb = citation.source_type === "web";

  return (
    <div className="rounded-xl border border-white/30 bg-white/30 backdrop-blur-sm p-3 space-y-2 hover:bg-white/40 transition-colors">
      {/* Header: icon + title + page/url */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
          {isWeb ? (
            <Globe className="h-3.5 w-3.5 text-primary" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-primary" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2">
            {citation.title}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {isWeb
              ? citation.url
              : citation.page
              ? `Page ${citation.page}`
              : "Document"}
          </p>
        </div>
      </div>

      {/* Quote preview — 2-line clamp */}
      {citation.quote && (
        <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-4 border-l-2 border-primary/30 pl-2 italic">
          &ldquo;{citation.quote}&rdquo;
        </p>
      )}
    </div>
  );
}
