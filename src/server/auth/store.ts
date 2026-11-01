import "server-only";
import { getDb } from "@/server/db";
import { verifyPassword } from "./crypto";

export type AuthUser = { id: string; email: string; role: "admin" | "member" };
export type SessionInput = { tokenHash: string; userId: string; createdAt: string; expiresAt: string };
type D1Statement = { bind(...values: (string | number | null)[]): D1Statement; first<T>(): Promise<T | null>; run(): Promise<unknown> };
export type D1AuthBinding = { prepare(sql: string): D1Statement };
export type AuthDatabase = { kind: "sqlite"; db: ReturnType<typeof getDb> } | { kind: "d1"; db: D1AuthBinding };

type UserRow = { id: string; email: string; role: "admin" | "member"; password_hash: string };
type SessionRow = AuthUser;

export async function getAuthDatabase(): Promise<AuthDatabase> {
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return { kind: "d1", db: (getCloudflareContext().env as unknown as { DB: D1AuthBinding }).DB };
  }
  return { kind: "sqlite", db: getDb() };
}

export async function countUsers(database: AuthDatabase): Promise<number> {
  if (database.kind === "sqlite") return (database.db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const row = await database.db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function findUserByEmail(database: AuthDatabase, email: string): Promise<UserRow | null> {
  if (database.kind === "sqlite") return (database.db.prepare("SELECT id,email,role,password_hash FROM users WHERE email=? AND disabled_at IS NULL").get(email) as UserRow | undefined) ?? null;
  return database.db.prepare("SELECT id,email,role,password_hash FROM users WHERE email=? AND disabled_at IS NULL").bind(email).first<UserRow>();
}

export async function createInitialOwner(database: AuthDatabase, input: { id: string; email: string; passwordHash: string; now: string }) {
  if (database.kind === "sqlite") {
    return database.db.transaction(() => {
      const count = (database.db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
      if (count !== 0) throw new Error("账号已初始化");
      database.db.prepare("INSERT INTO users (id,email,password_hash,role,created_at) VALUES (?,?,?,'admin',?)")
        .run(input.id, input.email, input.passwordHash, input.now);
      for (const table of ["positions", "dca_plans", "portfolio_snapshots"]) {
        database.db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id IS NULL`).run(input.id);
      }
      return { id: input.id, email: input.email, role: "admin" as const };
    }).immediate();
  }
  const existing = await countUsers(database);
  if (existing !== 0) throw new Error("账号已初始化");
  const statements = [
    database.db.prepare("INSERT INTO users (id,email,password_hash,role,created_at) SELECT ?,?,?,'admin',? WHERE NOT EXISTS (SELECT 1 FROM users)")
      .bind(input.id, input.email, input.passwordHash, input.now),
    database.db.prepare("UPDATE positions SET user_id=? WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='admin')").bind(input.id, input.id),
    database.db.prepare("UPDATE dca_plans SET user_id=? WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='admin')").bind(input.id, input.id),
    database.db.prepare("UPDATE portfolio_snapshots SET user_id=? WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='admin')").bind(input.id, input.id),
  ];
  await (database.db as unknown as { batch(statements: D1Statement[]): Promise<unknown> }).batch(statements);
  const owner = await database.db.prepare("SELECT id,email,role FROM users WHERE id=?").bind(input.id).first<AuthUser>();
  if (!owner) throw new Error("账号已初始化");
  return owner;
}

export async function verifyUserPassword(database: AuthDatabase, email: string, password: string) {
  const user = await findUserByEmail(database, email);
  if (!user || !await verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, role: user.role } satisfies AuthUser;
}

export async function createSession(database: AuthDatabase, input: SessionInput) {
  if (database.kind === "sqlite") database.db.prepare("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").run(input.tokenHash, input.userId, input.expiresAt, input.createdAt);
  else await database.db.prepare("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(input.tokenHash, input.userId, input.expiresAt, input.createdAt).run();
}

export async function deleteSession(database: AuthDatabase, tokenHash: string) {
  if (database.kind === "sqlite") database.db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(tokenHash);
  else await database.db.prepare("DELETE FROM user_sessions WHERE token_hash=?").bind(tokenHash).run();
}

export async function loginIsLimited(database: AuthDatabase, keyHash: string, cutoff: string) {
  const sql = "SELECT attempts FROM auth_login_limits WHERE key_hash=? AND window_started_at>?";
  const row = database.kind === "sqlite"
    ? database.db.prepare(sql).get(keyHash, cutoff) as { attempts: number } | undefined
    : await database.db.prepare(sql).bind(keyHash, cutoff).first<{ attempts: number }>();
  return (row?.attempts ?? 0) >= 10;
}

export async function recordLoginFailure(database: AuthDatabase, keyHash: string, now: string, cutoff: string) {
  const sql = `INSERT INTO auth_login_limits(key_hash,attempts,window_started_at) VALUES(?,1,?)
    ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_login_limits.window_started_at<=? THEN 1 ELSE auth_login_limits.attempts+1 END,
    window_started_at=CASE WHEN auth_login_limits.window_started_at<=? THEN excluded.window_started_at ELSE auth_login_limits.window_started_at END`;
  if (database.kind === "sqlite") database.db.prepare(sql).run(keyHash, now, cutoff, cutoff);
  else await database.db.prepare(sql).bind(keyHash, now, cutoff, cutoff).run();
}

export async function clearLoginFailures(database: AuthDatabase, keyHash: string) {
  if (database.kind === "sqlite") database.db.prepare("DELETE FROM auth_login_limits WHERE key_hash=?").run(keyHash);
  else await database.db.prepare("DELETE FROM auth_login_limits WHERE key_hash=?").bind(keyHash).run();
}

export async function findSessionUser(database: AuthDatabase, tokenHash: string, now: string): Promise<AuthUser | null> {
  const sql = "SELECT u.id,u.email,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL";
  if (database.kind === "sqlite") return (database.db.prepare(sql).get(tokenHash, now) as SessionRow | undefined) ?? null;
  return database.db.prepare(sql).bind(tokenHash, now).first<SessionRow>();
}

