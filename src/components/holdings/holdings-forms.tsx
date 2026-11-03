"use client";

import { PersonalFundPicker } from "./personal-fund-picker";
import type { PersonalFund } from "@/server/funds/personal";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, Check, ChevronDown, Loader2, Pencil, Trash2 } from "lucide-react";
import { FormError } from "@/components/form-error";
import { ACCOUNT_LABELS, type AccountKey, type PositionStatus } from "@/components/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayISO } from "@/lib/format";
import { resolveHoldingNumbers } from "@/lib/holding-input";
import { notifySaved } from "@/lib/notify";
import {
  deletePosition,
  importNavCsv,
  importPositionsCsv,
  saveNav,
  savePortfolioSnapshot,
  savePosition,
} from "@/server/ledger/actions";
import type { Exposure, Position } from "@/server/ledger";

const ENTRY_MODES = {
  price: { label: "持仓单价 + 份额", fields: ["unitCost", "shares"], computed: "cost" },
  total: { label: "总成本 + 份额", fields: ["cost", "shares"], computed: "unitCost" },
  shares: { label: "总成本 + 持仓单价", fields: ["cost", "unitCost"], computed: "shares" },
} as const;
type EntryMode = keyof typeof ENTRY_MODES;
const AMOUNT_LABELS = { cost: "持仓总成本", shares: "持有份额", unitCost: "持仓单价" };

export function PositionForm({
  initial,
  exposure = "nasdaq",
  fundOptions,
  fundManagers,
  existingPositions = [],
}: {
  exposure?: Exposure;
  fundOptions?: Record<string, string>;
  fundManagers?: Record<string, string>;
  existingPositions?: Pick<Position, "id" | "account" | "symbol" | "status" | "dcaPlanId">[];
  initial?: {
    id: number;
    account: string;
    symbol: string;
    shares: number | null;
    cost: number;
    status: string;
    note: string | null;
    exposure?: Exposure;
  };
}) {
  const router = useRouter();
  const initialEntryMode: EntryMode = initial && !(initial.shares && initial.shares > 0) ? "total" : "price";
  const initialAmounts = { shares: initial?.shares?.toString() ?? "", cost: initial?.cost.toString() ?? "", unitCost: initial?.shares && initial.shares > 0 ? String(initial.cost / initial.shares) : "" };
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>(initialEntryMode);
  const [showNote, setShowNote] = useState(Boolean(initial?.note));
  const revealHolding = useRef<string | null>(null);
  const [channel, setChannel] = useState<"agency" | "direct">(initial?.account === "gf_direct" ? "direct" : "agency");
  const [account, setAccount] = useState(initial?.account === "gf_direct" ? "alipay" : initial?.account ?? "alipay");
  const status = initial?.status ?? "settled";
  const [amounts, setAmounts] = useState(initialAmounts);
  const fields = ENTRY_MODES[entryMode].fields;
  const computedKey = ENTRY_MODES[entryMode].computed;
  const numericAmounts = Object.fromEntries(fields.map((key) => [key, amounts[key].trim() === "" ? null : Number(amounts[key])]));
  const calculated = resolveHoldingNumbers(numericAmounts);
  const hasBothAmounts = fields.every((key) => amounts[key].trim() !== "");
  const [selectedFund, setSelectedFund] = useState<PersonalFund | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(initial?.symbol ?? "");
  const selectedAccount = channel === "direct" ? "gf_direct" : account;
  const duplicateRows = selectedSymbol ? existingPositions.filter((position) => position.id !== initial?.id && position.symbol === selectedSymbol && position.account === selectedAccount && (position.status === "settled" || position.status === "pending")) : [];
  const duplicate = duplicateRows.find((position) => position.status === "settled" && position.dcaPlanId == null) ?? duplicateRows.find((position) => position.dcaPlanId != null) ?? duplicateRows[0];
  const platformName = channel === "direct" ? selectedFund?.manager ?? fundManagers?.[selectedSymbol] ?? "基金公司" : ACCOUNT_LABELS[account as AccountKey];
  const formId = `position-${initial?.id ?? "new"}`;

  function changeEntryMode(mode: EntryMode) {
    if (calculated.ok) setAmounts({ shares: String(calculated.shares), cost: String(calculated.cost), unitCost: String(calculated.unitCost) });
    setEntryMode(mode);
    setError(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || lookupBusy || duplicate) return;
    const data = new FormData(event.currentTarget);
    const symbol = fundOptions && (exposure === "nasdaq" || exposure === "fund") ? selectedSymbol : String(data.get("symbol") ?? "");
    if (!symbol) {
      setError("请先查询并选择基金");
      return;
    }
    if (!calculated.ok) { setError(calculated.error); return; }
    setPending(true);
    setError(null);
    try {
      const result = await savePosition({
        id: initial?.id,
        account: (channel === "direct" ? "gf_direct" : account) as AccountKey,
        exposure: initial?.exposure ?? exposure,
        symbol,
        ...numericAmounts,
        status: status as PositionStatus,
        note: String(data.get("note") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setOpen(false);
      notifySaved("持仓已保存");
    } catch {
      setError("暂时无法保存，填写的内容已保留，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (pending) return;
      setOpen(next);
      if (next) {
        setAmounts(initialAmounts);
        setSelectedSymbol(initial?.symbol ?? "");
        setSelectedFund(null); setLookupBusy(false);
        setChannel(initial?.account === "gf_direct" ? "direct" : "agency");
        setAccount(initial?.account === "gf_direct" ? "alipay" : initial?.account ?? "alipay");
        setError(null);
        setEntryMode(initialEntryMode);
        setShowNote(Boolean(initial?.note));
      }
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant={initial ? "ghost" : "default"} size="sm">
          {initial ? <><Pencil aria-hidden="true" /> <span className="sr-only">编辑持仓</span></> : "新增持仓"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-xl" onCloseAutoFocus={(event) => {
        if (!revealHolding.current) return;
        const target = document.getElementById(`holding-${revealHolding.current}`);
        revealHolding.current = null;
        if (target instanceof HTMLDetailsElement) {
          event.preventDefault();
          target.open = true;
          target.querySelector("summary")?.focus();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }}>
        <form onSubmit={onSubmit} className="flex max-h-[90dvh] min-h-0 flex-col" aria-busy={pending}>
          <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
            <DialogTitle>{initial ? "编辑持仓" : "新增持仓"}</DialogTitle>
            <DialogDescription>从购买平台复制已确认持仓，填写两项数据即可。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
          <fieldset disabled={pending} className="min-w-0 space-y-6">
          <section className="grid gap-3" aria-labelledby={`${formId}-fund-title`}>
            <EntrySectionTitle id={`${formId}-fund-title`} number="01" title="选择基金" />
            <Label htmlFor={`symbol-${initial?.id ?? "new"}`} className="sr-only">基金名称或代码</Label>
            {fundOptions && (exposure === "nasdaq" || exposure === "fund") ?
              <PersonalFundPicker key={`${initial?.id ?? "new"}-${open}`} id={`symbol-${initial?.id ?? "new"}`} options={fundOptions} initialSymbol={initial?.symbol} selectedSymbol={selectedSymbol} onSelect={(symbol) => { setSelectedSymbol(symbol); setError(null); }} onResolved={setSelectedFund} onBusy={setLookupBusy} /> :
              <Input id={`symbol-${initial?.id ?? "new"}`} name="symbol" value={selectedSymbol} onChange={(event) => { setSelectedSymbol(event.target.value.trim()); setError(null); }} placeholder="例如 016452" className="font-mono" required />}
          </section>
          <section className="grid gap-3" aria-labelledby={`${formId}-platform-title`}>
            <EntrySectionTitle id={`${formId}-platform-title`} number="02" title="在哪里购买" />
            <div role="group" aria-label="购买渠道" className="grid grid-cols-2 gap-2">
              {([["agency", "第三方平台", "支付宝、银行等"], ["direct", "基金公司直购", "基金公司 App / 官网"]] as const).map(([value, label, hint]) =>
                <button key={value} type="button" disabled={pending} aria-pressed={channel === value} onClick={() => { setChannel(value); setError(null); }}
                  className={`relative min-w-0 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${channel === value ? "border-copper bg-copper/5" : "border-border hover:bg-muted/40"}`}>
                  <span className="block pr-4 text-sm font-medium">{label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
                  {channel === value ? <Check className="absolute right-3 top-3.5 size-3.5 text-copper" aria-hidden="true" /> : null}
                </button>)}
            </div>
            {channel === "agency" ? <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
              <Label htmlFor={`${formId}-platform`}>购买平台</Label>
              <Select value={account} onValueChange={(value) => { setAccount(value); setError(null); }} disabled={pending}>
                <SelectTrigger id={`${formId}-platform`} className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{(["alipay", "cmb", "jd", "other"] as const).map((value) => <SelectItem key={value} value={value}>{ACCOUNT_LABELS[value]}</SelectItem>)}</SelectContent>
              </Select>
            </div> : <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">{selectedSymbol ? platformName : "选择基金后，自动匹配所属基金公司。"}</p>}
            {duplicate ? <div role="status" className="rounded-xl border border-copper/25 bg-copper/5 px-3 py-3 text-sm leading-relaxed">
              <p className="font-medium">{platformName}已有这只基金的{duplicate.dcaPlanId != null ? "定投记录" : duplicate.status === "pending" ? "待确认申购" : "持仓"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{duplicate.dcaPlanId != null ? "请在定投管理中调整执行记录，避免重复计入资产。" : duplicate.status === "pending" ? "请处理原有申购记录，无需再次新增。" : "请编辑原有持仓，更新总成本和份额。"}</p>
              {duplicate.dcaPlanId != null ? <a href="/dca" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-copper underline underline-offset-4">前往定投管理<ArrowRight className="size-3" /></a> : <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-copper underline underline-offset-4" onClick={() => { revealHolding.current = selectedSymbol; setOpen(false); }}>查看已有记录<ArrowRight className="size-3" /></button>}
            </div> : null}
          </section>
          <section className="grid gap-3" aria-labelledby={`${formId}-amounts-title`}>
            <EntrySectionTitle id={`${formId}-amounts-title`} number="03" title="填写持仓" />
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-entry-mode`} className="text-xs text-muted-foreground">选择手头已有的数据</Label>
              <Select value={entryMode} onValueChange={(value) => changeEntryMode(value as EntryMode)} disabled={pending}>
                <SelectTrigger id={`${formId}-entry-mode`} className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ENTRY_MODES).map(([key, mode]) => <SelectItem key={key} value={key}>{mode.label}{key === "price" ? "（推荐）" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 min-[400px]:grid-cols-2">
              {fields.map((key) => <div key={key} className="grid min-w-0 gap-2">
                <Label htmlFor={`${key}-${initial?.id ?? "new"}`}>{AMOUNT_LABELS[key]}<span className="font-normal text-muted-foreground">{key === "shares" ? "（份）" : key === "unitCost" ? "（元/份）" : "（元）"}</span></Label>
                <Input id={`${key}-${initial?.id ?? "new"}`} name={key} type="number" min={key === "shares" ? "0.0001" : "0"} step="any" inputMode="decimal" required
                  value={amounts[key]} onChange={(event) => { setAmounts((current) => ({ ...current, [key]: event.target.value })); setError(null); }}
                  aria-invalid={hasBothAmounts && !calculated.ok} aria-describedby={`${formId}-amounts-help`} placeholder={key === "shares" ? "例如 1000.00" : key === "cost" ? "例如 2000.00" : "例如 2.0000"} className="h-12 rounded-xl bg-background/50 font-mono text-lg md:text-lg" />
              </div>)}
            </div>
            <p id={`${formId}-amounts-help`} className="text-xs leading-relaxed text-muted-foreground">{entryMode === "total" ? "总成本为买入成本，不是当前市值。" : "持仓单价请填写平台显示的持仓成本价，不是最新净值。"}</p>
            <div aria-live="polite" aria-atomic="true" className={`flex min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-3 ${hasBothAmounts && !calculated.ok ? "bg-destructive/5" : "bg-muted/50"}`}>
              {hasBothAmounts && !calculated.ok ? <p role="alert" className="text-xs text-destructive">{calculated.error}</p> : <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Calculator className="size-4 shrink-0" aria-hidden="true" /><span>{AMOUNT_LABELS[computedKey]}<span className="mt-0.5 block text-[11px]">自动计算</span></span></div>
                <output className="min-w-0 break-all text-right font-mono text-base font-semibold">{calculated.ok ? `${computedKey === "shares" ? "" : "¥"}${calculated[computedKey].toLocaleString("zh-CN", { minimumFractionDigits: computedKey === "unitCost" ? 4 : 2, maximumFractionDigits: 4 })}${computedKey === "shares" ? " 份" : computedKey === "unitCost" ? " / 份" : ""}` : "—"}</output>
              </>}
            </div>
          </section>
          <div className="grid gap-2">
            <button type="button" aria-expanded={showNote} aria-controls={`${formId}-note`} onClick={() => setShowNote(!showNote)} className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronDown className={`size-3.5 transition-transform ${showNote ? "rotate-180" : ""}`} aria-hidden="true" />{showNote ? "备注（选填）" : "添加备注（选填）"}</button>
            <div id={`${formId}-note`} hidden={!showNote}><Label className="sr-only" htmlFor={`note-${initial?.id ?? "new"}`}>备注</Label><Input id={`note-${initial?.id ?? "new"}`} name="note" defaultValue={initial?.note ?? ""} placeholder="例如：从支付宝导入的现有持仓" className="h-11" /></div>
          </div>
          </fieldset>
          </div>
          <div className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4 sm:px-6">
            <FormError error={error} />
            <DialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:flex">
              <p className="hidden flex-1 text-xs text-muted-foreground sm:block">{duplicate ? "请先处理已有记录" : selectedSymbol ? <>保存至 <span className="text-foreground">{platformName}</span></> : "先选基金，再填写持仓"}</p>
              <Button type="button" variant="outline" className="h-11 px-5" disabled={pending} onClick={() => setOpen(false)}>取消</Button>
              <Button type="submit" className="h-11 px-6" disabled={pending || lookupBusy || Boolean(duplicate) || !selectedSymbol || !calculated.ok}>
                {pending ? <><Loader2 className="size-4 animate-spin" />保存中…</> : lookupBusy ? "查询基金中…" : initial ? "保存修改" : "保存持仓"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntrySectionTitle({ id, number, title }: { id: string; number: string; title: string }) {
  return <h3 id={id} className="flex items-center gap-2.5 text-sm font-semibold"><span className="font-mono text-[11px] font-medium text-copper">{number}</span>{title}</h3>;
}

export function DeletePositionButton({ id, isDcaExecution = false }: { id: number; isDcaExecution?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="删除持仓" title="删除持仓">
          <Trash2 aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>删除这笔持仓？</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">删除后无法恢复。{isDcaExecution ? "对应的定投记账记录也会移除。" : ""}</p>
        <FormError error={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={async () => {
            setPending(true);
            try {
              const result = await deletePosition(id);
              if (result.ok) { setOpen(false); router.refresh(); }
              else setError(result.error);
            } finally { setPending(false); }
          }}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NavForm({ defaultSymbol = "016452" }: { defaultSymbol?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await saveNav({
        symbol: String(data.get("symbol") ?? ""),
        asOf: String(data.get("asOf") ?? ""),
        nav: Number(data.get("nav")),
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
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      {error ? <div className="sm:col-span-4"><FormError error={error} /></div> : null}
      <div className="grid gap-1.5">
        <Label htmlFor="nav-symbol">代码</Label>
        <Input id="nav-symbol" name="symbol" defaultValue={defaultSymbol} className="font-mono" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nav-asof">净值日</Label>
        <Input id="nav-asof" name="asOf" type="date" defaultValue={todayISO()} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nav-nav">单位净值</Label>
        <Input id="nav-nav" name="nav" type="number" min="0" step="0.0001" className="font-mono" required />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          保存净值
        </Button>
      </div>
    </form>
  );
}

export function SnapshotForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await savePortfolioSnapshot({
        asOf: String(data.get("asOf") ?? ""),
        dynamicMv: Number(data.get("dynamicMv")),
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

  const yesterday = todayISO();
  const [y, m, d] = yesterday.split("-").map(Number);
  const prior = new Date(y, m - 1, d - 1);
  const priorIso = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}-${String(prior.getDate()).padStart(2, "0")}`;

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
      {error ? <div className="sm:col-span-3"><FormError error={error} /></div> : null}
      <div className="grid gap-1.5">
        <Label htmlFor="snap-asof">快照日</Label>
        <Input id="snap-asof" name="asOf" type="date" defaultValue={priorIso} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="snap-mv">当日动态市值</Label>
        <Input id="snap-mv" name="dynamicMv" type="number" min="0" step="any" className="font-mono" required />
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="outline" disabled={pending}>
          手造快照
        </Button>
      </div>
    </form>
  );
}

export function CsvImport({
  kind,
}: {
  kind: "positions" | "nav";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const csv = String(new FormData(event.currentTarget).get("csv") ?? "");
    setPending(true);
    setError(null);
    try {
      const result =
        kind === "positions" ? await importPositionsCsv(csv) : await importNavCsv(csv);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      event.currentTarget.reset();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormError error={error} />
      <Label htmlFor={`csv-${kind}`}>
        {kind === "positions"
          ? "持仓 CSV（account,symbol,shares,cost,status）"
          : "净值 CSV（symbol,as_of,nav）"}
      </Label>
      <Textarea
        id={`csv-${kind}`}
        name="csv"
        rows={4}
        required
        className="min-h-20 font-mono text-sm"
        placeholder={
          kind === "positions"
            ? "alipay,016452,1000,8000,settled"
            : "016452,2026-08-26,1.2345"
        }
      />
      <div>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          导入
        </Button>
      </div>
    </form>
  );
}
