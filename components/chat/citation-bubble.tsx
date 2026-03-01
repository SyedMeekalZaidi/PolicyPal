"use client";

// Inline citation pill — Perplexity-style.
// Appears inline in the AI response after a text segment that has source citations.
// Clicking highlights the associated text and filters the Sources Panel.

import type { CitationGroup } from "@/lib/types/chat";
import { cn } from "@/lib/utils";

type Props = {
  groupId: string;
  citationIds: number[];
  count: number;
  isActive: boolean;
  onClick: (group: CitationGroup) => void;
};

export function CitationBubble({ groupId, citationIds, count, isActive, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick({ spanId: groupId, citationIds })}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-[10px] font-semibold",
        "min-w-[18px] h-[18px] px-1.5 mx-0.5 align-middle",
        "border transition-all duration-150 cursor-pointer select-none",
        "leading-none",
        isActive
          ? "bg-primary/20 text-primary border-primary/40 shadow-sm"
          : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40"
      )}
      aria-label={`${count} citation${count !== 1 ? "s" : ""}`}
    >
      {count === 1 ? "1" : `+${count}`}
    </button>
  );
}
