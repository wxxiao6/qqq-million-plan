"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ResolvePendingForm } from "@/components/holdings/pending-forms";
import { DeletePositionButton, PositionForm } from "@/components/holdings/holdings-forms";
import { accountLabel } from "@/components/labels";
import { SalesChannelFilters } from "@/components/sales-channel-filter";
import { Money } from "@/components/money";
import { filterHoldingPositions, groupHoldingChannels, groupNasdaqHoldings, marketValueIncludingPending, summarizeNasdaqHoldings, type HoldingChannelGroup, type HoldingGroup } from "@/lib/holdings-dashboard";
import type { PositionDetail } from "@/server/ledger";
import { filterBySalesChannel, type SalesChannelFilter } from "@/lib/sales-channel-filter";

type SortOrder = "value" | "gain" | "symbol";

export function HoldingsExplorer({ positions, names, managers }: { positions: PositionDetail[]; names: Record<string, string>; managers: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<SalesChannelFilter>("all");
  const [detail, setDetail] = useState("all");
  const [sort, setSort] = useState<SortOrder>("value");

  const groups = useMemo(() => {
    const matching = filterBySalesChannel(filterHoldingPositions(positions, names, query, "all"), managers, channel, detail);
    const result = groupNasdaqHoldings(matching, names);
    result.sort((a, b) => sort === "symbol" ? a.symbol.localeCompare(b.symbol) :
      sort === "gain" ? (b.holdingPnl ?? Number.NEGATIVE_INFINITY) - (a.holdingPnl ?? Number.NEGATIVE_INFINITY) || a.symbol.localeCompare(b.symbol) :
        (b.marketValue ?? Number.NEGATIVE_INFINITY) - (a.marketValue ?? Number.NEGATIVE_INFINITY) || a.symbol.localeCompare(b.symbol));
    return result;
  }, [positions, names, managers, query, channel, detail, sort]);

  const summary = useMemo(() => summarizeNasdaqHoldings(groups), [groups]);
  const isFiltered = channel !== "all" || query.trim().length > 0;

  return <>
      <section aria-label="持仓总览" className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_36px_rgba(70,52,36,.055)]">
        <div className="grid gap-7 bg-foreground px-6 py-7 text-primary-foreground md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:px-8">
          <div>
            <p className="text-xs font-medium tracking-[.16em] text-primary-foreground/60">{isFiltered ? "纳指持仓 · 筛选结果" : "纳指持仓 · 组合总览"}</p>
            <p className="mt-5 text-sm text-primary-foreground/70">{isFiltered ? "筛选资产合计" : "资产合计"}</p>
            <p className="font-display mt-1 text-[clamp(2.7rem,6vw,4.5rem)] font-semibold leading-none tracking-[-.045em]">
              <Money value={marketValueIncludingPending(summary.marketValue, summary.pendingCash)} className="font-display" />
            </p>
            <p className="mt-4 text-xs text-primary-foreground/60">
              含待确认资金 · {summary.fundCount} 只基金 · {summary.settledCount} 笔已确认
              {summary.unvaluedCount > 0 ? ` · ${summary.unvaluedCount} 笔缺少净值，未计入资产合计` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 border-t border-primary-foreground/15 pt-5 md:border-l md:border-t-0 md:pl-7 md:pt-0">
            <OverviewNumber label="持仓成本" value={<Money value={summary.cost} />} />
            <OverviewNumber label="持有收益" value={<Money value={summary.holdingPnl} signed className={summary.holdingPnl != null && summary.holdingPnl < 0 ? "!text-[#ffc3b8]" : "!text-[#b4e6c7]"} />} />
            <OverviewNumber label={summary.incomeDate ? `${summary.incomeDate} 收益` : "单日收益"}
              detail={summary.incomeFundCount < summary.datedIncomeFundCount ? `计入该日 ${summary.incomeFundCount} 只基金` : undefined}
              value={<Money value={summary.today} signed className={summary.today != null && summary.today < 0 ? "!text-[#ffc3b8]" : "!text-[#b4e6c7]"} />} />
            <OverviewNumber label="待确认资金" value={<Money value={summary.pendingCash} />} detail={`${summary.pendingCount} 笔待确认`} />
          </div>
        </div>
      </section>


    <section aria-labelledby="holdings-list-title" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-medium tracking-[.16em] text-copper">HOLDINGS</p>
        <h2 id="holdings-list-title" className="mt-1 text-2xl font-semibold tracking-tight">基金持仓</h2>
        <p className="mt-1 text-sm text-muted-foreground">按基金汇总，展开后按销售渠道查看实际持有。</p>
      </div>
      <p className="text-sm text-muted-foreground">显示 <span className="font-mono text-foreground">{groups.length}</span> 只基金</p>
    </div>

    <div className="grid gap-3 rounded-xl border border-border bg-card/75 p-3 lg:grid-cols-[minmax(12rem,1fr)_auto_auto] lg:items-center">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">搜索基金名称或代码</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索基金名称或代码" className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none focus:border-copper" />
      </label>
      <SalesChannelFilters rows={positions} managers={managers} channel={channel} detail={detail} onChannelChange={(value) => { setChannel(value); setDetail("all"); }} onDetailChange={setDetail} />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="whitespace-nowrap">排序</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)} className="h-10 min-w-28 rounded-lg border border-input bg-card px-3 text-sm text-foreground">
          <option value="value">市值从高到低</option>
          <option value="gain">收益从高到低</option>
          <option value="symbol">基金代码</option>
        </select>
      </label>
    </div>

    {groups.length > 0 ? <div className="space-y-3">
      {groups.map((group) => <HoldingCard key={group.symbol} group={group} fundOptions={names} fundManagers={managers} />)}
    </div> : <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
      <p className="text-base font-medium">{positions.length ? "没有符合条件的持仓" : "还没有纳指持仓"}</p>
      <p className="mt-1 text-sm text-muted-foreground">{positions.length ? "试试其他基金代码或渠道。" : "点击页面右上角的“新增持仓”开始记录。"}</p>
      {positions.length ? <button type="button" onClick={() => { setQuery(""); setChannel("all"); setDetail("all"); }} className="mt-4 text-sm font-medium text-copper hover:underline">清除筛选</button> : null}
    </div>}
  </section>
  </>;
}

function OverviewNumber({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return <div className="min-w-0">
    <p className="text-xs text-primary-foreground/60">{label}</p>
    <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{value}</p>
    {detail ? <p className="mt-1 text-xs text-primary-foreground/50">{detail}</p> : null}
  </div>;
}

function HoldingCard({ group, fundOptions, fundManagers }: { group: HoldingGroup; fundOptions: Record<string, string>; fundManagers: Record<string, string> }) {
  const channels = groupHoldingChannels(group.positions);
  return <details className="group overflow-hidden rounded-2xl border border-border bg-card shadow-[0_5px_18px_rgba(70,52,36,.035)] open:border-copper/40">
    <summary className="relative flex cursor-pointer list-none flex-col gap-4 px-5 py-5 marker:hidden hover:bg-muted/25 sm:px-6 lg:flex-row lg:items-center [&::-webkit-details-marker]:hidden">
      <div className="w-full min-w-0 pr-6 lg:min-w-48 lg:flex-1 lg:pr-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-medium text-copper">{group.symbol}</span>
        </div>
        <h3 className="mt-1.5 line-clamp-2 text-base font-semibold leading-snug" title={group.name}>{group.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{group.settledCount} 笔已确认 · {group.positions.length} 笔记录{group.navAsOf ? ` · 净值 ${group.navAsOf}` : ""}{group.unvaluedCount ? ` · ${group.unvaluedCount} 笔未估值` : ""}</p>
      </div>
      <div className="grid w-full min-w-0 grid-cols-2 gap-x-5 gap-y-2 sm:gap-x-8 lg:w-[510px] lg:shrink-0 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        <CardMetric label="资产合计" value={<Money value={marketValueIncludingPending(group.marketValue, group.pendingCash)} />} />
        <CardMetric label="持有收益" value={<Money value={group.holdingPnl} signed />} />
        <CardMetric label={group.navAsOf ? `${group.navAsOf} 收益` : "单日收益"} value={<Money value={group.today} signed />} />
      </div>
      <ChevronDown className="absolute right-5 top-6 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 lg:static" aria-hidden="true" />
    </summary>
    <div className="border-t border-border bg-background/45 px-5 pb-5 pt-4 sm:px-6">
      {group.unvaluedCount > 0 ? <p className="mb-3 text-xs text-limit">{group.unvaluedCount} 笔已确认持仓缺少净值，未计入上方资产合计与收益。</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] table-fixed border-collapse text-left text-sm">
          <colgroup><col className="w-[190px]" /><col className="w-[160px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[140px]" /><col className="w-[140px]" /><col className="w-[120px]" /></colgroup>
          <thead><tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-2 font-medium">销售渠道</th><th className="py-2 font-medium">总金额</th><th className="py-2 font-medium">待确认金额</th><th className="py-2 font-medium">持仓成本</th><th className="py-2 font-medium">{group.navAsOf ? `${group.navAsOf} 收益` : "单日收益"}</th><th className="py-2 font-medium">持有收益</th><th className="py-2 text-right font-medium">操作</th>
          </tr></thead>
          <tbody>{channels.map((channel) => <ChannelSummaryRow key={channel.account} channel={channel} group={group} fundOptions={fundOptions} fundManagers={fundManagers} />)}</tbody>
        </table>
      </div>
    </div>
  </details>;
}

function ChannelSummaryRow({ channel, group, fundOptions, fundManagers }: { channel: HoldingChannelGroup; group: HoldingGroup; fundOptions: Record<string, string>; fundManagers: Record<string, string> }) {
  const label = channel.account === "gf_direct" ? fundManagers[group.symbol] ?? "基金管理人" : accountLabel(channel.account);
  return <tr className="border-b border-border/70 last:border-0 align-top">
    <td className="py-3"><span className="font-medium">{label}</span>{channel.pendingPositions.length > 0 ? <small className="block text-xs text-muted-foreground">{channel.pendingPositions.length} 笔待确认</small> : null}</td>
    <td className="py-3"><Money value={marketValueIncludingPending(channel.marketValue, channel.pendingCash)} /></td>
    <td className="py-3"><Money value={channel.pendingCash} /></td>
    <td className="py-3"><Money value={(channel.cost + channel.pendingCash) || null} /></td>
    <td className="py-3"><Money value={channel.today} signed /></td>
    <td className="py-3"><Money value={channel.holdingPnl} signed /></td>
    <td className="whitespace-nowrap py-3 text-right"><ChannelActions channel={channel} fundOptions={fundOptions} fundManagers={fundManagers} /></td>
  </tr>;
}

function ChannelActions({ channel, fundOptions, fundManagers }: { channel: HoldingChannelGroup; fundOptions: Record<string, string>; fundManagers: Record<string, string> }) {
  const editable = channel.settledPositions.filter((position) => position.dcaPlanId == null);
  return <div className="flex flex-wrap justify-end gap-1">{editable.map((position) => <span key={position.id} className="inline-flex items-center gap-1"><PositionForm initial={position} fundOptions={fundOptions} fundManagers={fundManagers} /><DeletePositionButton id={position.id} isDcaExecution={false} /></span>)}{channel.pendingPositions.filter((position) => position.dcaPlanId == null).map((position) => <ResolvePendingForm key={position.id} id={position.id} executionOn={position.executionOn} cutoffPeriod={position.cutoffPeriod} />)}</div>;
}

function CardMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0">
    <p className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</p>
    <p className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base">{value}</p>
  </div>;
}
