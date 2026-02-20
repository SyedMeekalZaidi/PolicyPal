// Dashboard layout: auth + profile gate, then 3-panel shell.
// LeftPanel and SourcesPanel persist across route changes (/dashboard ↔ /dashboard/[id]).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromClaims, isProfileComplete } from "@/lib/profile/gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  if (!isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  const { data: authUser } = await supabase.auth.getUser();
  const metadata = authUser?.user?.user_metadata || {};
  const firstName = metadata.first_name || metadata.firstName || "";
  const lastName = metadata.last_name || metadata.lastName || "";
  const fullName =
    `${firstName} ${lastName}`.trim() ||
    authUser?.user?.email?.split("@")[0] ||
    "User";
  const email = authUser?.user?.email || "";

  return (
    <main className="h-screen p-4 overflow-hidden">
      <DashboardShell userName={fullName} userEmail={email}>
        {children}
      </DashboardShell>
    </main>
  );
}
