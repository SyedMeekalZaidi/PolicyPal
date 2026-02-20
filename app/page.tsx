import { createClient } from "@/lib/supabase/server";
import { getUserIdFromClaims } from "@/lib/profile/gate";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { CTA } from "@/components/landing/cta";
import { Footer } from "@/components/landing/footer";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);

  let user = null;
  if (userId) {
    const { data: authUser } = await supabase.auth.getUser();
    if (authUser?.user) {
      const metadata = authUser.user.user_metadata || {};
      const firstName = metadata.first_name || metadata.firstName || "";
      const lastName = metadata.last_name || metadata.lastName || "";
      const fullName = `${firstName} ${lastName}`.trim() || authUser.user.email?.split("@")[0] || "User";
      user = {
        name: fullName,
        email: authUser.user.email || "",
      };
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar user={user} />
      <Hero isAuthenticated={!!user} />
      <Features />
      <CTA />
      <Footer />
    </main>
  );
}
