import { describe, expect, it } from "vitest";
import { loginHref, resolveLoginDestination } from "./auth-navigation";

describe("login navigation", () => {
  it("preserves each supported destination", () => {
    expect(resolveLoginDestination("/dca")).toEqual({ href: "/dca", label: "定投管理" });
    expect(resolveLoginDestination("/quota").href).toBe("/quota");
    expect(loginHref("/holdings/manage")).toBe("/login?next=%2Fholdings%2Fmanage");
  });

  it.each([undefined, ["/dca", "/quota"], "https://example.com", "//example.com", "javascript:alert(1)", "/login", "__proto__", "/dca?next=//example.com"])("falls back for invalid destination %j", (next) => {
    expect(resolveLoginDestination(next).href).toBe("/holdings/manage");
  });
});
