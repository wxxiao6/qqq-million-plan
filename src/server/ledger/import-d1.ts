import { beijingTodayISO, isISODate } from "@/lib/format";
import { portfolioSnapshotStatement } from "../market/nav-d1";
import type { D1Statement, ReconcileD1 } from "./reconcile-d1";

type Result = { ok: true } | { ok: false; error: string };
type Holding = { account: string; symbol: string; status: string; dca_plan_id: number | null };
const parse = (csv: string) => csv.trim().split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim())).filter((row) => row.some(Boolean));

export async function importPositionsCsvD1(db: ReconcileD1, csv: string): Promise<Result> {
  const rows = parse(csv);
  if (!rows.length) return { ok: false, error: "CSV 为空" };
  const data = rows.slice(/account|账户/i.test(rows[0][0] ?? "") ? 1 : 0);
  const [existing] = await db.batch([db.prepare("SELECT account,symbol,status,dca_plan_id FROM positions WHERE exposure='nasdaq' AND status IN ('pending','settled')").bind()]);
  const holdings = existing.results as Holding[];
  const statements: D1Statement[] = [];
  const now = new Date().toISOString(), today = beijingTodayISO();
  for (const [account, symbol, sharesRaw, costRaw, statusRaw] of data) {
    if (!["alipay", "gf_direct", "cmb", "jd", "other"].includes(account)) return { ok: false, error: `账户不合法：${account}` };
    if (!symbol) return { ok: false, error: "基金代码不能为空" };
    const shares = Number(sharesRaw), cost = Number(costRaw), status = statusRaw || "settled";
    if (!Number.isFinite(shares) || shares <= 0) return { ok: false, error: "份额不合法" };
    if (!Number.isFinite(cost) || cost < 0) return { ok: false, error: "成本不合法" };
    if (!["settled", "pending"].includes(status)) return { ok: false, error: "状态不合法" };
    const duplicates = holdings.filter((item) => item.account === account && item.symbol === symbol);
    if (duplicates.length) {
      const message = duplicates.some((item) => item.status === "settled" && item.dca_plan_id == null)
        ? "该购买平台已有此基金的持仓，请在持仓管理中编辑已有持仓"
        : duplicates.some((item) => item.dca_plan_id != null) ? "该购买平台已有此基金的定投持仓，请在定投管理的执行记录中调整" : "该购买平台已有此基金的待确认申购，请在持仓管理中处理原有记录";
      return { ok: false, error: `${symbol}：${message}` };
    }
    holdings.push({ account, symbol, status, dca_plan_id: null });
    statements.push(db.prepare(`INSERT INTO app_kv(key,value) SELECT '__csv_guard__',NULL WHERE EXISTS
      (SELECT 1 FROM positions WHERE exposure='nasdaq' AND account=? AND symbol=? AND status IN ('pending','settled'))`).bind(account, symbol));
    statements.push(db.prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,updated_at)
      VALUES (?, 'nasdaq', ?, ?, ?, ?, NULL, ?, ?)`).bind(account, symbol, shares, cost, status, today, now));
  }
  statements.push(portfolioSnapshotStatement(db, today) as D1Statement);
  try { await db.batch(statements); return { ok: true }; }
  catch { return { ok: false, error: "导入失败，请刷新后重试" }; }
}

export async function importNavCsvD1(db: ReconcileD1, csv: string): Promise<Result> {
  const rows = parse(csv);
  if (!rows.length) return { ok: false, error: "CSV 为空" };
  const statements: D1Statement[] = [];
  for (const [symbol, asOf, navRaw] of rows.slice(/symbol|代码/i.test(rows[0][0] ?? "") ? 1 : 0)) {
    if (!symbol) return { ok: false, error: "基金代码不能为空" };
    if (!isISODate(asOf)) return { ok: false, error: `日期不合法：${asOf}` };
    const nav = Number(navRaw);
    if (!Number.isFinite(nav) || nav <= 0) return { ok: false, error: "净值不合法" };
    statements.push(db.prepare(`INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES (?, ?, ?, 'manual')
      ON CONFLICT(symbol,as_of) DO UPDATE SET nav=excluded.nav,source='manual'`).bind(symbol, asOf, nav));
  }
  statements.push(portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement);
  try { await db.batch(statements); return { ok: true }; }
  catch { return { ok: false, error: "导入失败，请刷新后重试" }; }
}
