import { NextResponse } from "next/server";
import { hashPassword, hashToken } from "@/server/auth/crypto";
import { startSession } from "@/server/auth/session";
import { countUsers, createInitialOwner, getAuthDatabase } from "@/server/auth/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const database = await getAuthDatabase();
  if (await countUsers(database) !== 0) return NextResponse.json({ error: "账号已初始化" }, { status: 409 });
  const expected = process.env.INITIAL_OWNER_SETUP_TOKEN;
  if (!expected || expected.length < 32) return NextResponse.json({ error: "管理员初始化口令未配置" }, { status: 503 });
  let body: { email?: unknown; password?: unknown; setupToken?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式不正确" }, { status: 400 }); }
  if (typeof body.email !== "string" || typeof body.password !== "string" || typeof body.setupToken !== "string") return NextResponse.json({ error: "请填写账号、密码和初始化口令" }, { status: 400 });
  const email = body.email.trim().toLowerCase();
  if (email.length < 1 || email.length > 254 || /\s/.test(email)) return NextResponse.json({ error: "账号格式不正确" }, { status: 400 });
  if (body.password.length < 6 || body.password.length > 256) return NextResponse.json({ error: "密码长度须为 6 至 256 个字符" }, { status: 400 });
  const [expectedHash, receivedHash] = await Promise.all([hashToken(expected), hashToken(body.setupToken)]);
  let mismatch = 0;
  for (let index = 0; index < expectedHash.length; index++) mismatch |= expectedHash.charCodeAt(index) ^ receivedHash.charCodeAt(index);
  if (mismatch !== 0) return NextResponse.json({ error: "初始化口令无效" }, { status: 401 });
  try {
    const owner = await createInitialOwner(database, { id: crypto.randomUUID(), email, passwordHash: await hashPassword(body.password), now: new Date().toISOString() });
    await startSession(database, owner.id);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "初始化失败" }, { status: 409 });
  }
}
