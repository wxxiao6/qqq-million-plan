import { isISODate } from "@/lib/format";

export type ManagementFeeRateStatus = "valid" | "missing" | "invalid";
export type ManagementFeeCoverageStatus = "covered" | "partial" | "missing" | "not_applicable";

export type ManagementFeeRate = {
  code: string;
  effectiveOn: string;
  annualRatePct: number | null;
  rawValue: string | null;
  sourceUrl: string;
  sourceProvider: string;
  observedAt: string;
  status: ManagementFeeRateStatus;
};

export type ManagementFeeEntry = {
  id: number;
  symbol: string;
  account: string;
  feeDate: string;
  amount: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManagementFeeCoverage = {
  status: ManagementFeeCoverageStatus;
  eligibleGroups: number;
  coveredGroups: number;
  missingGroups: number;
};

export function daysInYear(isoDate: string): number {
  if (!isISODate(isoDate)) return 365;
  const year = Number(isoDate.slice(0, 4));
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
}

export function calculateDailyManagementFee(
  marketValue: number | null | undefined,
  annualRatePct: number | null | undefined,
  feeDate: string,
): number | null {
  if (!isISODate(feeDate) || marketValue == null || !Number.isFinite(marketValue) || marketValue < 0) return null;
  if (annualRatePct == null || !Number.isFinite(annualRatePct) || annualRatePct < 0) return null;
  const amount = marketValue * annualRatePct / 100 / daysInYear(feeDate);
  return Number.isFinite(amount) ? Math.round(amount * 1e8) / 1e8 : null;
}

export function managementFeeCoverage(
  eligibleGroups: number,
  coveredGroups: number,
  missingGroups: number,
): ManagementFeeCoverage {
  if (eligibleGroups === 0) return { status: "not_applicable", eligibleGroups, coveredGroups, missingGroups };
  if (missingGroups === 0 && coveredGroups === eligibleGroups) return { status: "covered", eligibleGroups, coveredGroups, missingGroups };
  if (coveredGroups === 0) return { status: "missing", eligibleGroups, coveredGroups, missingGroups };
  return { status: "partial", eligibleGroups, coveredGroups, missingGroups };
}
