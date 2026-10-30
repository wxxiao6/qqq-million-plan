import { beijingTodayISO } from "@/lib/format";
import { portfolioSnapshotStatement } from "../market/nav-d1";
import type { D1Statement, ReconcileD1 } from "./reconcile-d1";

/** The mutation and same-day investment snapshot commit together. */
export async function writeWithSnapshotD1(db: ReconcileD1, sql: string, values: (string | number | null)[]) {
  await db.batch([db.prepare(sql).bind(...values), portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement]);
}
