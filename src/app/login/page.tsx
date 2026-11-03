import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, CalendarDays, LockKeyhole, Radar } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { resolveLoginDestination } from "@/lib/auth-navigation";
import { getCurrentUser } from "@/server/auth/context";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destination = resolveLoginDestination(next);
  if (await getCurrentUser()) redirect(destination.href);

  return (
    <div className="mx-auto max-w-5xl py-2 sm:py-8 lg:py-12">
      <Link href="/quota" className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />返回纳指雷达</Link>
      <div className="mt-6 grid items-center gap-10 lg:mt-10 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <section aria-labelledby="login-intro" className="order-2 lg:order-1">
          <p className="font-mono text-[11px] tracking-[0.18em] text-copper">YOUR INVESTMENT WORKSPACE</p>
          <h2 id="login-intro" className="mt-5 text-3xl font-semibold leading-[1.4] tracking-tight sm:text-4xl">每一笔积累，<br />都有迹可循。</h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">登录你的个人工作台，让持仓、收益与定投计划各归其位。</p>
          <div className="mt-8 hidden space-y-5 sm:block">
            <div className="flex items-start gap-3"><span className="rounded-xl bg-secondary p-2.5"><BriefcaseBusiness className="size-4 text-copper" aria-hidden="true" /></span><div><h2 className="text-sm font-medium">持仓一目了然</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">按基金和渠道，查看持仓与收益。</p></div></div>
            <div className="flex items-start gap-3"><span className="rounded-xl bg-secondary p-2.5"><CalendarDays className="size-4 text-copper" aria-hidden="true" /></span><div><h2 className="text-sm font-medium">定投有序进行</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">管理投资计划，回看每一次执行。</p></div></div>
          </div>
          <Link href="/quota" className="mt-8 inline-flex items-center gap-2 border-t border-border pt-5 text-xs text-muted-foreground hover:text-foreground"><Radar className="size-4" aria-hidden="true" />只看基金行情？纳指雷达无需登录<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link>
        </section>
        <section aria-labelledby="login-heading" className="order-1 rounded-3xl border border-border bg-card p-6 shadow-[0_12px_40px_rgba(70,52,36,0.05)] sm:p-8 lg:order-2">
          <div className="mb-6 flex items-center gap-2 border-b border-border pb-5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5 text-copper" aria-hidden="true" />持仓与定投需登录后使用</div>
          <LoginForm destination={destination} />
        </section>
      </div>
    </div>
  );
}
