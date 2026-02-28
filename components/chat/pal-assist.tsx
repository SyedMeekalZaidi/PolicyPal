"use client";

// PalAssist — rendered above the ChatInput when the LangGraph agent pauses via interrupt().
//
// Interrupt types:
//   action_choice  → row of action buttons (multi-action or low confidence)
//   doc_choice     → row of doc pills + "All of these" secondary button
//   text_input     → prompt only; ChatInput below stays enabled for user response
//   retrieval_low  → 3 action buttons (stubbed for Phase 3, wired in Iteration 2-3)
//
// Parent (ChatPanel) wraps this in <AnimatePresence> for the exit animation.
// PalAssist only handles enter animation internally.

import { Bot, FileText, Globe, Tag } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import type { InterruptResponse, ResumeValue } from "@/lib/types/chat";

type Props = {
  interrupt: InterruptResponse;
  onRespond: (resumeValue: ResumeValue) => void;
  onCancel: () => void;
  disabled: boolean;
};

export function PalAssist({ interrupt, onRespond, onCancel, disabled }: Props) {
  const { interrupt_type, message, options } = interrupt;

  function respond(type: ResumeValue["type"], value: string) {
    onRespond({ type, value });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="rounded-2xl border border-white/60 bg-white/75 backdrop-blur-md shadow-lg shadow-blue-200/25 p-3.5"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
          <Bot className="h-3 w-3 text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary">PalAssist</span>
      </div>

      {/* ── Prompt message ── */}
      <p className="text-sm text-foreground mb-3 leading-relaxed">{message}</p>

      {/* ── action_choice — row of action buttons ── */}
      {interrupt_type === "action_choice" && options && (
        <div className="flex flex-wrap items-center gap-2">
          {options.map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              onClick={() => respond("action_choice", opt.id)}
              disabled={disabled}
              className="rounded-xl text-xs h-8"
            >
              {opt.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-xl text-xs h-8 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* ── doc_choice — doc pills + "All of these" + Cancel ── */}
      {interrupt_type === "doc_choice" && options && (
        <div className="flex flex-wrap items-center gap-2">
          {options.map((opt) =>
            opt.id === "all" ? (
              <Button
                key="all"
                size="sm"
                variant="secondary"
                onClick={() => respond("doc_choice", "all")}
                disabled={disabled}
                className="rounded-xl text-xs h-8"
              >
                All of these
              </Button>
            ) : (
              <button
                key={opt.id}
                onClick={() => respond("doc_choice", opt.id)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all disabled:opacity-50 hover:scale-[1.03] active:scale-95"
                style={{
                  background: "rgba(74, 158, 255, 0.12)",
                  color: "#1d6fd8",
                  border: "1px solid rgba(74, 158, 255, 0.3)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <FileText className="h-3 w-3 flex-shrink-0" />
                {opt.label}
              </button>
            )
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-xl text-xs h-8 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* ── text_input — user types in ChatInput below; show hint + Cancel ── */}
      {interrupt_type === "text_input" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground italic">
            Type your response below and press Enter ↵
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-xl text-xs h-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* ── retrieval_low — 3 options (stub, wired in Iteration 2-3) ── */}
      {interrupt_type === "retrieval_low" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => respond("retrieval_low", "tag_docs")}
            disabled={disabled}
            className="rounded-xl text-xs h-8 gap-1.5"
          >
            <Tag className="h-3 w-3" />
            Tag specific documents
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond("retrieval_low", "web_search")}
            disabled={disabled}
            className="rounded-xl text-xs h-8 gap-1.5"
          >
            <Globe className="h-3 w-3" />
            Search the web
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => respond("retrieval_low", "continue")}
            disabled={disabled}
            className="rounded-xl text-xs h-8 text-muted-foreground hover:text-foreground"
          >
            Continue anyway
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-xl text-xs h-8 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      )}
    </motion.div>
  );
}
