"use client";

// Single conversation row in the sidebar list.
// States: default → hover (timestamp + menu) → rename (input + tick/X) | delete (dialog).
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRenameConversation } from "@/hooks/mutations/use-rename-conversation";
import { useDeleteConversation } from "@/hooks/mutations/use-delete-conversation";
import type { ConversationRow } from "@/lib/types/conversations";

type Props = {
  conversation: ConversationRow;
};

export function ConversationItem({ conversation }: Props) {
  const router = useRouter();
  const params = useParams();
  const activeId = params?.conversationId as string | undefined;
  const isActive = activeId === conversation.id;

  const [isRenaming, setIsRenaming] = useState(false);
  const [editValue, setEditValue] = useState(
    conversation.title ?? "New conversation"
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const rename = useRenameConversation();
  const deleteConv = useDeleteConversation();

  // Focus + select all when entering rename mode
  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  // Keep edit value in sync if title is updated externally (e.g. auto-title)
  useEffect(() => {
    if (!isRenaming) {
      setEditValue(conversation.title ?? "New conversation");
    }
  }, [conversation.title, isRenaming]);

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    const original = conversation.title ?? "New conversation";

    // Empty → cancel, restore original
    if (!trimmed) {
      setEditValue(original);
      setIsRenaming(false);
      return;
    }

    // No change → close silently
    if (trimmed === original) {
      setIsRenaming(false);
      return;
    }

    rename.mutate(
      { conversation, title: trimmed },
      {
        onSuccess: () => setIsRenaming(false),
        onError: () => {
          toast.error("Failed to rename conversation");
          setEditValue(original);
          setIsRenaming(false);
        },
      }
    );
  }, [editValue, conversation, rename]);

  const handleCancel = useCallback(() => {
    setEditValue(conversation.title ?? "New conversation");
    setIsRenaming(false);
  }, [conversation.title]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  // Blur = save. e.preventDefault() on tick/X mousedown prevents blur from
  // firing before those buttons handle the click — so this only runs on
  // clicking outside.
  const handleBlur = useCallback(() => {
    handleSave();
  }, [handleSave]);

  const handleDelete = useCallback(() => {
    deleteConv.mutate(conversation, {
      onSuccess: () => {
        if (isActive) router.push("/dashboard");
      },
      onError: () => toast.error("Failed to delete conversation"),
    });
    setShowDeleteDialog(false);
  }, [conversation, deleteConv, isActive, router]);

  const title = conversation.title ?? "New conversation";
  const timestamp = formatRelativeTime(conversation.last_message_at);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={title}
        onClick={() => {
          if (!isRenaming) router.push(`/dashboard/${conversation.id}`);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isRenaming)
            router.push(`/dashboard/${conversation.id}`);
        }}
        className={cn(
          "group relative flex items-center gap-1.5 rounded-xl px-3 py-2 min-w-0",
          "transition-colors duration-100 cursor-pointer select-none",
          isActive
            ? "bg-primary/10 text-foreground"
            : "hover:bg-white/40 text-foreground"
        )}
      >
        {isRenaming ? (
          /* ── Rename mode ── */
          <div
            className="flex items-center gap-1 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              className="h-6 text-xs py-0 px-2 rounded-lg bg-white/60 border-white/40 flex-1 min-w-0"
            />
            {/* Tick: mousedown preventDefault stops blur, then save fires */}
            <button
              type="button"
              aria-label="Save rename"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-green-600 hover:bg-white/60 transition-colors"
            >
              <Check className="h-3 w-3" />
            </button>
            {/* X: mousedown preventDefault stops blur, then cancel fires */}
            <button
              type="button"
              aria-label="Cancel rename"
              onMouseDown={(e) => {
                e.preventDefault();
                handleCancel();
              }}
              className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/60 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          /* ── Default / hover mode ── */
          <>
            {/* Title */}
            <span
              className="flex-1 min-w-0 text-xs font-medium truncate"
              title={title}
            >
              {title}
            </span>

            {/* Timestamp: visible on hover or when menu is open */}
            <span
              className={cn(
                "text-[10px] text-muted-foreground shrink-0 transition-opacity duration-100",
                menuOpen
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              )}
            >
              {timestamp}
            </span>

            {/* Three-dot menu trigger */}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Conversation options"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "shrink-0 h-5 w-5 flex items-center justify-center rounded",
                    "text-muted-foreground hover:text-foreground hover:bg-white/60",
                    "transition-opacity duration-100",
                    menuOpen
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setIsRenaming(true);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setShowDeleteDialog(true);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This cannot be undone. &ldquo;{title}&rdquo; and all its messages
              will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConv.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
