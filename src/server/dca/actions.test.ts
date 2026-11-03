import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./index", () => ({ upsertDcaPlan: vi.fn(() => ({ ok: true, id: 1 })), correctDcaExecution: vi.fn(), removeDcaPlan: vi.fn(), recordPlanExecution: vi.fn(), setDcaPlanStatus: vi.fn() }));
vi.mock("./create-d1", () => ({ createDcaPlanD1: vi.fn(() => ({ ok: true, id: 1 })) }));
vi.mock("./edit-d1", () => ({ editDcaPlanD1: vi.fn() }));
vi.mock("./write-d1", () => ({ correctDcaExecutionD1: vi.fn(), recordPlanExecutionD1: vi.fn(), removeDcaPlanD1: vi.fn(), setDcaPlanStatusD1: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: {} } }) }));

import { saveDcaPlan } from "./actions";
import { upsertDcaPlan } from "./index";
import { createDcaPlanD1 } from "./create-d1";

const input = { symbol: "016452", shareClass: "A", channelKind: "agency", amount: 10, frequency: "daily", startDate: "2026-10-28", creationMode: "history" as const };

describe("新建定投保存前核对", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CLOUDFLARE_RUNTIME", "0"); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T04:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(["0", "1"])("本地与云端均拒绝未核对的历史补录（%s）", async (runtime) => {
    vi.stubEnv("CLOUDFLARE_RUNTIME", runtime);
    expect(await saveDcaPlan(input)).toMatchObject({ ok: false, error: expect.stringContaining("重新核对") });
    expect(upsertDcaPlan).not.toHaveBeenCalled(); expect(createDcaPlanD1).not.toHaveBeenCalled();
  });
  it.each(["0", "1"])("核对成功后才交给现有记账逻辑（%s）", async (runtime) => {
    vi.stubEnv("CLOUDFLARE_RUNTIME", runtime);
    expect(await saveDcaPlan({ ...input, confirmedBackfill: { count: 5, total: 50, through: "2026-11-03" } })).toEqual({ ok: true });
    expect(runtime === "0" ? upsertDcaPlan : createDcaPlanD1).toHaveBeenCalledOnce();
  });
  it("从现在开始拒绝历史起始日，未选择录入方式也不能保存", async () => {
    expect(await saveDcaPlan({ ...input, creationMode: "now" })).toMatchObject({ ok: false });
    expect(await saveDcaPlan({ ...input, creationMode: undefined })).toMatchObject({ ok: false });
    expect(upsertDcaPlan).not.toHaveBeenCalled();
  });
  it("编辑已有计划沿用原逻辑，不要求重新补录确认", async () => {
    expect(await saveDcaPlan({ ...input, id: 1, creationMode: undefined })).toEqual({ ok: true });
    expect(upsertDcaPlan).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), { importPastPending: false });
  });
});
