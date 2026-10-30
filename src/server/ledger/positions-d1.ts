import { beijingTodayISO } from "@/lib/format";
import { resolveHoldingNumbers } from "@/lib/holding-input";
import { portfolioSnapshotStatement } from "../market/nav-d1";
import type { Account, Exposure, PositionStatus } from "./index";
import type { D1Statement, ReconcileD1 } from "./reconcile-d1";

export type PositionInput = { id?: number; account: Account; exposure?: Exposure; symbol: string; shares?: number | null;
  cost?: number | null; unitCost?: number | null; status: PositionStatus; note?: string };
type Result = { ok: true } | { ok: false; error: string };
type Existing = { status: PositionStatus; dca_plan_id: number | null; account: string; symbol: string; exposure: Exposure; fingerprint: string };
const ROW_SIGNATURE = `SELECT json_array(id,account,exposure,symbol,shares,cost,status,note,recorded_on,updated_at,dca_plan_id) FROM positions WHERE id=?`;

function duplicateMessage(rows: Array<{ status: string; dca_plan_id: number | null }>): string | null {
  if (!rows.length) return null;
  if (rows.some((row) => row.status === "settled" && row.dca_plan_id == null)) return "该购买平台已有此基金的持仓，请在持仓管理中编辑已有持仓";
  if (rows.some((row) => row.dca_plan_id != null)) return "该购买平台已有此基金的定投持仓，请在定投管理的执行记录中调整";
  return "该购买平台已有此基金的待确认申购，请在持仓管理中处理原有记录";
}

export async function savePositionD1(db: ReconcileD1, input: PositionInput): Promise<Result> {
  if (!["alipay", "gf_direct", "cmb", "jd", "other"].includes(input.account)) return { ok: false, error: "账户不合法" };
  const exposure = input.exposure ?? "nasdaq";
  if (!["nasdaq", "gold", "crypto"].includes(exposure)) return { ok: false, error: "敞口不合法" };
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "基金代码不能为空" };
  if (!["settled", "pending"].includes(input.status)) return { ok: false, error: "状态不合法" };
  if (input.status === "pending") return { ok: false, error: "请使用“补录待确认申购”录入扣款" };
  const amounts = resolveHoldingNumbers(input);
  if (!amounts.ok) return amounts;
  const id = input.id ?? -1;
  const bind = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
  const [existingRows, duplicates] = await db.batch([
    bind(`SELECT status,dca_plan_id,account,symbol,exposure,(${ROW_SIGNATURE}) AS fingerprint FROM positions WHERE id=?`, id, id),
    bind("SELECT status,dca_plan_id FROM positions WHERE exposure='nasdaq' AND account=? AND symbol=? AND status IN ('pending','settled')", input.account, symbol),
  ]);
  const existing = existingRows.results[0] as Existing | undefined;
  if (input.id && !existing) return { ok: false, error: "找不到持仓" };
  if (existing && (existing.status !== "settled" || existing.dca_plan_id != null)) return { ok: false, error: "请使用待确认处理操作；定投持仓不可在此改写" };
  const keyChanged = !existing || existing.account !== input.account || existing.symbol !== symbol || existing.exposure !== exposure;
  if (exposure === "nasdaq" && keyChanged) {
    const message = duplicateMessage(duplicates.results as Array<{ status: string; dca_plan_id: number | null }>);
    if (message) return { ok: false, error: message };
  }
  const guard = bind(`INSERT INTO app_kv(key,value) SELECT '__position_guard__',NULL WHERE
    (?=1 AND (${ROW_SIGNATURE}) IS NOT ?) OR (?=1 AND EXISTS (SELECT 1 FROM positions
      WHERE exposure='nasdaq' AND account=? AND symbol=? AND status IN ('pending','settled')))`,
  existing ? 1 : 0, id, existing?.fingerprint ?? null, exposure === "nasdaq" && keyChanged ? 1 : 0, input.account, symbol);
  const now = new Date().toISOString();
  const write = existing
    ? bind(`UPDATE positions SET account=?,exposure=?,symbol=?,shares=?,cost=?,status=?,note=?,updated_at=? WHERE id=?`,
      input.account, exposure, symbol, amounts.shares, amounts.cost, input.status, input.note?.trim() || null, now, id)
    : bind(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      input.account, exposure, symbol, amounts.shares, amounts.cost, input.status, input.note?.trim() || null, beijingTodayISO(), now);
  try {
    await db.batch([guard, write, portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement]);
    return { ok: true };
  } catch { return { ok: false, error: "保存持仓失败，请刷新后重试" }; }
}

export async function deletePositionD1(db: ReconcileD1, id: number): Promise<Result> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "找不到持仓" };
  const [rows] = await db.batch([db.prepare(`SELECT status,dca_plan_id,(${ROW_SIGNATURE}) AS fingerprint FROM positions WHERE id=?`).bind(id, id)]);
  const row = rows.results[0] as Pick<Existing, "status" | "dca_plan_id" | "fingerprint"> | undefined;
  if (!row) return { ok: false, error: "找不到持仓" };
  if (row.status === "pending" || row.dca_plan_id != null) return { ok: false, error: "待确认申购请标记失败或撤单；定投持仓不可直接删除" };
  try {
    await db.batch([
      db.prepare(`INSERT INTO app_kv(key,value) SELECT '__position_delete_guard__',NULL WHERE (${ROW_SIGNATURE}) IS NOT ?`).bind(id, row.fingerprint),
      db.prepare("DELETE FROM positions WHERE id=?").bind(id),
      portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement,
    ]);
    return { ok: true };
  } catch { return { ok: false, error: "删除持仓失败，请刷新后重试" }; }
}
