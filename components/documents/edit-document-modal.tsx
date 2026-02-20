"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useUpdateDocument } from "@/hooks/mutations/use-update-document";
import { useSets } from "@/hooks/queries/use-sets";
import { useQueryClient } from "@tanstack/react-query";
import { SETS_QUERY_KEY } from "@/hooks/queries/use-sets";
import { cn } from "@/lib/utils";
import { DEFAULT_SET_COLOR, SET_COLORS } from "@/lib/constants/colors";
import type { DocType, DocumentWithSet, SetRow } from "@/lib/types/documents";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect } from "@/components/shared/search-select";
import type { SearchSelectItem } from "@/components/shared/search-select";

type Props = {
  doc: DocumentWithSet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditDocumentModal({ doc, open, onOpenChange }: Props) {
  const { data: sets = [] } = useSets();
  const updateMutation = useUpdateDocument();
  const queryClient = useQueryClient();
  const supabase = createClient();

  // Form state — initialised from the document on mount/doc change
  const [title, setTitle] = useState(doc.title);
  const [version, setVersion] = useState(doc.version ?? "");
  const [docType, setDocType] = useState<DocType>(doc.doc_type as DocType);
  const [selectedSetValue, setSelectedSetValue] = useState(
    doc.set_id ?? "none"
  );

  // Inline create set state
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [newSetColor, setNewSetColor] = useState(DEFAULT_SET_COLOR);
  const [createdSet, setCreatedSet] = useState<SetRow | null>(null);
  const [isCreatingSet, setIsCreatingSet] = useState(false);

  // Sync form when doc prop changes (e.g. different doc opened)
  useEffect(() => {
    setTitle(doc.title);
    setVersion(doc.version ?? "");
    setDocType(doc.doc_type as DocType);
    setSelectedSetValue(doc.set_id ?? "none");
    setShowCreateSet(false);
    setNewSetName("");
    setNewSetColor(DEFAULT_SET_COLOR);
    setCreatedSet(null);
  }, [doc]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setShowCreateSet(false);
        setCreatedSet(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const handleSetSelect = useCallback((value: string) => {
    if (value === "create-new") {
      setShowCreateSet(true);
      setSelectedSetValue("create-new");
      setCreatedSet(null);
    } else {
      setShowCreateSet(false);
      setSelectedSetValue(value);
      setCreatedSet(null);
    }
  }, []);

  const handleCreateSet = useCallback(async () => {
    if (!newSetName.trim()) return;
    setIsCreatingSet(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error("You must be logged in to create a set.");
        return;
      }

      const { data, error } = await supabase
        .from("sets")
        .insert({ name: newSetName.trim(), color: newSetColor, user_id: user.id })
        .select()
        .single();

      if (error) throw error;

      const newSet = data as SetRow;
      setCreatedSet(newSet);
      setSelectedSetValue(newSet.id);
      setShowCreateSet(false);
      queryClient.invalidateQueries({ queryKey: SETS_QUERY_KEY });
    } catch {
      toast.error("Failed to create set. Please try again.");
    } finally {
      setIsCreatingSet(false);
    }
  }, [newSetName, newSetColor, supabase, queryClient]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim() || selectedSetValue === "create-new") return;

      const resolvedSetId =
        selectedSetValue !== "none" ? selectedSetValue : null;

      const updatedSetData =
        createdSet ??
        (resolvedSetId ? (sets.find((s) => s.id === resolvedSetId) ?? null) : null);

      onOpenChange(false);

      updateMutation.mutate(
        {
          document: doc,
          updates: {
            title: title.trim(),
            version: version.trim() || null,
            doc_type: docType,
            set_id: resolvedSetId,
          },
          updatedSetData,
        },
        {
          onSuccess: () => toast.success("Document updated."),
          onError: () => toast.error("Update failed. Please try again."),
        }
      );
    },
    [
      title,
      version,
      docType,
      selectedSetValue,
      createdSet,
      sets,
      doc,
      onOpenChange,
      updateMutation,
    ]
  );

  const setItems: SearchSelectItem[] = [
    { value: "none", label: "No set (Global)" },
    ...sets.map((s) => ({ value: s.id, label: s.name })),
    { value: "create-new", label: "+ Create new set" },
  ];

  const canSubmit =
    !!title.trim() && selectedSetValue !== "create-new";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-white rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Pencil className="h-4 w-4 text-primary" />
            </div>
            Edit Document
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-title">Title *</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl"
              required
            />
          </div>

          {/* Version + Doc Type row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-version">Version</Label>
              <Input
                id="edit-version"
                placeholder="e.g. 2024, v3.1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="rounded-xl"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Document Type *</Label>
              <Select
                value={docType}
                onValueChange={(v) => setDocType(v as DocType)}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regulatory_source">
                    Regulatory Source
                  </SelectItem>
                  <SelectItem value="company_policy">Company Policy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Set selector */}
          <div className="flex flex-col gap-1.5">
            <Label>Set</Label>
            <SearchSelect
              items={setItems}
              value={
                createdSet
                  ? createdSet.id
                  : selectedSetValue === "create-new"
                  ? "create-new"
                  : selectedSetValue
              }
              onChange={handleSetSelect}
              placeholder="No set (Global)"
              searchPlaceholder="Search sets..."
            />
          </div>

          {/* Inline create set form */}
          {showCreateSet && (
            <div className="rounded-xl border border-dashed p-4 flex flex-col gap-3 bg-muted/30">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                New Set
              </p>
              <Input
                placeholder="Set name"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                className="rounded-xl"
                autoFocus
              />
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">Color</p>
                <div className="flex gap-2 flex-wrap">
                  {SET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      onClick={() => setNewSetColor(c.hex)}
                      className={cn(
                        "h-6 w-6 rounded-full transition-all border-2",
                        newSetColor === c.hex
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-105"
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateSet}
                  disabled={!newSetName.trim() || isCreatingSet}
                  className="rounded-xl"
                >
                  {isCreatingSet ? "Creating..." : "Create Set"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCreateSet(false);
                    setSelectedSetValue(doc.set_id ?? "none");
                  }}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || updateMutation.isPending}
              className="rounded-xl"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
