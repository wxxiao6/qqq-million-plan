"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteDeposit,
  saveCash,
  saveDeposit,
  saveMortgage,
} from "@/server/ledger/actions";

export function DepositForm({
  initial,
}: {
  initial?: {
    id: number;
    bank: string;
    principal: number;
    rate: number | null;
    startDate: string | null;
    maturityDate: string | null;
    canPrepay: boolean;
  };
}) {
  const router = useRouter();
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
        id: initial?.id,
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
      if (!initial) event.currentTarget.reset();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      {error ? <div className="sm:col-span-2"><FormError error={error} /></div> : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`bank-${initial?.id ?? "new"}`}>银行</Label>
        <Input id={`bank-${initial?.id ?? "new"}`} name="bank" defaultValue={initial?.bank ?? ""} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`principal-${initial?.id ?? "new"}`}>本金</Label>
        <Input
          id={`principal-${initial?.id ?? "new"}`}
          name="principal"
          type="number"
          min="0"
          step="any"
          className="font-mono"
          defaultValue={initial?.principal ?? ""}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`rate-${initial?.id ?? "new"}`}>年利率</Label>
        <Input
          id={`rate-${initial?.id ?? "new"}`}
          name="rate"
          type="number"
          min="0"
          step="any"
          className="font-mono"
          defaultValue={initial?.rate ?? ""}
        />
      </div>
      <label className="flex items-end gap-2 text-sm">
        <input
          type="checkbox"
          name="canPrepay"
          defaultChecked={initial?.canPrepay}
        />
        支持提前支取
      </label>
      <div className="grid gap-1.5">
        <Label htmlFor={`start-${initial?.id ?? "new"}`}>起息日</Label>
        <Input id={`start-${initial?.id ?? "new"}`} name="startDate" type="date" defaultValue={initial?.startDate ?? ""} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`mat-${initial?.id ?? "new"}`}>到期日</Label>
        <Input id={`mat-${initial?.id ?? "new"}`} name="maturityDate" type="date" defaultValue={initial?.maturityDate ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {initial ? "保存修改" : "新增存款"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteDepositButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive"
      onClick={async () => {
        await deleteDeposit(id);
        router.refresh();
      }}
    >
      删除
    </Button>
  );
}

export function MortgageForm({
  initial,
}: {
  initial: {
    remainingPrincipal: number;
    monthlyPayment: number | null;
    remainingTerms: number | null;
    rateType: "fixed" | "floating" | null;
    paymentDay: number | null;
  } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [rateType, setRateType] = useState(initial?.rateType ?? "fixed");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const paymentRaw = String(data.get("paymentDay") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = await saveMortgage({
        remainingPrincipal: Number(data.get("remainingPrincipal")),
        monthlyPayment: Number(data.get("monthlyPayment")) || null,
        remainingTerms: Number(data.get("remainingTerms")) || null,
        rateType: rateType as "fixed" | "floating",
        paymentDay: paymentRaw === "" ? null : Number(paymentRaw),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      {error ? <div className="sm:col-span-2"><FormError error={error} /></div> : null}
      <div className="grid gap-1.5">
        <Label htmlFor="m-remaining">剩余本金</Label>
        <Input
          id="m-remaining"
          name="remainingPrincipal"
          type="number"
          min="0"
          step="any"
          className="font-mono"
          defaultValue={initial?.remainingPrincipal ?? ""}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-pay">月供</Label>
        <Input
          id="m-pay"
          name="monthlyPayment"
          type="number"
          min="0"
          step="any"
          className="font-mono"
          defaultValue={initial?.monthlyPayment ?? ""}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-terms">剩余期数</Label>
        <Input
          id="m-terms"
          name="remainingTerms"
          type="number"
          min="0"
          className="font-mono"
          defaultValue={initial?.remainingTerms ?? ""}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>利率类型</Label>
        <Select
          value={rateType}
          onValueChange={(value) => setRateType(value as "fixed" | "floating")}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">固定</SelectItem>
            <SelectItem value="floating">浮动</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-day">本月还款日</Label>
        <Input
          id="m-day"
          name="paymentDay"
          type="number"
          min="1"
          max="28"
          defaultValue={initial?.paymentDay ?? ""}
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={pending}>
          保存房贷
        </Button>
      </div>
    </form>
  );
}

export function CashAndPrevForm({ cash }: { cash: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const amount = Number(new FormData(event.currentTarget).get("cash"));
          const result = await saveCash(amount);
          if (!result.ok) setError(result.error);
          else router.refresh();
        }}
      >
        <Label htmlFor="cash">现金</Label>
        <Input id="cash" name="cash" type="number" min="0" step="any" className="font-mono" defaultValue={cash || ""} />
        <Button type="submit" size="sm" variant="outline">
          保存现金
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}
