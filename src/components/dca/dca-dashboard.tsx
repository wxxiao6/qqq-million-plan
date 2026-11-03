"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { DcaPlanForm, DcaStatusButton, EndDcaButton } from "@/components/holdings/dca-forms";
import { ResolvePendingForm } from "@/components/holdings/pending-forms";
import { channelLabel, dcaAccountLabel, dcaStatusLabel } from "@/components/labels";
import { FormError } from "@/components/form-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { correctDcaExecutionAction } from "@/server/dca/actions";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { filterDcaBySalesChannel, plannedDcaDates, summarizeDcaAmounts, summarizeDcaSchedule, summarizeDcaProgress } from "@/lib/dca-dashboard";
import { SalesChannelFilters } from "@/components/sales-channel-filter";
import { UNKNOWN_SALES_DETAIL, type SalesChannelFilter } from "@/lib/sales-channel-filter";
import { dcaChannelWarningLabel, type DcaPlanView, type DcaShareCandidate } from "@/lib/dca";
import type { DcaFeeDetail } from "@/server/dca";

type Props = { syncErrors: string[]; plans: DcaPlanView[]; candidates: DcaShareCandidate[]; emptyUniverse: boolean; records: DcaFeeDetail[]; managers: Record<string, string>; today: string; requestedRecordId?: number | null };
type StatusFilter = "active" | "paused" | "ended";

export function DcaDashboard({ plans, candidates, emptyUniverse, records, managers, syncErrors, today, requestedRecordId }: Props) {
  const [status, setStatus] = useState<StatusFilter>("active");
  const [channel, setChannel] = useState<SalesChannelFilter>("all");
  const [detail, setDetail] = useState("all");
  const { plans: accountPlans, records: accountRecords } = filterDcaBySalesChannel(plans, records, managers, channel, detail);
  const successfulRecords = accountRecords.filter((record) => record.status === "pending" || record.status === "settled");
  const schedule = summarizeDcaSchedule(accountPlans, successfulRecords, today);
  const amounts = summarizeDcaAmounts(accountPlans, accountRecords, today);
  const progress = summarizeDcaProgress(accountRecords, today);
  const fees = successfulRecords.reduce((sum, record) => sum + record.feeAmount, 0);
  const filtered = accountPlans.filter((plan) => plan.status === status)
    .sort((a, b) => (a.nextDebitDate ?? "9999").localeCompare(b.nextDebitDate ?? "9999") || a.id - b.id);
  const nearest = schedule.next[0] ?? schedule.pending[0];
  const counts = { active: schedule.active.length, paused: accountPlans.filter((plan) => plan.status === "paused").length, ended: accountPlans.filter((plan) => plan.status === "ended").length };
  const rowRecords = (plan: DcaPlanView) => accountRecords.filter((record) => record.planId === plan.id);
  const platform = (plan: DcaPlanView) => plan.channelKind === "direct" ? managers[plan.symbol] ?? "基金公司待核实" : plan.account ? dcaAccountLabel(plan.account) : "平台待核实";
  const actions = (plan: DcaPlanView) => <div className="flex flex-wrap items-center justify-end gap-1"><PlanDetail plan={plan} candidates={candidates} emptyUniverse={emptyUniverse} records={rowRecords(plan)} today={today} managers={managers} />{plan.status !== "ended" ? <><DcaPlanForm candidates={candidates} emptyUniverse={emptyUniverse} initial={plan} managers={managers} existingPlans={plans} triggerLabel="调整计划" /><DcaStatusButton id={plan.id} status={plan.status} /></> : null}</div>;

  return <div className="page-stack">
    {requestedRecordId ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      {records.some((record) => record.positionId === requestedRecordId) ? <><span className="text-muted-foreground">来自持仓管理的定投记录</span><RecordsDialog records={records.filter((record) => record.positionId === requestedRecordId)} plans={plans} initialOpen trigger={<Button variant="outline" size="sm">查看指定记录</Button>} /></> : <p className="text-muted-foreground">该记录已不存在或不属于当前账号，请在记账记录中查看。</p>}
    </div> : null}
    <section aria-label="定投总览" className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_36px_rgba(70,52,36,.055)]">
      <div className="grid gap-6 bg-foreground px-5 py-6 text-primary-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:px-7">
        <div className="min-w-0"><p className="text-xs text-primary-foreground/60">投入总览 · {channel === "all" ? "全部渠道" : `${channelLabel(channel)}${detail === "all" ? "" : ` · ${detail === UNKNOWN_SALES_DETAIL ? "待核实" : channel === "agency" ? dcaAccountLabel(detail) : detail}`}`}</p><p className="mt-4 text-sm text-primary-foreground/70">本月预计投入</p><p className="mt-1 break-all font-display text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-tight tracking-tight"><Money value={amounts.monthly} className="font-display whitespace-normal" /></p><p className="mt-2 text-xs leading-relaxed text-primary-foreground/55">含已记账及本月剩余计划，按当前安排估算。</p></div>
        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-5 border-t border-primary-foreground/15 pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <HeroMetric label="本月已确认" value={<Money value={progress.monthlyConfirmed} />} detail="本月申购且已确认份额，含手续费" />
          <HeroMetric label="待确认金额" value={<Money value={progress.pendingAmount} />} detail="全部未确认记录，含历史期次" />
          <div className="min-w-0"><p className="text-xs text-primary-foreground/60">待处理记录</p><RecordsDialog records={accountRecords} plans={accountPlans} initialStatus="pending" trigger={<button type="button" className="mt-1 text-left text-xl font-semibold underline decoration-primary-foreground/30 underline-offset-4 hover:decoration-primary-foreground sm:text-2xl" aria-label={`查看 ${progress.pendingCount} 笔待确认记录`}>{progress.pendingCount} <span className="text-sm font-normal">笔 →</span></button>} /><p className="mt-1 text-xs text-primary-foreground/50">核对扣款金额与申购状态</p></div>
          <HeroMetric label="今日计划金额" value={<Money value={amounts.daily} />} detail={`${counts.active} 项进行中 · ${counts.paused} 项已暂停`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-7"><div><p className="text-sm font-medium">{schedule.pending.length ? `${schedule.pending.length} 项计划自动记账待处理` : nearest?.nextDebitDate ? `下次计划日 ${nearest.nextDebitDate}` : "暂无后续计划"}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">累计记账 <Money value={amounts.total} /> · 手续费 <Money value={fees} /> · 自动生成的记录请对照平台核对。</p></div><div className="flex flex-wrap gap-2"><CalendarDialog plans={accountPlans} records={accountRecords} today={today} /><RecordsDialog records={accountRecords} plans={accountPlans} /></div></div>
    </section>
    {syncErrors.length ? <section role="alert" className="section-band text-sm text-loss"><p className="font-semibold">部分计划自动记账未完成</p><p className="mt-2 text-xs">{syncErrors.join("；")}</p></section> : null}
    <section className="section-band" aria-label="定投计划">
      <div><h2 className="text-lg font-semibold tracking-tight">我的定投计划</h2><p className="mt-1 text-xs text-muted-foreground">按下次计划日排序，直接调整金额与节奏，或暂停计划。</p></div>
      <div className="mt-5 space-y-3 border-b border-border pb-4"><div className="flex flex-wrap gap-2" aria-label="计划状态筛选">{(["active", "paused", "ended"] as const).map((item) => <button key={item} type="button" aria-pressed={status === item} onClick={() => setStatus(item)} className={`rounded-lg px-3 py-2 text-sm ${status === item ? "bg-foreground font-medium text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:text-foreground"}`}>{dcaStatusLabel(item)} <span className="ml-1 font-mono text-xs">{counts[item]}</span></button>)}</div><div className="grid grid-cols-2 gap-3 sm:max-w-xl"><SalesChannelFilters rows={plans} managers={managers} channel={channel} detail={detail} onChannelChange={(value) => { setChannel(value); setDetail("all"); }} onDetailChange={setDetail} layout="toolbar" /></div></div>
      {filtered.length ? <><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[760px] border-collapse text-sm"><thead className="text-left text-xs text-muted-foreground"><tr>{["基金与购买平台", "每期投入", "下次安排", "执行情况", "操作"].map((title) => <th key={title} className="border-b border-border px-2 py-3 font-medium last:text-right">{title}</th>)}</tr></thead><tbody>{filtered.map((plan) => <tr key={plan.id} className="border-b border-border/70 last:border-b-0"><td className="max-w-64 px-2 py-4"><p className="text-sm font-medium leading-relaxed">{plan.name ?? plan.symbol}</p><p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{plan.symbol}</span> · {platform(plan)}</p></td><td className="px-2 py-4"><Money value={plan.amount} /><p className="mt-1 text-xs text-muted-foreground">{plan.frequencyLabel}</p></td><td className="px-2 py-4"><p className="font-mono text-xs">{plan.status === "active" ? plan.nextDebitDate ?? "—" : dcaStatusLabel(plan.status)}</p>{plan.status === "active" && plan.nextDebitDate && plan.nextDebitDate <= today ? <p className="mt-1 text-xs text-loss">记账待处理</p> : null}{plan.status === "active" && dcaChannelWarningLabel(plan.channelWarning) ? <p className="mt-1 text-xs text-loss">{dcaChannelWarningLabel(plan.channelWarning)}</p> : null}</td><td className="px-2 py-4"><ExecutionSummary plan={plan} records={rowRecords(plan)} /></td><td className="max-w-60 px-2 py-4">{actions(plan)}</td></tr>)}</tbody></table></div><div className="divide-y divide-border/70 lg:hidden">{filtered.map((plan) => <article key={plan.id} className="py-4"><p className="text-sm font-semibold leading-relaxed">{plan.name ?? plan.symbol}</p><p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{plan.symbol}</span> · {platform(plan)}</p><div className="mt-4 grid grid-cols-2 gap-4 text-xs"><div><p className="text-muted-foreground">每期投入 · {plan.frequencyLabel}</p><p className="mt-1 text-base font-medium"><Money value={plan.amount} /></p></div><div><p className="text-muted-foreground">下次安排</p><p className="mt-1 font-mono text-sm">{plan.status === "active" ? plan.nextDebitDate ?? "—" : dcaStatusLabel(plan.status)}</p>{plan.status === "active" && plan.nextDebitDate && plan.nextDebitDate <= today ? <p className="mt-1 text-loss">记账待处理</p> : null}</div></div><div className="mt-3"><ExecutionSummary plan={plan} records={rowRecords(plan)} /></div>{plan.status === "active" && dcaChannelWarningLabel(plan.channelWarning) ? <p className="mt-2 text-xs text-loss">{dcaChannelWarningLabel(plan.channelWarning)}</p> : null}<div className="mt-3">{actions(plan)}</div></article>)}</div></> : <div className="py-12 text-center"><p className="text-sm font-medium">{plans.length ? "没有符合条件的计划" : "还没有定投计划"}</p><p className="mt-2 text-xs text-muted-foreground">{plans.length ? "试试切换状态或渠道。" : "点击右上方新增定投，安排第一笔投入。"}</p></div>}
    </section>
  </div>;
}

function ExecutionSummary({ plan, records }: { plan: DcaPlanView; records: DcaFeeDetail[] }) {
  const pending = records.filter((record) => record.status === "pending");
  const settled = records.filter((record) => record.status === "settled");
  return <div className="space-y-1 text-xs"><p className="text-muted-foreground">已确认 {settled.length} 笔 · <Money value={settled.reduce((sum, record) => sum + record.cashDebited, 0)} /></p>{pending.length ? <RecordsDialog records={records} plans={[plan]} initialStatus="pending" trigger={<button type="button" className="text-copper underline underline-offset-4">{pending.length} 笔待确认 →</button>} /> : <p className="text-muted-foreground">暂无待确认</p>}</div>;
}

function HeroMetric({ label, value, detail }: { label: string; value: React.ReactNode; detail: string }) {
  return <div className="min-w-0"><p className="text-xs text-primary-foreground/60">{label}</p><p className="mt-1 break-all text-lg font-semibold tracking-tight sm:text-2xl [&_.font-mono]:whitespace-normal">{value}</p><p className="mt-1 text-xs text-primary-foreground/50">{detail}</p></div>;
}

function PlanDetail({ plan, candidates, emptyUniverse, records, today, managers }: { plan: DcaPlanView; candidates: DcaShareCandidate[]; emptyUniverse: boolean; records: DcaFeeDetail[]; today: string; managers: Record<string, string> }) {
  return <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm" className="text-copper">详情 →</Button></DialogTrigger>
    <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl"><DialogHeader className="border-b border-border px-6 py-5 text-left"><p className="text-xs font-semibold tracking-[.16em] text-copper">定投计划</p><DialogTitle className="pr-6 text-xl">{plan.name ?? plan.symbol}</DialogTitle><p className="font-mono text-xs text-muted-foreground">{plan.symbol} · {plan.shareClass} 类 · {dcaStatusLabel(plan.status)}</p></DialogHeader>
      <div className="space-y-6 overflow-y-auto px-6 py-5"><div className="grid grid-cols-2 gap-5 sm:grid-cols-4"><DetailMetric label="每期投入" value={<Money value={plan.amount} />} /><DetailMetric label="投入频率" value={plan.frequencyLabel} /><DetailMetric label="下次计划日" value={plan.status === "active" ? plan.nextDebitDate ?? "—" : "—"} /><DetailMetric label="累计记账金额" value={<Money value={records.filter((record) => record.status === "pending" || record.status === "settled").reduce((sum, record) => sum + record.cashDebited, 0)} />} /></div>
        <div className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground"><p>渠道 / 基金公司或平台：{channelLabel(plan.channelKind)} / {plan.channelKind === "direct" ? managers[plan.symbol] ?? "基金公司待核实" : plan.account ? dcaAccountLabel(plan.account) : "—"}　 ·　起始日：{plan.startDate}</p><p>手续费：{plan.feeKind === "rate" ? `${plan.feeValue}%` : plan.feeKind === "fixed" ? `每次 ¥${plan.feeValue}` : "未设置"}{plan.note ? `　 ·　备注：${plan.note}` : ""}</p>{plan.status === "active" && dcaChannelWarningLabel(plan.channelWarning) ? <p className="text-loss">{dcaChannelWarningLabel(plan.channelWarning)}</p> : null}{plan.status === "active" && plan.nextDebitDate && plan.nextDebitDate < today ? <p className="text-copper">该期自动记账尚未完成，请检查页面提示。</p> : null}</div>
        <div><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">记账记录</h3><RecordsDialog records={records} plans={[plan]} trigger={<button type="button" className="text-xs text-copper underline underline-offset-4">查看全部 {records.length} 笔 →</button>} /></div><RecordList records={records.slice(0, 5)} plans={[plan]} compact /></div>
        {plan.status !== "ended" ? <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4"><DcaPlanForm candidates={candidates} emptyUniverse={emptyUniverse} initial={plan} managers={managers} triggerLabel="编辑计划" /><DcaStatusButton id={plan.id} status={plan.status} /><EndDcaButton id={plan.id} /></div> : <p className="border-t border-border pt-4 text-xs text-muted-foreground">计划已结束，历史记录仍保留。</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
function DetailMetric({ label, value }: { label: string; value: React.ReactNode }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>; }

function RecordList({ records, plans, compact = false }: { records: DcaFeeDetail[]; plans: DcaPlanView[]; compact?: boolean }) {
  const names = new Map(plans.map((plan) => [plan.id, plan.name ?? plan.symbol]));
  if (!records.length) return <p className="rounded-xl bg-muted/40 px-4 py-5 text-sm text-muted-foreground">暂无记账记录。计划到期后会自动生成记账记录。</p>;
  return <div className="divide-y divide-border/70">{records.map((record) => <div key={record.positionId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{compact ? (record.executionOn ?? record.recordedOn ?? "日期未知") : (names.get(record.planId) ?? record.symbol)}</p><p className="mt-1 text-xs text-muted-foreground">{record.autoGenerated ? "自动记账 · " : "手动记录 · "}{compact ? `申购 ¥${record.subscriptionAmount.toFixed(2)} · 手续费 ¥${record.feeAmount.toFixed(2)}` : `${record.executionOn ?? record.recordedOn ?? "日期未知"} · ${dcaAccountLabel(record.account)} · 申购 ¥${record.subscriptionAmount.toFixed(2)} · 手续费 ¥${record.feeAmount.toFixed(2)}`}</p></div><div className="text-right"><Money value={record.cashDebited} className="text-sm" /><p className="mt-1 text-xs text-muted-foreground">{record.status === "failed" || record.status === "cancelled" ? "原申请 · " : ""}{record.status === "settled" ? "已确认" : record.status === "pending" ? "待确认" : record.status === "failed" ? "申购失败" : "已撤单"}{record.tDate ? ` · T日 ${record.tDate}` : ""}</p>{record.status === "pending" || record.status === "settled" ? <div className="mt-2 flex flex-wrap justify-end gap-2"><CorrectRecord record={record} />{record.status === "pending" ? <ResolvePendingForm id={record.positionId} executionOn={record.executionOn} cutoffPeriod={record.cutoffPeriod} /> : null}</div> : null}</div></div>)}</div>;
}

function CorrectRecord({ record }: { record: DcaFeeDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"keep" | "failed" | "cancelled">("keep");
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setError(null); setOutcome("keep"); } }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="outline">修正记录</Button></DialogTrigger>
    <DialogContent className="sm:max-w-md"><form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null);
      const data = new FormData(event.currentTarget);
      try { const result = await correctDcaExecutionAction({ id: record.positionId, cashDebited: Number(data.get("cashDebited")), feeAmount: Number(data.get("feeAmount")), outcome });
        if (!result.ok) { setError(result.error); return; } setOpen(false); router.refresh();
      } finally { setBusy(false); }
    }}><DialogHeader className="text-left"><DialogTitle>修正记账记录</DialogTitle><p className="text-sm text-muted-foreground">按购买渠道的实际情况调整金额，或标记本次未成功。不会操作真实交易。</p></DialogHeader><FormError error={error} />
      <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor={`correct-cash-${record.positionId}`}>记账金额</Label><Input id={`correct-cash-${record.positionId}`} name="cashDebited" type="number" min="0.01" step="0.01" defaultValue={record.cashDebited} required /></div><div className="grid gap-2"><Label htmlFor={`correct-fee-${record.positionId}`}>手续费</Label><Input id={`correct-fee-${record.positionId}`} name="feeAmount" type="number" min="0" step="0.01" defaultValue={record.feeAmount} required /></div></div>
      <div className="grid gap-2"><Label htmlFor={`correct-outcome-${record.positionId}`}>记录状态</Label><select id={`correct-outcome-${record.positionId}`} className="h-10 rounded-lg border border-border bg-card px-3 text-sm" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="keep">保留记录</option><option value="failed">申购失败</option><option value="cancelled">已撤单</option></select></div>
      <p className="text-xs text-muted-foreground">标记失败或撤单会从累计记账金额和持仓中扣除该笔记录，且不会再次自动生成。</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy}>保存修正</Button></div>
    </form></DialogContent>
  </Dialog>;
}

type RecordStatus = "all" | "pending" | "settled" | "failed" | "cancelled";
function RecordsDialog({ records, plans, initialStatus = "all", trigger, initialOpen = false }: { records: DcaFeeDetail[]; plans: DcaPlanView[]; initialStatus?: RecordStatus; trigger?: React.ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [recordStatus, setRecordStatus] = useState<RecordStatus>(initialStatus);
  const [month, setMonth] = useState("all");
  const months = [...new Set(records.map((record) => (record.executionOn ?? record.recordedOn)?.slice(0, 7)).filter((value): value is string => Boolean(value)))].sort().reverse();
  const visible = records.filter((record) => (recordStatus === "all" || record.status === recordStatus) && (month === "all" || (record.executionOn ?? record.recordedOn)?.startsWith(month)));
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setRecordStatus(initialStatus); setMonth("all"); } }}><DialogTrigger asChild>{trigger ?? <Button variant="outline" size="sm"><ClipboardList />记账记录</Button>}</DialogTrigger><DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"><DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 text-left sm:px-6"><DialogTitle>{initialStatus === "pending" ? "待确认记录" : "记账记录"}</DialogTitle><DialogDescription>自动生成的记录请对照平台核对，确认份额后计入已确认持仓。</DialogDescription></DialogHeader><div className="shrink-0 space-y-3 border-b border-border px-5 py-4 sm:px-6"><div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs text-muted-foreground">记录状态<select aria-label="记录状态筛选" value={recordStatus} onChange={(event) => setRecordStatus(event.target.value as RecordStatus)} className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground">{([["all", "全部状态"], ["pending", "待确认"], ["settled", "已确认"], ["failed", "申购失败"], ["cancelled", "已撤单"]] as const).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1.5 text-xs text-muted-foreground">申购月份<select aria-label="申购月份" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground"><option value="all">全部月份</option>{months.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><p className="text-xs text-muted-foreground">显示 {visible.length} 笔{recordStatus === "pending" || recordStatus === "settled" ? <> · 合计 <Money value={visible.reduce((sum, record) => sum + record.cashDebited, 0)} /></> : ""}</p></div><div className="min-h-0 overflow-y-auto px-5 py-2 sm:px-6">{visible.length ? <RecordList records={visible} plans={plans} /> : <p className="py-10 text-center text-sm text-muted-foreground">{recordStatus === "pending" ? "当前范围没有待确认记录。" : "没有符合条件的记录。"}</p>}</div></DialogContent></Dialog>;
}

function CalendarDialog({ plans, records, today }: { plans: DcaPlanView[]; records: DcaFeeDetail[]; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const planned = useMemo(() => plans.flatMap((plan) => plannedDcaDates(plan, month, records.filter((record) => record.planId === plan.id && (record.status === "pending" || record.status === "settled")).map((record) => record.executionOn ?? record.recordedOn).filter((date): date is string => Boolean(date))).map((date) => ({ date, plan }))), [plans, records, month]);
  const monthRecords = records.filter((record) => (record.executionOn ?? record.recordedOn)?.startsWith(month));
  const selectedPlans = planned.filter((entry) => entry.date === selected);
  const selectedRecords = monthRecords.filter((record) => (record.executionOn ?? record.recordedOn) === selected);
  function moveMonth(delta: number) { const date = new Date(year, monthNumber - 1 + delta, 1); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`); setSelected(null); }
  return <Dialog><DialogTrigger asChild><Button variant="outline" size="sm"><CalendarDays />计划日历</Button></DialogTrigger><DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-xl"><DialogHeader className="text-left"><DialogTitle>计划日历</DialogTitle><p className="text-sm text-muted-foreground">按当前计划显示后续安排，已记账期次按计划日期展示。</p></DialogHeader><div className="min-h-0 overflow-y-auto"><div className="mb-3 flex items-center justify-between"><Button variant="ghost" size="icon-sm" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft /></Button><p className="font-medium">{year} 年 {monthNumber} 月</p><Button variant="ghost" size="icon-sm" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight /></Button></div><div className="grid grid-cols-7 text-center text-xs text-muted-foreground">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} className="py-2">{day}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, "0")}`; const plannedCount = planned.filter((entry) => entry.date === date).length; const recordedCount = monthRecords.filter((record) => (record.executionOn ?? record.recordedOn) === date).length; return <button key={date} type="button" aria-label={`${date}，${plannedCount} 项计划，${recordedCount} 笔记账记录`} aria-pressed={selected === date} onClick={() => setSelected(date)} className={`min-h-12 rounded-lg py-1 text-sm ${selected === date ? "bg-foreground text-primary-foreground" : "hover:bg-muted"}`}><span>{index + 1}</span><span className="mt-1 flex h-1.5 justify-center gap-1">{plannedCount ? <span className="size-1.5 rounded-full bg-copper" /> : null}{recordedCount ? <span className="size-1.5 rounded-full bg-gain" /> : null}</span></button>; })}</div><p className="mt-3 text-xs text-muted-foreground"><span className="mr-1 inline-block size-1.5 rounded-full bg-copper" />计划 <span className="ml-3 mr-1 inline-block size-1.5 rounded-full bg-gain" />记账记录（含失败与撤单） · 节假日以实际渠道为准</p><div className="mt-4 border-t border-border pt-4"><p className="mb-2 text-sm font-semibold">{selected ?? "选择日期查看明细"}</p>{selected ? <>{selectedPlans.map(({ plan }) => <div key={plan.id} className="flex justify-between gap-3 py-2 text-sm"><span>{plan.name ?? plan.symbol} <span className="text-xs text-copper">计划</span></span><Money value={plan.amount} /></div>)}{selectedRecords.map((record) => <div key={record.positionId} className="flex justify-between gap-3 py-2 text-sm"><span>{plans.find((plan) => plan.id === record.planId)?.name ?? record.symbol} <span className={`text-xs ${record.status === "failed" || record.status === "cancelled" ? "text-loss" : "text-gain"}`}>{record.status === "failed" ? "申购失败" : record.status === "cancelled" ? "已撤单" : "已记账"}</span></span><Money value={record.cashDebited} /></div>)}{!selectedPlans.length && !selectedRecords.length ? <p className="text-xs text-muted-foreground">当天没有计划或记账记录。</p> : null}</> : <p className="text-xs text-muted-foreground">选择日历中的日期，查看计划和记账记录。</p>}</div></div></DialogContent></Dialog>;
}
