import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { localNavSlot, runLocalNavTick } from "./local-fund-nav";

describe("local fund NAV publication windows", () => {
  it("only uses Beijing evening hourly slots", () => {
    expect(localNavSlot(new Date("2026-11-03T00:00:00Z"))).toBeNull();
    expect(localNavSlot(new Date("2026-11-03T09:59:00Z"))).toBeNull();
    expect(localNavSlot(new Date("2026-11-03T10:00:00Z"))).toBe("2026-11-03:18:00");
    expect(localNavSlot(new Date("2026-11-03T10:44:00Z"))).toBe("2026-11-03:18:00");
    expect(localNavSlot(new Date("2026-11-03T10:45:00Z"))).toBe("2026-11-03:18:00");
    expect(localNavSlot(new Date("2026-11-03T11:30:00Z"))).toBe("2026-11-03:19:00");
    expect(localNavSlot(new Date("2026-11-03T12:15:00Z"))).toBe("2026-11-03:20:00");
    expect(localNavSlot(new Date("2026-11-03T15:59:00Z"))).toBe("2026-11-03:23:00");
    expect(localNavSlot(new Date("2026-11-03T16:00:00Z"))).toBeNull();
    expect(localNavSlot(new Date("2026-11-03T04:00:00Z"))).toBeNull();
    expect(localNavSlot(new Date("2026-11-03T14:00:00Z"))).toBe("2026-11-03:22:00");
    expect(localNavSlot(new Date("2026-11-03T15:00:00Z"))).toBe("2026-11-03:23:00");
  });

  it("retries failure, persists successful slots and excludes concurrent workers", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE app_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    const now = new Date("2026-11-03T14:00:00Z");
    const failing = vi.fn(async () => ({ ok: false, bizDate: "2026-11-03", success: 0, failed: [] }));
    await runLocalNavTick(now, db, failing);
    await runLocalNavTick(now, db, failing);
    expect(failing).toHaveBeenCalledTimes(2);
    let release!: () => void;
    const refresh = vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); return { ok: true, bizDate: "2026-11-03", success: 1, failed: [] }; });
    const running = runLocalNavTick(now, db, refresh);
    await runLocalNavTick(now, db, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    release(); await running;
    await runLocalNavTick(now, db, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    const success = vi.fn(async () => ({ ok: true, bizDate: "2026-11-03", success: 1, failed: [] }));
    await runLocalNavTick(new Date("2026-11-03T15:00:00Z"), db, success);
    expect(success).toHaveBeenCalledTimes(1);
    db.close();
  });
});
