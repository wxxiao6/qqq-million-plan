"use client";

import { accountLabel } from "@/components/labels";
import { FilterSelect } from "@/components/filter-select";
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
  const toolbar = layout === "toolbar";
  return <div className={toolbar ? "contents" : "flex w-full max-w-full flex-row-reverse flex-wrap items-center justify-start gap-2 sm:w-[27rem]"}>
    <FilterSelect<SalesChannelFilter> label="渠道" value={channel} onValueChange={onChannelChange}
      className={toolbar ? "order-2" : "flex shrink-0 items-center gap-2"} triggerClassName={toolbar ? undefined : "w-28"}
      options={[{ value: "all", label: "全部渠道" }, { value: "direct", label: "直销" }, { value: "agency", label: "代销" }]} />
    {channel !== "all" ? <FilterSelect label={channel === "direct" ? "基金公司" : "代销平台"} value={detail} onValueChange={onDetailChange}
      className={toolbar ? "order-4 col-span-2 min-[480px]:col-span-3" : "flex max-w-full items-center gap-2"} triggerClassName={toolbar ? undefined : "w-48 max-w-full"}
      options={[{ value: "all", label: "全部" }, ...options.map((value) => ({ value, label: value === UNKNOWN_SALES_DETAIL ? (channel === "direct" ? "基金公司待核实" : "平台待核实") : channel === "direct" ? value : accountLabel(value) }))]} /> : null}
  </div>;
}
