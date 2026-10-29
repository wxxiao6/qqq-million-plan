import { NextResponse } from "next/server";
import { syncNasdaqFundNav } from "@/server/market/biying";
import { syncTiantianAgencyQuota, tiantianNavSource } from "@/server/market/tiantian";

/** 手动触发天天基金净值与代销额度刷新；直销额度仍由外部机器人上报。 */
export async function POST() {
  const nav = await syncNasdaqFundNav(new Date(), fetch, tiantianNavSource);
  const quota = await syncTiantianAgencyQuota();
  const failed = [...nav.failed, ...quota.failed];
  const success = nav.success + quota.success;
  return NextResponse.json({ ...nav, source: "tiantian", quota, success, failed, partial: success > 0 && failed.length > 0, error: failed.length ? failed.map((item) => `${item.code}：${item.error}`).join("；") : undefined }, {
    status: failed.length === 0 ? 200 : success > 0 ? 207 : 502,
  });
}
