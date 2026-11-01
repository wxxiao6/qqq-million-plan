"use server";

import { requireUser } from "@/server/auth/context";
import { revalidatePath } from "next/cache";
import { resolveHoldingNumbers } from "@/lib/holding-input";
import { isISODate, todayISO } from "@/lib/format";
import { getDb } from "../db";
import { createPendingSubscription, resolvePendingSubscription, type PendingInput } from "./pending";
import {
  type Account,
  type Exposure,
  type PositionStatus,
  upsertTodaySnapshot,
} from "./index";
import { deletePositionD1, savePositionD1 } from "./positions-d1";
import { createPendingSubscriptionD1, resolvePendingSubscriptionD1 } from "./pending-d1";
import { writeWithSnapshotD1 } from "./snapshot-write-d1";
import { importNavCsvD1, importPositionsCsvD1 } from "./import-d1";
import type { ReconcileD1 } from "./reconcile-d1";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addPendingSubscription(input: PendingInput): Promise<ActionResult> {
  await requireUser();
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const result = await createPendingSubscriptionD1(await cloudDatabase(), input);
    if (result.ok) invalidateViews();
    return result.ok ? { ok: true } : result;
  }
  const result = createPendingSubscription(input);
  if (result.ok) touch();
  return result.ok ? { ok: true } : result;
}

export async function finishPendingSubscription(input: Parameters<typeof resolvePendingSubscription>[0]): Promise<ActionResult> {
  await requireUser();
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const result = await resolvePendingSubscriptionD1(await cloudDatabase(), input);
    if (result.ok) invalidateViews();
    return result.ok ? { ok: true } : result;
  }
  const result = resolvePendingSubscription(input);
  if (result.ok) touch();
  return result.ok ? { ok: true } : result;
}

const ACCOUNTS: Account[] = ["alipay", "gf_direct", "cmb", "jd", "other"];
const STATUSES: PositionStatus[] = ["settled", "pending"];
const EXPOSURES: Exposure[] = ["nasdaq", "gold", "crypto"];

function touch() {
  upsertTodaySnapshot();
  invalidateViews();
}

function invalidateViews() {
  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/holdings/overview");
  revalidatePath("/holdings/manage");
  revalidatePath("/dca");
  revalidatePath("/quota");
}

async function cloudDatabase(): Promise<ReconcileD1> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return (getCloudflareContext().env as unknown as { DB: ReconcileD1 }).DB;
}

async function cloudWriteWithSnapshot(sql: string, values: (string | number | null)[]): Promise<ActionResult> {
  try {
    await writeWithSnapshotD1(await cloudDatabase(), sql, values);
    invalidateViews();
    return { ok: true };
  } catch { return { ok: false, error: "保存失败，请刷新后重试" }; }
}

function duplicateNasdaqHoldingMessage(db: ReturnType<typeof getDb>, account: string, symbol: string): string | null {
  const rows = db.prepare("SELECT status, dca_plan_id FROM positions WHERE exposure = 'nasdaq' AND account = ? AND symbol = ? AND status IN ('pending', 'settled')").all(account, symbol) as { status: string; dca_plan_id: number | null }[];
  if (!rows.length) return null;
  if (rows.some((row) => row.status === "settled" && row.dca_plan_id == null)) return "该购买平台已有此基金的持仓，请在持仓管理中编辑已有持仓";
  if (rows.some((row) => row.dca_plan_id != null)) return "该购买平台已有此基金的定投持仓，请在定投管理的执行记录中调整";
  return "该购买平台已有此基金的待确认申购，请在持仓管理中处理原有记录";
}

export async function savePosition(input: {
  id?: number;
  account: Account;
  exposure?: Exposure;
  symbol: string;
  shares?: number | null;
  cost?: number | null;
  unitCost?: number | null;
  status: PositionStatus;
  note?: string;
}): Promise<ActionResult> {
  await requireUser();
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const result = await savePositionD1(await cloudDatabase(), input);
    if (result.ok) invalidateViews();
    return result;
  }
  if (!ACCOUNTS.includes(input.account)) return { ok: false, error: "账户不合法" };
  const exposure = input.exposure ?? "nasdaq";
  if (!EXPOSURES.includes(exposure)) return { ok: false, error: "敞口不合法" };
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "基金代码不能为空" };
  if (!STATUSES.includes(input.status)) return { ok: false, error: "状态不合法" };
  if (input.status === "pending") return { ok: false, error: "请使用“补录待确认申购”录入扣款" };
  const amounts = resolveHoldingNumbers(input);
  if (!amounts.ok) return amounts;

  const { shares, cost } = amounts;
  const now = new Date().toISOString();
  const db = getDb();
  try {
    db.transaction(() => {
      const existing = input.id ? db.prepare(
        "SELECT status, dca_plan_id, account, symbol, exposure FROM positions WHERE id = ?",
      ).get(input.id) as { status: PositionStatus; dca_plan_id: number | null; account: string; symbol: string; exposure: Exposure } | undefined : undefined;
      if (input.id && !existing) throw new Error("找不到持仓");
      if (existing && (existing.status !== "settled" || existing.dca_plan_id != null)) throw new Error("请使用待确认处理操作；定投持仓不可在此改写");
      const keyChanged = !existing || existing.account !== input.account || existing.symbol !== symbol || existing.exposure !== exposure;
      const duplicateMessage = exposure === "nasdaq" && keyChanged ? duplicateNasdaqHoldingMessage(db, input.account, symbol) : null;
      if (duplicateMessage) throw new Error(duplicateMessage);
      if (input.id) {
        db.prepare(`UPDATE positions SET account = ?, exposure = ?, symbol = ?, shares = ?, cost = ?,
          status = ?, note = ?, updated_at = ? WHERE id = ?`)
          .run(input.account, exposure, symbol, shares, cost, input.status, input.note?.trim() || null, now, input.id);
      } else {
        db.prepare(`INSERT INTO positions (account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(input.account, exposure, symbol, shares, cost, input.status, input.note?.trim() || null, todayISO(), now);
      }
    }).immediate();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "保存持仓失败" };
  }
  touch();
  return { ok: true };
}

export async function deletePosition(id: number): Promise<ActionResult> {
  await requireUser();
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const result = await deletePositionD1(await cloudDatabase(), id);
    if (result.ok) invalidateViews();
    return result;
  }
  const existing = getDb().prepare("SELECT status, dca_plan_id FROM positions WHERE id = ?").get(id) as { status: PositionStatus; dca_plan_id: number | null } | undefined;
  if (!existing) return { ok: false, error: "找不到持仓" };
  if (existing.status === "pending" || existing.dca_plan_id != null) return { ok: false, error: "待确认申购请标记失败或撤单；定投持仓不可直接删除" };
  getDb().prepare("DELETE FROM positions WHERE id = ?").run(id);
  touch();
  return { ok: true };
}

export async function saveNav(input: {
  symbol: string;
  asOf: string;
  nav: number;
}): Promise<ActionResult> {
  await requireUser();
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "基金代码不能为空" };
  if (!isISODate(input.asOf)) return { ok: false, error: "日期格式须为 YYYY-MM-DD" };
  if (!Number.isFinite(input.nav) || input.nav <= 0) {
    return { ok: false, error: "净值必须大于 0" };
  }
  if (process.env.CLOUDFLARE_RUNTIME === "1") return cloudWriteWithSnapshot(
    `INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES (?, ?, ?, 'manual')
     ON CONFLICT(symbol, as_of) DO UPDATE SET nav = excluded.nav, source = 'manual'`, [symbol, input.asOf, input.nav]);
  getDb()
    .prepare(
      `INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES (?, ?, ?, 'manual')
       ON CONFLICT(symbol, as_of) DO UPDATE SET nav = excluded.nav, source = 'manual'`,
    )
    .run(symbol, input.asOf, input.nav);
  touch();
  return { ok: true };
}

export async function savePortfolioSnapshot(input: {
  asOf: string;
  dynamicMv: number;
}): Promise<ActionResult> {
  await requireUser();
  if (!isISODate(input.asOf)) return { ok: false, error: "日期格式须为 YYYY-MM-DD" };
  if (!Number.isFinite(input.dynamicMv) || input.dynamicMv < 0) {
    return { ok: false, error: "动态市值不能为负数" };
  }
  if (process.env.CLOUDFLARE_RUNTIME === "1") return cloudWriteWithSnapshot(
    `INSERT INTO portfolio_snapshots (as_of, dynamic_mv) VALUES (?, ?)
     ON CONFLICT(as_of) DO UPDATE SET dynamic_mv = excluded.dynamic_mv`, [input.asOf, input.dynamicMv]);
  getDb()
    .prepare(
      `INSERT INTO portfolio_snapshots (as_of, dynamic_mv) VALUES (?, ?)
       ON CONFLICT(as_of) DO UPDATE SET dynamic_mv = excluded.dynamic_mv`,
    )
    .run(input.asOf, input.dynamicMv);
  touch();
  return { ok: true };
}

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
}

export async function importPositionsCsv(csv: string): Promise<ActionResult> {
  await requireUser();
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const result = await importPositionsCsvD1(await cloudDatabase(), csv);
    if (result.ok) invalidateViews();
    return result;
  }
  const rows = parseCsv(csv);
  if (rows.length === 0) return { ok: false, error: "CSV 为空" };
  const start = /account|账户/i.test(rows[0][0] ?? "") ? 1 : 0;
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO positions (
       account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at
     ) VALUES (?, 'nasdaq', ?, ?, ?, ?, NULL, ?, ?)`,
  );
  try {
    const run = db.transaction(() => {
      for (const row of rows.slice(start)) {
        const [account, symbol, sharesRaw, costRaw, statusRaw] = row;
        if (!ACCOUNTS.includes(account as Account)) {
          throw new Error(`账户不合法：${account}`);
        }
        if (!symbol) throw new Error("基金代码不能为空");
        const shares = Number(sharesRaw);
        const cost = Number(costRaw);
        const status = (statusRaw || "settled") as PositionStatus;
        if (!Number.isFinite(shares) || shares <= 0) throw new Error("份额不合法");
        if (!Number.isFinite(cost) || cost < 0) throw new Error("成本不合法");
        if (!STATUSES.includes(status)) throw new Error("状态不合法");
        const duplicateMessage = duplicateNasdaqHoldingMessage(db, account, symbol);
        if (duplicateMessage) throw new Error(`${symbol}：${duplicateMessage}`);
        insert.run(account, symbol, shares, cost, status, todayISO(), now);
      }
    });
    run.immediate();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "导入失败" };
  }
  touch();
  return { ok: true };
}

export async function importNavCsv(csv: string): Promise<ActionResult> {
  await requireUser();
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const result = await importNavCsvD1(await cloudDatabase(), csv);
    if (result.ok) invalidateViews();
    return result;
  }
  const rows = parseCsv(csv);
  if (rows.length === 0) return { ok: false, error: "CSV 为空" };
  const start = /symbol|代码/i.test(rows[0][0] ?? "") ? 1 : 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES (?, ?, ?, 'manual')
     ON CONFLICT(symbol, as_of) DO UPDATE SET nav = excluded.nav, source = 'manual'`,
  );
  try {
    const run = db.transaction(() => {
      for (const row of rows.slice(start)) {
        const [symbol, asOf, navRaw] = row;
        if (!symbol) throw new Error("基金代码不能为空");
        if (!isISODate(asOf)) throw new Error(`日期不合法：${asOf}`);
        const nav = Number(navRaw);
        if (!Number.isFinite(nav) || nav <= 0) throw new Error("净值不合法");
        insert.run(symbol, asOf, nav);
      }
    });
    run();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "导入失败" };
  }
  touch();
  return { ok: true };
}
