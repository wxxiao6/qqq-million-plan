"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { FormError } from "@/components/form-error";
import { ACCOUNT_LABELS, type AccountKey, type PositionStatus } from "@/components/labels";
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
import type { Exposure } from "@/server/ledger";

export function PositionForm({
  initial,
  exposure = "nasdaq",
  fundOptions,
  fundManagers,
}: {
  exposure?: Exposure;
  fundOptions?: Record<string, string>;
  fundManagers?: Record<string, string>;
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [channel, setChannel] = useState<"agency" | "direct">(initial?.account === "gf_direct" ? "direct" : "agency");
  const [account, setAccount] = useState(initial?.account === "gf_direct" ? "alipay" : initial?.account ?? "alipay");
  const status = initial?.status ?? "settled";
  const [amounts, setAmounts] = useState({ shares: initial?.shares?.toString() ?? "", cost: initial?.cost.toString() ?? "", unitCost: "" });
  const numericAmounts = Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.trim() === "" ? null : Number(value)]));
  const calculated = resolveHoldingNumbers(numericAmounts);
  const [selectedSymbol, setSelectedSymbol] = useState(initial?.symbol ?? "");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const symbol = fundOptions && exposure === "nasdaq" ? selectedSymbol : String(data.get("symbol") ?? "");
    if (!symbol) {
      setError("请从列表选择基金");
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
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) {
        setAmounts({ shares: initial?.shares?.toString() ?? "", cost: initial?.cost.toString() ?? "", unitCost: "" });
        setSelectedSymbol(initial?.symbol ?? "");
        setChannel(initial?.account === "gf_direct" ? "direct" : "agency");
        setAccount(initial?.account === "gf_direct" ? "alipay" : initial?.account ?? "alipay");
        setError(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant={initial ? "ghost" : "default"} size="sm">
          {initial ? <><Pencil aria-hidden="true" /> <span className="sr-only">编辑持仓</span></> : "新增持仓"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-xl">
        <form onSubmit={onSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{initial ? "编辑持仓" : "新增持仓"}</DialogTitle>
            {!initial && exposure === "nasdaq" ? <p className="text-sm text-muted-foreground">同一购买平台和基金仅保留一组持仓，已有持仓请直接编辑。</p> : null}
          </DialogHeader>
          <FormError error={error} />
          <div className="grid gap-2">
            <Label>购买渠道</Label>
            <div role="group" aria-label="购买渠道" className="grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1">
              {([ ["agency", "代销"], ["direct", "直销"] ] as const).map(([value, label]) =>
                <button key={value} type="button" aria-pressed={channel === value} onClick={() => setChannel(value)}
                  className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${channel === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>)}
            </div>
          </div>
          {channel === "agency" ? <div className="grid gap-2">
            <Label>代销平台</Label>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["alipay", "cmb", "jd", "other"] as const).map((value) =>
                  <SelectItem key={value} value={value}>{ACCOUNT_LABELS[value]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div> : null}
          <div className="grid gap-2">
            <Label htmlFor={`symbol-${initial?.id ?? "new"}`}>基金</Label>
            {fundOptions && exposure === "nasdaq" ?
              <FundCodePicker key={`${initial?.id ?? "new"}-${open}`} id={`symbol-${initial?.id ?? "new"}`} options={fundOptions} initialSymbol={initial?.symbol} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} /> :
              <Input id={`symbol-${initial?.id ?? "new"}`} name="symbol" defaultValue={initial?.symbol ?? ""} placeholder="例如 016452" className="font-mono" required />}
          </div>
          {channel === "direct" ? <div className="grid gap-2">
            <Label htmlFor={`manager-${initial?.id ?? "new"}`}>基金公司</Label>
            <Input id={`manager-${initial?.id ?? "new"}`} value={selectedSymbol ? fundManagers?.[selectedSymbol] ?? "基金公司待核实" : "选择基金后自动显示"} readOnly className="bg-muted/50" />
          </div> : null}
          <section className="grid gap-3 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-medium">持仓数据</p>
              <p className="mt-1 text-xs text-muted-foreground">填写任意两项，系统计算第三项。单价请填持仓成本单价。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {([["cost", "持仓总成本（元）"], ["shares", "持有份额"], ["unitCost", "持仓成本单价（元）"]] as const).map(([key, label]) =>
                <div key={key} className="grid gap-2">
                  <Label htmlFor={`${key}-${initial?.id ?? "new"}`}>{label}</Label>
                  <Input id={`${key}-${initial?.id ?? "new"}`} name={key} type="number" min="0" step="any"
                    value={amounts[key]} onChange={(event) => setAmounts((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder="可留空" className="font-mono" />
                </div>)}
            </div>
            {calculated.ok ? <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-6" aria-live="polite">
              持仓总成本 ¥{calculated.cost.toLocaleString("zh-CN", { maximumFractionDigits: 4 })}
              <span className="mx-2 text-muted-foreground">·</span>
              {calculated.shares.toLocaleString("zh-CN", { maximumFractionDigits: 4 })} 份
              <span className="mx-2 text-muted-foreground">·</span>
              成本单价 ¥{calculated.unitCost.toLocaleString("zh-CN", { maximumFractionDigits: 4 })}
            </div> : null}
          </section>
          <div className="grid gap-2">
            <Label htmlFor={`note-${initial?.id ?? "new"}`}>备注</Label>
            <Input
              id={`note-${initial?.id ?? "new"}`}
              name="note"
              defaultValue={initial?.note ?? ""}
            />
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

function FundCodePicker({ id, options, initialSymbol, selectedSymbol, onSelect }: {
  id: string;
  options: Record<string, string>;
  initialSymbol?: string;
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState(selectedSymbol);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const all = Object.entries(options).sort(([a], [b]) => a.localeCompare(b));
  if (initialSymbol && !options[initialSymbol]) all.unshift([initialSymbol, "原持仓基金"]);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = all.filter(([code, name]) => !normalized || `${code} ${name}`.toLocaleLowerCase().includes(normalized));

  function choose(code: string) {
    onSelect(code);
    setQuery(code);
    setOpen(false);
    setActiveIndex(0);
  }

  return <div className="relative" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Input
      id={id}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={`${id}-options`}
      aria-activedescendant={open && matches.length ? `${id}-option-${Math.min(activeIndex, matches.length - 1)}` : undefined}
      value={query}
      onChange={(event) => { setQuery(event.target.value); onSelect(""); setActiveIndex(0); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, matches.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && open && matches.length) { event.preventDefault(); choose(matches[Math.min(activeIndex, matches.length - 1)][0]); }
      }}
      placeholder="输入基金代码或名称搜索"
      autoComplete="off"
      required
    />
    {selectedSymbol ? <p className="mt-1 text-xs text-muted-foreground">已选择：{selectedSymbol} {options[selectedSymbol] ?? "原持仓基金"}</p> : null}
    {open ? <div id={`${id}-options`} role="listbox" aria-label="基金搜索结果" className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
      {matches.length ? matches.map(([code, name], index) =>
        <button key={code} id={`${id}-option-${index}`} type="button" role="option" aria-selected={code === selectedSymbol}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(code)}
          className={`flex w-full gap-3 rounded-md px-3 py-2 text-left text-sm ${index === activeIndex ? "bg-muted" : "hover:bg-muted/70"}`}>
          <span className="shrink-0 font-mono text-copper">{code}</span><span className="min-w-0 truncate">{name}</span>
        </button>) : <p className="px-3 py-3 text-sm text-muted-foreground">未找到匹配基金</p>}
    </div> : null}
  </div>;
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
