import type { PersonalQuota } from "@/lib/personal-quota";

export function PersonalQuotaEstimate({ value }: { value: PersonalQuota }) {
  const money = (amount: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: value.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return <div className="space-y-1.5 whitespace-nowrap">
    {value.state === "ready" ? <p className={`font-mono text-sm font-semibold tabular-nums ${value.excess ? "text-limit" : "text-foreground"}`}
      title={value.excess ? `今日计划超额 ${money(value.excess)}` : value.shared ? "与其他份额或渠道共用额度" : undefined}>
      {money(value.remaining ?? 0)}
    </p> : <p className="text-sm text-muted-foreground">{value.state === "paused" ? "暂停申购" : "暂无法计算"}</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">
      已记录 {money(value.recorded)} · 待执行 {money(value.scheduled)}
    </p>
  </div>;
}
