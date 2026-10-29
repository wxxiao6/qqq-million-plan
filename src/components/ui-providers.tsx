"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function UiProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={250}>
      {children}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
