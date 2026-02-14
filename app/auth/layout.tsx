// Auth pages split-screen layout wrapper
import { AuthPanel } from "@/components/auth/auth-panel";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left branding panel */}
      <AuthPanel />

      {/* Right form panel */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6 bg-transparent">
          <div className="w-full max-w-md">
            <div className="glass-card-medium rounded-2xl p-8 md:p-10">
              {children}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="py-6 px-6 border-t border-primary/10 bg-transparent">
          <div className="max-w-md mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
            <div>© 2026 PolicyPal</div>
            <div className="flex items-center gap-4">
              <Link href="#" className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <span>·</span>
              <Link href="#" className="hover:text-foreground transition-colors">
                Support
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
