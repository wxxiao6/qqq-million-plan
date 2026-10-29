"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ASSET_TYPE_LABELS, type AssetType } from "@/lib/holdings";
import { QuietButton } from "@/components/holdings/quiet-button";
import { enableAssetType } from "@/server/holdings/actions";
import { cn } from "@/lib/utils";

export function AddAssetControl({
  remaining,
  weak = false,
}: {
  remaining: AssetType[];
  weak?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (remaining.length === 0) return null;

  async function pick(type: AssetType) {
    setPending(true);
    try {
      const result = await enableAssetType(type);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn(weak && "text-sm")}>
      {open ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {remaining.map((type) => (
            <button
              key={type}
              type="button"
              disabled={pending}
              onClick={() => pick(type)}
              className="text-[15px] text-copper/80 hover:text-copper disabled:opacity-50"
            >
              {ASSET_TYPE_LABELS[type]}
            </button>
          ))}
          <button
            type="button"
            className="text-[15px] text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            取消
          </button>
        </div>
      ) : (
        <QuietButton
          className={weak ? "text-sm text-muted-foreground hover:text-copper" : undefined}
          onClick={() => setOpen(true)}
        >
          添加资产
        </QuietButton>
      )}
    </div>
  );
}
