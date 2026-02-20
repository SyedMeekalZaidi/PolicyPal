// Active conversation page: validates ownership, renders ChatPanel.
// Auth already enforced by parent layout. This page only checks that
// the conversation exists and belongs to the current user.
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserIdFromClaims } from "@/lib/profile/gate";
import { ChatPanel } from "@/components/dashboard/chat-panel";

type Props = {
  params: Promise<{ conversationId: string }>;
};

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/dashboard");
  }

  const userId = getUserIdFromClaims(data.claims);
  if (!userId) {
    redirect("/dashboard");
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!conversation) {
    redirect("/dashboard");
  }

  return (
    <ChatPanel
      conversationId={conversation.id}
      initialTitle={conversation.title ?? "New conversation"}
    />
  );
}
