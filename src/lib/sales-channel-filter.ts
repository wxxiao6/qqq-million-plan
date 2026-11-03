export type SalesChannelFilter = "all" | "direct" | "agency";
export type SalesFilterRow = { symbol: string; account: string | null; channelKind?: "direct" | "agency" };
export const UNKNOWN_SALES_DETAIL = "__unknown__";

// Catalog entries use short names while provider identities may use legal names.
export function normalizeManager(manager: string): string {
  const name = manager.trim().replace(/基金管理(?:股份有限公司|有限责任公司|有限公司)$/, "基金");
  // Provider records may identify Dacheng's direct-sales offices as the manager.
  if (/^大成基金(?:上海|深圳)投资理财中心$/.test(name)) return "大成基金";
  return name;
}

export function rowSalesChannel(row: SalesFilterRow): "direct" | "agency" {
  return row.channelKind ?? (row.account === "gf_direct" ? "direct" : "agency");
}

export function salesDetail(row: SalesFilterRow, managers: Record<string, string>): string {
  return rowSalesChannel(row) === "direct"
    ? normalizeManager(managers[row.symbol] ?? "") || UNKNOWN_SALES_DETAIL
    : row.account || UNKNOWN_SALES_DETAIL;
}

export function filterBySalesChannel<T extends SalesFilterRow>(rows: T[], managers: Record<string, string>, channel: SalesChannelFilter, detail: string): T[] {
  const normalizedDetail = channel === "direct" ? normalizeManager(detail) : detail;
  return rows.filter((row) => channel === "all" ||
    (rowSalesChannel(row) === channel && (detail === "all" || salesDetail(row, managers) === normalizedDetail)));
}

export function salesDetails(rows: SalesFilterRow[], managers: Record<string, string>, channel: SalesChannelFilter): string[] {
  if (channel === "all") return [];
  return [...new Set(rows.filter((row) => rowSalesChannel(row) === channel).map((row) => salesDetail(row, managers)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
