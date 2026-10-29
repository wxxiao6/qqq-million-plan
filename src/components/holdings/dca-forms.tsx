"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
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
  deriveNextDebitDate,
  isLegalDcaAccount,
  type DcaAccount,
  type DcaChannelKind,
  type DcaFeeKind,
  type DcaExecutionStatus,
  type DcaFrequency,
  type DcaPlanView,
  type DcaShareCandidate,
} from "@/lib/dca";
import { todayISO } from "@/lib/format";
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
  startDate: string;
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
}: {
  candidates: DcaShareCandidate[];
  emptyUniverse: boolean;
  initial?: DcaPlanView;
  triggerLabel?: string;
  prominent?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO());
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

  useEffect(() => {
    if (!open || initial) return;
    writeDraft<DcaPlanDraft>(DCA_PLAN_DRAFT_KEY, {
      channelKind,
      account,
      frequency,
      weekday,
      monthDay,
      startDate,
      cutoffPeriod,
      feeKind,
      feeValue,
      note,
    });
  }, [account, channelKind, cutoffPeriod, feeKind, feeValue, frequency, initial, monthDay, note, open, startDate, weekday]);

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
  const nextPlannedDate = deriveNextDebitDate({
    frequency,
    startDate,
    weekday: Number(weekday),
    monthDay: Number(monthDay),
  });

  function resetFromInitial() {
    const draft = initial ? null : readDraft<DcaPlanDraft>(DCA_PLAN_DRAFT_KEY);
    const channel = initial?.channelKind ?? (isDcaChannelKind(draft?.channelKind) ? draft.channelKind : "agency");
    setChannelKind(channel);
    setShare(initial ? shareKey(initial.symbol, initial.shareClass) : "");
    setAccount(initial ? accountForPlan(initial, channel) : draft?.account && isLegalDcaAccount(channel, draft.account) ? draft.account : defaultDcaAccount(channel));
    setFrequency(initial?.frequency ?? (isDcaFrequency(draft?.frequency) ? draft.frequency : "weekly"));
    setWeekday(initial ? String(initial.weekday ?? 3) : typeof draft?.weekday === "string" ? draft.weekday : "3");
    setMonthDay(initial ? String(initial.monthDay ?? 8) : typeof draft?.monthDay === "string" ? draft.monthDay : "8");
    const start = initial?.startDate ?? (typeof draft?.startDate === "string" ? draft.startDate : todayISO());
    setStartDate(start);
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
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setOpen(false);
      notifySaved("定投计划已保存");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetFromInitial();
      }}
    >
      <DialogTrigger asChild>
        {prominent ? <Button type="button">{triggerLabel ?? "新增定投计划"}</Button> :
          <QuietButton>{triggerLabel ?? (initial ? "编辑定投计划" : "新增定投计划")}</QuietButton>}
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-6 py-5 text-left sm:px-8">
            <p className="text-xs font-semibold tracking-[.16em] text-copper">定投设置</p>
            <DialogTitle className="text-2xl">{initial ? "编辑定投计划" : "新增定投计划"}</DialogTitle>
            <p className="text-sm text-muted-foreground">先选基金与购买渠道，再设定每期投入和扣款节奏。同一购买平台和基金只能有一个未结束的定投计划。</p>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 sm:px-8">
          <FormError error={error} />
          {emptyUniverse ? (
            <p className="text-sm text-muted-foreground">
              额度数据尚未生成，请稍后检查雷达。
              <Link href="/quota" className="ml-1 font-medium text-copper">
                查看纳指雷达
              </Link>
            </p>
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-2">
                <section className="self-start rounded-xl border border-border bg-background/55 p-4 sm:p-5" aria-labelledby={`dca-fund-heading-${initial?.id ?? "new"}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="grid size-7 place-items-center rounded-full bg-foreground text-xs font-semibold text-card">1</span><h3 id={`dca-fund-heading-${initial?.id ?? "new"}`} className="font-semibold">基金与购买渠道</h3></div>
                  <div className="space-y-4">
                    <div className="grid gap-2"><Label>购买渠道</Label><div className="grid grid-cols-2 gap-2" role="group" aria-label="购买渠道">
                      {([ ["agency", "代销"], ["direct", "直销"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={channelKind === value} onClick={() => onChannelChange(value)} className={`h-10 rounded-lg border text-sm font-medium transition-colors ${channelKind === value ? "border-foreground bg-foreground text-card" : "border-border bg-card hover:border-foreground/40"}`}>{label}</button>)}
                    </div></div>
                    <div className="grid gap-2"><Label>{channelKind === "direct" ? "基金公司" : "代销平台"}</Label><Select key={channelKind} value={account} onValueChange={(value) => setAccount(value as DcaAccount)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{channelAccounts.map((value) => <SelectItem key={value} value={value}>{DCA_ACCOUNT_LABELS[value]}</SelectItem>)}</SelectContent></Select>{initial ? <p className="text-xs text-muted-foreground">更换购买渠道或平台会同步调整该计划的历史记账与持仓记录。</p> : null}</div>
                    <div className="grid gap-2"><div className="flex items-center justify-between gap-2"><Label htmlFor={`dca-fund-${initial?.id ?? "new"}`}>基金</Label><span className="text-xs text-muted-foreground">可选 {filtered.length} 只份额</span></div>
                      <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFundOpen(false); }}>
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                        <Input id={`dca-fund-${initial?.id ?? "new"}`} role="combobox" aria-expanded={fundOpen} aria-controls={`dca-fund-options-${initial?.id ?? "new"}`} aria-activedescendant={fundOpen && matchingFunds.length ? `dca-fund-option-${initial?.id ?? "new"}-${fundActiveIndex}` : undefined} aria-autocomplete="list" value={fundOpen ? fundSearch : selected ? `${selected.symbol} · ${selected.name}` : fundSearch} onFocus={() => { setFundSearch(""); setFundOpen(true); }} onChange={(event) => { setFundSearch(event.target.value); setShare(""); setFundActiveIndex(0); setFundOpen(true); }} onKeyDown={(event) => {
                          if (event.key === "Escape") setFundOpen(false);
                          if (event.key === "ArrowDown") { event.preventDefault(); setFundActiveIndex((index) => Math.min(index + 1, matchingFunds.length - 1)); }
                          if (event.key === "ArrowUp") { event.preventDefault(); setFundActiveIndex((index) => Math.max(index - 1, 0)); }
                          if (event.key === "Enter" && fundOpen && matchingFunds.length) { event.preventDefault(); chooseFund(matchingFunds[fundActiveIndex]?.key ?? matchingFunds[0].key); }
                        }} placeholder="搜索代码或名称" className="pl-9" />
                        {fundOpen ? <div id={`dca-fund-options-${initial?.id ?? "new"}`} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
                          {matchingFunds.length ? matchingFunds.map((row, index) => <button id={`dca-fund-option-${initial?.id ?? "new"}-${index}`} type="button" role="option" aria-selected={index === fundActiveIndex} key={row.key} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseFund(row.key)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted ${index === fundActiveIndex ? "bg-muted" : ""}`}><span className="font-mono font-semibold">{row.symbol}</span><span className="ml-2 text-xs text-copper">{row.shareClass}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.name}</span></button>) : <p className="px-3 py-4 text-center text-sm text-muted-foreground">该渠道没有匹配的可申购基金</p>}
                        </div> : null}
                      </div>
                      {filtered.length === 0 && !initial ? <p className="text-xs text-muted-foreground">该渠道暂无可申购且有额度的基金。</p> : null}
                    </div>
                    {selected ? <div className="rounded-lg bg-card px-3 py-2 text-xs"><span className="font-medium">{selected.shareClass} 类份额</span><span className="ml-2 text-muted-foreground">{cellStatus === "paused" ? "暂停申购" : cellStatus === "open" ? "开放申购，限额待核实" : selectedLimit != null ? `日限额 ¥${selectedLimit}` : "额度待核实"}</span></div> : null}
                    {warningText ? <p className="text-xs text-loss">{warningText}{warning === "paused" ? "，可能无法扣款，建议调整渠道" : null}</p> : null}
                  </div>
                </section>
                <section className="rounded-xl border border-border bg-background/55 p-4 sm:p-5" aria-labelledby={`dca-schedule-heading-${initial?.id ?? "new"}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="grid size-7 place-items-center rounded-full bg-foreground text-xs font-semibold text-card">2</span><h3 id={`dca-schedule-heading-${initial?.id ?? "new"}`} className="font-semibold">投入与扣款节奏</h3></div>
                  <div className="space-y-4">
                    <div className="grid gap-2"><Label htmlFor={`dca-amount-${initial?.id ?? "new"}`}>每期定投金额</Label><div className="relative"><span className="absolute left-3 top-2 text-lg font-semibold">¥</span><Input id={`dca-amount-${initial?.id ?? "new"}`} name="amount" type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如 100" className="pl-8 font-mono text-lg" required /></div></div>
                    <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label>频率</Label><Select value={frequency} onValueChange={(value) => setFrequency(value as DcaFrequency)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(DCA_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                      {frequency === "weekly" || frequency === "biweekly" ? <div className="grid gap-2"><Label>周几</Label><Select value={weekday} onValueChange={setWeekday}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(WEEKDAY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div> : null}
                      {frequency === "monthly" ? <div className="grid gap-2"><Label htmlFor={`dca-month-day-${initial?.id ?? "new"}`}>每月几号</Label><Input id={`dca-month-day-${initial?.id ?? "new"}`} type="number" min={1} max={28} value={monthDay} onChange={(event) => setMonthDay(event.target.value)} required /></div> : null}
                    </div>
                    {frequency === "daily" ? <p className="text-xs text-muted-foreground">每日按工作日安排，实际扣款日期以购买渠道为准。</p> : null}
                    <div className="grid gap-2"><Label htmlFor={`dca-start-${initial?.id ?? "new"}`}>起始日</Label><Input id={`dca-start-${initial?.id ?? "new"}`} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /><p className="text-xs text-muted-foreground">首期计划日期：<span className="font-mono text-foreground">{nextPlannedDate}</span></p></div>
                    <div className="grid gap-2"><Label>扣款受理时间</Label><Select value={cutoffPeriod} onValueChange={(value) => setCutoffPeriod(value as "before_15" | "after_15")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before_15">15:00 前</SelectItem><SelectItem value="after_15">15:00 后</SelectItem></SelectContent></Select></div>
                    {!initial ? <p className="text-xs text-muted-foreground">保存后，将按计划补记起始日至今天已到期的记录。请核对购买渠道的实际扣款；本工具不会发起交易。</p> : null}
                    <div className="grid gap-2"><Label>手续费（可选）</Label><div className="flex gap-2"><Select value={feeKind} onValueChange={(value) => { const next = value as DcaFeeKind | "none"; setFeeKind(next); if (next === "none") setFeeValue(""); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不填</SelectItem>{Object.entries(DCA_FEE_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>{feeKind !== "none" ? <Input id={`dca-fee-${initial?.id ?? "new"}`} type="number" min="0" step="any" value={feeValue} onChange={(event) => setFeeValue(event.target.value)} placeholder={feeKind === "rate" ? "%" : "元"} className="w-28 shrink-0 font-mono" /> : null}</div></div>
                    <div className="grid gap-2"><Label htmlFor={`dca-note-${initial?.id ?? "new"}`}>备注（可选）</Label><Input id={`dca-note-${initial?.id ?? "new"}`} name="note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如工资日后扣款" /></div>
                  </div>
                </section>
              </div>
            </>
          )}
          </div>
          <DialogFooter className="flex-row items-center justify-between border-t border-border bg-card px-6 py-4 sm:px-8">
            <p className="hidden text-xs text-muted-foreground sm:block">{selected ? `${selected.symbol} · ${channelKind === "direct" ? "直销" : "代销"}` : "选择基金后保存计划"}</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={pending || emptyUniverse || !selected}>保存计划</Button></div>
          </DialogFooter>
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

