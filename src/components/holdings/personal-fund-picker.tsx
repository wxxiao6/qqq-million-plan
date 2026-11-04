"use client";

import { formatNav } from "@/lib/format";
import { classifyHoldingFund, HOLDING_FUND_LABELS } from "@/lib/fund-category";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { lookupPersonalFund } from "@/server/funds/actions";
import type { PersonalFund } from "@/server/funds/personal";

export function PersonalFundPicker({ id, options, initialSymbol, selectedSymbol, onSelect, onResolved, onBusy }: {
  id: string; options: Record<string, string>; initialSymbol?: string; selectedSymbol: string;
  onSelect: (code: string) => void; onResolved: (fund: PersonalFund | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(selectedSymbol);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fund, setFund] = useState<PersonalFund | null>(null);
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { ++request.current; }, []);
  const all = Object.entries(options).sort(([a], [b]) => a.localeCompare(b));
  if (initialSymbol && !options[initialSymbol]) all.unshift([initialSymbol, "原持仓基金"]);
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = all.filter(([code, name]) => !normalized || `${code} ${name}`.toLocaleLowerCase().includes(normalized));
  const matches = filtered.slice(0, 8);
  const canQuery = /^\d{6}$/.test(query.trim()) && !options[query.trim()];
  const optionCount = matches.length + (canQuery ? 1 : 0);

  async function choose(code: string) {
    const token = ++request.current;
    setQuery(code); setOpen(false); setError(null); setFund(null);
    onSelect(""); onResolved(null); setBusy(true); onBusy(true);
    try {
      const result = await lookupPersonalFund(code);
      if (token !== request.current) return;
      if (!result.ok) { setError(result.error); return; }
      setFund(result.fund); onResolved(result.fund); onSelect(code);
    } catch { if (token === request.current) setError("基金查询失败，请稍后重试"); }
    finally { if (token === request.current) { setBusy(false); onBusy(false); } }
  }

  if (selectedSymbol) return <div id={id} className="rounded-xl border border-copper/25 bg-copper/5 p-3.5">
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-copper/10 text-copper"><Check className="size-3" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-relaxed">{fund?.name ?? options[selectedSymbol] ?? "原持仓基金"}</p>
        <p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{selectedSymbol}</span> · {HOLDING_FUND_LABELS[classifyHoldingFund(fund?.name ?? options[selectedSymbol] ?? "", fund?.fundType, fund?.isNasdaq)]}</p>
      </div>
      <button type="button" className="shrink-0 rounded-md px-1 py-1 text-xs text-copper underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { ++request.current; onSelect(""); onResolved(null); setFund(null); setQuery(""); setOpen(true); setActiveIndex(0); requestAnimationFrame(() => input.current?.focus()); }}>更换</button>
    </div>
    {fund ? <div className="mt-3 border-t border-copper/15 pt-2.5 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
      {fund.nav != null ? <>最新净值 <span className="font-mono text-foreground">{formatNav(fund.nav)}</span> 元 · {fund.navDate}</> : "净值同步中，保存后自动重试"}
      {fund.navError && fund.nav != null ? <p className="mt-1 text-limit">暂用已公布净值，稍后自动更新。</p> : null}
    </div> : null}
  </div>;

  return <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && !busy} aria-controls={open && !busy ? `${id}-options` : undefined}
      aria-activedescendant={open && !busy && optionCount ? `${id}-option-${Math.min(activeIndex, optionCount - 1)}` : undefined}
      value={query} autoComplete="off" placeholder="输入基金名称或六位代码" required className="h-12 pl-9 pr-10"
      onFocus={() => { if (query) setOpen(true); }} onClick={() => setOpen(true)}
      onChange={(event) => {
        ++request.current; setBusy(false); onBusy(false); setQuery(event.target.value); onSelect(""); onResolved(null);
        setFund(null); setError(null); setActiveIndex(0); setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => open ? Math.min(index + 1, Math.max(0, optionCount - 1)) : 0); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
        if (event.key === "Enter") {
          event.preventDefault();
          if (busy) return;
          if (open && optionCount && activeIndex < matches.length) void choose(matches[activeIndex][0]);
          else if (/^\d{6}$/.test(query.trim()) && !busy) void choose(query.trim());
        }
      }} />
      {busy ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-copper" aria-hidden="true" /> : null}
    </div>
    {open && !busy ? <div id={`${id}-options`} role="listbox" aria-label="基金搜索结果" className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
      <p className="px-3 py-2 text-[11px] text-muted-foreground">{normalized ? `匹配到 ${filtered.length} 只基金${filtered.length > 8 ? "，请继续输入缩小范围" : ""}` : "输入名称或代码，快速查找基金"}</p>
      {matches.map(([code, name], index) => <button key={code} id={`${id}-option-${index}`} type="button" role="option" aria-selected={index === activeIndex}
        onMouseDown={(event) => event.preventDefault()} onClick={() => void choose(code)}
        className={`flex w-full gap-3 rounded-md px-3 py-2 text-left text-sm ${index === activeIndex ? "bg-muted" : "hover:bg-muted/70"}`}>
        <span className="shrink-0 font-mono text-copper">{code}</span><span className="min-w-0 truncate">{name}</span>
      </button>)}
      {canQuery ? <button id={`${id}-option-${matches.length}`} type="button" role="option" aria-selected={activeIndex === matches.length} onMouseDown={(event) => event.preventDefault()} onClick={() => void choose(query.trim())}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-3 text-left text-sm font-medium text-copper ${activeIndex === matches.length ? "bg-muted" : "hover:bg-muted"}`}>
        <Search className="size-4" />查询基金 {query.trim()}
      </button> : !matches.length ? <p className="px-3 py-3 text-sm text-muted-foreground">请输入六位基金代码，从数据源查询。</p> : null}
    </div> : null}
    <div aria-live="polite" className="mt-2 text-xs">
      {busy ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3 animate-spin" />正在查询基金及最新净值…</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}<button type="button" className="ml-2 underline" onClick={() => void choose(query.trim())}>重试</button></p> : null}
      {!busy && !error ? <p className="text-muted-foreground">支持人民币场外基金，列表外基金可输入代码查询。</p> : null}
    </div>
  </div>;
}
