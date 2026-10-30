import { getDb } from "../db";
import { assembleNasdaqFunds, CATALOG_ROWS_SQL, CATALOG_SELLERS_SQL, listNasdaqFunds, type CatalogRow } from "./catalog";

type Seller = { code: string; seller: string; sourceUrl: string | null };
export type CatalogD1 = {
  prepare(sql: string): unknown;
  batch(statements: unknown[]): Promise<Array<{ results: unknown[] }>>;
};

/** Read both parts in one D1 batch so seller data and quotes share a snapshot. */
export async function listNasdaqFundsD1(db: CatalogD1): Promise<CatalogRow[]> {
  const [funds, sellers] = await db.batch([
    db.prepare(CATALOG_ROWS_SQL),
    db.prepare(CATALOG_SELLERS_SQL),
  ]);
  return assembleNasdaqFunds(funds.results as CatalogRow[], sellers.results as Seller[]);
}

export async function listNasdaqFundsForRuntime(): Promise<CatalogRow[]> {
  if (process.env.CLOUDFLARE_RUNTIME !== "1") return listNasdaqFunds(getDb());
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = getCloudflareContext();
  return listNasdaqFundsD1((env as unknown as { DB: CatalogD1 }).DB);
}
