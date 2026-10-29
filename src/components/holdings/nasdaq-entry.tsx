"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/form-error";
import { QuietButton } from "@/components/holdings/quiet-button";
import { CHANNEL_LABELS } from "@/components/labels";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NasdaqFundLookup } from "@/server/holdings/lookup";
import { lookupNasdaqFund, saveNasdaqHolding } from "@/server/holdings/actions";

export function NasdaqEntry({ hasSettled }: { hasSettled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [looking, setLooking] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [fund, setFund] = useState<NasdaqFundLookup | null>(null);
  const [channel, setChannel] = useState<"direct" | "agency">("agency");
  const [platform, setPlatform] = useState("alipay");
  const [shares, setShares] = useState("");
  const [unitCost, setUnitCost] = useState("");

  async function lookup(code: string) {
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      setFund(null);
      setError(null);
      return;
    }
    setLooking(true);
    setError(null);
    try {
      const result = await lookupNasdaqFund(trimmed);
      if (!result.ok) {
        setFund(null);
        setError(result.error);
        return;
      }
      setFund(result.fund);
      const nextChannel =
        result.fund.hasDirect && result.fund.hasAgency
          ? "agency"
          : result.fund.hasAgency
            ? "agency"
            : "direct";
      setChannel(nextChannel);
      if (nextChannel === "direct") setPlatform("gf_direct");
    } finally {
      setLooking(false);
    }
  }

  function changeChannel(next: "direct" | "agency") {
    setChannel(next);
    if (next === "direct") setPlatform("gf_direct");
    else if (platform !== "alipay" && platform !== "cmb") setPlatform("alipay");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fund || looking) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await saveNasdaqHolding({
        symbol: fund.symbol,
        channelKind: channel,
        platform: channel === "direct" ? "gf_direct" : platform,
        shares: Number(data.get("shares")),
        unitCost: Number(data.get("unitCost")),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setOpen(false);
      setSymbol("");
      setFund(null);
      setShares("");
      setUnitCost("");
    } finally {
      setPending(false);
    }
  }

  const both = fund?.hasDirect && fund?.hasAgency;
  const saveDisabled = pending || looking || !fund;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setFund(null);
          setSymbol("");
          setShares("");
          setUnitCost("");
        }
      }}
    >
      <DialogTrigger asChild>
        <QuietButton>新增持仓</QuietButton>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>新增纳指持仓</DialogTitle>
          </DialogHeader>
          <FormError error={error} />
          <div className="grid gap-2">
            <Label htmlFor="nasdaq-symbol">基金代码</Label>
            <Input
              id="nasdaq-symbol"
              name="symbol"
              value={symbol}
              onChange={(event) => {
                const value = event.target.value;
                setSymbol(value);
                if (value.trim().length >= 6) void lookup(value);
              }}
              onBlur={() => lookup(symbol)}
              className="font-mono"
              required
            />
            {looking ? (
              <p className="text-xs text-muted-foreground">正在查询基金信息…</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label>基金名称</Label>
            <p className="text-sm">{fund?.name ?? "—"}</p>
          </div>
          {fund && both ? (
            <div className="grid gap-2">
              <Label>交易渠道</Label>
              <Select
                value={channel}
                onValueChange={(value) => changeChannel(value as "direct" | "agency")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : fund ? (
            <div className="grid gap-2">
              <Label>交易渠道</Label>
              <p className="text-sm">{CHANNEL_LABELS[channel]}</p>
            </div>
          ) : null}
          {fund && channel === "agency" ? (
            <div className="grid gap-2">
              <Label>交易平台</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择平台" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alipay">支付宝</SelectItem>
                  <SelectItem value="cmb">招行</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : fund && channel === "direct" ? (
            <div className="grid gap-2">
              <Label>交易平台</Label>
              <p className="text-sm">基金公司直销</p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="nasdaq-shares">持仓份额</Label>
              <Input
                id="nasdaq-shares"
                name="shares"
                type="number"
                min="0.01"
                step="0.01"
                value={shares}
                onChange={(event) => setShares(event.target.value)}
                className="font-mono"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nasdaq-unit-cost">单位成本</Label>
              <Input
                id="nasdaq-unit-cost"
                name="unitCost"
                type="number"
                min="0"
                step="0.0001"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                className="font-mono"
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            预计累计成本：{formatCalculatedCost(shares, unitCost)}（持有份额 × 单位成本）
          </p>
          <DialogFooter>
            <Button type="submit" disabled={saveDisabled}>
              保存持仓
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatCalculatedCost(shares: string, unitCost: string) {
  const total = Number(shares) * Number(unitCost);
  if (!Number.isFinite(total) || !shares || !unitCost) return "—";
  return `¥${total.toLocaleString("zh-CN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
}
