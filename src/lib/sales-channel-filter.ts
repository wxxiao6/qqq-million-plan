export type SalesChannelFilter = "all" | "direct" | "agency";
export type SalesFilterRow = { symbol: string; account: string | null; channelKind?: "direct" | "agency" };
export const UNKNOWN_SALES_DETAIL = "__unknown__";

export function rowSalesChannel(row: SalesFilterRow): "direct" | "agency" {
  return row.channelKind ?? (row.account === "gf_direct" ? "direct" : "agency");
}

export function salesDetail(row: SalesFilterRow, managers: Record<string, string>): string {
  return rowSalesChannel(row) === "direct"
    ? managers[row.symbol]?.trim() || UNKNOWN_SALES_DETAIL
    : row.account || UNKNOWN_SALES_DETAIL;
}

export function filterBySalesChannel<T extends SalesFilterRow>(rows: T[], managers: Record<string, string>, channel: SalesChannelFilter, detail: string): T[] {
  return rows.filter((row) => channel === "all" ||
    (rowSalesChannel(row) === channel && (detail === "all" || salesDetail(row, managers) === detail)));
}

export function salesDetails(rows: SalesFilterRow[], managers: Record<string, string>, channel: SalesChannelFilter): string[] {
  if (channel === "all") return [];
  return [...new Set(rows.filter((row) => rowSalesChannel(row) === channel).map((row) => salesDetail(row, managers)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
