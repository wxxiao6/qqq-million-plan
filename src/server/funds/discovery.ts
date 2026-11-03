export type DiscoveredFund = {
  code: string; name: string; manager: string | null; fundType: string;
  currency: "CNY"; venue: "otc"; isNasdaq: boolean; sourceUrl: string;
};

/** The same Eastmoney/Tiantian provider used by the existing NAV pipeline. */
export function parseFundIdentity(code: string, payload: unknown, sourceUrl: string): DiscoveredFund {
  const data = (payload as { Datas?: Record<string, unknown> } | null)?.Datas;
  if (!data || data.FCODE !== code || typeof data.SHORTNAME !== "string" || !data.SHORTNAME.trim() || typeof data.FTYPE !== "string") {
    throw new Error("未查到这只基金，请核对六位基金代码");
  }
  const name = data.SHORTNAME.trim();
  const fundType = data.FTYPE;
  if (/美元|美金|USD|港币|港元|HKD/i.test(`${name} ${data.CURRENCY ?? ""}`)) throw new Error("目前仅支持人民币场外基金");
  if (/货币|理财型/.test(fundType)) throw new Error("暂不支持按万份收益计价的基金");
  if (/^(?:5\d{5}|15\d{4})$/.test(code) || (/ETF/i.test(name) && !/联接/.test(name))) throw new Error("请选择人民币场外基金，暂不支持场内 ETF 持仓");
  return { code, name, manager: typeof data.JJGS === "string" ? data.JJGS : null,
    fundType, currency: "CNY", venue: "otc", isNasdaq: /纳斯达克|纳指/.test(name), sourceUrl };
}

export async function fetchFundIdentity(code: string, fetcher: typeof fetch = fetch) {
  if (!/^\d{6}$/.test(code)) throw new Error("请输入六位基金代码");
  const sourceUrl = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation?${new URLSearchParams({ FCODE: code, deviceid: "1", plat: "Android", product: "EFund", version: "6.5.5" })}`;
  const response = await fetcher(sourceUrl, { headers: { Referer: "https://fund.eastmoney.com/" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("基金信息暂时无法获取，请稍后重试");
  return parseFundIdentity(code, await response.json(), sourceUrl);
}
