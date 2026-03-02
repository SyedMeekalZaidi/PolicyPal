"use client";

import { FileText, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/lib/constants/colors";
import type { DocumentWithSet } from "@/lib/types/documents";

type Props = {
  doc: DocumentWithSet;
  onEdit?: (doc: DocumentWithSet) => void;
};

const DOC_TYPE_ACCENT: Record<string, string> = {
  regulatory_source: "#FEC872", // Gold
  company_policy: "#10B981",    // Green
};

const DOC_TYPE_LABEL: Record<string, string> = {
  regulatory_source: "Regulatory",
  company_policy: "Company Policy",
};

export function DocumentCard({ doc, onEdit }: Props) {
  const accentColor = DOC_TYPE_ACCENT[doc.doc_type] ?? "#4A9EFF";
  const setColor = doc.sets?.color;

  // Icon tint follows set color; fall back to primary blue when no set assigned
  const iconColor = setColor ?? "#4A9EFF";
  const iconBg = hexToRgba(iconColor, 0.15);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5",
        "border border-white/60 bg-white/80 backdrop-blur-sm",
        "shadow-sm shadow-blue-100/40",
        "transition-all duration-150 hover:bg-white/90 hover:shadow-md hover:shadow-blue-100/50 hover:-translate-y-px",
        "cursor-default overflow-hidden"
      )}
    >
      {/* Left accent bar — doc type color (gold = regulatory, green = company) */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ backgroundColor: accentColor }}
      />

      {/* File icon — tinted to match set color */}
      <div
        className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: iconBg }}
      >
        <FileText className="h-4 w-4" style={{ color: iconColor }} />
      </div>

      {/* Text: title + type label */}
      <div className="flex-1 min-w-0 pl-0.5">
        <p
          className="text-xs font-semibold text-foreground leading-snug truncate"
          title={doc.title}
        >
          {doc.title}
          {doc.version && (
            <span className="font-normal text-muted-foreground ml-1">
              ({doc.version})
            </span>
          )}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
        </p>
      </div>

      {/* Edit button — appears on hover */}
      {onEdit && (
        <button
          type="button"
          aria-label="Edit document"
          onClick={() => onEdit(doc)}
          className={cn(
            "shrink-0 h-6 w-6 rounded-lg flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "bg-white/80 hover:bg-white text-muted-foreground hover:text-foreground"
          )}
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
