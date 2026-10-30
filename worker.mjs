import handler from "./.open-next/worker.js";
import { runScheduledDca } from "./src/server/jobs/scheduled-dca.ts";

export default {
  fetch: handler.fetch,
  async scheduled(event, env) {
    await runScheduledDca(env.DB, new Date(event.scheduledTime));
  },
};
