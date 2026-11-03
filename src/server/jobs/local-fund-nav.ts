import { getDb } from "../db";
import { syncNasdaqFundNav } from "../market/biying";
import { tiantianNavSource } from "../market/tiantian";

export { navPublicationSlot as localNavSlot } from "@/lib/job-schedule";
import { navPublicationSlot as localNavSlot } from "@/lib/job-schedule";

/** One persisted completion per half-hour publication slot; failures retry next tick.
 * The lease prevents concurrent Next.js processes from duplicating the job. */
export async function runLocalNavTick(now = new Date(), database = getDb(), refresh = () => syncNasdaqFundNav(now, fetch, tiantianNavSource)) {
  const slot = localNavSlot(now);
  if (!slot) return;
  const completed = database.prepare("SELECT value FROM app_kv WHERE key='job:local_nav:completed'").get() as { value: string } | undefined;
  if (completed?.value === slot) return;
  const lease = JSON.stringify({ id: crypto.randomUUID(), expiresAt: now.getTime() + 15 * 60_000 });
  const acquired = database.prepare(`INSERT INTO app_kv(key,value) VALUES('job:local_nav:lease',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(app_kv.value,'$.expiresAt')<=?`).run(lease, now.getTime());
  if (!acquired.changes) return;
  try {
    const result = await refresh();
    if (result.ok) database.prepare(`INSERT INTO app_kv(key,value) VALUES('job:local_nav:completed',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(slot);
  } finally { database.prepare("DELETE FROM app_kv WHERE key='job:local_nav:lease' AND value=?").run(lease); }
}

export function startLocalFundNavSync() {
  const state = globalThis as typeof globalThis & { personalFundNavTimer?: ReturnType<typeof setInterval> };
  if (state.personalFundNavTimer) return;
  const tick = () => { void runLocalNavTick().catch(() => console.error("本地基金净值同步失败，下个周期重试")); };
  state.personalFundNavTimer = setInterval(tick, 15 * 60_000);
  state.personalFundNavTimer.unref();
  tick();
}
