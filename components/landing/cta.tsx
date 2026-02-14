// Landing page call-to-action section
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <div className="glass-card-medium rounded-2xl p-12 shadow-lg hover:shadow-2xl hover:shadow-blue-300/20 transition-shadow duration-300 relative overflow-hidden">
          {/* Subtle top shine */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Ready to streamline your compliance workflow?
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Join compliance officers who trust PolicyPal for faster, more accurate regulatory analysis.
            </p>
            <Button asChild size="lg" className="rounded-xl min-w-[180px]">
              <Link href="/auth/sign-up">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
