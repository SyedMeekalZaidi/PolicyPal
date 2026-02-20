"use client";

import { useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { useDocuments } from "@/hooks/queries/use-documents";
import { useSets } from "@/hooks/queries/use-sets";
import type { DocumentWithSet, SetRow } from "@/lib/types/documents";

import { DocumentSearch } from "@/components/documents/document-search";
import { IngestingSection } from "@/components/documents/ingesting-section";
import { SetSection } from "@/components/documents/set-section";
import { DocumentCard } from "@/components/documents/document-card";
import { UploadDocumentModal } from "@/components/documents/upload-document-modal";
import { EditDocumentModal } from "@/components/documents/edit-document-modal";

type Props = {
  uploadModalOpen: boolean;
  onUploadModalClose: () => void;
};

export function DocumentPanel({ uploadModalOpen, onUploadModalClose }: Props) {
  const { data: docs = [], isLoading } = useDocuments();
  const { data: sets = [] } = useSets();

  const [search, setSearch] = useState("");
  const [editingDoc, setEditingDoc] = useState<DocumentWithSet | null>(null);

  // Split docs by status
  const ingestingDocs = useMemo(
    () => docs.filter((d) => d.status !== "ready"),
    [docs]
  );
  const readyDocs = useMemo(
    () => docs.filter((d) => d.status === "ready"),
    [docs]
  );

  // Apply search filter to ready docs
  const filteredReadyDocs = useMemo(
    () => filterDocs(readyDocs, sets, search),
    [readyDocs, sets, search]
  );

  // Group ready docs: global (no set) + per-set
  const globalDocs = useMemo(
    () =>
      filteredReadyDocs
        .filter((d) => !d.set_id)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [filteredReadyDocs]
  );

  const setGroups = useMemo(
    () => buildSetGroups(filteredReadyDocs, sets),
    [filteredReadyDocs, sets]
  );

  const hasReadyDocs = globalDocs.length > 0 || setGroups.some((g) => g.docs.length > 0);
  const hasAnyDocs = docs.length > 0;

  return (
    <>
      <div className="flex flex-col gap-3 h-full">
        {/* Search */}
        <DocumentSearch value={search} onChange={setSearch} />

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-0.5 -mr-0.5 min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            </div>
          )}

          {!isLoading && !hasAnyDocs && !search && (
            <EmptyState />
          )}

          {/* Ingesting section — not filtered by search */}
          {ingestingDocs.length > 0 && (
            <IngestingSection docs={ingestingDocs} />
          )}

          {/* Ready docs — filtered by search */}
          {!isLoading && hasReadyDocs && (
            <>
              {/* Global docs (no set) */}
              {globalDocs.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Global Documents
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {globalDocs.map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        onEdit={setEditingDoc}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Set groups */}
              {setGroups.map(({ set, docs: setDocs }) =>
                setDocs.length > 0 ? (
                  <SetSection
                    key={set.id}
                    set={set}
                    docs={setDocs}
                    onEdit={setEditingDoc}
                  />
                ) : null
              )}
            </>
          )}

          {/* No search results */}
          {!isLoading && search && !hasReadyDocs && ingestingDocs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm font-medium text-foreground">No results</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try a different document or set name.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <UploadDocumentModal
        open={uploadModalOpen}
        onOpenChange={(open) => {
          if (!open) onUploadModalClose();
        }}
      />

      {editingDoc && (
        <EditDocumentModal
          doc={editingDoc}
          open={!!editingDoc}
          onOpenChange={(open) => {
            if (!open) setEditingDoc(null);
          }}
        />
      )}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterDocs(
  docs: DocumentWithSet[],
  sets: SetRow[],
  query: string
): DocumentWithSet[] {
  if (!query.trim()) return docs;
  const q = query.toLowerCase();

  // Sets whose names match the query (show ALL their docs)
  const matchingSetIds = new Set(
    sets
      .filter((s) => s.name.toLowerCase().includes(q))
      .map((s) => s.id)
  );

  return docs.filter(
    (doc) =>
      doc.title.toLowerCase().includes(q) ||
      (doc.set_id && matchingSetIds.has(doc.set_id))
  );
}

type SetGroup = { set: SetRow; docs: DocumentWithSet[] };

function buildSetGroups(docs: DocumentWithSet[], sets: SetRow[]): SetGroup[] {
  const docsWithSet = docs.filter((d) => d.set_id);

  // Build a map of set_id → docs
  const bySet = new Map<string, DocumentWithSet[]>();
  for (const doc of docsWithSet) {
    const arr = bySet.get(doc.set_id!) ?? [];
    arr.push(doc);
    bySet.set(doc.set_id!, arr);
  }

  // Return groups for sets that have at least one doc
  return sets
    .filter((s) => bySet.has(s.id))
    .map((s) => ({
      set: s,
      docs: (bySet.get(s.id) ?? []).sort((a, b) =>
        a.title.localeCompare(b.title)
      ),
    }));
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
        <FileText className="h-5 w-5 text-primary" />
      </div>
      <p className="text-sm font-medium text-foreground">No documents yet</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[180px]">
        Click the upload button above to add your first PDF.
      </p>
    </div>
  );
}
