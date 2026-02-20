// Dashboard center column: chat panel.
import { SendHorizonal, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChatPanel() {
  return (
    <section className="glass-card-medium rounded-2xl flex flex-col h-full overflow-hidden">
      {/* Header: chat name (left) + branding (right) */}
      <header className="flex items-center justify-between gap-3 p-4 pb-3">
        <h2 className="text-sm font-semibold text-foreground truncate">
          New conversation
        </h2>
        <span className="text-sm font-bold text-primary flex-shrink-0">
          PolicyPal
        </span>
      </header>

      {/* Messages area */}
      <div className="flex-1 mx-4 rounded-xl border border-white/10 bg-white/10 overflow-auto">
        <div className="h-full w-full flex items-center justify-center text-center p-4">
          <div className="max-w-[340px]">
            <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">You're ready.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload documents and start a chat. This panel will show messages and citations.
            </p>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="p-4 pt-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Type a question..."
            className="rounded-xl bg-white/20 border-white/10 placeholder:text-muted-foreground"
            disabled
          />
          <Button size="icon" className="rounded-xl flex-shrink-0" aria-label="Send message" disabled>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
