import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/server/auth/crypto";
import { getAuthDatabase } from "@/server/auth/store";
import { POST } from "./route";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: { set: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));
vi.mock("@/server/auth/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/store")>(),
  getAuthDatabase: vi.fn(),
}));

let db: Database.Database;

beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT,
      role TEXT, created_at TEXT, disabled_at TEXT
    );
    CREATE TABLE user_sessions (token_hash TEXT, user_id TEXT, created_at TEXT, expires_at TEXT);
    CREATE TABLE positions (id INTEGER PRIMARY KEY, user_id TEXT);
    CREATE TABLE dca_plans (id INTEGER PRIMARY KEY, user_id TEXT);
    CREATE TABLE portfolio_snapshots (id INTEGER PRIMARY KEY, user_id TEXT);
    INSERT INTO positions VALUES (1, NULL);
    INSERT INTO dca_plans VALUES (1, NULL);
    INSERT INTO portfolio_snapshots VALUES (1, NULL);
  `);
  vi.mocked(getAuthDatabase).mockResolvedValue({ kind: "sqlite", db });
});

afterEach(() => db.close());

const request = (body: unknown) => new Request("https://finance.example/api/auth/setup", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("first account creation", () => {
  it("creates the owner using only account and password, claims records and starts a session", async () => {
    const response = await POST(request({ email: "  MyAccount  ", password: "test-password" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const owner = db.prepare("SELECT id, email, role, password_hash FROM users").get() as {
      id: string; email: string; role: string; password_hash: string;
    };
    expect(owner).toMatchObject({ email: "myaccount", role: "admin" });
    expect(await verifyPassword("test-password", owner.password_hash)).toBe(true);
    for (const table of ["positions", "dca_plans", "portfolio_snapshots", "user_sessions"]) {
      expect(db.prepare(`SELECT user_id FROM ${table}`).get()).toEqual({ user_id: owner.id });
    }
    expect(cookieJar.set).toHaveBeenCalledWith("qmp_session", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });

  it("rejects account creation after the owner already exists", async () => {
    await POST(request({ email: "owner", password: "test-password" }));
    cookieJar.set.mockClear();
    const response = await POST(request({ email: "second", password: "test-password" }));
    expect(response.status).toBe(409);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("allows only one owner when creation requests arrive together", async () => {
    const responses = await Promise.all([
      POST(request({ email: "first", password: "test-password" })),
      POST(request({ email: "second", password: "test-password" })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM user_sessions").get()).toEqual({ count: 1 });
  });

  it.each([null, {}, { email: "owner" }, { email: "", password: "test-password" }, { email: "two words", password: "test-password" }, { email: "owner", password: "12345" }, { email: "owner", password: "a".repeat(257) }])("rejects invalid account details: %j", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("https://finance.example/api/auth/setup", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(cookieJar.set).not.toHaveBeenCalled();
  });
});
