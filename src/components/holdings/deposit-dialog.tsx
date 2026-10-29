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
import { saveDeposit } from "@/server/ledger/actions";

export function DepositDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rateRaw = String(data.get("rate") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = await saveDeposit({
        bank: String(data.get("bank") ?? ""),
        principal: Number(data.get("principal")),
        rate: rateRaw === "" ? null : Number(rateRaw),
        startDate: String(data.get("startDate") ?? ""),
        maturityDate: String(data.get("maturityDate") ?? ""),
        canPrepay: data.get("canPrepay") === "on",
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
        <QuietButton>新增存款</QuietButton>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>新增存款</DialogTitle>
          </DialogHeader>
          <FormError error={error} />
          <div className="grid gap-2">
            <Label htmlFor="hold-bank">银行</Label>
            <Input id="hold-bank" name="bank" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hold-principal">本金</Label>
            <Input
              id="hold-principal"
              name="principal"
              type="number"
              min="0.01"
              step="any"
              className="font-mono"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hold-rate">年利率</Label>
            <Input id="hold-rate" name="rate" type="number" min="0" step="any" className="font-mono" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="canPrepay" />
            支持提前支取
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="hold-start">起息日</Label>
              <Input id="hold-start" name="startDate" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hold-mat">到期日</Label>
              <Input id="hold-mat" name="maturityDate" type="date" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              保存存款
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
