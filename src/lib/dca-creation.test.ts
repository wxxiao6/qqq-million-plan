import { describe, expect, it } from "vitest";
import { previewDcaCreation, validateDcaCreation } from "./dca-creation";

const daily = { frequency: "daily", startDate: "2026-10-28", amount: 100 };
const today = "2026-11-03";

describe("新建定投与补录预览", () => {
  it("按账本工作日生成历史期次，包含今日，预览合计与下一期", () => {
    expect(previewDcaCreation(daily, today)).toEqual({ ok: true, dates: ["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"], count: 5, historicalCount: 4, total: 500, firstDate: "2026-10-28", nextDate: "2026-11-04" });
  });
  it("周、双周和每月按相同节奏推进，未来首期不生成记录", () => {
    expect(previewDcaCreation({ ...daily, frequency: "weekly", weekday: 3 }, today)).toMatchObject({ count: 1, nextDate: "2026-11-04" });
    expect(previewDcaCreation({ ...daily, frequency: "biweekly", startDate: "2026-10-14", weekday: 3 }, today)).toMatchObject({ count: 2, nextDate: "2026-11-11" });
    expect(previewDcaCreation({ ...daily, frequency: "monthly", startDate: "2026-10-01", monthDay: 28 }, today)).toMatchObject({ count: 1, nextDate: "2026-11-28" });
    expect(previewDcaCreation({ ...daily, startDate: "2026-11-07" }, today)).toMatchObject({ count: 0, total: 0, firstDate: "2026-11-09", nextDate: "2026-11-09" });
  });
  it("从现在开始拒绝历史日期，历史补录拒绝未来日期", () => {
    expect(validateDcaCreation({ ...daily, creationMode: "now" }, today)).toContain("不能早于今天");
    expect(validateDcaCreation({ ...daily, startDate: "2026-11-04", creationMode: "history" }, today)).toContain("不能晚于今天");
    expect(validateDcaCreation({ ...daily, startDate: today, creationMode: "now" }, today)).toBeNull();
    expect(validateDcaCreation(daily, today)).toContain("请选择");
  });
  it("补录保存必须匹配已核对的笔数、金额与当天日期", () => {
    const input = { ...daily, creationMode: "history" as const, confirmedBackfill: { count: 5, total: 500, through: today } };
    expect(validateDcaCreation(input, today)).toBeNull();
    expect(validateDcaCreation({ ...input, confirmedBackfill: undefined }, today)).toContain("重新核对");
    expect(validateDcaCreation({ ...input, amount: 200 }, today)).toContain("重新核对");
    expect(validateDcaCreation({ ...input, startDate: "2026-10-29" }, today)).toContain("重新核对");
    expect(validateDcaCreation(input, "2026-11-04")).toContain("重新核对");
  });
  it("日期、金额与节奏无效时不进入循环，补录上限与云端一致", () => {
    for (const input of [{ ...daily, startDate: "" }, { ...daily, amount: 0 }, { ...daily, amount: Infinity }, { ...daily, frequency: "monthly", monthDay: 0 }, { ...daily, frequency: "weekly", weekday: 1.5 }, { ...daily, startDate: "2000-01-01" }]) {
      expect(previewDcaCreation(input, today).ok).toBe(false);
    }
  });
});
