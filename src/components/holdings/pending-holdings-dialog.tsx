"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { accountLabel } from "@/components/labels";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { PositionDetail } from "@/server/ledger";
import { ResolvePendingForm } from "./pending-forms";

export function PendingHoldingsDialog({ positions, names, managers, trigger }: {
  positions: PositionDetail[];
  names: Record<string, string>;
  managers: Record<string, string>;
  trigger?: React.ReactNode;
}) {
  const [source, setSource] = useState("all");
  const [month, setMonth] = useState("all");
  const pending = positions.filter((position) => position.status === "pending");
  const months = [...new Set(pending.map((position) => (position.executionOn ?? position.recordedOn)?.slice(0, 7)).filter((value): value is string => Boolean(value)))].sort().reverse();
  const visible = pending.filter((position) =>
    (source === "all" || (source === "dca" ? position.dcaPlanId != null : position.dcaPlanId == null)) &&
    (month === "all" || (position.executionOn ?? position.recordedOn)?.startsWith(month)),
  ).sort((a, b) => (a.executionOn ?? a.recordedOn ?? "9999").localeCompare(b.executionOn ?? b.recordedOn ?? "9999") || a.id - b.id);

  return <Dialog onOpenChange={(open) => { if (open) { setSource("all"); setMonth("all"); } }}>
    <DialogTrigger asChild>{trigger ?? <Button type="button" variant="outline" size="sm">查看待确认 {pending.length} 笔</Button>}</DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
        <DialogTitle>待确认申购</DialogTitle>
        <DialogDescription>汇总当前筛选范围内的待确认申购。非 QDII 基金获取到对应成交净值后自动确认；其余可核对购买平台结果后处理。</DialogDescription>
      </DialogHeader>
      <div className="shrink-0 space-y-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">记录来源<select aria-label="待确认来源" value={source} onChange={(event) => setSource(event.target.value)} className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground"><option value="all">全部来源</option><option value="manual">手动申购</option><option value="dca">定投申购</option></select></label>
          <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">申购月份<select aria-label="待确认月份" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground"><option value="all">全部月份</option>{months.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <p className="text-xs text-muted-foreground">{visible.length} 笔待确认 · 合计 <Money value={visible.reduce((sum, position) => sum + position.cashDebited, 0)} /></p>
      </div>
      <div className="min-h-0 overflow-y-auto px-5 sm:px-6">
        {visible.length ? <div className="divide-y divide-border">{visible.map((position) => <article key={position.id} className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-sm font-medium leading-snug">{names[position.symbol] ?? position.symbol}</p><p className="mt-1 text-xs text-muted-foreground">{position.symbol} · {position.account === "gf_direct" ? managers[position.symbol] ?? "基金公司" : accountLabel(position.account)}</p></div>
            <Money value={position.cashDebited} className="shrink-0 text-sm font-semibold" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{position.executionOn ?? position.recordedOn ?? "日期待补充"} · {position.dcaPlanId != null ? "定投申购" : "手动申购"}{position.expectedConfirmOn ? ` · 预计确认 ${position.expectedConfirmOn}` : ""}</p>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {position.dcaPlanId != null ? <Button asChild variant="ghost" size="sm" className="text-copper"><Link href={`/dca?record=${position.id}`}>查看定投记录<ArrowUpRight aria-hidden="true" /></Link></Button> : null}
            <ResolvePendingForm id={position.id} executionOn={position.executionOn} cutoffPeriod={position.cutoffPeriod} description={<>{names[position.symbol] ?? position.symbol}（{position.symbol}） · {position.executionOn ?? position.recordedOn ?? "日期待补充"} · <Money value={position.cashDebited} /></>} />
          </div>
        </article>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">当前范围没有待确认申购。</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
