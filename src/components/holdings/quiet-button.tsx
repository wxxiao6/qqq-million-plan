import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const quietActionClass =
  "h-auto px-0 text-[15px] font-normal text-copper/75 hover:bg-transparent hover:text-copper";

export function QuietButton({
  children,
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(quietActionClass, className)}
      {...props}
    >
      {children}
    </Button>
  );
}
