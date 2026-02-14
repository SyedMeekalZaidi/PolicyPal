// Dashboard right column: vertical sidebar (skeleton).
import * as React from "react";
import { FileText, Folder, Globe, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function SidebarSection({
  title,
  icon,
}: {
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{title}</p>
            <p className="text-[11px] text-muted-foreground truncate">Coming soon</p>
          </div>
        </div>
        <Badge variant="secondary" className="rounded-full px-2">
          0
        </Badge>
      </div>
      <Button variant="outline" className="w-full rounded-xl bg-transparent" disabled>
        Add
      </Button>
    </div>
  );
}

export function SidebarRight() {
  return (
    <aside className="glass-card-light rounded-2xl p-4 h-full flex flex-col">
      <header className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-sm font-semibold text-foreground">Sidebar</h2>
        <Button variant="outline" size="icon" className="rounded-xl" aria-label="Sidebar actions" disabled>
          <Layers className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-3">
        <SidebarSection title="Actions" icon={<Globe className="h-4 w-4" />} />
        <SidebarSection title="Sets" icon={<Folder className="h-4 w-4" />} />
        <SidebarSection title="Documents" icon={<FileText className="h-4 w-4" />} />
      </div>
    </aside>
  );
}

