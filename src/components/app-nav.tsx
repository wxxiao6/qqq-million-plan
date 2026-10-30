"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, CalendarDays, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dca", label: "定投管理", icon: CalendarDays },
  { href: "/holdings/manage", label: "持仓管理", icon: BriefcaseBusiness },
  { href: "/quota", label: "纳指雷达", icon: Unlock },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="app-shell sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-3.5 sm:px-8 lg:px-10">
        <Link href="/quota" className="brand shrink-0 no-underline">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>qqq-million-plan</span>
        </Link>
        <nav aria-label="导航" className="app-nav flex items-center gap-1">
          {ITEMS.map((item) => {
            const current =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "nav-item inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm no-underline transition-all duration-200",
                  current
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-card hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
