"use client";

// Dashboard right panel: collapsible sources/citations panel.
import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Globe, PanelRightClose, PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

type Props = {
  isCollapsed: boolean;
  onToggle: () => void;
};

export function SourcesPanel({ isCollapsed, onToggle }: Props) {
  const handlePeekClick = useCallback(() => {
    onToggle();
  }, [onToggle]);

  return (
    <div className="relative h-full">
      {/* Collapsed peek strip */}
      <AnimatePresence>
        {isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.2 }}
            onClick={handlePeekClick}
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
        {!isCollapsed && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="glass-card-light rounded-2xl flex flex-col h-full overflow-hidden"
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-2 p-4 pb-3">
              <h2 className="text-sm font-semibold text-foreground">Sources</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                className="h-8 w-8 rounded-xl hover:bg-white/20"
                aria-label="Collapse sources panel"
              >
                <PanelRightClose className="h-4 w-4 text-muted-foreground" />
              </Button>
            </header>

            {/* Document sources section */}
            <div className="flex-1 overflow-auto px-4 pb-4">
              <div className="space-y-4">
                <SourceSection
                  icon={<FileText className="h-4 w-4" />}
                  title="Documents"
                  emptyText="Document citations will appear here when you chat."
                />
                <SourceSection
                  icon={<Globe className="h-4 w-4" />}
                  title="Web"
                  emptyText="Web sources will appear here when web search is used."
                />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function SourceSection({
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
