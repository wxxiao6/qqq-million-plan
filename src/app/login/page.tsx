"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup ? { email, password, setupToken } : { email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setMessage(result.error ?? "操作失败"); return; }
      router.replace("/holdings/manage"); router.refresh();
    } catch { setMessage("网络错误，请稍后重试"); }
    finally { setBusy(false); }
  }

  return <section className="mx-auto mt-12 w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-sm">
    <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">QQQ MILLION PLAN</p>
    <h1 className="mt-3 font-display text-3xl">{setup ? "初始化个人账号" : "登录"}</h1>
    <p className="mt-2 text-sm text-muted-foreground">持仓和定投数据仅供你的账号使用。</p>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm">账号<input required type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5" /></label>
      <label className="block text-sm">密码<input required type="password" minLength={setup ? 6 : 1} autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5" />{setup && <span className="mt-1 block text-xs text-muted-foreground">至少 6 个字符</span>}</label>
      {setup && <label className="block text-sm">一次性初始化口令<input required type="password" autoComplete="off" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5" /></label>}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "请稍候…" : setup ? "创建账号并认领现有数据" : "登录"}</button>
    </form>
    <button type="button" onClick={() => { setSetup(!setup); setMessage(""); }} className="mt-4 text-sm text-muted-foreground underline underline-offset-4">{setup ? "已有账号？登录" : "首次使用？初始化账号"}</button>
  </section>;
}
