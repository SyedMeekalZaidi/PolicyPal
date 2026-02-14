import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromClaims, isProfileComplete } from "@/lib/profile/gate";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";

function getDisplayNameFromClaims(claims: unknown) {
  if (!claims || typeof claims !== "object") return "there";
  const c = claims as Record<string, unknown>;
  const userMetadata = (c.user_metadata ?? c.userMetadata) as Record<string, unknown> | undefined;
  const first =
    (typeof userMetadata?.first_name === "string" && userMetadata.first_name) ||
    (typeof userMetadata?.firstName === "string" && userMetadata.firstName) ||
    "";
  const last =
    (typeof userMetadata?.last_name === "string" && userMetadata.last_name) ||
    (typeof userMetadata?.lastName === "string" && userMetadata.lastName) ||
    "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const email = typeof c.email === "string" ? c.email : "";
  return email ? email.split("@")[0] : "there";
}

export default async function OnboardingPage() {
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

  // If already complete, don't let users revisit onboarding.
  if (isProfileComplete(profile)) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <OnboardingForm userId={userId} displayName={getDisplayNameFromClaims(data.claims)} />
    </main>
  );
}

