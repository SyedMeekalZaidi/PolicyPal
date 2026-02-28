"use client";

// PalReasoning — shimmering status text rendered below the last user message
// while the LangGraph agent is running.
//
// Each node completion emits a StatusEvent. This component renders the latest
// one with a 300ms minimum display time so rapid node completions are readable.
// Null clears immediately (the AI response is ready — don't delay showing it).

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { StatusEvent } from "@/lib/types/chat";

const MIN_DISPLAY_MS = 300;

type Props = {
  status: StatusEvent | null;
};

export function PalReasoning({ status }: Props) {
  // displayedStatus is what actually renders — may lag status by up to 300ms
  const [displayedStatus, setDisplayedStatus] = useState<StatusEvent | null>(null);
  const lastRenderTimeRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always keep the latest status accessible inside timer callbacks
  const latestStatusRef = useRef<StatusEvent | null>(null);
  latestStatusRef.current = status;

  useEffect(() => {
    // Cancel any queued update — we'll re-schedule if needed
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    if (status === null) {
      // Terminal: clear immediately — the AI message is ready to display
      setDisplayedStatus(null);
      lastRenderTimeRef.current = 0;
      return;
    }

    // Non-null: enforce 300ms minimum display per status
    const now = Date.now();
    const elapsed = now - lastRenderTimeRef.current;
    const delay = lastRenderTimeRef.current === 0 ? 0 : Math.max(0, MIN_DISPLAY_MS - elapsed);

    if (delay === 0) {
      setDisplayedStatus(status);
      lastRenderTimeRef.current = now;
    } else {
      pendingTimerRef.current = setTimeout(() => {
        setDisplayedStatus(latestStatusRef.current);
        lastRenderTimeRef.current = Date.now();
        pendingTimerRef.current = null;
      }, delay);
    }

    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [status]);

  if (!displayedStatus) return null;

  return (
    <div className="flex flex-col gap-1.5 px-1 py-0.5">
      {/* Status line with shimmer icon */}
      <div
        className="flex items-center gap-1.5 text-sm text-primary"
        style={{ animation: "pal-shimmer 1.8s ease-in-out infinite" }}
      >
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-medium">{displayedStatus.message}</span>
      </div>

      {/* Doc pills — shown when doc_resolver resolves documents */}
      {displayedStatus.docs_found && displayedStatus.docs_found.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-5">
          {displayedStatus.docs_found.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                background: "rgba(74, 158, 255, 0.14)",
                color: "#1d6fd8",
                border: "1px solid rgba(255, 255, 255, 0.5)",
                backdropFilter: "blur(4px)",
              }}
            >
              📄 {doc.title}
            </span>
          ))}
        </div>
      )}

      {/* Web query — shown when an action node triggers a web search */}
      {displayedStatus.web_query && (
        <p className="pl-5 text-xs text-muted-foreground italic">
          🔍 &ldquo;{displayedStatus.web_query}&rdquo;
        </p>
      )}
    </div>
  );
}
