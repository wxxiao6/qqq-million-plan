/** 持仓概览页面组装。页面只借结果；写库走 actions。 */

import {
  ASSET_TYPES,
  GOLD_SYMBOL,
  parseEnabledTypes,
  type AssetType,
} from "@/lib/holdings";
import { kvGet, kvSet } from "../db";
import { getDcaBoard, type DcaBoard } from "../dca";
import {
  getExposureSummary,
  getDynamicSummary,
  listDeposits,
  listNavSnapshots,
  listNasdaqPlatformGroups,
  listPositions,
  writeAutoNav,
  type Deposit,
  type ExposureSummary,
  type NasdaqPlatformGroup,
} from "../ledger";
import { fetchOfficialNav } from "../market/eastmoney";
import { getMarketSnapshot } from "../market/mock";
import type { NasdaqFundLookup } from "./lookup";

const ENABLED_KEY = "holdings.enabledTypes";

export type HoldingsView = {
  empty: boolean;
  enabled: AssetType[];
  remainingTypes: AssetType[];
  nasdaqIndex: number | null;
  goldPrice: number | null;
  dynamic: ExposureSummary;
  nasdaq: ExposureSummary;
  gold: ExposureSummary;
  crypto: ExposureSummary;
  deposits: Deposit[];
  depositPv: number | null;
  nasdaqGroups: NasdaqPlatformGroup[];
  dcaNasdaq: DcaBoard;
};

export function listStoredEnabledTypes(): AssetType[] {
  return parseEnabledTypes(kvGet(ENABLED_KEY));
}

export function enableAssetTypeSync(type: AssetType) {
  const current = listStoredEnabledTypes();
  if (current.includes(type)) return;
  kvSet(ENABLED_KEY, JSON.stringify([...current, type]));
}

export function resolveEnabledTypes(): AssetType[] {
  const set = new Set<AssetType>(listStoredEnabledTypes());
  for (const row of listPositions()) {
    if (row.exposure === "nasdaq" || row.exposure === "gold" || row.exposure === "crypto") {
      set.add(row.exposure);
    }
  }
  if (listDeposits().length > 0) set.add("deposit");
  return ASSET_TYPES.filter((type) => set.has(type));
}

export function getHoldingsView(): HoldingsView {
  const enabled = resolveEnabledTypes();
  const remainingTypes = ASSET_TYPES.filter((type) => !enabled.includes(type));
  const market = getMarketSnapshot();
  const deposits = listDeposits();
  const depositPv = deposits.reduce((sum, row) => sum + row.principal, 0);

  return {
    empty: enabled.length === 0,
    enabled,
    remainingTypes,
    nasdaqIndex: market.nasdaqIndex,
    goldPrice: market.goldPrice,
    dynamic: getDynamicSummary(),
    nasdaq: getExposureSummary("nasdaq"),
    gold: getExposureSummary("gold"),
    crypto: getExposureSummary("crypto"),
    deposits,
    depositPv: deposits.length > 0 ? depositPv : null,
    nasdaqGroups: listNasdaqPlatformGroups(),
    dcaNasdaq: getDcaBoard(),
  };
}

/** 已确认纳指持仓没有净值时，按代码补拉最近正式净值；失败时仍保留「—」。 */
export async function ensureHeldNasdaqNavs() {
  const heldSymbols = [...new Set(
    listPositions()
      .filter((position) => position.exposure === "nasdaq" && position.status === "settled")
      .map((position) => position.symbol),
  )];
  const snapped = new Set(listNavSnapshots().map((snapshot) => snapshot.symbol));
  const missing = heldSymbols.filter((symbol) => !snapped.has(symbol));
  await Promise.all(missing.map(async (symbol) => {
    const nav = await fetchOfficialNav(symbol);
    if (nav) writeAutoNav(symbol, nav.asOf, nav.nav);
  }));
}

export { GOLD_SYMBOL };
export type { NasdaqFundLookup };
