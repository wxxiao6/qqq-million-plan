const DESTINATIONS: Record<string, string> = {
  "/holdings/manage": "持仓管理",
  "/dca": "定投管理",
  "/quota": "纳指雷达",
};

export function resolveLoginDestination(next: string | string[] | undefined) {
  const href = typeof next === "string" && Object.hasOwn(DESTINATIONS, next)
    ? next
    : "/holdings/manage";
  return { href, label: DESTINATIONS[href] };
}

export function loginHref(next: string) {
  return `/login?next=${encodeURIComponent(resolveLoginDestination(next).href)}`;
}
