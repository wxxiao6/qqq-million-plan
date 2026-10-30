"use server";

import { revalidatePath } from "next/cache";
import type { DcaExecutionInput, DcaInput } from "@/lib/dca";
import { correctDcaExecutionD1, recordPlanExecutionD1, removeDcaPlanD1, setDcaPlanStatusD1 } from "./write-d1";
import { createDcaPlanD1 } from "./create-d1";
import { editDcaPlanD1 } from "./edit-d1";
import type { ReconcileD1 } from "../ledger/reconcile-d1";
import {
  correctDcaExecution,
  removeDcaPlan,
  recordPlanExecution,
  setDcaPlanStatus,
  upsertDcaPlan,
  type DcaWriteResult,
} from "./index";

export type ActionResult = { ok: true } | { ok: false; error: string };

function touch() {
  revalidatePath("/dca");
  revalidatePath("/holdings");
  revalidatePath("/holdings/overview");
  revalidatePath("/holdings/manage");
  revalidatePath("/quota");
}

function toAction(result: DcaWriteResult): ActionResult {
  if (!result.ok) return result;
  touch();
  return { ok: true };
}

async function cloudDatabase(): Promise<ReconcileD1> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return (getCloudflareContext().env as unknown as { DB: ReconcileD1 }).DB;
}

export async function saveDcaPlan(
  input: DcaInput & { id?: number },
): Promise<ActionResult> {
  if (process.env.CLOUDFLARE_RUNTIME === "1") return toAction(input.id
    ? await editDcaPlanD1(await cloudDatabase(), { ...input, id: input.id })
    : await createDcaPlanD1(await cloudDatabase(), input));
  return toAction(upsertDcaPlan(input, { importPastPending: !input.id }));
}

export async function saveDcaExecution(planId: number, execution: DcaExecutionInput): Promise<ActionResult> {
  return toAction(process.env.CLOUDFLARE_RUNTIME === "1" ? await recordPlanExecutionD1(await cloudDatabase(), planId, execution) : recordPlanExecution(planId, execution));
}

export async function pauseDcaPlan(id: number): Promise<ActionResult> {
  return toAction(process.env.CLOUDFLARE_RUNTIME === "1" ? await setDcaPlanStatusD1(await cloudDatabase(), id, "paused") : setDcaPlanStatus(id, "paused"));
}

export async function resumeDcaPlan(id: number): Promise<ActionResult> {
  return toAction(process.env.CLOUDFLARE_RUNTIME === "1" ? await setDcaPlanStatusD1(await cloudDatabase(), id, "active") : setDcaPlanStatus(id, "active"));
}

export async function endDcaPlan(id: number): Promise<ActionResult> {
  return toAction(process.env.CLOUDFLARE_RUNTIME === "1" ? await setDcaPlanStatusD1(await cloudDatabase(), id, "ended") : setDcaPlanStatus(id, "ended"));
}

export async function deleteDcaPlan(id: number): Promise<ActionResult> {
  return toAction(process.env.CLOUDFLARE_RUNTIME === "1" ? await removeDcaPlanD1(await cloudDatabase(), id) : removeDcaPlan(id));
}

export async function correctDcaExecutionAction(input: Parameters<typeof correctDcaExecution>[0]): Promise<ActionResult> {
  return toAction(process.env.CLOUDFLARE_RUNTIME === "1" ? await correctDcaExecutionD1(await cloudDatabase(), input) : correctDcaExecution(input));
}
