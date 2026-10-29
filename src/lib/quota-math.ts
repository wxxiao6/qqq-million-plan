/** 纳指雷达公式。口径见 docs/spec-quota.md 第 3 节。 */

import { MIN_ORDER_DEFAULT } from "./formulas";

export type ChannelKind = "direct" | "agency";

export type QuotaAmount =
  | { kind: "amount"; value: number }
  | { kind: "unlimited" }
  | { kind: "unknown" };

export type QuotaShareTag = "none" | "shared" | "all-channel";

export type QuotaResultLabel = "有可买额度" | "今日无可买额度" | "额度待更新";

export type QuotaDataStatus = "已更新" | "更新中" | "部分更新" | "更新失败" | "非今日数据";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function defaultQuotaScope(
  symbol: string,
  shareClass: string,
  channelKind: ChannelKind,
): string {
  return `${symbol}:${shareClass}:${channelKind}`;
}

export function resolveQuotaScope(
  symbol: string,
  shareClass: string,
  channelKind: ChannelKind,
  stored: string | null | undefined,
): string {
  const trimmed = stored?.trim();
  if (trimmed) return trimmed;
  return defaultQuotaScope(symbol, shareClass, channelKind);
}

/** 单格可投：暂停 0；限额/开放有日限额则取日限额；开放无日限额为不限额；未知或无效不进金额汇总。 */
export function cellInvestable(
  status: string | null | undefined,
  dailyLimit: number | null | undefined,
): QuotaAmount {
  if (status == null || status === "" || status === "unknown") {
    return { kind: "unknown" };
  }
  if (status === "paused") {
    return { kind: "amount", value: 0 };
  }
  if (status === "limited") {
    if (dailyLimit == null || !Number.isFinite(dailyLimit) || dailyLimit < 0) {
      return { kind: "unknown" };
    }
    return { kind: "amount", value: roundMoney(dailyLimit) };
  }
  if (status === "open") {
    if (dailyLimit == null || Number.isNaN(dailyLimit)) {
      return { kind: "unlimited" };
    }
    if (!Number.isFinite(dailyLimit) || dailyLimit < 0) {
      return { kind: "unknown" };
    }
    return { kind: "amount", value: roundMoney(dailyLimit) };
  }
  return { kind: "unknown" };
}

/** 单格剩余：有限取 max(可投 − 已购买, 0)；不限额保持不限额；暂停 0；未知保持未知。 */
export function cellRemaining(
  investable: QuotaAmount,
  purchasedToday = 0,
): QuotaAmount {
  if (investable.kind === "unknown") return { kind: "unknown" };
  if (investable.kind === "unlimited") return { kind: "unlimited" };
  const purchased = Number.isFinite(purchasedToday) ? Math.max(purchasedToday, 0) : 0;
  return {
    kind: "amount",
    value: roundMoney(Math.max(investable.value - purchased, 0)),
  };
}

export function isBuyableAmount(
  amount: QuotaAmount,
  minOrder = MIN_ORDER_DEFAULT,
): boolean {
  if (amount.kind === "unlimited") return true;
  if (amount.kind === "amount") return amount.value >= minOrder;
  return false;
}

export function hasPositiveRemaining(amount: QuotaAmount): boolean {
  return amount.kind === "unlimited" || (amount.kind === "amount" && amount.value > 0);
}

export function remainingSortScore(amount: QuotaAmount): number {
  if (amount.kind === "unlimited") return Number.POSITIVE_INFINITY;
  if (amount.kind === "amount") return amount.value;
  return Number.NEGATIVE_INFINITY;
}

export function sameQuotaAmount(a: QuotaAmount, b: QuotaAmount): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "amount" && b.kind === "amount") return a.value === b.value;
  return true;
}

/** 未知不按 0 参与合计；任一不限额则整体为不限额。 */
export function sumQuotaAmounts(amounts: QuotaAmount[]): QuotaAmount {
  const participating = amounts.filter((item) => item.kind !== "unknown");
  if (participating.length === 0) return { kind: "unknown" };
  if (participating.some((item) => item.kind === "unlimited")) {
    return { kind: "unlimited" };
  }
  return {
    kind: "amount",
    value: roundMoney(
      participating.reduce(
        (sum, item) => sum + (item.kind === "amount" ? item.value : 0),
        0,
      ),
    ),
  };
}

export function coverageOf(amounts: QuotaAmount[]): {
  covered: number;
  total: number;
} {
  return {
    covered: amounts.filter((item) => item.kind !== "unknown").length,
    total: amounts.length,
  };
}

export type QuotaScopeCell = {
  scopeId: string;
  symbol: string;
  shareClass: string;
  channelKind: ChannelKind;
  investable: QuotaAmount;
  purchased: number;
};

export type CollapsedScope = {
  scopeId: string;
  channels: ChannelKind[];
  shareKeys: string[];
  investable: QuotaAmount;
  purchased: number;
  remaining: QuotaAmount;
  shareTag: QuotaShareTag;
};

function shareKey(symbol: string, shareClass: string) {
  return `${symbol}:${shareClass}`;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

export function shareTagFor(scope: {
  channels: ChannelKind[];
  shareKeys: string[];
}): QuotaShareTag {
  if (scope.channels.length > 1) return "all-channel";
  if (scope.shareKeys.length > 1) return "shared";
  return "none";
}

/**
 * 按额度作用域去重。同 scope 只计一次；金额冲突或识别不出则视为未知，不重复累计。
 */
export function collapseScopes(cells: QuotaScopeCell[]): CollapsedScope[] {
  const groups = new Map<string, QuotaScopeCell[]>();
  for (const cell of cells) {
    const scopeId = cell.scopeId.trim();
    if (!scopeId) continue;
    const list = groups.get(scopeId) ?? [];
    list.push(cell);
    groups.set(scopeId, list);
  }

  const collapsed: CollapsedScope[] = [];
  for (const [scopeId, list] of groups) {
    const known = list.filter((item) => item.investable.kind !== "unknown");
    let investable: QuotaAmount;
    if (known.length === 0) {
      investable = { kind: "unknown" };
    } else {
      const first = known[0].investable;
      investable = known.every((item) => sameQuotaAmount(item.investable, first))
        ? first
        : { kind: "unknown" };
    }

    const purchased = roundMoney(
      Math.max(
        ...list.map((item) =>
          Number.isFinite(item.purchased) ? item.purchased : 0,
        ),
        0,
      ),
    );

    const channels = uniqueSorted(list.map((item) => item.channelKind));
    const shareKeys = uniqueSorted(
      list.map((item) => shareKey(item.symbol, item.shareClass)),
    );
    collapsed.push({
      scopeId,
      channels,
      shareKeys,
      investable,
      purchased,
      remaining: cellRemaining(investable, purchased),
      shareTag: shareTagFor({ channels, shareKeys }),
    });
  }
  return collapsed;
}

export function scopesForChannel(
  scopes: CollapsedScope[],
  channel: ChannelKind,
): CollapsedScope[] {
  return scopes.filter((scope) => scope.channels.includes(channel));
}

export function quotaResultLabel(input: {
  scopeInvestables: QuotaAmount[];
  remaining: QuotaAmount;
  minOrder?: number;
}): QuotaResultLabel {
  const { covered, total } = coverageOf(input.scopeInvestables);
  if (total > 0 && covered === 0) return "额度待更新";
  const minOrder = input.minOrder ?? MIN_ORDER_DEFAULT;
  if (isBuyableAmount(input.remaining, minOrder)) return "有可买额度";
  if (input.scopeInvestables.some((item) => item.kind === "unlimited")) {
    return "有可买额度";
  }
  return "今日无可买额度";
}

export type SortableQuotaRow = {
  remaining: QuotaAmount;
  allPaused: boolean;
  symbol: string;
  shareClass: string;
};

/** 有剩余置顶 → 剩余从高到低 → 不限额高于有限额 → 全暂停沉底 → 同级代码升序。 */
export function compareQuotaDetailRows(
  a: SortableQuotaRow,
  b: SortableQuotaRow,
): number {
  const aHas = hasPositiveRemaining(a.remaining);
  const bHas = hasPositiveRemaining(b.remaining);
  if (aHas !== bHas) return aHas ? -1 : 1;

  const aSink = a.allPaused;
  const bSink = b.allPaused;
  if (aSink !== bSink) return aSink ? 1 : -1;

  const aScore = remainingSortScore(a.remaining);
  const bScore = remainingSortScore(b.remaining);
  if (aScore !== bScore) return bScore - aScore;

  const code = a.symbol.localeCompare(b.symbol, "en");
  if (code !== 0) return code;
  return a.shareClass.localeCompare(b.shareClass, "en");
}
