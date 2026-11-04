import { isolatedLedger } from "@/test/isolated-ledger";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFundIdentity } from "./discovery";
import { discoverPersonalFund, readPersonalFund, attachFundNavStatement } from "./personal";
import { localFundDatabase } from "./database";
import { savePositionD1 } from "../ledger/positions-d1";
import { refreshCloudChunk } from "../market/refresh-d1";
import { saveNavChunkD1 } from "../market/nav-d1";

vi.mock("../auth/context", () => ({ requireUser: async () => ({ id: "test-owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const fixture = isolatedLedger();
const code = "161725";
const identity = { code, name: "招商中证白酒指数(LOF)A", manager: "招商基金", fundType: "指数型-股票", currency: "CNY" as const,
  venue: "otc" as const, isNasdaq: false, sourceUrl: "https://example.com/info" };
const record = { code, navDate: "2026-10-30", nav: 1.2, dailyChangePct: 20, sourceUrl: "https://example.com/nav",
  recentHistory: [{ navDate: "2026-10-30", nav: 1.2, dailyChangePct: 20 }, { navDate: "2026-10-29", nav: 1, dailyChangePct: null }] };
let sqlite: Database.Database;

beforeEach(() => { sqlite = fixture.db; });

describe("personal fund lifecycle", () => {
  it("migrates existing financial data and owner linkage without loss", () => {
    const old = new Database(":memory:");
    old.pragma("foreign_keys=ON");
    const files = readdirSync("db/migrations").filter((name) => name.endsWith(".sql")).sort();
    for (const file of files.filter((name) => name < "045")) old.exec(readFileSync(path.join("db/migrations", file), "utf8"));
    old.prepare("INSERT INTO users(id,email,password_hash,role,created_at) VALUES('owner','local','hash','admin','2026-10-30')").run();
    old.prepare("INSERT INTO positions(account,exposure,symbol,shares,cost,status,updated_at,note,auto_generated) VALUES('jd','nasdaq','016452',123.45,100,'settled','2026-10-30','original',0)").run();
    const before = old.prepare("SELECT * FROM positions").all();
    old.exec(readFileSync("db/migrations/045_personal_fund_catalog.sql", "utf8"));
    expect(old.prepare("SELECT * FROM positions").all()).toEqual(before);
    old.prepare("INSERT INTO positions(account,exposure,symbol,shares,cost,status,updated_at) VALUES('other','fund',?,2,1,'settled','2026-10-30')").run(code);
    expect(old.prepare("SELECT user_id FROM positions WHERE exposure='fund'").get()).toEqual({ user_id: "owner" });
    expect(old.pragma("foreign_key_check")).toEqual([]);
    old.close();
  });

  it("validates provider identity and rejects unsupported instruments or mismatched codes", () => {
    const payload = { Datas: { FCODE: code, SHORTNAME: identity.name, FTYPE: identity.fundType, JJGS: "招商基金" } };
    expect(parseFundIdentity(code, payload, "source")).toMatchObject({ code, isNasdaq: false, currency: "CNY" });
    expect(() => parseFundIdentity("000001", payload, "source")).toThrow("未查到");
    expect(() => parseFundIdentity(code, { Datas: { ...payload.Datas, SHORTNAME: "指数美元A" } }, "source")).toThrow("人民币");
    expect(() => parseFundIdentity(code, { Datas: { ...payload.Datas, FTYPE: "货币型" } }, "source")).toThrow("万份收益");
    expect(() => parseFundIdentity("510300", { Datas: { ...payload.Datas, FCODE: "510300", SHORTNAME: "沪深300ETF" } }, "source")).toThrow("场内");
  });

  it("discovers once, caches NAV, saves an ordinary holding and values it without adding it to radar", async () => {
    const db = localFundDatabase(sqlite);
    const fetchIdentity = vi.fn(async () => identity);
    const source = { name: "tiantian", fetchNav: vi.fn(async () => record) };
    const opts = { identity: fetchIdentity, source, now: new Date("2026-10-31T01:00:00Z") };
    const found = await discoverPersonalFund(db, code, opts);
    expect(found).toMatchObject({ name: identity.name, isNasdaq: false, nav: 1.2, navDate: "2026-10-30" });
    await discoverPersonalFund(db, code, opts);
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
    expect(source.fetchNav).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT code FROM nasdaq_funds WHERE code=?").get(code)).toBeUndefined();
    expect(await savePositionD1(db, { account: "other", exposure: "fund", symbol: code, shares: 100, cost: 100, status: "settled" })).toEqual({ ok: true });
    expect((await import("../ledger")).listPositionDetails().find((row) => row.symbol === code)).toMatchObject({ exposure: "fund", marketValue: 120, holdingPnl: 20, today: expect.closeTo(20) });
    expect(await savePositionD1(db, { account: "other", exposure: "fund", symbol: code, shares: 100, cost: 100, status: "settled" })).toMatchObject({ ok: false });
    expect(sqlite.prepare("SELECT code FROM nav_sync_funds WHERE code=?").get(code)).toEqual({ code });
  });

  it("preserves the last price on failure and recovers later that day", async () => {
    const db = localFundDatabase(sqlite);
    await discoverPersonalFund(db, code, { identity: async () => identity, source: { name: "tiantian", fetchNav: async () => record }, now: new Date("2026-10-31T01:00:00Z") });
    const failing = { name: "tiantian", fetchNav: vi.fn(async () => { throw new Error("offline"); }) };
    const found = await discoverPersonalFund(db, code, { source: failing, now: new Date("2026-10-31T02:00:00Z") });
    expect(found.nav).toBe(1.2);
    expect(found.navError).toContain("重试");
    const recovered = await discoverPersonalFund(db, code, { source: { name: "tiantian", fetchNav: async () => ({ ...record, navDate: "2026-10-31", nav: 1.3, recentHistory: undefined }) }, now: new Date("2026-10-31T02:01:00Z") });
    expect(recovered).toMatchObject({ nav: 1.3, navError: null });
    await saveNavChunkD1(db, [record], "tiantian", "2026-10-30T01:00:00Z");
    expect(await readPersonalFund(db, code)).toMatchObject({ nav: 1.3, navError: null });
    await saveNavChunkD1(db, [{ ...record, nav: 1.1, navDate: "2026-10-31", recentHistory: undefined }], "tiantian", "2026-10-31T02:00:00Z");
    expect(await readPersonalFund(db, code)).toMatchObject({ nav: 1.3, navError: null });
  });

  it("keeps a new fund selectable even when its first NAV request fails", async () => {
    const db = localFundDatabase(sqlite);
    const found = await discoverPersonalFund(db, "000001", { identity: async () => ({ ...identity, code: "000001", name: "华夏成长混合" }),
      source: { name: "tiantian", fetchNav: async () => { throw new Error("offline"); } } });
    expect(found).toMatchObject({ code: "000001", nav: null });
    expect(found.navError).toContain("自动重试");
    expect(await savePositionD1(db, { account: "other", exposure: "fund", symbol: "000001", shares: 20, cost: 40, status: "settled" })).toEqual({ ok: true });
    const detail = (await import("../ledger")).listPositionDetails().find((row) => row.symbol === "000001");
    expect(detail).toMatchObject({ marketValue: null, holdingPnl: null, today: null });
    expect(sqlite.prepare("SELECT code FROM nav_sync_funds WHERE code='000001'").get()).toBeDefined();
  });

  it("reuses cached history for a new holding and respects manual corrections", async () => {
    const db = localFundDatabase(sqlite);
    sqlite.prepare("INSERT INTO fund_nav_history(code,nav_date,nav,source,source_url,fetched_at) VALUES('016452','2026-10-30',2,'tiantian','source','2026-10-31')").run();
    sqlite.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES('016452','2026-10-30',3,'manual')").run();
    await db.batch([attachFundNavStatement(db, "016452")]);
    expect(sqlite.prepare("SELECT nav FROM nav_snapshots WHERE symbol='016452' AND as_of='2026-10-30'").get()).toEqual({ nav: 3 });
  });

  it("includes held funds once in cloud pagination but excludes unheld discoveries and leaves quota unchanged", async () => {
    const base = localFundDatabase(sqlite);
    await discoverPersonalFund(base, code, { identity: async () => identity, source: { name: "tiantian", fetchNav: async () => record } });
    expect(await savePositionD1(base, { account: "other", exposure: "fund", symbol: code, shares: 100, cost: 100, status: "settled" })).toEqual({ ok: true });
    // Model the D1 all() read API on top of the same migrated SQLite schema.
    const db = { ...base, prepare(sql: string) { return { bind(...values: (string | number | null)[]) {
      return { sql, values, async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; } };
    } }; } };
    sqlite.prepare("INSERT INTO funds SELECT '999999','Unheld',NULL,NULL,'CNY','otc',0,'source','2026-10-31'").run();
    const codes: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      codes.push(new URL(String(input)).searchParams.get("FCODE")!);
      return Response.json({ data: [{ FSRQ: "2026-10-31", DWJZ: "2", JZZZL: "1" }] });
    });
    let after = "";
    do {
      const result = await refreshCloudChunk(db, { phase: "nav", after, observedAt: "2026-11-01T01:00:00Z", bizDate: "2026-11-01", runId: "test" }, fetcher);
      after = result.next ?? "";
    } while (after);
    expect(codes.filter((item) => item === code)).toHaveLength(1);
    expect(codes).not.toContain("999999");
    expect(sqlite.prepare("SELECT code FROM nasdaq_funds WHERE code=?").get(code)).toBeUndefined();
  });

  it("refreshes again on the same day and includes a holding added after a successful run", async () => {
    const { syncNasdaqFundNav } = await import("../market/biying");
    const source = { name: "tiantian", fetchNav: vi.fn(async (symbol: string) => ({ ...record, code: symbol, recentHistory: undefined })) };
    const first = await syncNasdaqFundNav(new Date("2026-11-01T01:00:00Z"), fetch, source);
    expect(first.ok).toBe(true);
    const db = localFundDatabase(sqlite);
    await discoverPersonalFund(db, "000002", { now: new Date("2026-11-01T02:00:00Z"), identity: async () => ({ ...identity, code: "000002", name: "华夏成长混合C" }),
      source: { name: "tiantian", fetchNav: async () => { throw new Error("offline"); } } });
    await savePositionD1(db, { account: "other", exposure: "fund", symbol: "000002", shares: 10, cost: 10, status: "settled" });
    source.fetchNav.mockClear();
    const second = await syncNasdaqFundNav(new Date("2026-11-01T14:00:00Z"), fetch, source);
    expect(second.ok).toBe(true);
    expect(second.success).toBe(first.success + 1);
    expect(source.fetchNav.mock.calls.filter(([symbol]) => symbol === "000002")).toHaveLength(1);
    expect(await readPersonalFund(db, "000002")).toMatchObject({ nav: 1.2, navError: null });
  });
  it("derives classification on the server and rejects unverified codes", async () => {
    const { savePosition } = await import("../ledger/actions");
    const db = localFundDatabase(sqlite);
    await discoverPersonalFund(db, "000003", { identity: async () => ({ ...identity, code: "000003", name: "普通混合基金" }),
      source: { name: "tiantian", fetchNav: async () => ({ ...record, code: "000003" }) } });
    expect(await savePosition({ account: "other", symbol: "000003", exposure: "nasdaq", shares: 10, cost: 10, status: "settled" })).toEqual({ ok: true });
    expect(sqlite.prepare("SELECT exposure FROM positions WHERE symbol='000003'").get()).toEqual({ exposure: "fund" });
    expect(await savePosition({ account: "other", symbol: "999997", shares: 10, cost: 10, status: "settled" })).toMatchObject({ ok: false });
    expect(sqlite.prepare("SELECT id FROM positions WHERE symbol='999997'").get()).toBeUndefined();
  });

});
