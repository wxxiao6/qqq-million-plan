"use client";

import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type FilterOption<T extends string> = { value: T; label: string };

export function FilterSelect<T extends string>({ label, ariaLabel, value, options, onValueChange, className, triggerClassName, hideLabel = false }: {
  label: string;
  ariaLabel?: string;
  value: T;
  options: readonly FilterOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
  triggerClassName?: string;
  hideLabel?: boolean;
}) {
  const id = useId();

  return <div className={cn("grid min-w-0", !hideLabel && "gap-1.5", className)}>
    <label htmlFor={id} className={hideLabel ? "sr-only" : "shrink-0 whitespace-nowrap text-xs text-muted-foreground"}>{label}</label>
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} aria-label={ariaLabel ?? label} className={cn(
        "w-full min-w-0 cursor-pointer rounded-lg border-border px-3 text-left text-foreground transition-[border-color,box-shadow] hover:border-copper/50 focus-visible:border-copper focus-visible:ring-2 focus-visible:ring-copper/15 data-[size=default]:h-10 data-[state=open]:border-copper data-[state=open]:ring-2 data-[state=open]:ring-copper/10 [&>[data-slot=select-value]]:min-w-0 [&>[data-slot=select-value]]:truncate [&>svg]:opacity-80 [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-180",
        triggerClassName
      )}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start" sideOffset={6} collisionPadding={12}
        className="w-[var(--radix-select-trigger-width)] min-w-0 rounded-2xl border-border bg-popover p-1 shadow-[0_12px_32px_-8px_rgba(70,52,36,.22),0_2px_6px_rgba(70,52,36,.06)]">
        {options.map((option) => <SelectItem key={option.value} value={option.value}
          className="min-h-11 cursor-pointer rounded-lg py-2.5 pr-9 pl-3 text-sm transition-colors focus:bg-muted/70 focus:text-foreground data-[state=checked]:bg-copper/10 data-[state=checked]:font-medium data-[state=checked]:text-copper data-[state=checked]:focus:bg-copper/15 [&_[data-slot=select-item-indicator]]:right-3 [&_[data-slot=select-item-indicator]_svg]:text-copper">
          {option.label}
        </SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}
