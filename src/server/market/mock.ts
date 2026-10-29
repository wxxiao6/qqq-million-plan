import fs from "node:fs";
import path from "node:path";
import { parseMarketFile, type NasdaqShareSituation } from "@/lib/market";

const MOCK_PATH = path.join(process.cwd(), "config", "nasdaq-market.mock.json");

export type MarketFetchResult =
  | {
      ok: true;
      shares: NasdaqShareSituation[];
      nasdaqIndex: number | null;
      goldPrice: number | null;
    }
  | { ok: false; error: string };

export function fetchMockMarket(): MarketFetchResult {
  try {
    if (!fs.existsSync(MOCK_PATH)) {
      return { ok: false, error: "模拟源文件不存在" };
    }
    const raw = JSON.parse(fs.readFileSync(MOCK_PATH, "utf8")) as unknown;
    const parsed = parseMarketFile(raw);
    if (parsed.shares.length === 0) return { ok: false, error: "模拟源为空" };
    return {
      ok: true,
      shares: parsed.shares,
      nasdaqIndex: parsed.nasdaqIndex,
      goldPrice: parsed.goldPrice,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "模拟源不可用",
    };
  }
}

export function getMarketSnapshot(): {
  nasdaqIndex: number | null;
  goldPrice: number | null;
} {
  const fetched = fetchMockMarket();
  if (!fetched.ok) return { nasdaqIndex: null, goldPrice: null };
  return { nasdaqIndex: fetched.nasdaqIndex, goldPrice: fetched.goldPrice };
}
