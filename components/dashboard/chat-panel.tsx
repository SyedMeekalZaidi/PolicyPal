// Dashboard center column: chat panel (skeleton).
import { SendHorizonal, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function ChatPanel() {
  return (
    <section className="glass-card-medium rounded-2xl p-4 h-full flex flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">New conversation</h2>
          <p className="text-xs text-muted-foreground truncate">Ask about a policy, regulation, or set.</p>
        </div>
        <Badge variant="outline" className="rounded-full bg-white/20 border-white/10">
          Inquire
        </Badge>
      </header>

      <div className="flex-1 rounded-xl border border-white/10 bg-white/10 p-4 overflow-auto">
        <div className="h-full w-full flex items-center justify-center text-center">
          <div className="max-w-[360px]">
            <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">You’re ready.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload documents and start a chat. This panel will show messages and citations.
            </p>
          </div>
        </div>
      </div>

      <div className="pt-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Type a question…"
            className="rounded-xl bg-white/20 border-white/10 placeholder:text-muted-foreground"
            disabled
          />
          <Button size="icon" className="rounded-xl" aria-label="Send message" disabled>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Chat is coming next. This is the dashboard shell.
        </p>
      </div>
    </section>
  );
}

