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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { filterDcaBySalesChannel, plannedDcaDates, summarizeDcaAmounts, summarizeDcaSchedule } from "@/lib/dca-dashboard";
import { SalesChannelFilters } from "@/components/sales-channel-filter";
import { UNKNOWN_SALES_DETAIL, type SalesChannelFilter } from "@/lib/sales-channel-filter";
import { dcaChannelWarningLabel, type DcaPlanView, type DcaShareCandidate } from "@/lib/dca";
import type { DcaFeeDetail } from "@/server/dca";

type Props = { syncErrors: string[]; plans: DcaPlanView[]; candidates: DcaShareCandidate[]; emptyUniverse: boolean; records: DcaFeeDetail[]; managers: Record<string, string>; today: string };
type StatusFilter = "active" | "paused" | "ended";

export function DcaDashboard({ plans, candidates, emptyUniverse, records, managers, syncErrors, today }: Props) {
  const [status, setStatus] = useState<StatusFilter>("active");
  const [channel, setChannel] = useState<SalesChannelFilter>("all");
  const [detail, setDetail] = useState("all");
  const { plans: accountPlans, records: accountRecords } = filterDcaBySalesChannel(plans, records, managers, channel, detail);
  const successfulRecords = accountRecords.filter((record) => record.status === "pending" || record.status === "settled");
  const schedule = summarizeDcaSchedule(accountPlans, successfulRecords, today);
  const amounts = summarizeDcaAmounts(accountPlans, accountRecords, today);
  const paidByPlan = new Map(accountPlans.map((plan) => [plan.id, successfulRecords.filter((record) => record.planId === plan.id).reduce((sum, record) => sum + record.cashDebited, 0)]));
  const fees = successfulRecords.reduce((sum, record) => sum + record.feeAmount, 0);
  const filtered = accountPlans.filter((plan) => plan.status === status)
    .sort((a, b) => (a.nextDebitDate ?? "9999").localeCompare(b.nextDebitDate ?? "9999") || a.id - b.id);
  const nearest = schedule.next[0] ?? schedule.active.filter((plan) => plan.nextDebitDate).sort((a, b) => a.nextDebitDate!.localeCompare(b.nextDebitDate!))[0];
  const counts = { active: schedule.active.length, paused: accountPlans.filter((plan) => plan.status === "paused").length, ended: accountPlans.filter((plan) => plan.status === "ended").length };

  return <div className="page-stack">
    <section aria-label="定投总览" className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_36px_rgba(70,52,36,.055)]">
      <div className="grid gap-7 bg-foreground px-6 py-7 text-primary-foreground md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:px-8">
        <div>
          <p className="text-xs font-medium tracking-[.16em] text-primary-foreground/60">定投计划 · 投入总览 · {channel === "all" ? "全部渠道" : `${channelLabel(channel)}${detail === "all" ? "" : ` · ${detail === UNKNOWN_SALES_DETAIL ? "待核实" : channel === "agency" ? dcaAccountLabel(detail) : detail}`}`}</p>
          <p className="mt-5 text-sm text-primary-foreground/70">本月定投预计金额</p>
          <p className="font-display mt-1 text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-none tracking-[-.045em]"><Money value={amounts.monthly} className="font-display" /></p>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-primary-foreground/60">本月已记账金额＋本月尚未记账的计划金额，按当前计划估算。</p>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-6 border-t border-primary-foreground/15 pt-5 md:border-l md:border-t-0 md:pl-7 md:pt-0">
          <HeroMetric label="今日定投金额" value={<Money value={amounts.daily} />} detail="今日已记账及待记账金额" />
          <HeroMetric label="累计记账金额" value={<Money value={amounts.total} />} detail="累计有效记账，含手续费" />
          <HeroMetric label="累计购买手续费" value={<Money value={fees} />} detail="按有效记账记录累计" />
          <HeroMetric label="进行中计划" value={`${counts.active} 项`} detail={`${counts.paused} 项已暂停 · ${counts.ended} 项已结束`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 md:px-8">
        <div className="flex items-start gap-3"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${schedule.pending.length ? "bg-copper" : "bg-gain"}`} /><div>
          <p className="text-sm font-medium">{nearest?.nextDebitDate ? `下次计划日 ${nearest.nextDebitDate}` : "暂无后续计划"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{nearest ? <>到计划日自动生成记账记录</> : "新增定投后，投入安排会显示在这里。"}</p>
        </div></div>
        <div className="flex flex-wrap gap-2"><CalendarDialog plans={accountPlans} records={accountRecords} today={today} /><RecordsDialog records={accountRecords} plans={accountPlans} /></div>
      </div>
    </section>

    {syncErrors.length ? <section role="alert" className="section-band text-sm text-loss"><p className="font-semibold">部分计划自动记账未完成</p><p className="mt-2 text-xs">{syncErrors.join("；")}</p></section> : null}

    <section className="section-band" aria-label="定投计划">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-tight">我的定投计划</h2><p className="mt-1 text-xs text-muted-foreground">按下一计划日排序，查看和调整每项计划。</p></div><DcaPlanForm candidates={candidates} emptyUniverse={emptyUniverse} triggerLabel="新增定投 ＋" /></div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-border">
        <div className="flex gap-5" aria-label="计划状态筛选">{(["active", "paused", "ended"] as const).map((item) => <button key={item} type="button" aria-pressed={status === item} onClick={() => setStatus(item)} className={`border-b-2 px-0 pb-3 text-sm transition-colors ${status === item ? "border-copper font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{dcaStatusLabel(item)} <span className="ml-1 font-mono text-xs">{counts[item]}</span></button>)}</div>
        <div className="w-full pb-2 sm:w-[27rem] sm:max-w-full"><SalesChannelFilters rows={plans} managers={managers} channel={channel} detail={detail} onChannelChange={(value) => { setChannel(value); setDetail("all"); }} onDetailChange={setDetail} /></div>
      </div>
      {filtered.length ? <><div className="dca-table-wrap hidden md:block"><table className="dca-table"><thead><tr><th>基金 / 份额</th><th>每期投入</th><th>频率</th><th>下次计划日</th><th>渠道 / 基金公司或平台</th><th>累计记账金额</th><th>状态</th><th>操作</th></tr></thead><tbody>{filtered.map((plan) => <tr key={plan.id}><td><strong>{plan.name ?? plan.symbol}</strong><small className="font-mono">{plan.symbol} · {plan.shareClass} 类</small></td><td><Money value={plan.amount} /></td><td>{plan.frequencyLabel}</td><td className="font-mono text-xs">{plan.status === "active" ? plan.nextDebitDate ?? "—" : "—"}{plan.status === "active" && plan.nextDebitDate && plan.nextDebitDate <= today ? <small className="!text-loss">记账待处理</small> : null}</td><td>{channelLabel(plan.channelKind)}<small>{plan.account ? dcaAccountLabel(plan.account) : "—"}</small></td><td><Money value={paidByPlan.get(plan.id) ?? 0} /></td><td><span className={`inline-flex items-center gap-1.5 ${plan.status === "active" ? "text-gain" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${plan.status === "active" ? "bg-gain" : "bg-muted-foreground"}`} />{dcaStatusLabel(plan.status)}</span>{dcaChannelWarningLabel(plan.channelWarning) && plan.status === "active" ? <small className="!text-loss">{dcaChannelWarningLabel(plan.channelWarning)}</small> : null}</td><td><PlanDetail plan={plan} candidates={candidates} emptyUniverse={emptyUniverse} records={records.filter((record) => record.planId === plan.id)} today={today} /></td></tr>)}</tbody></table></div><div className="divide-y divide-border/70 md:hidden">{filtered.map((plan) => <article key={plan.id} className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{plan.name ?? plan.symbol}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{plan.symbol} · {plan.shareClass} 类</p></div><span className={`shrink-0 text-xs ${plan.status === "active" ? "text-gain" : "text-muted-foreground"}`}>{dcaStatusLabel(plan.status)}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">每期投入 · {plan.frequencyLabel}</p><p className="mt-1 text-sm font-medium"><Money value={plan.amount} /></p></div><div><p className="text-muted-foreground">下次计划日</p><p className="mt-1 font-mono text-sm">{plan.status === "active" ? plan.nextDebitDate ?? "—" : "—"}</p></div><div><p className="text-muted-foreground">渠道 / 基金公司或平台</p><p className="mt-1">{channelLabel(plan.channelKind)} / {plan.account ? dcaAccountLabel(plan.account) : "—"}</p></div><div><p className="text-muted-foreground">累计记账金额</p><p className="mt-1"><Money value={paidByPlan.get(plan.id) ?? 0} /></p></div></div>{plan.status === "active" && dcaChannelWarningLabel(plan.channelWarning) ? <p className="mt-3 text-xs text-loss">{dcaChannelWarningLabel(plan.channelWarning)}</p> : null}<div className="mt-2 flex justify-end"><PlanDetail plan={plan} candidates={candidates} emptyUniverse={emptyUniverse} records={records.filter((record) => record.planId === plan.id)} today={today} /></div></article>)}</div></> : <div className="py-12 text-center"><p className="text-sm font-medium">{plans.length ? "没有符合条件的计划" : "还没有定投计划"}</p><p className="mt-2 text-xs text-muted-foreground">{plans.length ? "试试切换状态或渠道。" : "新增定投后，可以在这里跟踪每一次投入。"}</p></div>}
    </section>
  </div>;
}

function HeroMetric({ label, value, detail }: { label: string; value: React.ReactNode; detail: string }) {
  return <div className="min-w-0"><p className="text-xs text-primary-foreground/60">{label}</p><p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{value}</p><p className="mt-1 text-xs text-primary-foreground/50">{detail}</p></div>;
}

function PlanDetail({ plan, candidates, emptyUniverse, records, today }: { plan: DcaPlanView; candidates: DcaShareCandidate[]; emptyUniverse: boolean; records: DcaFeeDetail[]; today: string }) {
  return <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm" className="text-copper">详情 →</Button></DialogTrigger>
    <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl"><DialogHeader className="border-b border-border px-6 py-5 text-left"><p className="text-xs font-semibold tracking-[.16em] text-copper">定投计划</p><DialogTitle className="pr-6 text-xl">{plan.name ?? plan.symbol}</DialogTitle><p className="font-mono text-xs text-muted-foreground">{plan.symbol} · {plan.shareClass} 类 · {dcaStatusLabel(plan.status)}</p></DialogHeader>
      <div className="space-y-6 overflow-y-auto px-6 py-5"><div className="grid grid-cols-2 gap-5 sm:grid-cols-4"><DetailMetric label="每期投入" value={<Money value={plan.amount} />} /><DetailMetric label="投入频率" value={plan.frequencyLabel} /><DetailMetric label="下次计划日" value={plan.status === "active" ? plan.nextDebitDate ?? "—" : "—"} /><DetailMetric label="累计记账金额" value={<Money value={records.filter((record) => record.status === "pending" || record.status === "settled").reduce((sum, record) => sum + record.cashDebited, 0)} />} /></div>
        <div className="rounded-xl bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground"><p>渠道 / 基金公司或平台：{channelLabel(plan.channelKind)} / {plan.account ? dcaAccountLabel(plan.account) : "—"}　 ·　起始日：{plan.startDate}</p><p>手续费：{plan.feeKind === "rate" ? `${plan.feeValue}%` : plan.feeKind === "fixed" ? `每次 ¥${plan.feeValue}` : "未设置"}{plan.note ? `　 ·　备注：${plan.note}` : ""}</p>{plan.status === "active" && dcaChannelWarningLabel(plan.channelWarning) ? <p className="text-loss">{dcaChannelWarningLabel(plan.channelWarning)}</p> : null}{plan.status === "active" && plan.nextDebitDate && plan.nextDebitDate < today ? <p className="text-copper">该期自动记账尚未完成，请检查页面提示。</p> : null}</div>
        <div><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">记账记录</h3><span className="text-xs text-muted-foreground">共 {records.length} 笔</span></div><RecordList records={records.slice(0, 5)} plans={[plan]} compact /></div>
        {plan.status !== "ended" ? <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4"><DcaPlanForm candidates={candidates} emptyUniverse={emptyUniverse} initial={plan} triggerLabel="编辑计划" /><DcaStatusButton id={plan.id} status={plan.status} /><EndDcaButton id={plan.id} /></div> : <p className="border-t border-border pt-4 text-xs text-muted-foreground">计划已结束，历史记录仍保留。</p>}
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

function RecordsDialog({ records, plans }: { records: DcaFeeDetail[]; plans: DcaPlanView[] }) { return <Dialog><DialogTrigger asChild><Button variant="outline" size="sm"><ClipboardList />记账记录</Button></DialogTrigger><DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl"><DialogHeader className="text-left"><DialogTitle>记账记录</DialogTitle><p className="text-sm text-muted-foreground">按计划自动生成记账记录，请对照购买渠道核对实际金额和申购状态。</p></DialogHeader><div className="min-h-0 overflow-y-auto"><RecordList records={records} plans={plans} /></div></DialogContent></Dialog>; }

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
