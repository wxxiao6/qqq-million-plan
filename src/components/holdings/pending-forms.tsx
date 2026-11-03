"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Info, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { ACCOUNT_LABELS } from "@/components/labels";
import { FormError } from "@/components/form-error";
import { FilterSelect } from "@/components/filter-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { beijingTodayISO, formatMoney, isISODate } from "@/lib/format";
import { notifySaved } from "@/lib/notify";
import type { DcaPlanView } from "@/lib/dca";
import { addPendingSubscription, finishPendingSubscription } from "@/server/ledger/actions";
import type { Account, CutoffPeriod } from "@/server/ledger";

export function PendingSubscriptionForm({ names, plans, managers = {} }: { names: Record<string, string>; plans: DcaPlanView[]; managers?: Record<string, string> }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [account, setAccount] = useState<Account>("alipay");
  const [planId, setPlanId] = useState("");
  const [executionOn, setExecutionOn] = useState(beijingTodayISO);
  const [cutoff, setCutoff] = useState<CutoffPeriod | "">("");
  const [cash, setCash] = useState("");
  const [fee, setFee] = useState("0");
  const availablePlans = plans.filter((plan) => plan.symbol === symbol && plan.account === account && plan.status !== "ended");
  const cashNumber = Number(cash);
  const feeNumber = Number(fee || 0);
  const validCash = cash.trim() !== "" && Number.isFinite(cashNumber) && cashNumber >= 0.01;
  const validFee = Number.isFinite(feeNumber) && feeNumber >= 0 && (!validCash || feeNumber < cashNumber);
  const missing = !symbol ? "请从搜索结果中选择基金" : !isISODate(executionOn) ? "请填写实际申购日期" : !cutoff ? "请选择 15:00 前或后" : !validCash ? "请输入不小于 0.01 元的扣款金额" : !validFee ? "手续费须为非负数，且小于扣款金额" : null;
  const platform = account === "gf_direct" ? managers[symbol] ?? "基金公司直购" : ACCOUNT_LABELS[account];

  return <Dialog open={open} onOpenChange={(next) => {
    if (busy) return;
    setOpen(next);
    if (next) {
      setSymbol(""); setAccount("alipay"); setPlanId(""); setExecutionOn(beijingTodayISO());
      setCutoff(""); setCash(""); setFee("0"); setError(null);
    }
  }}>
    <DialogTrigger asChild><Button size="sm" variant="outline">补录待确认申购</Button></DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <form className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (missing) { setError(missing); return; }
        setBusy(true); setError(null);
        const data = new FormData(event.currentTarget);
        try {
          const result = await addPendingSubscription({
            symbol, account, executionOn, cutoffPeriod: cutoff as CutoffPeriod,
            cashDebited: cashNumber, feeAmount: feeNumber,
            dcaPlanId: planId ? Number(planId) : null,
            note: String(data.get("note") || ""),
          });
          if (!result.ok) { setError(result.error); return; }
          setOpen(false); router.refresh(); notifySaved("待确认申购已保存");
        } catch {
          setError("暂时无法保存，填写的内容已保留，请重试。");
        } finally { setBusy(false); }
      }}>
        <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
          <DialogTitle>补录待确认申购</DialogTitle>
          <DialogDescription>记录已扣款、尚未确认份额的申购，无需填写份额或净值。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            <section className="space-y-3" aria-labelledby={`${formId}-fund-title`}>
              <PendingSectionTitle id={`${formId}-fund-title`} number="01" title="基金与购买渠道" />
              <StoredFundPicker key={String(open)} id={`${formId}-fund`} names={names} symbol={symbol} onSelect={(value) => { setSymbol(value); setPlanId(""); setError(null); }} />
              <div role="group" aria-label="购买渠道" className="grid grid-cols-2 gap-2">
                {([["agency", "第三方平台"], ["direct", "基金公司直购"]] as const).map(([value, label]) => {
                  const selected = value === "direct" ? account === "gf_direct" : account !== "gf_direct";
                  return <button key={value} type="button" aria-pressed={selected} onClick={() => { setAccount(value === "direct" ? "gf_direct" : "alipay"); setPlanId(""); setError(null); }}
                    className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${selected ? "border-copper bg-copper/5 font-medium text-copper" : "border-border hover:bg-muted/40"}`}>
                    {label}{selected ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                  </button>;
                })}
              </div>
              {account === "gf_direct" ? <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">{symbol ? `购买账户：${platform}` : "选择基金后，自动匹配所属基金公司。"}</p> :
                <FilterSelect<Account> label="购买平台" value={account} onValueChange={(value) => { setAccount(value); setPlanId(""); setError(null); }}
                  className="grid-cols-[auto_minmax(0,1fr)] items-center gap-3" triggerClassName="data-[size=default]:h-11 rounded-xl"
                  options={(["alipay", "cmb", "jd", "other"] as const).map((value) => ({ value, label: ACCOUNT_LABELS[value] }))} />}
            </section>
            <section className="space-y-3 border-t border-border pt-4" aria-labelledby={`${formId}-amount-title`}>
              <PendingSectionTitle id={`${formId}-amount-title`} number="02" title="申购时间与扣款" />
              <div className="grid gap-3 min-[480px]:grid-cols-2">
                <div className="grid min-w-0 content-start gap-2"><Label htmlFor={`${formId}-date`}>实际申购日期</Label><Input id={`${formId}-date`} type="date" value={executionOn} onChange={(event) => { setExecutionOn(event.target.value); setError(null); }} className="h-11 min-w-0 rounded-xl" required /></div>
                <div className="grid min-w-0 content-start gap-2"><Label asChild><span id={`${formId}-cutoff-label`}>申请受理时间</span></Label>
                  <div role="group" aria-labelledby={`${formId}-cutoff-label`} className="grid grid-cols-2 gap-2">
                    {([["before_15", "15:00 前"], ["after_15", "15:00 后"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={cutoff === value} onClick={() => { setCutoff(value); setError(null); }}
                      className={`h-11 rounded-xl border px-2 py-2 text-sm transition-colors ${cutoff === value ? "border-copper bg-copper/5 font-medium text-copper" : "border-border hover:bg-muted/40"}`}>{label}</button>)}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">按购买平台的受理时间填写，净值日与份额确认日以基金公司确认为准。</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid min-w-0 gap-2"><Label htmlFor={`${formId}-cash`}>实际扣款<span className="font-normal text-muted-foreground">（元）</span></Label><Input id={`${formId}-cash`} type="number" inputMode="decimal" min="0.01" step="any" value={cash} onChange={(event) => { setCash(event.target.value); setError(null); }} placeholder="例如 500.00" className="h-12 rounded-xl font-mono text-lg md:text-lg" required /></div>
                <div className="grid min-w-0 gap-2"><Label htmlFor={`${formId}-fee`}>其中手续费<span className="font-normal text-muted-foreground">（元）</span></Label><Input id={`${formId}-fee`} type="number" inputMode="decimal" min="0" step="any" value={fee} onChange={(event) => { setFee(event.target.value); setError(null); }} aria-invalid={!validFee} aria-describedby={`${formId}-amount-help`} className="h-12 rounded-xl font-mono text-lg md:text-lg" /></div>
              </div>
              <div id={`${formId}-amount-help`} aria-live="polite" className={`rounded-xl px-3.5 py-3 ${validFee ? "bg-muted/50" : "bg-destructive/5"}`}>
                {!validFee ? <p className="text-xs text-destructive">手续费须为非负数，且小于扣款金额。</p> : <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs text-muted-foreground">计入待确认资金</span><output className="break-all font-mono text-lg font-semibold">{validCash ? formatMoney(cashNumber) : "—"}</output></div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{validCash ? `申购净额 ${formatMoney(cashNumber - feeNumber)}，手续费 ${formatMoney(feeNumber)}。` : "扣款金额包含手续费，请与平台扣款记录一致。"}确认份额后计入持仓与收益。</p>
                </>}
              </div>
            </section>
            <details className="group rounded-xl border-border px-3.5 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">备注与定投关联（选填）<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
              <div className="mt-3 space-y-3">
                {availablePlans.length ? <FilterSelect label="关联定投计划" value={planId || "none"} onValueChange={(value) => { setPlanId(value === "none" ? "" : value); setError(null); }}
                  options={[{ value: "none", label: "不关联，按手动申购记录" }, ...availablePlans.map((plan) => ({ value: String(plan.id), label: `计划 #${plan.id} · ${plan.frequencyLabel} · ${formatMoney(plan.amount)}` }))]} /> : <p className="text-xs leading-relaxed text-muted-foreground">{symbol ? "当前基金与购买渠道没有可关联的定投计划，将按手动申购记录。" : "选定基金和购买渠道后，可关联已有定投计划。"}</p>}
                <div className="grid gap-2"><Label htmlFor={`${formId}-note`}>备注</Label><Input id={`${formId}-note`} name="note" placeholder="例如：补录平台扣款记录" className="h-11 rounded-xl" /></div>
              </div>
            </details>
          </fieldset>
        </div>
        <div className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4 sm:px-6">
          <FormError error={error} />
          <p id={`${formId}-save-help`} role="status" className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{missing ?? `将保存至${platform}，份额确认前收益显示待确认。`}</p>
          <DialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 sm:flex">
            <Button type="button" variant="outline" className="h-11 px-5" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={busy || Boolean(missing)} aria-describedby={`${formId}-save-help`} className="h-11 px-6" type="submit">{busy ? <><Loader2 className="size-4 animate-spin" />保存中…</> : "保存待确认申购"}</Button>
          </DialogFooter>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function PendingSectionTitle({ id, number, title }: { id: string; number: string; title: string }) {
  return <h3 id={id} className="flex items-center gap-2.5 text-sm font-semibold"><span className="grid size-6 place-items-center rounded-full bg-muted font-mono text-[10px] font-medium text-muted-foreground">{number}</span>{title}</h3>;
}

function StoredFundPicker({ id, names, symbol, onSelect }: { id: string; names: Record<string, string>; symbol: string; onSelect: (code: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [active, setActive] = useState(0);
  const normalized = query.trim().toLowerCase();
  const matches = normalized ? Object.entries(names).filter(([code, name]) => `${code} ${name}`.toLowerCase().includes(normalized)).slice(0, 8) : [];
  const expanded = showResults && Boolean(normalized);
  useEffect(() => {
    if (expanded) results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);
  function choose(code: string) {
    onSelect(code); setShowResults(false);
    requestAnimationFrame(() => changeButton.current?.focus());
  }

  return <div onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowResults(false); }}>
    {symbol ? <div className="flex items-start gap-2.5 rounded-xl border border-copper/25 bg-copper/5 p-3.5">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-copper/10 text-copper"><Check className="size-3" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-relaxed">{names[symbol]}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{symbol}</p></div>
      <button ref={changeButton} type="button" className="shrink-0 rounded-md px-1 py-1 text-xs text-copper hover:underline" onClick={() => { onSelect(""); setQuery(""); setActive(0); requestAnimationFrame(() => input.current?.focus()); }}>更换基金</button>
    </div> : <>
      <Label htmlFor={id} className="sr-only">基金名称或代码</Label>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined} aria-activedescendant={expanded && matches.length ? `${id}-result-${Math.min(active, matches.length - 1)}` : undefined}
          value={query} autoComplete="off" placeholder="输入基金名称或六位代码" className="h-12 rounded-xl pl-9" aria-describedby={`${id}-help`}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setShowResults(true); }} onFocus={() => setShowResults(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setShowResults(false); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setShowResults(true); setActive((index) => !expanded ? 0 : event.key === "ArrowDown" ? Math.min(index + 1, Math.max(0, matches.length - 1)) : Math.max(0, index - 1)); }
            if (event.key === "Enter") { event.preventDefault(); if (expanded && matches.length) choose(matches[Math.min(active, matches.length - 1)][0]); }
          }} />
      </div>
      {expanded ? <div className="mt-2 rounded-xl border border-border bg-popover p-1 shadow-[0_5px_15px_rgba(70,52,36,.06)]">
        {matches.length ? <div ref={results} id={`${id}-results`} role="listbox" aria-label="可补录的基金" className="max-h-44 overflow-y-auto">
          {matches.map(([code, name], index) => <button id={`${id}-result-${index}`} key={code} type="button" role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(code)}
            className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${active === index ? "bg-muted/70" : "hover:bg-muted/50"}`}><span className="shrink-0 font-mono text-xs text-copper">{code}</span><span className="min-w-0 leading-relaxed">{name}</span></button>)}
        </div> : <div id={`${id}-results`} role="status" className="px-3 py-3"><p className="text-sm font-medium">未找到已添加的基金</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">请检查代码，或改用基金名称搜索。这里只显示已添加的人民币场外基金。</p></div>}
      </div> : null}
      <p id={`${id}-help`} className="mt-2 text-xs text-muted-foreground">搜索已添加的人民币场外基金，选中后补录申购。</p>
    </>}
  </div>;
}

export function ResolvePendingForm({ id, executionOn, cutoffPeriod, description }: { id: number; executionOn: string | null; cutoffPeriod: CutoffPeriod | null; description?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline">处理待确认</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto"><form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null);
      const data = new FormData(event.currentTarget);
      try {
        const result = await finishPendingSubscription({ id, outcome: "settled", shares: Number(data.get("shares")), tDate: String(data.get("tDate")), confirmedOn: String(data.get("confirmedOn")), executionOn: executionOn ?? String(data.get("executionOn")), cutoffPeriod: cutoffPeriod ?? String(data.get("cutoffPeriod")) as CutoffPeriod });
        if (!result.ok) { setError(result.error); return; }
        setOpen(false); router.refresh();
      } finally { setBusy(false); }
    }}>
      <DialogHeader className="pr-5 text-left"><DialogTitle>确认申购份额</DialogTitle>{description ? <DialogDescription>{description}</DialogDescription> : null}</DialogHeader><FormError error={error} />
      {!executionOn ? <div className="grid gap-2"><Label htmlFor={`execution-${id}`}>实际申购日期</Label><Input id={`execution-${id}`} name="executionOn" type="date" required /></div> : null}
      {!cutoffPeriod ? <div className="grid gap-2"><Label htmlFor={`cutoff-${id}`}>申请受理时间</Label><select id={`cutoff-${id}`} name="cutoffPeriod" className="h-10 rounded-md border bg-background px-3" defaultValue="" required><option value="" disabled>请选择</option><option value="before_15">15:00 前</option><option value="after_15">15:00 后</option></select></div> : null}
      <div className="grid gap-2"><Label htmlFor={`shares-${id}`}>确认份额</Label><Input id={`shares-${id}`} name="shares" type="number" min="0.000001" step="any" required /></div>
      <div className="grid gap-2"><Label htmlFor={`t-date-${id}`}>基金确认的 T 日</Label><Input id={`t-date-${id}`} name="tDate" type="date" required /></div>
      <div className="grid gap-2"><Label htmlFor={`confirm-date-${id}`}>份额确认日期</Label><Input id={`confirm-date-${id}`} name="confirmedOn" type="date" required /></div>
      <DialogFooter><Button type="submit" disabled={busy}>确认份额</Button></DialogFooter>
      <div className="flex gap-2 border-t pt-3">{([ ["failed", "申购失败"], ["cancelled", "已撤单"] ] as const).map(([outcome, label]) => <Button key={outcome} type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true); const result = await finishPendingSubscription({ id, outcome }); setBusy(false);
        if (!result.ok) setError(result.error); else { setOpen(false); router.refresh(); }
      }}>{label}</Button>)}</div>
    </form></DialogContent>
  </Dialog>;
}
