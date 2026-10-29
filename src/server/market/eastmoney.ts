/** Legacy single-fund NAV lookup used when a new holding needs an immediate price. */
const NAV_ENDPOINT = "https://api.fund.eastmoney.com/f10/lsjz";
type EastmoneyRow = { FSRQ?: string; DWJZ?: string };

export async function fetchOfficialNav(symbol: string): Promise<{ nav: number; asOf: string } | null> {
  const url = `${NAV_ENDPOINT}?fundCode=${encodeURIComponent(symbol)}&pageIndex=1&pageSize=1`;
  try {
    const response = await fetch(url, { headers: { Referer: `https://fund.eastmoney.com/${symbol}.html`, "User-Agent": "personal-finance-workbench/1.0" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { Data?: { LSJZList?: EastmoneyRow[] } };
    const row = payload.Data?.LSJZList?.[0];
    const nav = Number(row?.DWJZ);
    return row?.FSRQ && Number.isFinite(nav) && nav > 0 ? { nav, asOf: row.FSRQ } : null;
  } catch { return null; }
}
