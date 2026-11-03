export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.CLOUDFLARE_RUNTIME !== "1") {
    const { getDb } = await import("@/server/db");
    getDb();
    if (process.env.NEXT_PHASE !== "phase-production-build" && process.env.NODE_ENV !== "test") {
      const { startLocalFundNavSync } = await import("@/server/jobs/local-fund-nav");
      startLocalFundNavSync();
    }
  }
}
