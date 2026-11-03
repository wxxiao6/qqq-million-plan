"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { FormError } from "@/components/form-error";
import {
  DCA_ACCOUNT_LABELS,
  DCA_FEE_KIND_LABELS,
  DCA_FREQUENCY_LABELS,
  WEEKDAY_LABELS,
} from "@/components/labels";
import { QuietButton } from "@/components/holdings/quiet-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  accountsForChannel,
  candidatesForChannel,
  DCA_FREQUENCIES,
  dcaChannelWarning,
  dcaChannelWarningLabel,
  defaultDcaAccount,
  isLegalDcaAccount,
  type DcaAccount,
  type DcaChannelKind,
  type DcaFeeKind,
  type DcaExecutionStatus,
  type DcaFrequency,
  type DcaPlanView,
  type DcaShareCandidate,
} from "@/lib/dca";
import { beijingTodayISO, todayISO } from "@/lib/format";
import { previewDcaCreation, validateDcaCreation, type DcaCreationMode } from "@/lib/dca-creation";
import { Money } from "@/components/money";
import { notifySaved } from "@/lib/notify";
import {
  deleteDcaPlan,
  endDcaPlan,
  pauseDcaPlan,
  resumeDcaPlan,
  saveDcaExecution,
  saveDcaPlan,
} from "@/server/dca/actions";

function shareKey(symbol: string, shareClass: string) {
  return `${symbol}:${shareClass}`;
}

const DCA_PLAN_DRAFT_KEY = "dca-plan-form-draft:v1";

type DcaPlanDraft = {
  channelKind: DcaChannelKind;
  account: DcaAccount;
  frequency: DcaFrequency;
  weekday: string;
  monthDay: string;
  cutoffPeriod: "before_15" | "after_15";
  feeKind: DcaFeeKind | "none";
  feeValue: string;
  note: string;
};

function readDraft<T>(key: string): Partial<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Partial<T> : null;
  } catch {
    return null;
  }
}

function writeDraft<T>(key: string, draft: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Local storage may be unavailable in private browsing or with blocked storage.
  }
}

function isDcaFrequency(value: unknown): value is DcaFrequency {
  return typeof value === "string" && DCA_FREQUENCIES.includes(value as DcaFrequency);
}

function isDcaChannelKind(value: unknown): value is DcaChannelKind {
  return value === "agency" || value === "direct";
}

function isDcaFeeKind(value: unknown): value is DcaFeeKind | "none" {
  return value === "none" || value === "rate" || value === "fixed";
}

function accountForPlan(
  plan: DcaPlanView | undefined,
  channelKind: DcaChannelKind,
): DcaAccount {
  if (plan?.account && isLegalDcaAccount(channelKind, plan.account)) {
    return plan.account as DcaAccount;
  }
  return defaultDcaAccount(channelKind);
}

export function DcaPlanForm({
  candidates,
  emptyUniverse,
  initial,
  triggerLabel,
  prominent = false,
  managers = {},
  existingPlans = [],
}: {
  candidates: DcaShareCandidate[];
  emptyUniverse: boolean;
  initial?: DcaPlanView;
  triggerLabel?: string;
  prominent?: boolean;
  managers?: Record<string, string>;
  existingPlans?: DcaPlanView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [creationMode, setCreationMode] = useState<DcaCreationMode>("now");
  const [confirmedPreview, setConfirmedPreview] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const today = beijingTodayISO();
  const [channelKind, setChannelKind] = useState<DcaChannelKind>(
    initial?.channelKind ?? "agency",
  );
  const [share, setShare] = useState(
    initial ? shareKey(initial.symbol, initial.shareClass) : "",
  );
  const [account, setAccount] = useState<DcaAccount>(
    accountForPlan(initial, initial?.channelKind ?? "agency"),
  );
  const [frequency, setFrequency] = useState<DcaFrequency>(
    initial?.frequency ?? "weekly",
  );
  const [weekday, setWeekday] = useState(String(initial?.weekday ?? 3));
  const [monthDay, setMonthDay] = useState(String(initial?.monthDay ?? 8));
  const [startDate, setStartDate] = useState(initial?.startDate ?? today);
  const [cutoffPeriod, setCutoffPeriod] = useState<"before_15" | "after_15">(initial?.cutoffPeriod ?? "before_15");
  const [amount, setAmount] = useState(
    initial?.amount != null ? String(initial.amount) : "",
  );
  const [feeKind, setFeeKind] = useState<DcaFeeKind | "none">(
    initial?.feeKind ?? "none",
  );
  const [feeValue, setFeeValue] = useState(
    initial?.feeValue != null ? String(initial.feeValue) : "",
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [fundSearch, setFundSearch] = useState("");
  const [fundOpen, setFundOpen] = useState(false);
  const [fundActiveIndex, setFundActiveIndex] = useState(0);
  const fundInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || initial) return;
    writeDraft<DcaPlanDraft>(DCA_PLAN_DRAFT_KEY, {
      channelKind,
      account,
      frequency,
      weekday,
      monthDay,
      cutoffPeriod,
      feeKind,
      feeValue,
      note,
    });
  }, [account, channelKind, cutoffPeriod, feeKind, feeValue, frequency, initial, monthDay, note, open, weekday]);

  const filtered = useMemo(
    () => candidatesForChannel(candidates, channelKind),
    [candidates, channelKind],
  );
  const options = useMemo(() => {
    if (initial && share && !filtered.some((row) => row.key === share)) {
      const current = candidates.find((row) => row.key === share);
      if (current) return [current, ...filtered];
    }
    return filtered;
  }, [candidates, filtered, share, initial]);
  const matchingFunds = useMemo(() => {
    const query = fundSearch.trim().toLocaleLowerCase();
    return options.filter((row) => !query || `${row.symbol} ${row.name} ${row.shareClass}`.toLocaleLowerCase().includes(query));
  }, [options, fundSearch]);

  const selected = candidates.find((row) => row.key === share);
  const cellStatus =
    channelKind === "direct"
      ? (selected?.directStatus ?? null)
      : (selected?.agencyStatus ?? null);
  const selectedLimit = channelKind === "direct" ? selected?.directDailyLimit : selected?.agencyDailyLimit;
  const warning = selected ? dcaChannelWarning(cellStatus) : null;
  const warningText = dcaChannelWarningLabel(warning);
  const channelAccounts = accountsForChannel(channelKind);
  // Existing plans retain their original start date; editing does not backfill it again.
  const preview = previewDcaCreation({ frequency, startDate, weekday: Number(weekday), monthDay: Number(monthDay), amount: amount === "" ? NaN : Number(amount) }, initial ? startDate : today);
  const previewKey = JSON.stringify([share, channelKind, account, frequency, weekday, monthDay, startDate, amount, cutoffPeriod, feeKind, feeValue, today]);
  const previewConfirmed = confirmedPreview === previewKey;
  const creationError = initial ? null : validateDcaCreation({ frequency, startDate, weekday: Number(weekday), monthDay: Number(monthDay), amount: Number(amount), creationMode, confirmedBackfill: preview.ok ? { count: preview.count, total: preview.total, through: today } : undefined }, today);
  const duplicate = existingPlans.find((plan) => plan.id !== initial?.id && plan.status !== "ended" && plan.symbol === selected?.symbol && plan.account === account);
  const invalid = !selected || !preview.ok || Boolean(creationError) || Boolean(duplicate) || (!initial && creationMode === "history" && preview.ok && preview.count > 0 && !previewConfirmed);

  function resetFromInitial() {
    const draft = initial ? null : readDraft<DcaPlanDraft>(DCA_PLAN_DRAFT_KEY);
    const channel = initial?.channelKind ?? (isDcaChannelKind(draft?.channelKind) ? draft.channelKind : "agency");
    setChannelKind(channel);
    setShare(initial ? shareKey(initial.symbol, initial.shareClass) : "");
    setAccount(initial ? accountForPlan(initial, channel) : draft?.account && isLegalDcaAccount(channel, draft.account) ? draft.account : defaultDcaAccount(channel));
    setFrequency(initial?.frequency ?? (isDcaFrequency(draft?.frequency) ? draft.frequency : "weekly"));
    setWeekday(initial ? String(initial.weekday ?? 3) : typeof draft?.weekday === "string" ? draft.weekday : "3");
    setMonthDay(initial ? String(initial.monthDay ?? 8) : typeof draft?.monthDay === "string" ? draft.monthDay : "8");
    const start = initial?.startDate ?? today;
    setStartDate(start);
    setCreationMode("now"); setConfirmedPreview(null); setShowAdvanced(Boolean(initial?.note || initial?.feeKind));
    setCutoffPeriod(initial?.cutoffPeriod ?? (draft?.cutoffPeriod === "after_15" ? "after_15" : "before_15"));
    setAmount(initial?.amount != null ? String(initial.amount) : "");
    setFeeKind(initial?.feeKind ?? (isDcaFeeKind(draft?.feeKind) ? draft.feeKind : "none"));
    setFeeValue(initial?.feeValue != null ? String(initial.feeValue) : typeof draft?.feeValue === "string" ? draft.feeValue : "");
    setNote(initial?.note ?? (typeof draft?.note === "string" ? draft.note : ""));
    setFundSearch("");
    setFundOpen(false);
    setFundActiveIndex(0);
    setError(null);
  }

  function onChannelChange(next: DcaChannelKind) {
    setChannelKind(next);
    setAccount(defaultDcaAccount(next));
    const nextList = candidatesForChannel(candidates, next);
    if (!nextList.some((row) => row.key === share)) {
      setShare("");
    }
    setFundSearch("");
    setFundOpen(false);
    setFundActiveIndex(0);
  }

  function chooseFund(key: string) {
    setShare(key);
    setFundSearch("");
    setFundOpen(false);
    setFundActiveIndex(0);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || invalid) return;
    if (emptyUniverse) {
      setError("额度数据尚未生成，请稍后检查雷达");
      return;
    }
    if (!selected) {
      setError("请选择基金");
      return;
    }
    const data = new FormData(event.currentTarget);
    const parsedFee =
      feeKind === "none" || feeValue === "" ? Number.NaN : Number(feeValue);
    setPending(true);
    setError(null);
    try {
      const result = await saveDcaPlan({
        id: initial?.id,
        symbol: selected.symbol,
        shareClass: selected.shareClass,
        channelKind,
        account,
        amount: Number(amount),
        feeKind: feeKind === "none" ? null : feeKind,
        feeValue: Number.isFinite(parsedFee) ? parsedFee : null,
        frequency,
        weekday: Number(weekday),
        monthDay: Number(monthDay),
        startDate,
        cutoffPeriod,
        note: String(data.get("note") ?? note),
        creationMode: initial ? undefined : creationMode,
        confirmedBackfill: !initial && creationMode === "history" && preview.ok && previewConfirmed ? { count: preview.count, total: preview.total, through: today } : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setOpen(false);
      notifySaved("定投计划已保存");
    } catch {
      setError("暂时无法保存，填写的内容已保留，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) resetFromInitial();
      }}
    >
      <DialogTrigger asChild>
        {prominent ? <Button type="button">{triggerLabel ?? "新增定投计划"}</Button> :
          <QuietButton>{triggerLabel ?? (initial ? "编辑定投计划" : "新增定投计划")}</QuietButton>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={!pending}>
        <form onSubmit={onSubmit} className="flex max-h-[90dvh] min-h-0 flex-col" aria-busy={pending}>
          <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 text-left sm:px-6">
            <DialogTitle>{initial ? "编辑定投计划" : "新增定投"}</DialogTitle>
            <DialogDescription>选基金、填金额、设置节奏。到期自动记账，实际扣款以购买平台为准。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
          <fieldset disabled={pending} className="min-w-0 space-y-6">
            {emptyUniverse ? <p className="text-sm text-muted-foreground">额度数据尚未生成，<Link href="/quota" className="text-copper underline">查看纳指雷达</Link>。</p> : <>
            <section className="space-y-3" aria-labelledby={`dca-fund-heading-${initial?.id ?? "new"}`}>
              <h3 id={`dca-fund-heading-${initial?.id ?? "new"}`} className="text-sm font-semibold"><span className="mr-2 font-mono text-xs text-copper">01</span>选择基金与购买平台</h3>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="购买渠道">
                {([["agency", "第三方平台", "支付宝、银行等"], ["direct", "基金公司直购", "基金公司 App / 官网"]] as const).map(([value, label, hint]) => <button key={value} type="button" aria-pressed={channelKind === value} onClick={() => onChannelChange(value)} className={`relative min-w-0 rounded-xl border px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${channelKind === value ? "border-copper bg-copper/5" : "border-border hover:bg-muted/40"}`}><span className="block pr-4 text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span>{channelKind === value ? <Check className="absolute right-3 top-3.5 size-3.5 text-copper" aria-hidden="true" /> : null}</button>)}
              </div>
              {channelKind === "agency" ? <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3"><Label htmlFor={`dca-platform-${initial?.id ?? "new"}`}>购买平台</Label><Select value={account} onValueChange={(value) => setAccount(value as DcaAccount)}><SelectTrigger id={`dca-platform-${initial?.id ?? "new"}`} className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{channelAccounts.map((value) => <SelectItem key={value} value={value}>{DCA_ACCOUNT_LABELS[value]}</SelectItem>)}</SelectContent></Select></div> : <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">{selected ? managers[selected.symbol] ?? "基金公司直购" : "选择基金后，自动匹配所属基金公司。"}</p>}
              <div className="grid gap-2">
                <Label htmlFor={`dca-fund-${initial?.id ?? "new"}`}>基金名称或代码</Label>
                {selected && !fundOpen ? <div className="flex items-start gap-3 rounded-xl border border-copper/25 bg-copper/5 p-3.5"><Check className="mt-0.5 size-4 shrink-0 text-copper" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-medium leading-relaxed">{selected.name}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{selected.symbol} · {selected.shareClass} 类</p></div><button type="button" className="text-xs text-copper underline underline-offset-4" onClick={() => { setFundSearch(""); setFundOpen(true); setFundActiveIndex(0); requestAnimationFrame(() => fundInput.current?.focus()); }}>更换</button></div> : <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFundOpen(false); }}>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-4 size-4 text-muted-foreground" />
                  <Input ref={fundInput} id={`dca-fund-${initial?.id ?? "new"}`} role="combobox" aria-expanded={fundOpen} aria-controls={fundOpen ? `dca-fund-options-${initial?.id ?? "new"}` : undefined} aria-activedescendant={fundOpen && matchingFunds.length ? `dca-fund-option-${initial?.id ?? "new"}-${fundActiveIndex}` : undefined} aria-autocomplete="list" value={fundSearch} onFocus={() => { if (fundSearch) setFundOpen(true); }} onClick={() => setFundOpen(true)} onChange={(event) => { setFundSearch(event.target.value); setShare(""); setFundActiveIndex(0); setFundOpen(true); }} onKeyDown={(event) => {
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setFundOpen(false); }
                    if (event.key === "ArrowDown") { event.preventDefault(); setFundOpen(true); setFundActiveIndex((index) => Math.min(index + 1, Math.max(0, matchingFunds.length - 1))); }
                    if (event.key === "ArrowUp") { event.preventDefault(); setFundActiveIndex((index) => Math.max(index - 1, 0)); }
                    if (event.key === "Enter") { event.preventDefault(); if (fundOpen && matchingFunds.length) chooseFund(matchingFunds[fundActiveIndex]?.key ?? matchingFunds[0].key); }
                  }} placeholder="搜索基金名称或代码" className="h-12 pl-9" />
                  {fundOpen ? <div id={`dca-fund-options-${initial?.id ?? "new"}`} role="listbox" aria-label="基金搜索结果" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">{matchingFunds.length ? matchingFunds.map((row, index) => <button id={`dca-fund-option-${initial?.id ?? "new"}-${index}`} type="button" role="option" aria-selected={index === fundActiveIndex} key={row.key} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseFund(row.key)} className={`flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm ${index === fundActiveIndex ? "bg-muted" : "hover:bg-muted/70"}`}><span className="shrink-0 font-mono text-copper">{row.symbol}</span><span className="min-w-0">{row.name}</span></button>) : <p className="px-3 py-4 text-sm text-muted-foreground">该渠道没有匹配的可申购基金。</p>}</div> : null}
                </div>}
                {selected ? <p className="text-xs text-muted-foreground">{cellStatus === "paused" ? "暂停申购" : cellStatus === "open" ? "开放申购，限额待核实" : selectedLimit != null ? `参考日限额 ¥${selectedLimit}` : "额度待核实"}{warningText ? ` · ${warningText}` : ""}</p> : <p className="text-xs text-muted-foreground">可从当前渠道支持的基金中选择。</p>}
                {duplicate ? <p role="status" className="rounded-lg bg-copper/5 p-3 text-xs leading-relaxed text-copper">这个平台已有该基金的{duplicate.status === "paused" ? "暂停" : "进行中"}计划，请取消后编辑或恢复原计划。</p> : null}
                {initial ? <p className="text-xs leading-relaxed text-muted-foreground">更换购买渠道或平台会同步调整该计划的历史记账与持仓记录。</p> : null}
              </div>
            </section>
            <section className="space-y-3" aria-labelledby={`dca-schedule-heading-${initial?.id ?? "new"}`}>
              <h3 id={`dca-schedule-heading-${initial?.id ?? "new"}`} className="text-sm font-semibold"><span className="mr-2 font-mono text-xs text-copper">02</span>设置投入节奏</h3>
              <div className="grid gap-2"><Label htmlFor={`dca-amount-${initial?.id ?? "new"}`}>每期投入（元）</Label><Input id={`dca-amount-${initial?.id ?? "new"}`} name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如 100.00" className="h-12 font-mono text-lg" required /></div>
              <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor={`dca-frequency-${initial?.id ?? "new"}`}>投入频率</Label><Select value={frequency} onValueChange={(value) => setFrequency(value as DcaFrequency)}><SelectTrigger id={`dca-frequency-${initial?.id ?? "new"}`} className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(DCA_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                {frequency === "weekly" || frequency === "biweekly" ? <div className="grid gap-2"><Label htmlFor={`dca-weekday-${initial?.id ?? "new"}`}>周几</Label><Select value={weekday} onValueChange={setWeekday}><SelectTrigger id={`dca-weekday-${initial?.id ?? "new"}`} className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(WEEKDAY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div> : null}
                {frequency === "monthly" ? <div className="grid gap-2"><Label htmlFor={`dca-month-day-${initial?.id ?? "new"}`}>每月几号</Label><Input id={`dca-month-day-${initial?.id ?? "new"}`} type="number" min={1} max={28} step={1} value={monthDay} onChange={(event) => setMonthDay(event.target.value)} className="h-11" required /></div> : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{frequency === "daily" ? "每日按周一至周五安排；" : ""}节假日和实际扣款以购买平台为准。</p>
            </section>
            <section className="space-y-3" aria-labelledby={`dca-start-heading-${initial?.id ?? "new"}`}>
              <h3 id={`dca-start-heading-${initial?.id ?? "new"}`} className="text-sm font-semibold"><span className="mr-2 font-mono text-xs text-copper">03</span>{initial ? "计划起始日期" : "从什么时候开始"}</h3>
              {!initial ? <div className="grid grid-cols-2 gap-2" role="group" aria-label="录入方式">{([["now", "从现在开始", "今天起安排后续投入"], ["history", "补录已有定投", "按原计划补记历史投入"]] as const).map(([value, label, hint]) => <button key={value} type="button" aria-pressed={creationMode === value} onClick={() => { setCreationMode(value); setStartDate(today); setConfirmedPreview(null); }} className={`rounded-xl border px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${creationMode === value ? "border-copper bg-copper/5" : "border-border hover:bg-muted/40"}`}><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span></button>)}</div> : null}
              <div className="grid gap-2"><Label htmlFor={`dca-start-${initial?.id ?? "new"}`}>{creationMode === "history" && !initial ? "补录起始日" : "起始日"}</Label><Input id={`dca-start-${initial?.id ?? "new"}`} type="date" min={!initial && creationMode === "now" ? today : undefined} max={!initial && creationMode === "history" ? today : undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-11" required /></div>
              <div aria-live="polite" className="rounded-xl bg-muted/50 px-3.5 py-3 text-xs leading-relaxed">
                {preview.ok ? <>{!initial ? <><p className="font-medium text-foreground">{creationMode === "history" ? <>将生成 {preview.count} 笔记账记录，合计 <Money value={preview.total} /></> : <>首期计划日 <span className="font-mono">{preview.firstDate}</span></>}</p><p className="mt-1 text-muted-foreground">{creationMode === "history" ? `${preview.historicalCount} 笔历史期次${preview.count > preview.historicalCount ? "，含今天 1 笔" : ""}；下一期 ${preview.nextDate}。` : preview.count ? "今天的期次将在保存后自动记账。" : "首期到期后自动记账。"} 自动记账金额按每期投入估算，含手续费，请对照平台核对。</p></> : <p className="text-muted-foreground">保存后按调整后的计划安排记账，历史记录保留。</p>}</> : <p className="text-muted-foreground">{preview.error}</p>}
                {preview.ok && creationError ? <p role="alert" className="mt-1 text-loss">{creationError}</p> : null}
              </div>
              {!initial && creationMode === "history" && preview.ok && preview.count > 0 ? <label className="flex items-start gap-2.5 text-xs leading-relaxed"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--copper)]" checked={previewConfirmed} onChange={(event) => setConfirmedPreview(event.target.checked ? previewKey : null)} /><span>我已核对补录范围：截至 {today}，共 {preview.count} 笔、合计 <Money value={preview.total} />，与购买平台记录一致。</span></label> : null}
            </section>
            <div className="space-y-3"><button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-expanded={showAdvanced} aria-controls={`dca-advanced-${initial?.id ?? "new"}`} onClick={() => setShowAdvanced(!showAdvanced)}><ChevronDown className={`size-3.5 ${showAdvanced ? "rotate-180" : ""}`} aria-hidden="true" />手续费、受理时间与备注（选填）</button>
              <div id={`dca-advanced-${initial?.id ?? "new"}`} hidden={!showAdvanced} className="space-y-4 rounded-xl bg-muted/30 p-3.5">
                <div className="grid gap-2"><Label htmlFor={`dca-cutoff-${initial?.id ?? "new"}`}>扣款受理时间</Label><Select value={cutoffPeriod} onValueChange={(value) => setCutoffPeriod(value as "before_15" | "after_15")}><SelectTrigger id={`dca-cutoff-${initial?.id ?? "new"}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before_15">15:00 前</SelectItem><SelectItem value="after_15">15:00 后</SelectItem></SelectContent></Select></div>
                <div className="grid gap-2"><Label htmlFor={`dca-fee-kind-${initial?.id ?? "new"}`}>手续费</Label><div className="flex gap-2"><Select value={feeKind} onValueChange={(value) => { setFeeKind(value as DcaFeeKind | "none"); if (value === "none") setFeeValue(""); }}><SelectTrigger id={`dca-fee-kind-${initial?.id ?? "new"}`} className="min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不填</SelectItem>{Object.entries(DCA_FEE_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>{feeKind !== "none" ? <Input id={`dca-fee-${initial?.id ?? "new"}`} aria-label={feeKind === "rate" ? "手续费率（%）" : "每期手续费（元）"} type="number" min="0" step="any" value={feeValue} onChange={(event) => setFeeValue(event.target.value)} placeholder={feeKind === "rate" ? "%" : "元"} className="w-28 shrink-0 font-mono" /> : null}</div></div>
                <div className="grid gap-2"><Label htmlFor={`dca-note-${initial?.id ?? "new"}`}>备注</Label><Input id={`dca-note-${initial?.id ?? "new"}`} name="note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如工资日后扣款" /></div>
              </div>
            </div>
            </>}
          </fieldset>
          </div>
          <div className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4 sm:px-6"><FormError error={error} /><DialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:flex"><p className="hidden flex-1 text-xs text-muted-foreground sm:block">{duplicate ? "请编辑已有计划" : !initial && creationMode === "history" ? "核对补录预览后保存" : "实际扣款以购买平台为准"}</p><Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => setOpen(false)}>取消</Button><Button type="submit" className="h-11" disabled={pending || emptyUniverse || invalid}>{pending ? <><Loader2 className="size-4 animate-spin" />保存中…</> : initial ? "保存修改" : creationMode === "history" ? "保存并补记" : "保存计划"}</Button></DialogFooter></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DcaExecutionForm({ plan, triggerLabel = "记录扣款" }: { plan: DcaPlanView; triggerLabel?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [executionDate, setExecutionDate] = useState(plan.nextDebitDate ?? todayISO());
  const [executionStatus, setExecutionStatus] = useState<DcaExecutionStatus>("bought_before_cutoff");
  const [cashDebited, setCashDebited] = useState(String(plan.amount));
  const [actualFeeAmount, setActualFeeAmount] = useState("");

  return <Dialog open={open} onOpenChange={(next) => {
    setOpen(next);
    if (next) {
      setError(null);
      setExecutionDate(plan.nextDebitDate ?? todayISO());
      setExecutionStatus("bought_before_cutoff");
      setCashDebited(String(plan.amount));
      setActualFeeAmount("");
    }
  }}>
    <DialogTrigger asChild><QuietButton>{triggerLabel}</QuietButton></DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <form className="grid gap-4" onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const result = await saveDcaExecution(plan.id, {
            status: executionStatus,
            executionDate,
            actualCashDebited: Number(cashDebited),
            actualFeeAmount: actualFeeAmount === "" ? null : Number(actualFeeAmount),
          });
          if (!result.ok) { setError(result.error); return; }
          setOpen(false);
          router.refresh();
          notifySaved("扣款已记录为待确认申购");
        } finally { setPending(false); }
      }}>
        <DialogHeader className="text-left"><DialogTitle>记录实际扣款</DialogTitle><p className="text-sm text-muted-foreground">{plan.name ?? plan.symbol}（{plan.symbol}）· {plan.channelKind === "direct" ? "直销" : "代销"} · {plan.account ? DCA_ACCOUNT_LABELS[plan.account as DcaAccount] : "—"}</p></DialogHeader>
        <FormError error={error} />
        <div className="grid gap-2"><Label htmlFor={`dca-execution-date-${plan.id}`}>实际申购日期</Label><Input id={`dca-execution-date-${plan.id}`} type="date" value={executionDate} onChange={(event) => setExecutionDate(event.target.value)} required /></div>
        <div className="grid gap-2"><Label>申请受理时间</Label><Select value={executionStatus} onValueChange={(value) => setExecutionStatus(value as DcaExecutionStatus)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bought_before_cutoff">15:00 前</SelectItem><SelectItem value="bought_after_cutoff">15:00 后</SelectItem></SelectContent></Select></div>
        <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor={`dca-cash-${plan.id}`}>实际扣款金额</Label><Input id={`dca-cash-${plan.id}`} type="number" min="0.01" step="any" value={cashDebited} onChange={(event) => setCashDebited(event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor={`dca-actual-fee-${plan.id}`}>实际手续费</Label><Input id={`dca-actual-fee-${plan.id}`} type="number" min="0" step="any" value={actualFeeAmount} onChange={(event) => setActualFeeAmount(event.target.value)} placeholder="按计划估算" /></div></div>
        <p className="text-xs text-muted-foreground">保存后生成待确认申购；确认份额后在持仓管理中结转。</p>
        <DialogFooter><Button type="submit" disabled={pending}>记录扣款</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function DcaStatusButton({ id, status }: { id: number; status: "active" | "paused" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pausing = status === "active";
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null); }}>
    <DialogTrigger asChild><QuietButton>{pausing ? "暂停计划" : "恢复计划"}</QuietButton></DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="text-left"><DialogTitle>{pausing ? "暂停这项计划？" : "恢复这项计划？"}</DialogTitle>
        <p className="text-sm text-muted-foreground">{pausing ? "暂停后停止自动记账，已记录的申购和持仓会保留。此操作不会更改购买渠道的真实定投设置。" : "恢复后从今天起按计划自动记账，不补记暂停期间的期次。此操作不会更改购买渠道的真实定投设置。"}</p>
      </DialogHeader>
      <FormError error={error} />
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={pending} onClick={async () => {
        setPending(true); setError(null);
        try { const result = pausing ? await pauseDcaPlan(id) : await resumeDcaPlan(id); if (!result.ok) { setError(result.error); return; } setOpen(false); router.refresh(); notifySaved(pausing ? "计划已暂停" : "计划已恢复"); } finally { setPending(false); }
      }}>{pausing ? "确认暂停" : "确认恢复"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function EndDcaButton({ id }: { id: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null); }}>
    <DialogTrigger asChild><QuietButton className="text-destructive hover:text-destructive">结束计划</QuietButton></DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="text-left"><DialogTitle>结束这项计划？</DialogTitle><p className="text-sm text-muted-foreground">结束后停止自动记账，计划不可恢复或编辑，历史记录和持仓仍会保留。此操作不会更改购买渠道的真实定投设置。</p></DialogHeader>
      <FormError error={error} />
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={pending} onClick={async () => {
        setPending(true); setError(null);
        try { const result = await endDcaPlan(id); if (!result.ok) { setError(result.error); return; } setOpen(false); router.refresh(); notifySaved("计划已结束"); } finally { setPending(false); }
      }}>确认结束</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function DeleteDcaButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive"
      onClick={async () => {
        await deleteDcaPlan(id);
        router.refresh();
      }}
    >
      删除计划
    </Button>
  );
}

