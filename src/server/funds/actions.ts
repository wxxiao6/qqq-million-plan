"use server";

import { requireUser } from "../auth/context";
import { fundDatabase } from "./database";
import { discoverPersonalFund } from "./personal";

export async function lookupPersonalFund(code: string) {
  await requireUser();
  try { return { ok: true as const, fund: await discoverPersonalFund(await fundDatabase(), code) }; }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "基金查询失败，请稍后重试" }; }
}
