import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromClaims, isProfileComplete } from "@/lib/profile/gate";

export default async function ProtectedPage() {
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

  redirect("/dashboard");
}
