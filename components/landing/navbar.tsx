"use client";

// Landing page navigation bar with conditional auth display.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/shared/user-menu";

type Props = {
  user: { name: string; email: string } | null;
};

export function Navbar({ user }: Props) {
  return (
    <nav className="fixed top-0 w-full z-50 glass-nav">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-primary hover:opacity-80 transition-opacity">
          PolicyPal
        </Link>

        {user ? (
          <UserMenu userName={user.name} userEmail={user.email} />
        ) : (
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/auth/login">Sign In</Link>
            </Button>
            <Button asChild className="rounded-xl">
              <Link href="/auth/sign-up">Get Started</Link>
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
