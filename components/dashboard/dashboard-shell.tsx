"use client";

// Dashboard 3-panel shell: layout wrapper + provides CitationContext to all children.
//
// Architecture note: DashboardShell provides CitationContext, so it CANNOT consume it.
// SourcesPanelSlot is a thin child component that reads sourcesCollapsed from context
// and applies the correct width to the right column — solving the provider boundary.
import type { ReactNode } from "react";

import { CitationProvider, useCitationContext } from "@/context/citation-context";
import { LeftPanel } from "@/components/dashboard/left-panel";
import { SourcesPanel } from "@/components/dashboard/sources-panel";

type Props = {
  userName: string;
  userEmail: string;
  children: ReactNode;
};

// Inner component — inside CitationProvider so it can safely read sourcesCollapsed
function SourcesPanelSlot() {
  const { sourcesCollapsed } = useCitationContext();

  return (
    <div className={sourcesCollapsed ? "w-3 flex-shrink-0" : "w-[300px] flex-shrink-0"}>
      <SourcesPanel />
    </div>
  );
}

export function DashboardShell({ userName, userEmail, children }: Props) {
  return (
    <CitationProvider>
      <div className="flex gap-4 h-full w-full">
        {/* Left: Chats/Documents (fixed width) */}
        <div className="w-[320px] flex-shrink-0">
          <LeftPanel userName={userName} userEmail={userEmail} />
        </div>

        {/* Center: route content (empty state or active ChatPanel) */}
        <div className="flex-1 min-w-0">
          {children}
        </div>

        {/* Right: Sources (collapsible — width driven by CitationContext via SourcesPanelSlot) */}
        <SourcesPanelSlot />
      </div>
    </CitationProvider>
  );
}
