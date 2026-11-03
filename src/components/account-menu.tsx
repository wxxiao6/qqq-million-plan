"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { DropdownMenu } from "radix-ui";
import { BriefcaseBusiness, CalendarDays, Check, ChevronDown, LoaderCircle, LogOut, Radar } from "lucide-react";
import { toast } from "sonner";

const PAGES = [
  { href: "/quota", label: "纳指雷达", icon: Radar },
  { href: "/holdings/manage", label: "我的持仓", icon: BriefcaseBusiness },
  { href: "/dca", label: "我的定投", icon: CalendarDays },
] as const;

export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const name = email.split("@")[0];

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      router.replace("/quota");
      router.refresh();
    } catch {
      toast.error("退出失败，请稍后重试");
      setBusy(false);
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="account-trigger" aria-label={`账号菜单：${email}，已登录`}>
          <span className="account-avatar relative" aria-hidden="true">{Array.from(name)[0]?.toUpperCase() || "U"}<span className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-card bg-gain sm:hidden" /></span>
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block max-w-28 truncate text-sm font-medium">{name}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-gain" />已登录</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} collisionPadding={16} className="account-dropdown z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-1.5 shadow-xl shadow-foreground/10">
          <DropdownMenu.Label className="px-3 py-3">
            <span className="flex items-center gap-1.5 text-xs font-normal text-gain"><Check className="size-3.5" aria-hidden="true" />当前登录账号</span>
            <span className="mt-1.5 block break-all text-sm font-medium">{email}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border/70" />
          {PAGES.map(({ href, label, icon: Icon }) => {
            const current = pathname === href || pathname.startsWith(`${href}/`);
            return <DropdownMenu.Item key={href} asChild>
              <Link href={href} aria-current={current ? "page" : undefined} className="account-menu-item">
                <Icon aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {current && <Check className="text-copper" aria-hidden="true" />}
              </Link>
            </DropdownMenu.Item>;
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-border/70" />
          <DropdownMenu.Item disabled={busy} onSelect={(event) => { event.preventDefault(); void logout(); }} className="account-menu-item cursor-pointer text-destructive data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
            {busy ? "正在退出…" : "退出登录"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
