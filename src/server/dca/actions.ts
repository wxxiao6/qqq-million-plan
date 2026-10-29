"use server";

import { revalidatePath } from "next/cache";
import type { DcaExecutionInput, DcaInput } from "@/lib/dca";
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

export async function saveDcaPlan(
  input: DcaInput & { id?: number },
): Promise<ActionResult> {
  return toAction(upsertDcaPlan(input, { importPastPending: !input.id }));
}

export async function saveDcaExecution(planId: number, execution: DcaExecutionInput): Promise<ActionResult> {
  return toAction(recordPlanExecution(planId, execution));
}

export async function pauseDcaPlan(id: number): Promise<ActionResult> {
  return toAction(setDcaPlanStatus(id, "paused"));
}

export async function resumeDcaPlan(id: number): Promise<ActionResult> {
  return toAction(setDcaPlanStatus(id, "active"));
}

export async function endDcaPlan(id: number): Promise<ActionResult> {
  return toAction(setDcaPlanStatus(id, "ended"));
}

export async function deleteDcaPlan(id: number): Promise<ActionResult> {
  return toAction(removeDcaPlan(id));
}

export async function correctDcaExecutionAction(input: Parameters<typeof correctDcaExecution>[0]): Promise<ActionResult> {
  return toAction(correctDcaExecution(input));
}
