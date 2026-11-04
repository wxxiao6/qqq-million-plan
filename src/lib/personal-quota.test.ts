import { describe, expect, it } from "vitest";
import { buildPersonalQuota, quotaOrderDay, type PersonalQuotaFund, type QuotaPlan, type QuotaOrder } from "./personal-quota";

const today = "2026-11-04";
const fund = (code = "A", override: Partial<PersonalQuotaFund> = {}): PersonalQuotaFund => ({ code, name: code, currency: "CNY",
  directStatus: "verified", agencyStatus: "verified", directTradeStatus: "limited", agencyTradeStatus: "limited",
  directDailyLimit: 100, agencyDailyLimit: 100, directLimitScope: null, agencyLimitScope: null,
  directQuoteSourceUrl: "https://official.test/notice", agencyQuoteSourceUrl: "https://official.test/notice", ...override });
const plan = (override: Partial<QuotaPlan> = {}): QuotaPlan => ({ id: 1, symbol: "A", currency: "CNY", channel: "agency", account: "alipay", amount: 20,
  frequency: "daily", weekday: null, monthDay: null, startDate: "2026-11-02", importedThrough: null, cutoff: "before_15", ...override });
const order = (override: Partial<QuotaOrder> = {}): QuotaOrder => ({ id: 1, symbol: "A", currency: "CNY", account: "alipay", planId: null,
  executionOn: today, tDate: null, cutoff: "before_15", cash: 10, status: "pending", ...override });
const estimate = (plans: QuotaPlan[], orders: QuotaOrder[] = [], funds = [fund()], day = today) => buildPersonalQuota(funds, plans, orders, day);

describe("personal daily quota", () => {
  it("leaves public rows unchanged without a matching plan or channel", () => {
    expect(estimate([])).toEqual({});
    const result = estimate([plan()]);
    expect(result["A:agency"]).toMatchObject({ remaining: 80, scheduled: 20, recorded: 0 });
    expect(result["A:direct"]).toBeUndefined();
  });
  it("counts pending/settled actual cash once, replacing the same planned occurrence", () => {
    expect(estimate([plan()], [order({ planId: 1, cash: 18 }), order({ id: 2, cash: 7, status: "settled" })])["A:agency"])
      .toMatchObject({ remaining: 75, recorded: 25, scheduled: 0 });
  });
  it("ignores old pending balances and releases failed/cancelled occurrences", () => {
    const rows = [order({ id: 1, executionOn: "2026-11-03", cash: 40 }), order({ id: 2, planId: 1, status: "cancelled", cash: 20 }), order({ id: 3, status: "failed" })];
    expect(estimate([plan()], rows)["A:agency"]).toMatchObject({ remaining: 100, recorded: 0, scheduled: 0 });
  });
  it("preserves weekly, biweekly and monthly cadence and future start dates", () => {
    expect(estimate([plan({ frequency: "weekly", weekday: 1 })])["A:agency"].scheduled).toBe(0);
    expect(estimate([plan({ frequency: "biweekly", weekday: 3, startDate: "2026-10-28" })])["A:agency"].scheduled).toBe(0);
    expect(estimate([plan({ frequency: "biweekly", weekday: 3, startDate: "2026-10-21" })])["A:agency"].scheduled).toBe(20);
    expect(estimate([plan({ frequency: "monthly", monthDay: 4 })])["A:agency"].scheduled).toBe(20);
    expect(estimate([plan({ startDate: "2026-11-05" })])["A:agency"].scheduled).toBe(0);
    expect(estimate([plan({ importedThrough: today })])["A:agency"].scheduled).toBe(0);
  });
  it("uses the order's T day, handles Friday after-cutoff, and does not move confirmed dates", () => {
    expect(quotaOrderDay("2026-11-06", "after_15")).toBe("2026-11-09");
    expect(estimate([plan({ cutoff: "after_15" })], [], [fund()], "2026-11-09")["A:agency"].scheduled).toBe(20);
    expect(estimate([plan()], [order({ executionOn: "2026-11-03", cutoff: "after_15", cash: 30 })])["A:agency"].recorded).toBe(30);
    expect(estimate([plan()], [order({ tDate: "2026-11-05", cash: 30 })])["A:agency"].recorded).toBe(0);
  });
  it("shares one documented pool across share classes/channels and combines accounts conservatively", () => {
    const funds = [fund("A", { agencyLimitScope: "combined", directLimitScope: "combined" }), fund("C", { agencyLimitScope: "combined", directLimitScope: "combined" })];
    const plans = [plan(), plan({ id: 2, symbol: "C", account: "jd", amount: 30 }), plan({ id: 3, channel: "direct", account: "gf_direct", amount: 10 })];
    const result = estimate(plans, [order({ cash: 15, symbol: "C" })], funds);
    for (const row of Object.values(result)) expect(row).toMatchObject({ shared: true, remaining: 25, scheduled: 60, recorded: 15 });
    expect(result["C:direct"].ownPlanCount).toBe(0);
    expect(result["A:agency"].details).toHaveLength(4);
  });
  it("never joins distinct evidence or currencies merely because scope text matches", () => {
    const funds = [fund("A", { agencyLimitScope: "combined" }), fund("USD", { currency: "USD", agencyLimitScope: "combined" }),
      fund("C", { agencyLimitScope: "combined", agencyQuoteSourceUrl: "https://other.test/notice" })];
    expect(estimate([plan()], [], funds)["USD:agency"]).toBeUndefined();
    expect(estimate([plan()], [], funds)["C:agency"]).toBeUndefined();
  });
  it("does decimal subtraction and reports excess without a negative remaining amount", () => {
    expect(estimate([plan({ amount: 0.2 })], [order({ cash: 0.1 })], [fund("A", { agencyDailyLimit: 0.3 })])["A:agency"])
      .toMatchObject({ remaining: 0, excess: 0 });
    expect(estimate([plan({ amount: 110 })])["A:agency"]).toMatchObject({ remaining: 0, excess: 10 });
  });
  it("does not invent a numeric balance for paused/unverified/unlimited/unknown-account rows", () => {
    for (const override of [{ agencyTradeStatus: "paused" }, { agencyStatus: "unverified" }, { agencyTradeStatus: "open" }, { agencyDailyLimit: null }] as Partial<PersonalQuotaFund>[]) {
      expect(estimate([plan()], [], [fund("A", override)])["A:agency"].remaining).toBeNull();
    }
    expect(estimate([plan()], [order({ account: "other" })])["A:agency"]).toMatchObject({ state: "unknown", remaining: null });
    expect(estimate([plan()], [order({ cutoff: null })])["A:agency"]).toMatchObject({ state: "unknown", remaining: null });
    for (const account of [null, "other", "gf_direct"]) {
      expect(estimate([plan({ account })])["A:agency"]).toMatchObject({ state: "unknown", remaining: null });
    }
  });
});
