import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  lead,
  meta,
  aside,
}: {
  title: string;
  lead?: string;
  meta?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="page-header mb-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-[2rem] font-semibold tracking-[-0.035em] text-foreground sm:text-[2.45rem]">{title}</h1>
        {aside}
      </div>
      {lead ? <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{lead}</p> : null}
      {meta ? <p className="mt-2 text-sm text-muted-foreground">{meta}</p> : null}
    </header>
  );
}

export function Band({
  label,
  hint,
  tone = "read",
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  tone?: "read" | "entry";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn("section-band", tone === "entry" && "text-muted-foreground", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{label}</h2>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-2 rounded-xl px-4 py-4", className)}>
      <dt className="text-xs tracking-[.04em] text-muted-foreground">{label}</dt>
      <dd className="font-display mt-1 text-2xl leading-none tracking-tight">{children}</dd>
    </Card>
  );
}

export function JumpChip({
  href,
  label,
  muted,
  children,
}: {
  href: string;
  label: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="block min-w-40 flex-1 no-underline">
      <Card
        className={cn(
          "h-full gap-2 rounded-xl px-4 py-4 transition-all duration-200 active:scale-[0.99]",
          muted && "opacity-50",
        )}
      >
        <p className="text-xs tracking-[.04em] text-muted-foreground">{label}</p>
        <p className="mt-2 flex items-end justify-between gap-2 text-[17px] font-medium">
          <span>{children}</span>
          <ChevronRight className="mb-0.5 size-4 shrink-0 text-primary" aria-hidden />
        </p>
      </Card>
    </Link>
  );
}

export function JumpLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-copper no-underline"
    >
      {children}
    </Link>
  );
}

export function Region({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{label}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Ghost({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
