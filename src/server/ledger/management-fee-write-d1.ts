import { isISODate } from "@/lib/format";
import type { ManagementFeeEntry } from "@/lib/management-fee";
import { portfolioSnapshotStatement } from "../market/nav-d1";
import type { Account } from "./index";
import { managementFeeRebuildStatements, readManagementFeesD1 } from "./management-fees-d1";
import type { D1Statement, ReconcileD1 } from "./reconcile-d1";

type Result = { ok: true } | { ok: false; error: string };
type FeeInput = { id?: number; symbol: string; account: Account; feeDate: string; amount: number; note?: string };
const ENTRY_SIGNATURE = `SELECT json_array(id,symbol,account,fee_date,amount,note,created_at,updated_at) FROM holding_management_fee_entries WHERE id=?`;

export async function saveManagementFeeEntryD1(db: ReconcileD1, input: FeeInput): Promise<Result> {
  if (!["alipay", "gf_direct", "cmb", "jd", "other"].includes(input.account)) return { ok: false, error: "账户不合法" };
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "基金代码不能为空" };
  if (!isISODate(input.feeDate)) return { ok: false, error: "日期格式须为 YYYY-MM-DD" };
  const snapshot = await readManagementFeesD1(db);
  if (input.feeDate < snapshot.start) return { ok: false, error: "管理费只能从功能上线日开始录入" };
  if (!Number.isFinite(input.amount) || input.amount < 0) return { ok: false, error: "管理费金额不能为负数" };
  const [funds] = await db.batch([db.prepare("SELECT 1 FROM nasdaq_funds WHERE code=? AND currency='CNY'").bind(symbol)]);
  if (!funds.results.length) return { ok: false, error: "请选择目录中的人民币纳指基金" };
  const now = new Date().toISOString();
  const previous = snapshot.entries.find((entry) => entry.symbol === symbol && entry.account === input.account && entry.feeDate === input.feeDate);
  const entries = snapshot.entries.filter((entry) => !(entry.symbol === symbol && entry.account === input.account && entry.feeDate === input.feeDate));
  if (input.feeDate <= snapshot.asOf) entries.push({ id: previous?.id ?? input.id ?? -1, symbol, account: input.account,
    feeDate: input.feeDate, amount: input.amount, note: input.note?.trim() || null, createdAt: previous?.createdAt ?? now, updatedAt: now });
  entries.sort((a, b) => a.feeDate.localeCompare(b.feeDate) || a.id - b.id);
  const [guard, ...feeWrites] = managementFeeRebuildStatements(db, { ...snapshot, entries }, [{ symbol, account: input.account }], now);
  try {
    await db.batch([
      guard,
      db.prepare(`INSERT INTO app_kv(key,value) SELECT '__fee_fund_guard__',NULL WHERE NOT EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=? AND currency='CNY')`).bind(symbol),
      db.prepare(`INSERT INTO holding_management_fee_entries(id,symbol,account,fee_date,amount,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol,account,fee_date) DO UPDATE SET amount=excluded.amount,note=excluded.note,updated_at=excluded.updated_at`)
        .bind(input.id ?? null, symbol, input.account, input.feeDate, input.amount, input.note?.trim() || null, now, now),
      ...feeWrites,
      portfolioSnapshotStatement(db, snapshot.asOf) as D1Statement,
    ]);
    return { ok: true };
  } catch { return { ok: false, error: "保存管理费失败，请刷新后重试" }; }
}

export async function deleteManagementFeeEntryD1(db: ReconcileD1, id: number): Promise<Result> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "管理费记录不合法" };
  const [rows] = await db.batch([db.prepare(`SELECT symbol,account,(${ENTRY_SIGNATURE}) AS fingerprint FROM holding_management_fee_entries WHERE id=?`).bind(id, id)]);
  const entry = rows.results[0] as { symbol: string; account: Account; fingerprint: string } | undefined;
  if (!entry) return { ok: false, error: "找不到管理费记录" };
  const snapshot = await readManagementFeesD1(db);
  const entries: ManagementFeeEntry[] = snapshot.entries.filter((row) => row.id !== id);
  const [guard, ...feeWrites] = managementFeeRebuildStatements(db, { ...snapshot, entries }, [{ symbol: entry.symbol, account: entry.account }]);
  try {
    await db.batch([
      guard,
      db.prepare(`INSERT INTO app_kv(key,value) SELECT '__fee_entry_guard__',NULL WHERE (${ENTRY_SIGNATURE}) IS NOT ?`).bind(id, entry.fingerprint),
      db.prepare("DELETE FROM holding_management_fee_entries WHERE id=?").bind(id),
      ...feeWrites,
      portfolioSnapshotStatement(db, snapshot.asOf) as D1Statement,
    ]);
    return { ok: true };
  } catch { return { ok: false, error: "删除管理费失败，请刷新后重试" }; }
}
