import { deriveNextDebitDate, type DcaFrequency } from "./dca";
import { advanceWeekdays, shiftISO } from "./format";
import { decimal, roundMoney, sumMoney } from "./decimal";
import type { QuotaSummaryRow } from "./nasdaq-quota-summary";

export type PersonalQuotaFund = QuotaSummaryRow & { currency: string; name: string };
export type QuotaPlan = {
  id: number; symbol: string; currency: string; channel: "direct" | "agency";
  account: string | null; amount: number; frequency: DcaFrequency; weekday: number | null;
  monthDay: number | null; startDate: string; importedThrough: string | null;
  cutoff: "before_15" | "after_15";
};
export type QuotaOrder = {
  id: number; symbol: string; currency: string; account: string; planId: number | null;
  executionOn: string; tDate: string | null; cutoff: "before_15" | "after_15" | null;
  cash: number; status: "pending" | "settled" | "failed" | "cancelled";
};
export type PersonalQuota = {
  ownPlanCount: number; shared: boolean; currency: string;
  state: "ready" | "paused" | "unknown";
  remaining: number | null; excess: number; recorded: number; scheduled: number;
  details: { symbol: string; name: string; account: string | null; recorded: number; scheduled: number }[];
};

/** Same weekday convention as the ledger; an actual T date takes precedence. */
export function quotaOrderDay(date: string, cutoff: QuotaPlan["cutoff"] | null) {
  if (cutoff === "after_15") return advanceWeekdays(date, 1);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 6 ? shiftISO(date, 2) : weekday === 0 ? shiftISO(date, 1) : date;
}

/** Read-only estimate. Never multiply an investor's quota by their account count. */
export function buildPersonalQuota(funds: PersonalQuotaFund[], plans: QuotaPlan[], orders: QuotaOrder[], today: string): Record<string, PersonalQuota> {
  const nodes = funds.flatMap((fund) => (["direct", "agency"] as const).map((channel) => ({ fund, channel, key: `${fund.code}:${channel}` })));
  const parent = nodes.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const scopes = new Map<string, number>();
  nodes.forEach(({ fund, channel }, i) => {
    const scope = channel === "direct" ? fund.directLimitScope : fund.agencyLimitScope;
    const source = channel === "direct" ? fund.directQuoteSourceUrl : fund.agencyScopeSourceUrl ?? fund.agencyQuoteSourceUrl;
    if (!scope || !source) return;
    const key = `${fund.currency}:${source}:${scope}`;
    const previous = scopes.get(key);
    if (previous == null) scopes.set(key, i);
    else parent[root(i)] = root(previous);
  });
  const result: Record<string, PersonalQuota> = {};
  const orderChannel = (account: string) => account === "gf_direct" ? "direct" : ["alipay", "cmb", "jd"].includes(account) ? "agency" : null;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const members = nodes.filter((_, j) => root(j) === root(i));
    const memberKeys = new Set(members.map((member) => member.key));
    const poolPlans = plans.filter((plan) => plan.currency === node.fund.currency && memberKeys.has(`${plan.symbol}:${plan.channel}`));
    if (!poolPlans.length) continue;
    const details = new Map<string, PersonalQuota["details"][number]>();
    const add = (symbol: string, account: string | null, recorded: number, scheduled: number) => {
      const key = `${symbol}:${account}`;
      const detail = details.get(key) ?? { symbol, account, name: funds.find((fund) => fund.code === symbol)?.name ?? symbol, recorded: 0, scheduled: 0 };
      detail.recorded = sumMoney([detail.recorded, recorded]); detail.scheduled = sumMoney([detail.scheduled, scheduled]);
      details.set(key, detail);
    };
    let uncertain = false;
    for (const order of orders) {
      if (order.currency !== node.fund.currency || !["pending", "settled"].includes(order.status)) continue;
      const day = order.tDate ?? (order.cutoff ? quotaOrderDay(order.executionOn, order.cutoff) : null);
      const channel = orderChannel(order.account);
      const relevant = channel ? memberKeys.has(`${order.symbol}:${channel}`) : members.some((member) => member.fund.code === order.symbol);
      if (!relevant || (day && day !== today)) continue;
      if (!day || !channel) { uncertain = true; continue; }
      add(order.symbol, order.account, order.cash, 0);
    }
    for (const plan of poolPlans) {
      // Friday after-cutoff orders can occupy Monday's quota. Inspect each
      // possible execution date, anchored to the plan's original cadence.
      for (let offset = -3; offset <= 0; offset++) {
        const executionOn = shiftISO(today, offset);
        if (quotaOrderDay(executionOn, plan.cutoff) !== today || (plan.importedThrough && executionOn <= plan.importedThrough)) continue;
        const due = deriveNextDebitDate({ frequency: plan.frequency, startDate: plan.startDate, weekday: plan.weekday,
          monthDay: plan.monthDay, accountedThrough: shiftISO(executionOn, -1) });
        if (due !== executionOn) continue;
        // Any recorded outcome resolves this occurrence. Failed/cancelled
        // orders release capacity; successful orders are counted above.
        if (orders.some((order) => order.planId === plan.id && order.executionOn === executionOn)) continue;
        if (!plan.account || orderChannel(plan.account) !== plan.channel) uncertain = true;
        add(plan.symbol, plan.account, 0, plan.amount);
      }
    }
    const recorded = sumMoney([...details.values()].map((detail) => detail.recorded));
    const scheduled = sumMoney([...details.values()].map((detail) => detail.scheduled));
    const status = node.channel === "direct" ? node.fund.directTradeStatus : node.fund.agencyTradeStatus;
    const verified = node.channel === "direct" ? node.fund.directStatus : node.fund.agencyStatus;
    const limits = members.flatMap(({ fund, channel }) => {
      const limit = channel === "direct" ? fund.directDailyLimit : fund.agencyDailyLimit;
      const valid = channel === "direct" ? fund.directStatus : fund.agencyStatus;
      const trade = channel === "direct" ? fund.directTradeStatus : fund.agencyTradeStatus;
      return valid === "verified" && trade === "limited" && limit != null && Number.isFinite(limit) && limit >= 0 ? [limit] : [];
    });
    const ownLimit = node.channel === "direct" ? node.fund.directDailyLimit : node.fund.agencyDailyLimit;
    const state = status === "paused" ? "paused" : uncertain || verified !== "verified" || status !== "limited" || ownLimit == null || !Number.isFinite(ownLimit) || ownLimit < 0 || !limits.length ? "unknown" : "ready";
    const balance = state === "ready" ? roundMoney(decimal(Math.min(...limits)).minus(recorded).minus(scheduled).toNumber()) : null;
    result[node.key] = { ownPlanCount: poolPlans.filter((plan) => plan.symbol === node.fund.code && plan.channel === node.channel).length,
      shared: members.length > 1, currency: node.fund.currency, state, remaining: balance == null ? null : Math.max(0, balance),
      excess: balance != null && balance < 0 ? -balance : 0, recorded, scheduled, details: [...details.values()] };
  }
  return result;
}
