"use client";

import { useEffect, useId, useRef } from "react";
import { Search, X } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { accountLabel } from "@/components/labels";
import { salesDetails, UNKNOWN_SALES_DETAIL, type SalesChannelFilter, type SalesFilterRow } from "@/lib/sales-channel-filter";
import type { HoldingSortOrder } from "@/lib/holdings-dashboard";
import { HOLDING_FUND_SCOPES, type HoldingFundScope } from "@/lib/fund-category";

const channels = [{ value: "all", label: "全部渠道" }, { value: "direct", label: "直销" }, { value: "agency", label: "代销" }] as const;
const sorts = [{ value: "gain", label: "持有收益排序" }, { value: "gainRate", label: "持有收益率排序" }, { value: "value", label: "金额排序" }, { value: "dayGain", label: "昨日收益排序" }, { value: "navDate", label: "更新时间排序" }] as const;

export function HoldingsFilters({ rows, managers, query, scope, channel, detail, sort, onQueryChange, onScopeChange, onChannelChange, onDetailChange, onSortChange }: {
  rows: SalesFilterRow[];
  managers: Record<string, string>;
  query: string;
  scope: HoldingFundScope;
  channel: SalesChannelFilter;
  detail: string;
  sort: HoldingSortOrder;
  onQueryChange: (value: string) => void;
  onScopeChange: (value: HoldingFundScope) => void;
  onChannelChange: (value: SalesChannelFilter) => void;
  onDetailChange: (value: string) => void;
  onSortChange: (value: HoldingSortOrder) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const hasChannel = channel !== "all";
  const detailLabel = channel === "direct" ? "基金公司" : "账户";
  const detailOptions = salesDetails(rows, managers, channel).map((value) => ({
    value,
    label: value === UNKNOWN_SALES_DETAIL ? (channel === "direct" ? "基金公司待核实" : "账户待核实") : channel === "direct" ? value : accountLabel(value),
  }));

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target;
      // Leave editors and open dialogs in control of their own keyboard shortcuts.
      if (target instanceof HTMLElement && (target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])") || document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]'))) return;
      event.preventDefault();
      search.current?.focus();
    }
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  function clearSearch() {
    onQueryChange("");
    search.current?.focus();
  }

  return <div role="search" aria-label="持仓筛选" className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[0_4px_20px_rgba(70,52,36,.025)] sm:p-5">
    <div className="group relative flex min-w-0 items-center gap-2 rounded-xl border border-input bg-background/40 px-3 transition-[border-color,box-shadow,background-color] focus-within:border-copper focus-within:bg-card focus-within:ring-[3px] focus-within:ring-copper/10 sm:px-4">
      <Search className="size-5 shrink-0 text-muted-foreground transition-colors group-focus-within:text-copper" aria-hidden="true" />
      <input ref={search} type="search" value={query} onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && query) { event.preventDefault(); event.stopPropagation(); clearSearch(); }
        }}
        aria-label="搜索基金名称或代码" aria-describedby={hintId} aria-controls="holdings-results" aria-keyshortcuts="Meta+k Control+k"
        autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search"
        placeholder="搜索基金名称或代码"
        className="h-12 w-full min-w-0 border-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/75 sm:h-13 sm:text-sm [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none" />
      {query ? <button type="button" onClick={clearSearch} aria-label="清空搜索" title="清空搜索（Esc）" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-copper"><X className="size-4" aria-hidden="true" /></button>
        : <kbd title="按 Command 或 Ctrl + K 聚焦搜索" aria-hidden="true" className="hidden shrink-0 rounded-md border border-border bg-card px-2 py-1 font-sans text-[11px] text-muted-foreground sm:block">⌘ / Ctrl K</kbd>}
    </div>
    <p id={hintId} className="sr-only">输入即筛选当前持仓。按 Escape 清空搜索，保留其他筛选条件。</p>

    <div className={`mt-4 grid min-w-0 grid-cols-2 items-end gap-3 ${hasChannel ? "lg:grid-cols-4" : "sm:grid-cols-3"}`}>
      <FilterSelect label="范围" ariaLabel="持仓范围" value={scope} onValueChange={onScopeChange} options={HOLDING_FUND_SCOPES} triggerClassName="data-[size=default]:h-11" />
      <FilterSelect<SalesChannelFilter> label="渠道" value={channel} onValueChange={onChannelChange} options={channels} triggerClassName="data-[size=default]:h-11" />
      {hasChannel ? <FilterSelect label={detailLabel} value={detail} onValueChange={onDetailChange} options={[{ value: "all", label: channel === "direct" ? "全部基金公司" : "全部账户" }, ...detailOptions]} triggerClassName="data-[size=default]:h-11" /> : null}
      <FilterSelect<HoldingSortOrder> label="排序" value={sort} onValueChange={onSortChange} options={sorts} className={hasChannel ? undefined : "col-span-2 sm:col-span-1"} triggerClassName="data-[size=default]:h-11" />
    </div>
  </div>;
}
