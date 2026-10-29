import { kvGet, kvSet } from "../db";

export type JobName = "quota_scan" | "nav_scan" | "biying_nav" | "biying_info" | "tiantian_nav" | "tiantian_quota";

export type JobRecord = {
  ok: boolean;
  partial?: boolean;
  at: string;
  bizDate: string;
  error?: string;
  netInflow?: number;
};

function key(name: JobName) {
  return `job:${name}:last`;
}

function inflowKey(bizDate: string) {
  return `job:nav_scan:inflow:${bizDate}`;
}

export function readJob(name: JobName): JobRecord | null {
  const raw = kvGet(key(name));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export function writeJob(name: JobName, record: JobRecord) {
  kvSet(key(name), JSON.stringify(record));
  if (name === "nav_scan" && record.ok && record.bizDate) {
    kvSet(inflowKey(record.bizDate), String(record.netInflow ?? 0));
  }
}

export function readNetInflow(bizDate: string): number | null {
  const raw = kvGet(inflowKey(bizDate));
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function jobSucceededOn(name: JobName, bizDate: string): boolean {
  const last = readJob(name);
  return Boolean(last?.ok && last.bizDate === bizDate);
}
