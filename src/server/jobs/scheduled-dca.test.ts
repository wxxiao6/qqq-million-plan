import { beforeEach, expect, it, vi } from "vitest";
import { runScheduledDca } from "./scheduled-dca";
import { reconcileDueDcaPlansD1, type ReconcileD1 } from "../ledger/reconcile-d1";

vi.mock("../ledger/reconcile-d1", () => ({ reconcileDueDcaPlansD1: vi.fn() }));
beforeEach(() => vi.mocked(reconcileDueDcaPlansD1).mockReset());

it("uses Beijing's date at the UTC cron time and reports failures", async () => {
  const db = {} as ReconcileD1;
  vi.mocked(reconcileDueDcaPlansD1).mockResolvedValueOnce([]).mockResolvedValueOnce(["failed"]);
  const time = new Date("2026-10-31T00:05:00Z");
  await runScheduledDca(db, time);
  expect(reconcileDueDcaPlansD1).toHaveBeenCalledWith(db, "2026-10-31");
  await expect(runScheduledDca(db, time)).rejects.toThrow("failed");
});
