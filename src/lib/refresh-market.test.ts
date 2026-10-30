import { describe, expect, it, vi } from "vitest";
import { refreshMarket } from "./refresh-market";

describe("market refresh orchestration", () => {
  it("runs both phases, accumulates failures and finalizes", async () => {
    const seen: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      seen.push(body);
      if (!body.phase) return Response.json({ chunked: true, runId: "run", observedAt: "time", bizDate: "date" });
      if (body.phase === "finish") return Response.json({ ok: true });
      if (body.phase === "nav" && !body.after) return Response.json({ requested: 1, success: 1, failed: [], next: "000001" });
      if (body.phase === "quota") return Response.json({ requested: 1, success: 0, failed: [{ code: "000002", error: "offline" }], next: null });
      return Response.json({ requested: 1, success: 1, failed: [], next: null });
    });
    expect(await refreshMarket(fetcher)).toMatchObject({ ok: false, partial: true, failed: [{ code: "000002" }] });
    expect(seen.map((body) => body.phase ?? "init")).toEqual(["init", "nav", "nav", "quota", "finish"]);
    expect(seen[4]).toMatchObject({ nav: { requested: 2, success: 2 }, quota: { requested: 1, success: 0 } });
  });

  it("does not finalize an interrupted refresh", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.body
      ? Response.json({ error: "unavailable" }, { status: 500 })
      : Response.json({ chunked: true, runId: "run", observedAt: "time", bizDate: "date" }));
    await expect(refreshMarket(fetcher)).rejects.toThrow("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
