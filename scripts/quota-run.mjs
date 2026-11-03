import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optionalRead, syncCollectionState } from "./upload-quota.mjs";

export async function quotaRun(action, dir, options = {}) {
  dir = path.resolve(dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filename = path.join(dir, "collection-run.json");
  const previous = await optionalRead(filename);
  let state = previous ? JSON.parse(previous) : null;
  if (action === "start") {
    if (!state) {
      state = { runId: randomUUID(), startedAt: new Date().toISOString(), status: "collecting", collectedCount: 0 };
      await writeFile(filename, JSON.stringify(state, null, 2)+"\n", { mode: 0o600, flag: "wx" });
    }
  } else if (action === "finish" || action === "fail") {
    if (!state) throw new Error("Start the collection run first");
    const payload = JSON.parse(await optionalRead(path.join(dir, "payload.json")) || '{"items":[]}');
    state.status = action === "fail" ? "failed" : "collected";
    state.collectedCount = Array.isArray(payload.items) ? payload.items.length : 0;
    state.finishedAt = new Date().toISOString();
    await writeFile(filename, JSON.stringify(state, null, 2)+"\n", { mode: 0o600 });
  } else throw new Error("Usage: pnpm quota:run start|finish|fail /absolute/run-directory");
  try { await syncCollectionState(dir, options); return { ...state, reported: true }; }
  catch (error) { return { ...state, reported: false, error: error.message }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const name of [".env.local", ".env"]) {
    try { loadEnvFile(new URL(`../${name}`, import.meta.url)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  try {
    const [action, dir] = process.argv.slice(2);
    if (!dir) throw new Error("Usage: pnpm quota:run start|finish|fail /absolute/run-directory");
    console.log(JSON.stringify(await quotaRun(action, dir), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
