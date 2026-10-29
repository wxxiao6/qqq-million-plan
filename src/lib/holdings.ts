/** 持仓概览资产类型。口径见 docs/spec-holdings.md。 */

export const ASSET_TYPES = ["nasdaq", "gold", "deposit", "crypto"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  nasdaq: "纳指",
  gold: "黄金",
  deposit: "存款",
  crypto: "加密货币",
};

export const GOLD_SYMBOL = "XAU";

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

export function parseEnabledTypes(raw: string | null): AssetType[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AssetType => typeof item === "string" && isAssetType(item));
  } catch {
    return [];
  }
}
