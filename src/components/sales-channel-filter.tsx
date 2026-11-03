"use client";

import { accountLabel } from "@/components/labels";
import { salesDetails, UNKNOWN_SALES_DETAIL, type SalesChannelFilter, type SalesFilterRow } from "@/lib/sales-channel-filter";

export function SalesChannelFilters({ rows, managers, channel, detail, onChannelChange, onDetailChange, layout = "default" }: {
  rows: SalesFilterRow[];
  managers: Record<string, string>;
  channel: SalesChannelFilter;
  detail: string;
  onChannelChange: (channel: SalesChannelFilter) => void;
  onDetailChange: (detail: string) => void;
  layout?: "default" | "toolbar";
}) {
  const options = salesDetails(rows, managers, channel);
  const selectClass = "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground";
  const toolbar = layout === "toolbar";
  return <div className={toolbar ? "contents" : "flex w-full max-w-full flex-row-reverse flex-wrap items-center justify-start gap-2 sm:w-[27rem]"}>
    <label className={toolbar ? "order-2 grid min-w-0 gap-1.5 text-xs text-muted-foreground" : "flex shrink-0 items-center gap-2 text-xs text-muted-foreground"}><span>渠道</span><select aria-label="渠道" value={channel} onChange={(event) => onChannelChange(event.target.value as SalesChannelFilter)} className={`${selectClass} ${toolbar ? "w-full min-w-0" : "w-28"}`}><option value="all">全部渠道</option><option value="direct">直销</option><option value="agency">代销</option></select></label>
    {channel !== "all" ? <label className={toolbar ? "order-4 col-span-2 grid min-w-0 gap-1.5 text-xs text-muted-foreground min-[480px]:col-span-3" : "flex max-w-full items-center gap-2 text-xs text-muted-foreground"}><span className="shrink-0">{channel === "direct" ? "基金公司" : "代销平台"}</span><select aria-label={channel === "direct" ? "基金公司" : "代销平台"} value={detail} onChange={(event) => onDetailChange(event.target.value)} className={`${selectClass} ${toolbar ? "w-full min-w-0" : "w-48 max-w-full"}`}><option value="all">全部</option>{options.map((value) => <option key={value} value={value}>{value === UNKNOWN_SALES_DETAIL ? (channel === "direct" ? "基金公司待核实" : "平台待核实") : channel === "direct" ? value : accountLabel(value)}</option>)}</select></label> : null}
  </div>;
}
