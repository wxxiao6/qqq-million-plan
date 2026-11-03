/** Trusted SQL fragment, with exactly one bound delta parameter. Existing totals
 * and incoming money deltas are converted to integer cents before addition. */
export function investedTotalDeltaSql(direction: "add" | "subtract" = "add"): string {
  return `(CAST(ROUND(invested_total*100,0) AS INTEGER) ${direction === "add" ? "+" : "-"} CAST(ROUND(?*100,0) AS INTEGER))/100.0`;
}
