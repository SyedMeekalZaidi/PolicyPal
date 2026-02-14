"use client";

// Landing page features section with animated cards
import { FileText, MessageCircle, GitCompare, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  {
    icon: FileText,
    title: "Summarize",
    description: "Condense 100-page policies into actionable summaries with key insights and requirements.",
  },
  {
    icon: MessageCircle,
    title: "Inquire",
    description: "Ask questions across multiple documents and get precise answers with citations.",
  },
  {
    icon: GitCompare,
    title: "Compare",
    description: "Compare policy versions side-by-side to identify changes and update requirements.",
  },
  {
    icon: ShieldCheck,
    title: "Audit",
    description: "Audit compliance across regulatory sources with severity ratings and consequences.",
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Section heading */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            What PolicyPal Can Do
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Four powerful actions designed for compliance officers and regulatory teams
          </p>
        </div>

        {/* Feature cards grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.1,
                  ease: [0.21, 0.47, 0.32, 0.98],
                }}
                className="glass-card-light rounded-2xl p-6 hover:shadow-xl hover:shadow-blue-300/20 transition-all duration-300 hover:scale-[1.02] relative overflow-hidden"
              >
                {/* Subtle top shine */}
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                
                <div className="flex items-start gap-4 relative z-10">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
