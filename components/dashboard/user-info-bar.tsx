"use client";

// Dashboard bottom bar: user initials, name, and settings icon.
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  userName: string;
  userEmail: string;
};

export function UserInfoBar({ userName, userEmail }: Props) {
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-3 rounded-xl bg-white/10 border border-white/10 px-3 py-2.5">
        {/* Initials avatar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm ring-1 ring-primary/20 flex-shrink-0 cursor-default">
              {initials}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </TooltipContent>
        </Tooltip>

        {/* Name */}
        <p className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
          {userName}
        </p>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-xl hover:bg-white/20 flex-shrink-0"
          aria-label="Settings"
          disabled
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </TooltipProvider>
  );
}
