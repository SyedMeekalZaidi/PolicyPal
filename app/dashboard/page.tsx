import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromClaims, isProfileComplete } from "@/lib/profile/gate";
import { ChatList } from "@/components/dashboard/chat-list";
import { ChatPanel } from "@/components/dashboard/chat-panel";
import { SidebarRight } from "@/components/dashboard/sidebar-right";

// Dashboard skeleton shell (Phase 4): layout only, no chat logic yet.
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const userId = getUserIdFromClaims(data.claims);
  if (!userId) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name,industry,location")
    .eq("id", userId)
    .maybeSingle();

  // Hard gate: cannot access dashboard until onboarding is complete.
  if (!isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="max-w-7xl mx-auto min-h-[calc(100vh-4rem)]">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-6 min-h-[calc(100vh-4rem)]">
          <ChatList />
          <ChatPanel />
          <SidebarRight />
        </div>
      </div>
    </main>
  );
}

