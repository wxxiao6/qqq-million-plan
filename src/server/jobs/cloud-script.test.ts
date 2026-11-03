import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps the retired local scheduler harmless without credentials or network", () => {
  const result = spawnSync(process.execPath, ["scripts/cloud-jobs.mjs"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CLOUD_JOB_TOKEN: "", CLOUD_SITE_URL: "" },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("local polling is retired");
  expect(result.stderr).toBe("");
});
