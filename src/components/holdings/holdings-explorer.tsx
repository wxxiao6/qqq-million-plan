"use client";

import { RefreshFundNav } from "./refresh-fund-nav";
import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { PendingHoldingsDialog } from "./pending-holdings-dialog";
import { DeletePositionButton, PositionForm } from "@/components/holdings/holdings-forms";
import { accountLabel } from "@/components/labels";
import { SalesChannelFilters } from "@/components/sales-channel-filter";
import { FilterSelect } from "@/components/filter-select";
import { Money, Qty } from "@/components/money";
import { advanceWeekdays } from "@/lib/format";
import { filterHoldingPositions, groupHoldingChannels, groupNasdaqHoldings, marketValueIncludingPending, summarizeNasdaqHoldings, type HoldingChannelGroup, type HoldingGroup } from "@/lib/holdings-dashboard";
import type { PositionDetail } from "@/server/ledger";
import { filterBySalesChannel, type SalesChannelFilter } from "@/lib/sales-channel-filter";

type SortOrder = "value" | "gain" | "navDate" | "symbol";

// 展示口径：收益日期按净值日顺延一个工作日，计算仍使用原净值日期。
function incomeLabel(navDate: string | null): string {
  return navDate ? `${advanceWeekdays(navDate, 1)} 收益` : "单日收益";
}

export function HoldingsExplorer({ positions, names, managers, syncErrors = {} }: { positions: PositionDetail[]; names: Record<string, string>; managers: Record<string, string>; syncErrors?: Record<string, string> }) {
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<SalesChannelFilter>("all");
  const [detail, setDetail] = useState("all");
  const [sort, setSort] = useState<SortOrder>("value");

  const groups = useMemo(() => {
    const matching = filterBySalesChannel(filterHoldingPositions(positions.filter((position) => scope === "all" || position.exposure === scope), names, query, "all"), managers, channel, detail);
    const result = groupNasdaqHoldings(matching, names);
    result.sort((a, b) => sort === "symbol" ? a.symbol.localeCompare(b.symbol) :
      sort === "navDate" ? (b.navAsOf ?? "").localeCompare(a.navAsOf ?? "") || a.symbol.localeCompare(b.symbol) :
      sort === "gain" ? (b.holdingPnl ?? Number.NEGATIVE_INFINITY) - (a.holdingPnl ?? Number.NEGATIVE_INFINITY) || a.symbol.localeCompare(b.symbol) :
        (b.marketValue ?? Number.NEGATIVE_INFINITY) - (a.marketValue ?? Number.NEGATIVE_INFINITY) || a.symbol.localeCompare(b.symbol));
    return result;
  }, [positions, names, managers, query, channel, detail, sort, scope]);

  const summary = useMemo(() => summarizeNasdaqHoldings(groups), [groups]);
  const isFiltered = channel !== "all" || query.trim().length > 0 || scope !== "all";

  return <>
      <section aria-label="持仓总览" className="@container/overview overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_36px_rgba(70,52,36,.055)]">
        <div className="grid min-w-0 gap-7 bg-foreground px-6 py-7 text-primary-foreground @min-[40rem]/overview:px-8 @min-[64rem]/overview:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[.16em] text-primary-foreground/60">{scope === "nasdaq" ? "纳指持仓 · 筛选结果" : scope === "fund" ? "其他基金 · 筛选结果" : isFiltered ? "基金持仓 · 筛选结果" : "基金持仓 · 组合总览"}</p>
            <p className="mt-5 text-sm text-primary-foreground/70">{summary.unvaluedCount ? "已估值资产（含待确认资金）" : isFiltered ? "筛选资产合计" : "资产合计"}</p>
            <p className="font-display mt-1 text-[clamp(2rem,6cqi,4.5rem)] font-semibold leading-none tracking-[-.045em]">
              <Money value={marketValueIncludingPending(summary.marketValue, summary.pendingCash)} className="whitespace-nowrap font-display" />
            </p>
            <p className="mt-4 text-xs text-primary-foreground/60">
              含待确认资金 · {summary.fundCount} 只基金 · {summary.settledCount} 笔已确认
              {summary.unvaluedCount > 0 ? ` · ${summary.unvaluedCount} 笔缺少净值，未计入资产合计` : ""}
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-6 border-t border-primary-foreground/15 pt-5 @min-[20rem]/overview:grid-cols-2 @min-[64rem]/overview:border-l @min-[64rem]/overview:border-t-0 @min-[64rem]/overview:pl-7 @min-[64rem]/overview:pt-0">
            <OverviewNumber label="持仓成本" value={<Money value={summary.cost} />} detail="仅含已确认持仓" />
            <OverviewNumber label={summary.unvaluedCount ? "已估值持有收益" : "持有收益"} value={<Money value={summary.holdingPnl} signed className={summary.holdingPnl != null && summary.holdingPnl < 0 ? "!text-[#ffc3b8]" : "!text-[#b4e6c7]"} />} />
            <OverviewNumber label={incomeLabel(summary.incomeDate)}
              detail={summary.incomeFundCount < summary.fundCount ? `计入该日 ${summary.incomeFundCount} 只基金` : undefined}
              value={<Money value={summary.today} signed className={summary.today != null && summary.today < 0 ? "!text-[#ffc3b8]" : "!text-[#b4e6c7]"} />} />
            <PendingHoldingsDialog positions={groups.flatMap((group) => group.positions)} names={names} managers={managers} trigger={<button type="button" className="@container min-w-0 rounded-lg text-left outline-none transition-colors hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-primary-foreground/60" aria-label={`查看待确认申购，${summary.pendingCount} 笔，合计 ${summary.pendingCash.toFixed(2)} 元`}>
              <span className="flex items-center gap-1 text-xs text-primary-foreground/60">待确认资金<ArrowUpRight className="size-3.5" aria-hidden="true" /></span>
              <span className="mt-1 block whitespace-nowrap text-[clamp(1rem,11cqi,1.5rem)] font-semibold leading-snug tracking-tight"><Money value={summary.pendingCash} /></span>
              <span className="mt-1 block text-xs text-primary-foreground/60 underline underline-offset-4">查看 {summary.pendingCount} 笔待确认</span>
            </button>} />
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

    <div role="search" aria-label="持仓筛选" className="grid min-w-0 gap-3 rounded-xl border border-border bg-card/75 p-3">
      <label className="relative block min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">搜索基金名称或代码</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索基金名称或代码" className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none focus:border-copper" />
      </label>
      <div className="grid min-w-0 grid-cols-2 items-end gap-3 min-[480px]:grid-cols-3">
      <FilterSelect label="范围" ariaLabel="持仓范围" value={scope} onValueChange={setScope} className="order-1"
        options={[{ value: "all", label: "全部基金" }, { value: "nasdaq", label: "纳指基金" }, { value: "fund", label: "其他基金" }]} />
      <SalesChannelFilters layout="toolbar" rows={positions} managers={managers} channel={channel} detail={detail} onChannelChange={(value) => { setChannel(value); setDetail("all"); }} onDetailChange={setDetail} />
      <FilterSelect<SortOrder> label="排序" value={sort} onValueChange={setSort} className="order-3 col-span-2 min-[480px]:col-span-1"
        options={[{ value: "value", label: "市值从高到低" }, { value: "gain", label: "收益从高到低" }, { value: "navDate", label: "净值更新从新到旧" }, { value: "symbol", label: "基金代码" }]} />
      </div>
    </div>

    {groups.length > 0 ? <div className="space-y-3">
      {groups.map((group) => <HoldingCard key={group.symbol} group={group} syncError={syncErrors[group.symbol]} fundOptions={names} fundManagers={managers} />)}
    </div> : <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
      <p className="text-base font-medium">{positions.length ? "没有符合条件的持仓" : "还没有基金持仓"}</p>
      <p className="mt-1 text-sm text-muted-foreground">{positions.length ? "试试其他基金代码或渠道。" : "点击页面右上角的“新增持仓”开始记录。"}</p>
      {positions.length ? <button type="button" onClick={() => { setQuery(""); setScope("all"); setChannel("all"); setDetail("all"); }} className="mt-4 text-sm font-medium text-copper hover:underline">清除筛选</button> : null}
    </div>}
  </section>
  </>;
}

function OverviewNumber({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return <div className="@container min-w-0">
    <p className="text-xs text-primary-foreground/60">{label}</p>
    <p className="mt-1 whitespace-nowrap text-[clamp(1rem,11cqi,1.5rem)] font-semibold leading-snug tracking-tight">{value}</p>
    {detail ? <p className="mt-1 text-xs text-primary-foreground/50">{detail}</p> : null}
  </div>;
}

function HoldingCard({ group, fundOptions, fundManagers, syncError }: { group: HoldingGroup; fundOptions: Record<string, string>; fundManagers: Record<string, string>; syncError?: string }) {
  const channels = groupHoldingChannels(group.positions);
  return <details id={`holding-${group.symbol}`} className="group scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_5px_18px_rgba(70,52,36,.035)] open:border-copper/40">
    <summary className="relative flex cursor-pointer list-none flex-col gap-4 px-5 py-5 marker:hidden hover:bg-muted/25 sm:px-6 lg:flex-row lg:items-center [&::-webkit-details-marker]:hidden">
      <div className="w-full min-w-0 pr-6 lg:min-w-48 lg:flex-1 lg:pr-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-medium text-copper">{group.symbol}</span>
          {group.positions[0]?.exposure === "fund" ? <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">其他基金</span> : null}
        </div>
        <h3 className="mt-1.5 line-clamp-2 text-base font-semibold leading-snug" title={group.name}>{group.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{group.settledCount} 笔已确认 · {group.positions.length} 笔记录{group.navAsOf ? ` · 净值 ${group.navAsOf}` : ""}{group.unvaluedCount ? ` · ${group.unvaluedCount} 笔净值同步中` : syncError ? " · 净值更新暂缓" : ""}</p>
      </div>
      <div className="grid w-full min-w-0 grid-cols-2 gap-x-5 gap-y-2 sm:gap-x-8 lg:w-[510px] lg:shrink-0 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        <CardMetric label={group.unvaluedCount ? "已估值资产" : "资产合计"} value={<Money value={marketValueIncludingPending(group.marketValue, group.pendingCash)} />} />
        <CardMetric label="持有收益" value={<Money value={group.holdingPnl} signed />} />
        <CardMetric label={incomeLabel(group.navAsOf)} value={<Money value={group.today} signed />} />
      </div>
      <ChevronDown className="absolute right-5 top-6 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 lg:static" aria-hidden="true" />
    </summary>
    <div className="@container/channels border-t border-border bg-background/45 px-5 pb-5 pt-4 sm:px-6">
      {syncError ? <p className="mb-2 text-xs text-limit">更新暂缓：保留最近已公布净值，稍后自动重试。</p> : null}
      {syncError || group.unvaluedCount > 0 ? <div className="mb-3"><RefreshFundNav code={group.symbol} /></div> : null}
      {group.unvaluedCount > 0 ? <p className="mb-3 text-xs text-limit">{group.unvaluedCount} 笔已确认持仓缺少净值，未计入上方资产合计与收益。</p> : null}
      <div className="hidden grid-cols-[20%_21%_22%_21%_16%] border-b border-border pb-2 text-xs text-muted-foreground @min-[52rem]/channels:grid" aria-hidden="true">
        <span>销售渠道</span><span>资产合计</span><span>持仓单价 / 份额</span><span>持有收益</span><span className="text-right">操作</span>
      </div>
      <div className="space-y-3 @min-[52rem]/channels:space-y-0">
        {channels.map((channel) => <ChannelSummary key={channel.account} channel={channel} group={group} fundOptions={fundOptions} fundManagers={fundManagers} />)}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">资产合计含待确认资金；持仓成本、单价和收益仅计算已确认部分。持仓单价＝持仓成本 ÷ 持有份额。</p>
    </div>
  </details>;
}

function ChannelSummary({ channel, group, fundOptions, fundManagers }: { channel: HoldingChannelGroup; group: HoldingGroup; fundOptions: Record<string, string>; fundManagers: Record<string, string> }) {
  const label = channel.account === "gf_direct" ? fundManagers[group.symbol] ?? "基金管理人" : accountLabel(channel.account);
  return <article aria-label={`${label}持仓明细`} className="min-w-0 rounded-xl border border-border bg-card p-4 @min-[52rem]/channels:grid @min-[52rem]/channels:grid-cols-[20%_21%_22%_21%_16%] @min-[52rem]/channels:rounded-none @min-[52rem]/channels:border-0 @min-[52rem]/channels:border-b @min-[52rem]/channels:bg-transparent @min-[52rem]/channels:px-0 @min-[52rem]/channels:py-4 @min-[52rem]/channels:last:border-0">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 @min-[52rem]/channels:border-0 @min-[52rem]/channels:pr-4 @min-[52rem]/channels:pb-0">
      <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold leading-snug">{label}</h4><p className="mt-1 text-xs text-muted-foreground">{channel.settledPositions.length} 笔已确认</p></div>
      <div className="text-right @min-[52rem]/channels:hidden"><p className="text-[11px] text-muted-foreground">资产合计</p><p className="mt-1 text-sm font-semibold"><Money value={marketValueIncludingPending(channel.marketValue, channel.pendingCash)} /></p></div>
    </div>
    <div className="hidden space-y-1 pr-3 text-sm @min-[52rem]/channels:block"><p className="font-semibold"><Money value={marketValueIncludingPending(channel.marketValue, channel.pendingCash)} /></p><p className="text-xs text-muted-foreground">已确认 <Money value={channel.marketValue} /></p><p className="text-xs text-muted-foreground">待确认 <Money value={channel.pendingCash} /></p></div>
    <div className="hidden space-y-1 pr-3 text-sm @min-[52rem]/channels:block"><p><Money value={channel.unitCost} fractionDigits={4} /></p><p className="text-xs text-muted-foreground"><Qty value={channel.shares} /> 份</p><p className="text-xs text-muted-foreground">成本 <Money value={channel.cost} /></p></div>
    <div className="hidden space-y-1 pr-3 text-sm @min-[52rem]/channels:block"><p><Money value={channel.holdingPnl} signed /></p><p className="text-xs text-muted-foreground">{incomeLabel(channel.navAsOf)}</p><p><Money value={channel.today} signed className="text-xs" /></p></div>
    <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 py-4 @min-[52rem]/channels:hidden">
      <CardMetric label="持仓单价" value={<Money value={channel.unitCost} fractionDigits={4} />} />
      <CardMetric label="持有份额" value={<Qty value={channel.shares} />} />
      <CardMetric label="持仓成本" value={<Money value={channel.cost} />} />
      <CardMetric label="持有收益" value={<Money value={channel.holdingPnl} signed />} />
      <CardMetric label="已确认市值" value={<Money value={channel.marketValue} />} />
      <CardMetric label={incomeLabel(channel.navAsOf)} value={<Money value={channel.today} signed />} />
    </div>
    <div className="space-y-3 @min-[52rem]/channels:min-w-0">
      {channel.pendingPositions.length ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs @min-[52rem]/channels:justify-end @min-[52rem]/channels:bg-transparent @min-[52rem]/channels:p-0"><span className="text-muted-foreground @min-[52rem]/channels:hidden">待确认资金 <Money value={channel.pendingCash} className="text-foreground" /></span><PendingHoldingsDialog positions={channel.pendingPositions} names={fundOptions} managers={fundManagers} trigger={<button type="button" className="font-medium text-copper underline underline-offset-4">查看 {channel.pendingPositions.length} 笔待确认 →</button>} /></div> : null}
      <ChannelActions channel={channel} fundOptions={fundOptions} fundManagers={fundManagers} />
    </div>
  </article>;
}

function ChannelActions({ channel, fundOptions, fundManagers }: { channel: HoldingChannelGroup; fundOptions: Record<string, string>; fundManagers: Record<string, string> }) {
  const editable = channel.settledPositions.filter((position) => position.dcaPlanId == null);
  if (!editable.length) return null;
  return <div className="flex flex-wrap justify-end gap-1">{editable.map((position) => <span key={position.id} className="inline-flex items-center gap-1"><PositionForm initial={position} fundOptions={fundOptions} fundManagers={fundManagers} /><DeletePositionButton id={position.id} isDcaExecution={false} /></span>)}</div>;
}

function CardMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0">
    <p className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</p>
    <p className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base">{value}</p>
  </div>;
}
