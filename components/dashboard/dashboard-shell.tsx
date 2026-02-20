"use client";

// Dashboard 3-panel shell: manages shared layout state (e.g. sources panel collapse).
import { useCallback, useState } from "react";

import { LeftPanel } from "@/components/dashboard/left-panel";
import { ChatPanel } from "@/components/dashboard/chat-panel";
import { SourcesPanel } from "@/components/dashboard/sources-panel";

type Props = {
  userName: string;
  userEmail: string;
};

export function DashboardShell({ userName, userEmail }: Props) {
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

      {/* Center: Chat (fills remaining space) */}
      <div className="flex-1 min-w-0">
        <ChatPanel />
      </div>

      {/* Right: Sources (collapsible) */}
      <div className={sourcesCollapsed ? "w-3 flex-shrink-0" : "w-[300px] flex-shrink-0"}>
        <SourcesPanel isCollapsed={sourcesCollapsed} onToggle={toggleSources} />
      </div>
    </div>
  );
}
