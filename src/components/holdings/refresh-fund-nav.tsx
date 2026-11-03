"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { lookupPersonalFund } from "@/server/funds/actions";

export function RefreshFundNav({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <div className="text-xs" aria-live="polite">
    <button type="button" disabled={busy} className="font-medium text-copper underline underline-offset-4 disabled:opacity-50" onClick={async () => {
      setBusy(true); setError(null);
      try {
        const result = await lookupPersonalFund(code);
        if (!result.ok) setError(result.error);
        else { setError(result.fund.navError); router.refresh(); }
      } catch { setError("暂时无法更新，请稍后重试"); }
      finally { setBusy(false); }
    }}>{busy ? "更新中…" : "重试净值更新"}</button>
    {error ? <span className="ml-2 text-muted-foreground">{error}</span> : null}
  </div>;
}
