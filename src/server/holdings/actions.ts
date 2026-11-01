"use server";

import { requireUser } from "@/server/auth/context";
import { revalidatePath } from "next/cache";
import { GOLD_SYMBOL, isAssetType, type AssetType } from "@/lib/holdings";
import type { Account } from "@/server/ledger";
import { writeAutoNav } from "@/server/ledger";
import { savePosition } from "@/server/ledger/actions";
import { enableAssetTypeSync } from "./index";
import { lookupNasdaqFundSync } from "./lookup";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function enableAssetType(type: string): Promise<ActionResult> {
  await requireUser();
  if (!isAssetType(type)) return { ok: false, error: "类型不合法" };
  enableAssetTypeSync(type as AssetType);
  revalidatePath("/holdings");
  revalidatePath("/holdings/overview");
  return { ok: true };
}

export async function lookupNasdaqFund(symbol: string) {
  await requireUser();
  const found = lookupNasdaqFundSync(symbol);
  if (!found) return { ok: false as const, error: "找不到这只" };
  return { ok: true as const, fund: found };
}

function accountForChannel(
  channelKind: "direct" | "agency",
  platform: string,
): {
  ok: true; account: Account } | { ok: false; error: string } {
  if (channelKind === "direct") {
    return { ok: true, account: "gf_direct" };
  }
  if (platform === "alipay" || platform === "cmb" || platform === "jd" || platform === "other") {
    return { ok: true, account: platform };
  }
  return { ok: false, error: "请选择代销账户" };
}

export async function saveNasdaqHolding(input: {
  symbol: string;
  channelKind: "direct" | "agency";
  platform: string;
  shares: number;
  unitCost: number;
}): Promise<ActionResult> {
  await requireUser();
  const found = lookupNasdaqFundSync(input.symbol);
  if (!found) return { ok: false, error: "找不到这只" };
  if (input.channelKind !== "direct" && input.channelKind !== "agency") {
    return { ok: false, error: "渠道不合法" };
  }
  if (input.channelKind === "direct" && !found.hasDirect) {
    return { ok: false, error: "这只没有直销渠道" };
  }
  if (input.channelKind === "agency" && !found.hasAgency) {
    return { ok: false, error: "这只没有代销渠道" };
  }
  const account = accountForChannel(input.channelKind, input.platform);
  if (!account.ok) return account;
  if (!Number.isFinite(input.shares) || input.shares <= 0) {
    return { ok: false, error: "份额必须大于 0" };
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    return { ok: false, error: "每份成本不能为负数" };
  }

  if (found.nav != null && found.navDate) {
    writeAutoNav(found.symbol, found.navDate, found.nav);
  }

  const saved = await savePosition({
    account: account.account,
    exposure: "nasdaq",
    symbol: found.symbol,
    shares: input.shares,
    cost: input.shares * input.unitCost,
    status: "settled",
  });
  if (!saved.ok) return saved;
  enableAssetTypeSync("nasdaq");
  revalidatePath("/holdings");
  revalidatePath("/holdings/overview");
  return { ok: true };
}

export async function saveLotHolding(input: {
  exposure: "gold" | "crypto";
  symbol?: string;
  shares: number;
  cost: number;
}): Promise<ActionResult> {
  await requireUser();
  const symbol =
    input.exposure === "gold" ? GOLD_SYMBOL : String(input.symbol ?? "").trim();
  if (input.exposure === "crypto" && !symbol) {
    return { ok: false, error: "请填写名称或代码" };
  }
  const saved = await savePosition({
    account: "other",
    exposure: input.exposure,
    symbol,
    shares: input.shares,
    cost: input.cost,
    status: "settled",
  });
  if (!saved.ok) return saved;
  enableAssetTypeSync(input.exposure);
  return saved;
}
