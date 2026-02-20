"use client";

// Dashboard 3-panel shell: manages shared layout state (e.g. sources panel collapse).
// Center panel receives children from the route (empty state or active ChatPanel).
import { useCallback, useState, type ReactNode } from "react";

import { LeftPanel } from "@/components/dashboard/left-panel";
import { SourcesPanel } from "@/components/dashboard/sources-panel";

type Props = {
  userName: string;
  userEmail: string;
  children: ReactNode;
};

export function DashboardShell({ userName, userEmail, children }: Props) {
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);

  const toggleSources = useCallback(() => {
    setSourcesCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="flex gap-4 h-full w-full">
      {/* Left: Chats/Documents (fixed width) */}
      <div className="w-[320px] flex-shrink-0">
        <LeftPanel userName={userName} userEmail={userEmail} />
      </div>

      {/* Center: route content (empty state or active ChatPanel) */}
      <div className="flex-1 min-w-0">
        {children}
      </div>

      {/* Right: Sources (collapsible) */}
      <div className={sourcesCollapsed ? "w-3 flex-shrink-0" : "w-[300px] flex-shrink-0"}>
        <SourcesPanel isCollapsed={sourcesCollapsed} onToggle={toggleSources} />
      </div>
    </div>
  );
}
