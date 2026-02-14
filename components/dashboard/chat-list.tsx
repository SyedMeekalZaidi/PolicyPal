// Dashboard left column: conversation list (skeleton).
import { MessageCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ChatList() {
  return (
    <section className="glass-card-light rounded-2xl p-4 h-full flex flex-col">
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Chats</h2>
          <Badge variant="secondary" className="rounded-full px-2">
            0
          </Badge>
        </div>
        <Button variant="outline" size="icon" className="rounded-xl" aria-label="New chat" disabled>
          <Plus className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 rounded-xl border border-white/10 bg-white/10 p-4 flex items-center justify-center text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">No conversations yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your chats will appear here once you start asking questions.
          </p>
        </div>
      </div>
    </section>
  );
}

