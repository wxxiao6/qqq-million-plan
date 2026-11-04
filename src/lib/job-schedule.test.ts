import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_CRONS, navPublicationSlot, isNavRefreshDue } from "./job-schedule";

describe("NAV refresh schedule", () => {
  it("configures exactly eight evening refreshes at 45-minute intervals", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(config.triggers.crons).toEqual([JOB_CRONS.dca, JOB_CRONS.nav, JOB_CRONS.quotaCheck, JOB_CRONS.info]);
    const times: string[] = [];
    for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay++) {
      const hour = Math.floor(minuteOfDay / 60), minute = minuteOfDay % 60;
      const [minutes, hours] = JOB_CRONS.nav.split(" ");
      expect(minutes).toBe("*/15");
      expect(hours).toBe("10-15");
      if (minute % 15 || hour < 10 || hour > 15) continue;
      const date = new Date(Date.UTC(2026, 10, 4, hour, minute));
      if (!isNavRefreshDue(date)) continue;
      const time = `${String(hour + 8).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      expect(navPublicationSlot(date)).toBe(`2026-11-04:${time}`);
      times.push(time);
    }
    expect(isNavRefreshDue(new Date("2026-11-04T09:45:00Z"))).toBe(false);
    expect(isNavRefreshDue(new Date("2026-11-04T16:00:00Z"))).toBe(false);
    expect(times).toEqual(["18:00", "18:45", "19:30", "20:15", "21:00", "21:45", "22:30", "23:15"]);
  });
});
