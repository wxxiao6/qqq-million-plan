"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { resolveLoginDestination } from "@/lib/auth-navigation";

export function LoginForm({ destination }: { destination: ReturnType<typeof resolveLoginDestination> }) {
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setMessage(result.error ?? "操作失败"); return; }
      router.replace(destination.href); router.refresh();
    } catch { setMessage("网络错误，请稍后重试"); }
    finally { setBusy(false); }
  }

  return <>
    <h1 id="login-heading" className="text-2xl font-semibold tracking-tight">{setup ? "创建你的个人账号" : "欢迎回来"}</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{setup ? "创建账号后，已有持仓与定投数据将归入你的账号。" : `登录后继续${destination.label}。`}</p>
    <form onSubmit={submit} className="mt-7 space-y-5" aria-busy={busy}>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
      <label className="block text-sm font-medium">账号<input required type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="输入账号或邮箱" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-3.5 py-3 font-normal" /></label>
      <label className="block text-sm font-medium">密码<input required type="password" minLength={setup ? 6 : 1} maxLength={256} autoComplete={setup ? "new-password" : "current-password"} placeholder={setup ? "设置至少 6 位密码" : "输入密码"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-3.5 py-3 font-normal" />{setup && <span className="mt-1.5 block text-xs font-normal text-muted-foreground">至少 6 个字符</span>}</label>
      </fieldset>
      {message && <p role="alert" className="rounded-xl bg-paused-wash px-3.5 py-3 text-sm text-destructive">{message}</p>}
      <button disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-wait disabled:opacity-50">{busy ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{setup ? "正在创建…" : "正在登录…"}</> : <>{setup ? "创建账号并认领数据" : "登录并继续"}<ArrowRight className="size-4" aria-hidden="true" /></>}</button>
    </form>
    <div className="mt-6 border-t border-border pt-5 text-center">
      <button type="button" disabled={busy} onClick={() => { setSetup(!setup); setMessage(""); setPassword(""); }} className="min-h-8 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50">{setup ? "已有账号？返回登录" : "首次使用？创建个人账号"}</button>
    </div>
  </>;
}
