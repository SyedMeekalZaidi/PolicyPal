"use client";

// Dashboard left panel: tabbed Chats/Documents with contextual actions and user info footer.
import { useCallback, useState } from "react";
import { FileText, MessageCircle, Plus, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserInfoBar } from "@/components/dashboard/user-info-bar";
import { DocumentPanel } from "@/components/documents/document-panel";

type Tab = "chats" | "documents";

type Props = {
  userName: string;
  userEmail: string;
};

export function LeftPanel({ userName, userEmail }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("chats");
  const [uploadOpen, setUploadOpen] = useState(false);

  const handlePlus = useCallback(() => {
    if (activeTab === "chats") {
      // TODO: create new conversation
    } else {
      setUploadOpen(true);
    }
  }, [activeTab]);

  return (
    <section className="glass-card-light rounded-2xl flex flex-col h-full overflow-hidden">
      {/* Header: tabs + plus */}
      <header className="flex items-center justify-between gap-2 p-4 pb-0">
        <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setActiveTab("chats")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              activeTab === "chats"
                ? "bg-white/60 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/20"
            )}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Chats
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("documents")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              activeTab === "documents"
                ? "bg-white/60 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/20"
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            Documents
          </button>
        </div>

        <Button
          variant="outline"
          size="icon"
          className="rounded-xl bg-transparent h-8 w-8"
          aria-label={activeTab === "chats" ? "New chat" : "Upload document"}
          onClick={handlePlus}
        >
          {activeTab === "chats" ? (
            <Plus className="h-4 w-4" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
        </Button>
      </header>

      {/* Content: chat list or document list */}
      <div className="flex-1 overflow-hidden p-4">
        {activeTab === "chats" ? (
          <ChatsContent />
        ) : (
          <DocumentPanel
            uploadModalOpen={uploadOpen}
            onUploadModalClose={() => setUploadOpen(false)}
          />
        )}
      </div>

      {/* User info footer */}
      <div className="p-4 pt-0">
        <UserInfoBar userName={userName} userEmail={userEmail} />
      </div>
    </section>
  );
}

function ChatsContent() {
  return (
    <div className="h-full rounded-xl border border-white/10 bg-white/10 p-4 flex items-center justify-center text-center">
      <div className="max-w-[200px]">
        <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
          <MessageCircle className="h-5 w-5 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">No conversations yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Start a chat to begin analyzing your documents.
        </p>
      </div>
    </div>
  );
}

