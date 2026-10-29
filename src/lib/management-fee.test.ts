import { describe, expect, it } from "vitest";
import { calculateDailyManagementFee, daysInYear, managementFeeCoverage } from "./management-fee";

describe("management fee", () => {
  it("handles ordinary and leap years", () => {
    expect(daysInYear("2026-10-28")).toBe(365);
    expect(daysInYear("2024-02-29")).toBe(366);
    expect(calculateDailyManagementFee(1000, 0.5, "2026-10-28")).toBeCloseTo(0.01369863, 8);
  });

  it("returns null for unavailable inputs", () => {
    expect(calculateDailyManagementFee(null, 0.5, "2026-10-28")).toBeNull();
    expect(calculateDailyManagementFee(1000, null, "2026-10-28")).toBeNull();
    expect(calculateDailyManagementFee(1000, 0.5, "bad")).toBeNull();
  });

  it("summarizes coverage", () => {
    expect(managementFeeCoverage(0, 0, 0).status).toBe("not_applicable");
    expect(managementFeeCoverage(2, 2, 0).status).toBe("covered");
    expect(managementFeeCoverage(2, 1, 1).status).toBe("partial");
    expect(managementFeeCoverage(2, 0, 2).status).toBe("missing");
  });
});
