import { cache } from "react";
import { currentUser } from "./session";
import { getAuthDatabase, type AuthUser } from "./store";

export class AuthenticationRequired extends Error {
  constructor() { super("请先登录"); }
}

export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  try { return await currentUser(await getAuthDatabase()); }
  catch { return null; }
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationRequired();
  return user;
}
