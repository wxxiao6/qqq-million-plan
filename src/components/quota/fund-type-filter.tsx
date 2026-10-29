"use client";

import { useRouter } from "next/navigation";
import type { FundSort, SalesChannel } from "@/lib/nasdaq-fund-sort";

export type FundTypeFilterValue = "all" | "nasdaq_100" | "nasdaq_biotech" |
  "nasdaq_technology" | "nasdaq_selected";

type FundTheme = Exclude<FundTypeFilterValue, "all">;

const TYPE_LABELS: Record<FundTheme, string> = {
  nasdaq_100: "纳指 100",
  nasdaq_biotech: "纳指生物科技",
  nasdaq_technology: "纳斯达克科技",
  nasdaq_selected: "纳斯达克精选",
};

export function FundTypeFilter({ selected, channel, usdChannel, sort, availableTypes }: {
  selected: FundTypeFilterValue;
  channel: SalesChannel;
  usdChannel: SalesChannel;
  sort: FundSort;
  availableTypes: FundTheme[];
}) {
  const router = useRouter();

  return <select
    aria-label="筛选基金类型"
    value={selected}
    onChange={(event) => {
      const params = new URLSearchParams({
        channel, usdChannel, sort, type: event.target.value,
      });
      router.push(`/quota?${params}`, { scroll: false });
    }}
    className="h-8 max-w-40 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <option value="all">全部类型</option>
    {availableTypes.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
  </select>;
}
