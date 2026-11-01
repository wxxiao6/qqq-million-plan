import { NextResponse } from "next/server";
import { startSession } from "@/server/auth/session";
import { hashToken } from "@/server/auth/crypto";
import { clearLoginFailures, getAuthDatabase, loginIsLimited, recordLoginFailure, verifyUserPassword } from "@/server/auth/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式不正确" }, { status: 400 }); }
  if (typeof body.email !== "string" || typeof body.password !== "string" || body.password.length > 256) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 400 });
  const email = body.email.trim().toLowerCase();
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const keyHash = await hashToken(`${address}\n${email}`);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const database = await getAuthDatabase();
  if (await loginIsLimited(database, keyHash, cutoff)) return NextResponse.json({ error: "尝试次数过多，请 15 分钟后重试" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  const user = await verifyUserPassword(database, email, body.password);
  if (!user) {
    await recordLoginFailure(database, keyHash, now.toISOString(), cutoff);
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await clearLoginFailures(database, keyHash);
  await startSession(database, user.id);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
