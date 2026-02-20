"use client";

import { useCallback, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useUploadDocument } from "@/hooks/mutations/use-upload-document";
import { useSets } from "@/hooks/queries/use-sets";
import { useQueryClient } from "@tanstack/react-query";
import { SETS_QUERY_KEY } from "@/hooks/queries/use-sets";
import { cn } from "@/lib/utils";
import { DEFAULT_SET_COLOR, hexToRgba, SET_COLORS } from "@/lib/constants/colors";
import type { DocType, SetRow } from "@/lib/types/documents";

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

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function UploadDocumentModal({ open, onOpenChange }: Props) {
  const { data: sets = [] } = useSets();
  const uploadMutation = useUploadDocument();
  const queryClient = useQueryClient();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [docType, setDocType] = useState<DocType | "">("");
  const [selectedSetValue, setSelectedSetValue] = useState("none");

  // Inline "Create new set" form state
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [newSetColor, setNewSetColor] = useState(DEFAULT_SET_COLOR);
  const [createdSet, setCreatedSet] = useState<SetRow | null>(null);
  const [isCreatingSet, setIsCreatingSet] = useState(false);

  const resetForm = useCallback(() => {
    setFile(null);
    setFileError(null);
    setTitle("");
    setVersion("");
    setDocType("");
    setSelectedSetValue("none");
    setShowCreateSet(false);
    setNewSetName("");
    setNewSetColor(DEFAULT_SET_COLOR);
    setCreatedSet(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetForm();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm]
  );

  const validateFile = useCallback((f: File): string | null => {
    const isPdf =
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return "Only PDF files are supported.";
    if (f.size > MAX_FILE_SIZE) return "File too large. Maximum size is 20MB.";
    return null;
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] ?? null;
      setFile(f);
      setFileError(f ? validateFile(f) : null);
      // Pre-fill title from filename if empty
      if (f && !title) {
        setTitle(f.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
      }
    },
    [title, validateFile]
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
      // Refresh sets list in cache
      queryClient.invalidateQueries({ queryKey: SETS_QUERY_KEY });
    } catch {
      toast.error("Failed to create set. Please try again.");
    } finally {
      setIsCreatingSet(false);
    }
  }, [newSetName, newSetColor, supabase, queryClient]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file || fileError || !title.trim() || !docType) return;
      if (selectedSetValue === "create-new") return; // must finish creating set first

      const resolvedSetId =
        selectedSetValue !== "none" ? selectedSetValue : undefined;

      // Find the set data for optimistic UI
      const selectedSet =
        createdSet ??
        (resolvedSetId ? sets.find((s) => s.id === resolvedSetId) ?? null : null);

      onOpenChange(false);
      resetForm();

      uploadMutation.mutate(
        {
          file,
          title: title.trim(),
          version: version.trim() || undefined,
          doc_type: docType,
          set_id: resolvedSetId,
          setData: selectedSet,
        },
        {
          onSuccess: (result) => {
            if (result.status === "ready") {
              toast.success(`"${title.trim()}" processed successfully.`);
            } else {
              // Backend accepted the file but couldn't extract text (scanned/empty PDF)
              toast.error(
                result.error_message ??
                  `"${title.trim()}" could not be processed. Check that the PDF contains readable text.`
              );
            }
          },
          onError: () => {
            toast.error("Upload failed. Please try again.");
          },
        }
      );
    },
    [
      file,
      fileError,
      title,
      docType,
      selectedSetValue,
      version,
      createdSet,
      sets,
      onOpenChange,
      resetForm,
      uploadMutation,
    ]
  );

  const setItems: SearchSelectItem[] = [
    { value: "none", label: "No set (Global)" },
    ...sets.map((s) => ({ value: s.id, label: s.name })),
    { value: "create-new", label: "+ Create new set" },
  ];

  const activeSetLabel =
    createdSet?.name ??
    sets.find((s) => s.id === selectedSetValue)?.name ??
    undefined;

  const canSubmit =
    !!file &&
    !fileError &&
    !!title.trim() &&
    !!docType &&
    selectedSetValue !== "create-new";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-white rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Upload className="h-4 w-4 text-primary" />
            </div>
            Upload Document
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {/* File picker */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">PDF File *</Label>
            <div
              className={cn(
                "flex items-center gap-3 rounded-xl border border-dashed p-4 cursor-pointer hover:bg-muted/50 transition-colors",
                fileError && "border-destructive",
                file && !fileError && "border-primary/40 bg-primary/5"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText
                className={cn(
                  "h-8 w-8 shrink-0",
                  file && !fileError ? "text-primary" : "text-muted-foreground"
                )}
              />
              <div className="flex-1 min-w-0">
                {file ? (
                  <>
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      Click to choose a PDF
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF files only · max 20MB
                    </p>
                  </>
                )}
              </div>
              <Input
                ref={fileInputRef}
                id="file"
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            {fileError && (
              <p className="text-xs text-destructive">{fileError}</p>
            )}
          </div>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="e.g. Capital Adequacy Framework 2024"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl"
              required
            />
          </div>

          {/* Version + Doc Type row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
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
                  <SelectValue placeholder="Select type" />
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
            {activeSetLabel && selectedSetValue !== "create-new" && (
              <p className="text-xs text-muted-foreground">
                Document will be grouped under &quot;{activeSetLabel}&quot;
              </p>
            )}
          </div>

          {/* Inline create set form */}
          {showCreateSet && (
            <div className="rounded-xl border border-dashed p-4 flex flex-col gap-3 bg-muted/30">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                New Set
              </p>
              <Input
                placeholder="Set name (e.g. Bank Negara, ISO 27001)"
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
                    setSelectedSetValue("none");
                  }}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
              </div>
              {createdSet && (
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
                  style={{
                    backgroundColor: hexToRgba(createdSet.color, 0.12),
                    color: createdSet.color,
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: createdSet.color }}
                  />
                  {createdSet.name} created
                </div>
              )}
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
              disabled={!canSubmit}
              className="rounded-xl"
            >
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
