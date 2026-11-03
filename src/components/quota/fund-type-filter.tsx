"use client";

import { useRouter } from "next/navigation";
import { FilterSelect } from "@/components/filter-select";
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

  return <FilterSelect<FundTypeFilterValue>
    label="筛选基金类型"
    hideLabel
    value={selected}
    onValueChange={(value) => {
      const params = new URLSearchParams({
        channel, usdChannel, sort, type: value,
      });
      router.push(`/quota?${params}`, { scroll: false });
    }}
    className="w-40 max-w-full"
    triggerClassName="data-[size=default]:h-8 rounded-md px-2.5 text-xs font-medium"
    options={[{ value: "all", label: "全部类型" }, ...availableTypes.map((type) => ({ value: type, label: TYPE_LABELS[type] }))]}
  />;
}
