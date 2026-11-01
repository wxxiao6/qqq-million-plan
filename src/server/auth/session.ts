import { cookies } from "next/headers";
import { hashToken, randomToken } from "./crypto";
import { createSession, deleteSession, findSessionUser, type AuthDatabase } from "./store";

export const SESSION_COOKIE = "qmp_session";
const SESSION_DAYS = 30;

function expiresAt() { return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(); }

export async function startSession(db: AuthDatabase, userId: string) {
  const token = randomToken();
  const now = new Date().toISOString();
  await createSession(db, { tokenHash: await hashToken(token), userId, createdAt: now, expiresAt: expiresAt() });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(db: AuthDatabase) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db, await hashToken(token));
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(db: AuthDatabase) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findSessionUser(db, await hashToken(token), new Date().toISOString());
}
