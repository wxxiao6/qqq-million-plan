import { describe, expect, it, vi } from "vitest";

describe("必盈基金适配器", () => {
  it("解析历史净值的最新记录和日涨跌", async () => {
    vi.stubEnv("BIYING_LICENCE", "licence");
    const { fetchBiyingNav } = await import("./biying");
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { dm: "016452", t: "2026-10-27", dwjz: "2.1000", zzl: "1.25" },
      { dm: "016452", t: "2026-10-26", dwjz: "2.0740", zzl: "-0.20" },
    ]), { status: 200 }));
    await expect(fetchBiyingNav("016452", fetcher)).resolves.toMatchObject({ code: "016452", navDate: "2026-10-27", nav: 2.1, dailyChangePct: 1.25, sourceUrl: expect.stringContaining("/jj/lsjz/016452/licence") });
  });
});
