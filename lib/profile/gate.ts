// Profile gating utilities for onboarding completeness checks.
// Keep this logic centralized so /protected and /dashboard stay consistent.

export type ProfileGateFields = {
  company_name: string | null;
  industry: string | null;
  location: string | null; // UI labels this as "Country"
};

export function isProfileComplete(profile: ProfileGateFields | null | undefined) {
  if (!profile) return false;
  const company = profile.company_name?.trim();
  const industry = profile.industry?.trim();
  const country = profile.location?.trim();
  return Boolean(company && industry && country);
}

// Supabase `getClaims()` returns a JWT claims object. The user id is usually in `sub`,
// but we defensively support other common keys.
export function getUserIdFromClaims(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") return null;
  const c = claims as Record<string, unknown>;
  const id =
    (typeof c.sub === "string" && c.sub) ||
    (typeof c.user_id === "string" && c.user_id) ||
    (typeof c.id === "string" && c.id) ||
    null;
  return id;
}

