"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, FileText, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useDeleteDocument } from "@/hooks/mutations/use-delete-document";
import { useRetryDocument } from "@/hooks/mutations/use-retry-document";
import { hexToRgba } from "@/lib/constants/colors";
import { cn } from "@/lib/utils";
import type { DocumentWithSet } from "@/lib/types/documents";

import { Button } from "@/components/ui/button";

type Props = {
  docs: DocumentWithSet[];
};

export function IngestingSection({ docs }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const deleteMutation = useDeleteDocument();
  const retryMutation = useRetryDocument();

  if (docs.length === 0) return null;

  const processingCount = docs.filter((d) => d.status === "processing").length;
  const failedCount = docs.filter((d) => d.status === "failed").length;

  const label =
    processingCount > 0 && failedCount > 0
      ? `${processingCount} processing · ${failedCount} failed`
      : processingCount > 0
      ? `${processingCount} processing`
      : `${failedCount} failed`;

  return (
    <div className="flex flex-col gap-2">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        <span className="uppercase tracking-wide">Ingesting</span>
        <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {docs.length}
        </span>
        <span className="ml-auto text-[10px] font-normal normal-case tracking-normal">
          {label}
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-1.5">
          {docs.map((doc) =>
            doc.status === "processing" ? (
              <ProcessingCard key={doc.id} doc={doc} />
            ) : (
              <FailedCard
                key={doc.id}
                doc={doc}
                onRetry={() => {
                  retryMutation.mutate(doc.id, {
                    onSuccess: (result) => {
                      if (result.status === "ready") {
                        toast.success(`"${doc.title}" reprocessed successfully.`);
                      } else {
                        // Backend returned 200 but still couldn't process the file
                        toast.error(
                          result.error_message ??
                            `"${doc.title}" could not be processed. Check that the PDF contains readable text.`
                        );
                      }
                    },
                    onError: (err) => {
                      // HTTP error (404 = file missing in storage, 400/500 = other backend error)
                      toast.error(err.message || "Retry failed. Please try again.");
                    },
                  });
                  toast.info(`Retrying "${doc.title}"...`);
                }}
                onDelete={() => {
                  deleteMutation.mutate(doc, {
                    onSuccess: () => toast.success(`"${doc.title}" deleted.`),
                    onError: () => toast.error("Delete failed. Please try again."),
                  });
                }}
                isRetrying={retryMutation.isPending && retryMutation.variables === doc.id}
                isDeleting={deleteMutation.isPending && deleteMutation.variables?.id === doc.id}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function ProcessingCard({ doc }: { doc: DocumentWithSet }) {
  const setColor = doc.sets?.color;
  const cardBg = setColor ? hexToRgba(setColor, 0.09) : "rgba(255, 255, 255, 0.55)";

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 border border-white/70 backdrop-blur-sm shadow-sm overflow-hidden"
      style={{ backgroundColor: cardBg }}
    >
      {/* Pulsing icon */}
      <div className="shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <FileText className="h-4 w-4 text-primary animate-pulse" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">
          {doc.original_filename ?? doc.title}
        </p>
        {/* Shimmer bar */}
        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden w-3/4">
          <div className="h-full w-1/2 rounded-full bg-primary/40 animate-pulse" />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground shrink-0">Processing...</p>
    </div>
  );
}

type FailedCardProps = {
  doc: DocumentWithSet;
  onRetry: () => void;
  onDelete: () => void;
  isRetrying: boolean;
  isDeleting: boolean;
};

function FailedCard({ doc, onRetry, onDelete, isRetrying, isDeleting }: FailedCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 border border-destructive/25 backdrop-blur-sm shadow-sm bg-red-50/50 overflow-hidden">
      {/* Error icon */}
      <div className="shrink-0 h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-4 w-4 text-destructive" />
      </div>

      {/* Title + error message */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">
          {doc.original_filename ?? doc.title}
        </p>
        <p className="text-[10px] text-destructive mt-0.5 line-clamp-1">
          {doc.error_message ?? "Processing failed."}
        </p>
      </div>

      {/* Retry + Delete buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying || isDeleting}
          title="Retry"
          className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={isDeleting || isRetrying}
          title="Delete"
          className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
