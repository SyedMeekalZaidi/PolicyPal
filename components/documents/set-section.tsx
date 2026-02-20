"use client";

import type { DocumentWithSet, SetRow } from "@/lib/types/documents";
import { DocumentCard } from "@/components/documents/document-card";

type Props = {
  set: SetRow;
  docs: DocumentWithSet[];
  onEdit: (doc: DocumentWithSet) => void;
};

export function SetSection({ set, docs, onEdit }: Props) {
  if (docs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Set header */}
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: set.color }}
        />
        <span className="text-xs font-semibold text-foreground truncate">
          {set.name}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
          {docs.length}
        </span>
      </div>

      {/* Doc list */}
      <div className="flex flex-col gap-1.5">
        {docs.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}
