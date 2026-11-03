"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaProvider } from "@/components/pwa";

export function UiProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={250}>
      <PwaProvider>{children}</PwaProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
