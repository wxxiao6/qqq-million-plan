"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshMarket } from "@/lib/refresh-market";

/** 触发天天基金净值与代销额度刷新；直销额度由外部机器人写入。 */
export function RefreshMarketButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setPending(true);
    setError(null);
    try {
      const result = await refreshMarket();
      router.refresh();
      if (!result.ok) {
        setError(
          result.partial
            ? `部分更新：${result.error ?? "部分份额未更新"}`
            : `更新失败：${result.error ?? result.failed?.[0]?.error ?? "天天基金数据源不可用"}`,
        );
      }
    } catch {
      setError("更新请求失败，已保留最近一次数据");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-loss">{error}</span> : null}
      <Button variant="outline" size="sm" onClick={refresh} disabled={pending}>
        <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
        {pending ? "正在更新净值与额度…" : "更新净值与额度"}
      </Button>
    </div>
  );
}
