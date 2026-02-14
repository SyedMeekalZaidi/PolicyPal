"use client";

import { z } from "zod";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchSelect } from "@/components/shared/search-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { COUNTRIES } from "@/lib/constants/countries";
import { INDUSTRIES } from "@/lib/constants/industries";

const schema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  country: z.string().trim().min(1, "Country is required"),
  industry: z.string().trim().min(1, "Industry is required"),
  description: z.string().trim().max(600, "Description is too long").optional(),
});

type Props = {
  userId: string;
  displayName: string;
};

export function OnboardingForm({ userId, displayName }: Props) {
  const router = useRouter();

  const [phase, setPhase] = useState<"welcome" | "form">("welcome");
  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const welcomeText = useMemo(() => {
    const name = displayName?.trim() || "there";
    return { line1: `Hi ${name}`, line2: "Welcome to PolicyPal" };
  }, [displayName]);

  const handleWelcomeComplete = useCallback(() => {
    setPhase("form");
  }, []);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const parsed = schema.safeParse({
        companyName,
        country,
        industry,
        description: description ? description : undefined,
      });

      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Please check your inputs.");
        return;
      }

      setIsSaving(true);
      try {
        const supabase = createClient();
        const { error: updateError } = await supabase
          .from("profiles")
          .update({
            company_name: parsed.data.companyName,
            location: parsed.data.country,
            industry: parsed.data.industry,
            company_description: parsed.data.description ?? null,
          })
          .eq("id", userId);

        if (updateError) throw updateError;

        router.replace("/dashboard");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
      } finally {
        setIsSaving(false);
      }
    },
    [companyName, country, description, industry, router, userId],
  );

  return (
    <div className="w-full max-w-xl mx-auto">
      {phase === "welcome" && (
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5 }}
          onAnimationComplete={() => {
            window.setTimeout(() => handleWelcomeComplete(), 1100);
          }}
        >
          <motion.h1
            className="text-4xl md:text-5xl font-bold text-foreground mb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
          >
            {welcomeText.line1}
          </motion.h1>
          <motion.p 
            className="text-lg text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            {welcomeText.line2}
          </motion.p>
        </motion.div>
      )}

      {phase === "form" && (
        <motion.div
          className="glass-card-medium rounded-2xl p-8 md:p-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.21, 0.47, 0.32, 0.98] }}
        >
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-foreground mb-2">Let’s get started</h2>
            <p className="text-sm text-muted-foreground">
              This helps PolicyPal tailor answers to your business and regulatory context.
            </p>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Company Name</Label>
              <Input
                id="company-name"
                placeholder="e.g. PolicyPal Sdn Bhd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="relative z-10"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Country</Label>
                <SearchSelect
                  items={COUNTRIES}
                  value={country}
                  onChange={setCountry}
                  placeholder="Select country..."
                  searchPlaceholder="Search country..."
                />
              </div>
              <div className="space-y-2">
                <Label>Industry</Label>
                <SearchSelect
                  items={INDUSTRIES}
                  value={industry}
                  onChange={setIndustry}
                  placeholder="Select industry..."
                  searchPlaceholder="Search industry..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="company-desc">
                  Company Description <span className="text-muted-foreground">(optional)</span>
                </Label>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="relative z-20 inline-flex items-center justify-center rounded-full h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Description help"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs z-50">
                      Include what you do and how you operate (products/services, regulated activities, customer type,
                      regions). This improves AI accuracy.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Textarea
                id="company-desc"
                placeholder="e.g. We provide payment processing for SMEs in Malaysia and Singapore..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="relative z-10"
              />
              <p className="text-xs text-muted-foreground">
                Keep it short—just enough context to tailor compliance answers.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full rounded-xl" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save and Continue"}
            </Button>
          </form>
        </motion.div>
      )}
    </div>
  );
}

