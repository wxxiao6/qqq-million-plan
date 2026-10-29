"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/form-error";
import { QuietButton } from "@/components/holdings/quiet-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveLotHolding } from "@/server/holdings/actions";

export function LotForm({
  exposure,
  hasSettled,
}: {
  exposure: "gold" | "crypto";
  hasSettled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await saveLotHolding({
        exposure,
        symbol: String(data.get("symbol") ?? ""),
        shares: Number(data.get("shares")),
        cost: Number(data.get("cost")),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <QuietButton>新增持仓</QuietButton>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{exposure === "gold" ? "新增黄金持仓" : "新增加密资产持仓"}</DialogTitle>
          </DialogHeader>
          <FormError error={error} />
          {exposure === "crypto" ? (
            <div className="grid gap-2">
              <Label htmlFor="lot-symbol">名称或代码</Label>
              <Input id="lot-symbol" name="symbol" required />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="lot-shares">数量</Label>
              <Input
                id="lot-shares"
                name="shares"
                type="number"
                min="0.01"
                step="0.01"
                className="font-mono"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lot-cost">累计成本</Label>
              <Input
                id="lot-cost"
                name="cost"
                type="number"
                min="0"
                step="0.01"
                className="font-mono"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              保存持仓
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
