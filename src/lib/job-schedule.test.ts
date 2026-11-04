import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_CRONS, navPublicationSlot } from "./job-schedule";

describe("NAV refresh schedule", () => {
  it("configures exactly six evening refreshes at hourly intervals", () => {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(config.triggers.crons).toEqual([JOB_CRONS.dca, JOB_CRONS.nav, JOB_CRONS.quotaCheck, JOB_CRONS.info]);
    const times: string[] = [];
    for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay++) {
      const hour = Math.floor(minuteOfDay / 60), minute = minuteOfDay % 60;
      const [minutes, hours] = JOB_CRONS.nav.split(" ");
      expect(minutes).toBe("0");
      expect(hours).toBe("10-15");
      if (minute !== Number(minutes) || hour < 10 || hour > 15) continue;
      const date = new Date(Date.UTC(2026, 10, 4, hour, minute));
      const time = `${String(hour + 8).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      expect(navPublicationSlot(date)).toBe(`2026-11-04:${time}`);
      times.push(time);
    }
    expect(times).toEqual(["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]);
  });
});
