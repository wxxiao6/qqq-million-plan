import handler from "./.open-next/worker.js";
import { runScheduledDca } from "./src/server/jobs/scheduled-dca.ts";
import { handleMarketJob, MARKET_JOB_PATH, runCloudMarket } from "./src/server/jobs/cloud-market.ts";
import { checkQuotaReceipt } from "./src/server/jobs/quota-status.ts";
import { JOB_CRONS, isNavRefreshDue } from "./src/lib/job-schedule.ts";

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname === MARKET_JOB_PATH) return handleMarketJob(request, env.DB, env.CLOUD_JOB_TOKEN);
    return handler.fetch(request, env, ctx);
  },
  async scheduled(event, env) {
    const at = new Date(event.scheduledTime);
    if (event.cron === JOB_CRONS.nav) {
      if (!isNavRefreshDue(at)) return;
      return runCloudMarket(env.DB, env.JOBS_SELF, env.CLOUD_JOB_TOKEN, "nav", at);
    }
    switch (event.cron) {
      case JOB_CRONS.dca: return runScheduledDca(env.DB, at);
      case JOB_CRONS.info: return runCloudMarket(env.DB, env.JOBS_SELF, env.CLOUD_JOB_TOKEN, "info", at);
      case JOB_CRONS.quotaCheck: return checkQuotaReceipt(env.DB, at);
      default: throw new Error(`Unknown scheduled job: ${event.cron}`);
    }
  },
};
