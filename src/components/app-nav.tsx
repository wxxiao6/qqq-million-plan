"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { loginHref } from "@/lib/auth-navigation";
import { AccountMenu } from "@/components/account-menu";

export function AppNav({ user }: { user: { email: string } | null }) {
  const pathname = usePathname();

  return (
    <header className="app-shell sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-3.5 sm:px-8 lg:px-10">
        <Link href="/quota" className="brand shrink-0 no-underline">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>百万纳指计划</span>
        </Link>
        <div className="flex shrink-0 items-center justify-end gap-3">
          {user ? <AccountMenu email={user.email} /> : <>
            <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", pathname !== "/login" && "max-[400px]:hidden")}><UserRound className="size-3.5" aria-hidden="true" />访客模式</span>
            {pathname !== "/login" && <Link href={loginHref(pathname)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"><LogIn className="size-3.5" aria-hidden="true" />登录</Link>}
          </>}
        </div>
      </div>
    </header>
  );
}
