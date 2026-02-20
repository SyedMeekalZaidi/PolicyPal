"use client";

// Horizontal pill user menu for authenticated users (navbar).
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  userName: string;
  userEmail: string;
};

export function UserMenu({ userName, userEmail }: Props) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
      setIsLoggingOut(false);
    }
  };

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-3 rounded-full px-4 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-3 cursor-default">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm ring-1 ring-primary/20 flex-shrink-0">
                {initials}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="">
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
          aria-label="Logout"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </TooltipProvider>
  );
}
