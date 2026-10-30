export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.CLOUDFLARE_RUNTIME !== "1") {
    const { getDb } = await import("@/server/db");
    getDb();
  }
}
