import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/context", () => ({ requireUser: vi.fn(async () => ({ id: "owner" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./index", () => ({ upsertDcaPlan: vi.fn(() => ({ ok: true, id: 1 })), correctDcaExecution: vi.fn(), removeDcaPlan: vi.fn(), recordPlanExecution: vi.fn(), setDcaPlanStatus: vi.fn() }));
vi.mock("./create-d1", () => ({ createDcaPlanD1: vi.fn(() => ({ ok: true, id: 1 })) }));
vi.mock("./edit-d1", () => ({ editDcaPlanD1: vi.fn() }));
vi.mock("./write-d1", () => ({ correctDcaExecutionD1: vi.fn(), recordPlanExecutionD1: vi.fn(), removeDcaPlanD1: vi.fn(), setDcaPlanStatusD1: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: {} } }) }));

import { saveDcaPlan } from "./actions";
import * as actions from "./actions";
import * as local from "./index";
import * as cloudWrites from "./write-d1";
import { editDcaPlanD1 } from "./edit-d1";
import { requireUser } from "@/server/auth/context";
import { upsertDcaPlan } from "./index";
import { createDcaPlanD1 } from "./create-d1";

const input = { symbol: "016452", shareClass: "A", channelKind: "agency", amount: 10, frequency: "daily", startDate: "2026-10-28", creationMode: "history" as const };

describe("新建定投保存前核对", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireUser).mockResolvedValue({ id: "owner" } as Awaited<ReturnType<typeof requireUser>>); vi.stubEnv("CLOUDFLARE_RUNTIME", "0"); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T04:00:00Z")); });
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

// Every public write entry must authenticate before validation, database access or cache updates.
describe.each(["0", "1"])("定投写入认证（runtime %s）", (runtime) => {
  const calls = [
    ["create", () => actions.saveDcaPlan({ ...input, confirmedBackfill: { count: 5, total: 50, through: "2026-11-03" } })],
    ["edit", () => actions.saveDcaPlan({ ...input, id: 1 })],
    ["execute", () => actions.saveDcaExecution(1, { status: "bought_before_cutoff", executionDate: "2026-11-03", actualCashDebited: 10, actualFeeAmount: 0 })],
    ["pause", () => actions.pauseDcaPlan(1)],
    ["resume", () => actions.resumeDcaPlan(1)],
    ["end", () => actions.endDcaPlan(1)],
    ["delete", () => actions.deleteDcaPlan(1)],
    ["correct", () => actions.correctDcaExecutionAction({ id: 1, cashDebited: 10, feeAmount: 0, outcome: "keep" })],
  ] as const;
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CLOUDFLARE_RUNTIME", runtime); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T04:00:00Z")); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it.each(calls)("%s 已登录时只调用对应后端", async (name, call) => {
    vi.mocked(requireUser).mockResolvedValue({ id: "owner" } as Awaited<ReturnType<typeof requireUser>>);
    const writes = [local.upsertDcaPlan, local.correctDcaExecution, local.removeDcaPlan, local.recordPlanExecution, local.setDcaPlanStatus, cloudWrites.correctDcaExecutionD1, cloudWrites.recordPlanExecutionD1, cloudWrites.removeDcaPlanD1, cloudWrites.setDcaPlanStatusD1, createDcaPlanD1, editDcaPlanD1];
    for (const write of writes) vi.mocked(write).mockReturnValue({ ok: true, id: 1 } as never);
    await expect(call()).resolves.toEqual({ ok: true });
    const targets = {
      create: [local.upsertDcaPlan, createDcaPlanD1], edit: [local.upsertDcaPlan, editDcaPlanD1],
      execute: [local.recordPlanExecution, cloudWrites.recordPlanExecutionD1],
      pause: [local.setDcaPlanStatus, cloudWrites.setDcaPlanStatusD1],
      resume: [local.setDcaPlanStatus, cloudWrites.setDcaPlanStatusD1],
      end: [local.setDcaPlanStatus, cloudWrites.setDcaPlanStatusD1],
      delete: [local.removeDcaPlan, cloudWrites.removeDcaPlanD1],
      correct: [local.correctDcaExecution, cloudWrites.correctDcaExecutionD1],
    };
    const target = targets[name][Number(runtime)];
    expect(requireUser).toHaveBeenCalledOnce();
    expect(target).toHaveBeenCalledOnce();
    for (const write of writes.filter((write) => write !== target)) expect(write).not.toHaveBeenCalled();
  });
  it.each(calls)("%s 拒绝无有效会话的调用且不访问写入服务", async (_name, call) => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("请先登录"));
    await expect(call()).rejects.toThrow("请先登录");
    for (const write of [local.upsertDcaPlan, local.correctDcaExecution, local.removeDcaPlan, local.recordPlanExecution, local.setDcaPlanStatus, cloudWrites.correctDcaExecutionD1, cloudWrites.recordPlanExecutionD1, cloudWrites.removeDcaPlanD1, cloudWrites.setDcaPlanStatusD1, createDcaPlanD1, editDcaPlanD1]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});
