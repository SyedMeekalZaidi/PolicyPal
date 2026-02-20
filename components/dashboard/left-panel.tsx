"use client";

// Dashboard left panel: tabbed Chats/Documents with contextual actions and user info footer.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MessageCircle, Plus, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserInfoBar } from "@/components/dashboard/user-info-bar";
import { DocumentPanel } from "@/components/documents/document-panel";
import { ConversationList } from "@/components/conversations/conversation-list";
import { useCreateConversation } from "@/hooks/mutations/use-create-conversation";

type Tab = "chats" | "documents";

type Props = {
  userName: string;
  userEmail: string;
};

export function LeftPanel({ userName, userEmail }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("chats");
  const [uploadOpen, setUploadOpen] = useState(false);

  const router = useRouter();
  const createConversation = useCreateConversation();

  const handlePlus = useCallback(() => {
    if (activeTab === "chats") {
      const id = crypto.randomUUID();
      createConversation.mutate(
        { id, title: "New conversation" },
        { onSuccess: () => router.push(`/dashboard/${id}`) }
      );
    } else {
      setUploadOpen(true);
    }
  }, [activeTab, createConversation, router]);

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
          disabled={activeTab === "chats" && createConversation.isPending}
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
          <ConversationList />
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
