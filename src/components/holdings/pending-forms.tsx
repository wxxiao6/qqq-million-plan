"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_LABELS } from "@/components/labels";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayISO } from "@/lib/format";
import type { DcaPlanView } from "@/lib/dca";
import { addPendingSubscription, finishPendingSubscription } from "@/server/ledger/actions";
import type { Account, CutoffPeriod } from "@/server/ledger";

export function PendingSubscriptionForm({ names, plans }: { names: Record<string, string>; plans: DcaPlanView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<Account>("alipay");
  const [planId, setPlanId] = useState("");
  const options = Object.entries(names).filter(([code, name]) => `${code} ${name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  const availablePlans = plans.filter((plan) => plan.symbol === symbol && plan.account === account && plan.status !== "ended");
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline">补录待确认申购</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <form className="grid gap-4" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError(null);
        const data = new FormData(event.currentTarget);
        try {
          const result = await addPendingSubscription({
            symbol, account, executionOn: String(data.get("executionOn")),
            cutoffPeriod: String(data.get("cutoffPeriod")) as CutoffPeriod,
            cashDebited: Number(data.get("cashDebited")), feeAmount: Number(data.get("feeAmount") || 0),
            dcaPlanId: planId ? Number(planId) : null,
            note: String(data.get("note") || ""),
          });
          if (!result.ok) { setError(result.error); return; }
          setOpen(false); router.refresh();
        } finally { setBusy(false); }
      }}>
        <DialogHeader><DialogTitle>补录待确认申购</DialogTitle></DialogHeader>
        <FormError error={error} />
        <div className="grid gap-2"><Label htmlFor="pending-fund">基金名称或代码</Label>
          <Input id="pending-fund" value={query} onChange={(event) => { setQuery(event.target.value); setSymbol(""); setPlanId(""); }} placeholder="搜索人民币纳指基金" />
          {symbol ? <p className="text-xs text-muted-foreground">已选 {names[symbol]}（{symbol}）</p> : null}
          {!symbol && query ? <div className="max-h-36 overflow-y-auto rounded-lg border">{options.map(([code, name]) => <button key={code} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setSymbol(code); setQuery(`${name}（${code}）`); }}>{name}（{code}）</button>)}</div> : null}
        </div>
        <div className="grid gap-2"><Label htmlFor="pending-account">基金公司或代销平台</Label><select id="pending-account" className="h-10 rounded-md border bg-background px-3" value={account} onChange={(event) => { setAccount(event.target.value as Account); setPlanId(""); }}>{Object.entries(ACCOUNT_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="pending-date">实际申购日期</Label><Input id="pending-date" name="executionOn" type="date" defaultValue={todayISO()} required /></div>
        <div className="grid gap-2"><Label htmlFor="pending-cutoff">申请受理时间</Label><select id="pending-cutoff" name="cutoffPeriod" className="h-10 rounded-md border bg-background px-3" required defaultValue=""><option value="" disabled>请选择</option><option value="before_15">15:00 前</option><option value="after_15">15:00 后</option></select></div>
        <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor="pending-cash">实际扣款金额</Label><Input id="pending-cash" name="cashDebited" type="number" min="0.01" step="any" required /></div><div className="grid gap-2"><Label htmlFor="pending-fee">手续费</Label><Input id="pending-fee" name="feeAmount" type="number" min="0" step="any" defaultValue="0" /></div></div>
        {availablePlans.length ? <div className="grid gap-2"><Label htmlFor="pending-plan">关联定投计划（可选）</Label><select id="pending-plan" className="h-10 rounded-md border bg-background px-3" value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">不关联</option>{availablePlans.map((plan) => <option key={plan.id} value={plan.id}>计划 #{plan.id} · {plan.frequencyLabel} ¥{plan.amount}</option>)}</select></div> : null}
        <div className="grid gap-2"><Label htmlFor="pending-note">备注（可选）</Label><Input id="pending-note" name="note" /></div>
        <p className="text-xs text-muted-foreground">确认份额前按实际扣款金额计入待确认，收益显示待确认。</p>
        <DialogFooter><Button disabled={busy || !symbol} type="submit">保存待确认申购</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function ResolvePendingForm({ id, executionOn, cutoffPeriod }: { id: number; executionOn: string | null; cutoffPeriod: CutoffPeriod | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline">处理待确认</Button></DialogTrigger>
    <DialogContent><form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null);
      const data = new FormData(event.currentTarget);
      try {
        const result = await finishPendingSubscription({ id, outcome: "settled", shares: Number(data.get("shares")), tDate: String(data.get("tDate")), confirmedOn: String(data.get("confirmedOn")), executionOn: executionOn ?? String(data.get("executionOn")), cutoffPeriod: cutoffPeriod ?? String(data.get("cutoffPeriod")) as CutoffPeriod });
        if (!result.ok) { setError(result.error); return; }
        setOpen(false); router.refresh();
      } finally { setBusy(false); }
    }}>
      <DialogHeader><DialogTitle>确认申购份额</DialogTitle></DialogHeader><FormError error={error} />
      {!executionOn ? <div className="grid gap-2"><Label htmlFor={`execution-${id}`}>实际申购日期</Label><Input id={`execution-${id}`} name="executionOn" type="date" required /></div> : null}
      {!cutoffPeriod ? <div className="grid gap-2"><Label htmlFor={`cutoff-${id}`}>申请受理时间</Label><select id={`cutoff-${id}`} name="cutoffPeriod" className="h-10 rounded-md border bg-background px-3" defaultValue="" required><option value="" disabled>请选择</option><option value="before_15">15:00 前</option><option value="after_15">15:00 后</option></select></div> : null}
      <div className="grid gap-2"><Label htmlFor={`shares-${id}`}>确认份额</Label><Input id={`shares-${id}`} name="shares" type="number" min="0.000001" step="any" required /></div>
      <div className="grid gap-2"><Label htmlFor={`t-date-${id}`}>基金确认的 T 日</Label><Input id={`t-date-${id}`} name="tDate" type="date" required /></div>
      <div className="grid gap-2"><Label htmlFor={`confirm-date-${id}`}>份额确认日期</Label><Input id={`confirm-date-${id}`} name="confirmedOn" type="date" required /></div>
      <DialogFooter><Button type="submit" disabled={busy}>确认份额</Button></DialogFooter>
      <div className="flex gap-2 border-t pt-3">{([ ["failed", "申购失败"], ["cancelled", "已撤单"] ] as const).map(([outcome, label]) => <Button key={outcome} type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true); const result = await finishPendingSubscription({ id, outcome }); setBusy(false);
        if (!result.ok) setError(result.error); else { setOpen(false); router.refresh(); }
      }}>{label}</Button>)}</div>
    </form></DialogContent>
  </Dialog>;
}
