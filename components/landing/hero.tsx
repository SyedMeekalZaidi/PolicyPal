"use client";

// Landing page hero with conditional CTAs based on auth state.
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props = {
  isAuthenticated: boolean;
};

export function Hero({ isAuthenticated }: Props) {
  return (
    <section className="pt-32 pb-20 px-6 relative">
      <div className="max-w-6xl mx-auto text-center relative z-10">
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-6 tracking-tight">
          Smart Compliance.
          <br />
          <span className="italic font-bold bg-gradient-to-r from-primary to-selected bg-clip-text text-transparent">
            Better Decisions.
          </span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          AI-powered compliance assistant for regulatory policy analysis. 
          Summarize, inquire, compare, and audit documents with confidence.
        </p>

        {isAuthenticated ? (
          <Button
            asChild
            size="lg"
            className="rounded-xl min-w-[200px] text-base px-10 py-4 h-auto glass-outline-rotating"
          >
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button asChild size="lg" className="rounded-xl min-w-[160px]">
              <Link href="/auth/sign-up">Get Started</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl min-w-[160px] glass-card-light">
              <Link href="#features">Learn More</Link>
            </Button>
          </div>
        )}

        <div className="mt-16 max-w-4xl mx-auto">
          <div className="glass-card-medium rounded-2xl shadow-2xl shadow-blue-300/25 p-3 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            
            <div className="aspect-video rounded-xl bg-gradient-to-br from-muted via-section to-primary/10 flex items-center justify-center text-muted-foreground relative z-10 border border-primary/10">
              <span className="text-sm font-medium">Product screenshot coming soon</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
