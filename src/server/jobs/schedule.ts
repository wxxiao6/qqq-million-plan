import { reconcileDueDcaPlans } from "../ledger/recent-pending";
import { beijingHourMinute, beijingTodayISO } from "@/lib/format";
import { syncNasdaqFundInfo } from "../market/biying";
import { syncNasdaqFundNav } from "../market/biying";
import { syncTiantianAgencyQuota, tiantianNavSource } from "../market/tiantian";
import { jobSucceededOn, readJob, type JobName } from "./status";

let started = false;
let runningB = false;

const RETRY_MS = 30 * 60 * 1000;

function recentlyFailed(name: JobName): boolean {
  const last = readJob(name);
  if (!last || last.ok) return false;
  const at = new Date(last.at).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < RETRY_MS;
}

async function tick() {
  const now = new Date();
  const date = beijingTodayISO(now);
  const hm = beijingHourMinute(now);
  const dcaErrors = reconcileDueDcaPlans(date);
  if (dcaErrors.length) console.error("定投自动记账失败", dcaErrors);

  if (hm >= "22:00" && (!jobSucceededOn("tiantian_nav", date) || !jobSucceededOn("tiantian_quota", date)) && !recentlyFailed("tiantian_quota")) {
    if (!runningB) {
      runningB = true;
      try {
        await syncNasdaqFundNav(now, fetch, tiantianNavSource);
        await syncTiantianAgencyQuota(now);
      } finally {
        runningB = false;
      }
    }
  }

  // 基金概况数据每周一凌晨同步，与每日净值任务错开以控制必盈调用量。
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(now);
  if (weekday === "Mon" && hm >= "01:00" && !jobSucceededOn("biying_info", date) && !recentlyFailed("biying_info")) {
    if (!runningB) {
      runningB = true;
      try { await syncNasdaqFundInfo(now); } finally { runningB = false; }
    }
  }

}

export function startJobScheduler() {
  if (started) return;
  if (process.env.VITEST) return;
  if (process.env.DISABLE_JOBS === "1") return;
  started = true;
  void tick();
  setInterval(() => void tick(), 30_000);
}
