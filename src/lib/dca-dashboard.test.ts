import { describe, expect, it } from "vitest";
import type { DcaPlanView } from "./dca";
import { filterDcaBySalesChannel, plannedDcaDates, summarizeDcaAmounts, summarizeDcaSchedule } from "./dca-dashboard";

const plan = (id: number, nextDebitDate: string, status: "active" | "paused" = "active") => ({
  id, nextDebitDate, status, amount: 10, frequency: "daily",
}) as DcaPlanView;

describe("定投管理今日安排", () => {
  it("已记录执行的计划不再显示为待处理，暂停计划不计入", () => {
    const summary = summarizeDcaSchedule([
      plan(1, "2026-10-09"), plan(2, "2026-10-09"),
      plan(3, "2026-10-10"), plan(4, "2026-10-09", "paused"),
    ], [{ planId: 1, executionOn: "2026-10-09", recordedOn: "2026-10-10" }], "2026-10-09");
    expect(summary.due.map((item) => item.id)).toEqual([2]);
    expect(summary.completed.map((item) => item.id)).toEqual([1]);
    expect(summary.next.map((item) => item.id)).toEqual([3]);
    expect(summary.dueAmount).toBe(10);
  });
  it("扣款后计划日期推进，今天仍显示为已记录", () => {
    const summary = summarizeDcaSchedule([plan(1, "2026-10-10")], [{ planId: 1, executionOn: "2026-10-09", recordedOn: "2026-10-09" }], "2026-10-09");
    expect(summary.completed.map((item) => item.id)).toEqual([1]);
    expect(summary.due).toHaveLength(0);
  });
});

it("过去未记录的计划进入待补录，即使今天有另一笔扣款", () => {
  const summary = summarizeDcaSchedule([plan(1, "2026-10-08"), plan(2, "2026-10-12")],
    [{ planId: 1, executionOn: "2026-10-11", recordedOn: "2026-10-11" }], "2026-10-11");
  expect(summary.overdue.map((item) => item.id)).toEqual([1]);
  expect(summary.pendingAmount).toBe(10);
  expect(summary.due).toHaveLength(0);
});


describe("月度计划日期", () => {
  it("从最早未记录期次推算并跳过之后已记录的日期", () => {
    const weekly = { ...plan(1, "2026-09-28"), frequency: "weekly" as const };
    expect(plannedDcaDates(weekly, "2026-10", ["2026-10-12"])).toEqual(["2026-10-05", "2026-10-19", "2026-10-26"]);
    expect(plannedDcaDates({ ...weekly, status: "paused" }, "2026-10")).toEqual([]);
  });
  it("每日计划仅按既有工作日规则推进并跨年", () => {
    expect(plannedDcaDates(plan(1, "2026-12-31"), "2027-01").slice(0, 3)).toEqual(["2027-01-01", "2027-01-04", "2027-01-05"]);
  });
});




describe("日、月和累计定投金额", () => {
  it("账户筛选同时限定计划、执行记录和统计范围", () => {
    const plans = [
      { ...plan(1, "2026-10-09"), account: "alipay", frequency: "weekly" as const, amount: 100 },
      { ...plan(2, "2026-10-09"), account: "jd", frequency: "weekly" as const, amount: 200 },
      { ...plan(3, "2026-10-09", "paused"), account: "alipay" },
    ];
    const records = [
      { planId: 1, executionOn: "2026-10-02", recordedOn: "2026-10-02", cashDebited: 90, status: "settled" },
      { planId: 2, executionOn: "2026-10-02", recordedOn: "2026-10-02", cashDebited: 180, status: "settled" },
      { planId: 3, executionOn: "2026-10-02", recordedOn: "2026-10-02", cashDebited: 10, status: "failed" },
    ];
    const selected = filterDcaBySalesChannel(plans, records, {}, "agency", "alipay");
    expect(selected.plans.map((item) => item.id)).toEqual([1, 3]);
    expect(selected.records.map((item) => item.planId)).toEqual([1, 3]);
    expect(summarizeDcaAmounts(selected.plans, selected.records, "2026-10-09"))
      .toEqual({ daily: 100, monthly: 490, total: 90 });
    expect(summarizeDcaSchedule(selected.plans, selected.records, "2026-10-09").active).toHaveLength(1);
    expect(filterDcaBySalesChannel(plans, records, {}, "all", "all").records).toHaveLength(3);
  });
  it("本月合并已记账与后续期次，今日不重复计算，失败记录不计入", () => {
    const active = { ...plan(1, "2026-10-16"), frequency: "weekly" as const, amount: 100 };
    const paused = plan(2, "2026-10-16", "paused");
    const records = [
      { planId: 1, executionOn: "2026-10-09", recordedOn: "2026-10-09", cashDebited: 90, status: "pending" },
      { planId: 2, executionOn: "2026-10-09", recordedOn: "2026-10-09", cashDebited: 10, status: "settled" },
      { planId: 1, executionOn: "2026-10-02", recordedOn: "2026-10-02", cashDebited: 100, status: "failed" },
      { planId: 1, executionOn: "2026-09-25", recordedOn: "2026-09-25", cashDebited: 100, status: "settled" },
    ];
    expect(summarizeDcaAmounts([active, paused], records, "2026-10-09")).toEqual({ daily: 100, monthly: 400, total: 200 });
  });
  it("今日计划尚未记账时按计划金额计入日和月，不计入累计", () => {
    expect(summarizeDcaAmounts([{ ...plan(1, "2026-10-09"), frequency: "weekly", amount: 100 }], [], "2026-10-09"))
      .toEqual({ daily: 100, monthly: 400, total: 0 });
  });
});
