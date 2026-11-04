import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  db: {},
  board: { plans: [{ id: 7, status: "active", nextDebitDate: "2026-11-02" }], candidates: [], emptyUniverse: false },
  records: [{ id: 42, planId: 7, status: "pending" }],
  managers: { "008971": "大成基金" },
}));

vi.mock("@/components/dca/dca-dashboard", () => ({ DcaDashboard: vi.fn(() => null) }));
vi.mock("@/components/holdings/dca-forms", () => ({ DcaPlanForm: () => null }));
vi.mock("@/components/region", () => ({ PageHeader: () => null }));
vi.mock("@/server/auth/context", () => ({ getCurrentUser: vi.fn(async () => ({ id: "test-user" })) }));
vi.mock("@/server/dca", () => ({ getDcaBoard: vi.fn(() => data.board), listDcaExecutionHistory: vi.fn(() => data.records) }));
vi.mock("@/server/ledger", () => ({ listNasdaqHoldingManagers: vi.fn(() => data.managers) }));
vi.mock("@/server/dca/read-d1", () => ({ readDcaDashboardD1: vi.fn(async () => ({ ...data, records: data.records })) }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: data.db } }) }));
vi.mock("@/server/ledger/recent-pending", () => ({ reconcileDueDcaPlans: vi.fn(() => { throw new Error("Page must not book transactions"); }) }));
vi.mock("@/server/ledger/reconcile-d1", () => ({ reconcileDueDcaPlansD1: vi.fn(() => { throw new Error("Page must not book transactions"); }) }));

import DcaPage from "./page";
import { DcaDashboard } from "@/components/dca/dca-dashboard";
import { getCurrentUser } from "@/server/auth/context";
import { getDcaBoard } from "@/server/dca";
import { readDcaDashboardD1 } from "@/server/dca/read-d1";
import { reconcileDueDcaPlans } from "@/server/ledger/recent-pending";
import { reconcileDueDcaPlansD1 } from "@/server/ledger/reconcile-d1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T04:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it.each(["0", "1"])("opening and revisiting an overdue plan reads data without auto-booking (runtime %s)", async (runtime) => {
  vi.stubEnv("CLOUDFLARE_RUNTIME", runtime);
  for (const record of ["42", undefined]) {
    renderToStaticMarkup(await DcaPage({ searchParams: Promise.resolve({ record }) }));
    expect(vi.mocked(DcaDashboard).mock.lastCall?.[0]).toMatchObject({
      requestedRecordId: record ? 42 : null,
      plans: data.board.plans, records: data.records, managers: data.managers, syncErrors: [],
    });
  }
  expect(runtime === "1" ? readDcaDashboardD1 : getDcaBoard).toHaveBeenCalledTimes(2);
  expect(runtime === "1" ? getDcaBoard : readDcaDashboardD1).not.toHaveBeenCalled();
  expect(reconcileDueDcaPlans).not.toHaveBeenCalled();
  expect(reconcileDueDcaPlansD1).not.toHaveBeenCalled();
});

it.each(["0", "1"])("anonymous page requests redirect without reading the ledger (runtime %s)", async (runtime) => {
  vi.stubEnv("CLOUDFLARE_RUNTIME", runtime);
  vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
  await expect(DcaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  expect(getDcaBoard).not.toHaveBeenCalled();
  expect(readDcaDashboardD1).not.toHaveBeenCalled();
});
