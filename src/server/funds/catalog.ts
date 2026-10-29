import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export const SEARCH_URL = "https://fund.eastmoney.com/data/fundsearch.html?key=%E7%BA%B3%E6%96%AF%E8%BE%BE%E5%85%8B#key%E7%BA%B3%E6%96%AF%E8%BE%BE%E5%85%8B;ztjj";
const CATALOG = path.join(process.cwd(), "config", "nasdaq-funds.json");
const CSRC_EVIDENCE = path.join(process.cwd(), "config", "csrc-catalog-evidence.json");
const AGENCY_AUDIT = path.join(process.cwd(), "config", "nasdaq-agency-audit-2026-09-24.txt");
const SALES_AUDIT = path.join(process.cwd(), "config", "nasdaq-sales-audit-2026-09-24.tsv");
const OBSERVED_ON = "2026-09-24";

export type Theme = "nasdaq_100" | "nasdaq_biotech" | "nasdaq_technology" | "nasdaq_selected";
export type ProductType = "etf" | "etf_feeder" | "index" | "active";
export type Fund = {
  code: string;
  name: string;
  manager: string | null;
  theme: Theme;
  productType: ProductType;
  venue: "exchange" | "otc";
  currency: "CNY" | "USD";
  sourceUrl: string;
  detailUrl: string;
  observedOn: string;
};

const NASDAQ_BIOTECH_CODES = new Set(["001092", "001093", "016470", "016471"]);
const ETF_ALIASES = new Set(["159941", "159632", "159660", "513390", "513100", "513300", "513290"]);
const MANAGER_NAMES = [
  "景顺长城", "华泰柏瑞", "汇添富", "易方达", "广发", "大成", "建信", "华安", "华夏",
  "博时", "南方", "嘉实", "华宝", "天弘", "摩根", "万家", "招商", "宝盈", "国泰", "富国",
] as const;

/** Search hits alone are not a QDII test: reject unrelated securities and ambiguous names. */
export function classifyFund(code: string, name: string): Omit<Fund, "sourceUrl" | "detailUrl" | "observedOn"> | null {
  if (!/^\d{6}$/.test(code) || !name.trim()) return null;
  const biotech = /纳(?:斯达克|指)生物科技/.test(name) || NASDAQ_BIOTECH_CODES.has(code);
  const technology = /纳(?:斯达克|指)科技/.test(name);
  const selected = /纳斯达克精选/.test(name);
  const hundred = /纳斯达克100|纳指100|纳指ETF|纳斯达克ETF/.test(name);
  if (!biotech && !technology && !selected && !hundred) return null;
  const managers = MANAGER_NAMES.filter((manager) => name.includes(manager));
  if (managers.length > 1) return null;
  const manager = managers[0] ?? (name.includes("景顺") ? "景顺长城" : null);
  if (NASDAQ_BIOTECH_CODES.has(code) && !/广发生物科技指数/.test(name)) return null;
  const theme: Theme = biotech ? "nasdaq_biotech" : technology ? "nasdaq_technology" : selected ? "nasdaq_selected" : "nasdaq_100";
  const exchange = ETF_ALIASES.has(code) || (/ETF/.test(name) && !/联接/.test(name));
  const productType: ProductType = selected ? "active" : exchange ? "etf" : /ETF.*联接/.test(name) ? "etf_feeder" : "index";
  return {
    code,
    name: name.trim(),
    manager: manager ? `${manager}基金` : null,
    theme,
    productType,
    venue: exchange ? "exchange" : "otc",
    currency: /美元/.test(name) ? "USD" : "CNY",
  };
}

export function parseSearchSnapshot(tsv: string): Fund[] {
  const lines = tsv.trim().split(/\r?\n/);
  if (lines.shift() !== "code\tname") throw new Error("基金搜索快照缺少 code/name 表头");
  const seen = new Set<string>();
  const funds: Fund[] = [];
  for (const line of lines) {
    const fields = line.split("\t");
    if (fields.length !== 2) throw new Error(`无效基金搜索行: ${line}`);
    const [code, name] = fields;
    const classified = classifyFund(code, name);
    if (!classified || !classified.manager) throw new Error(`非目标基金、管理人或分类不明: ${line}`);
    if (seen.has(code)) throw new Error(`重复基金代码: ${code}`);
    seen.add(code);
    funds.push({
      ...classified,
      sourceUrl: SEARCH_URL,
      detailUrl: `https://fund.eastmoney.com/${code}.html`,
      observedOn: OBSERVED_ON,
    });
  }
  return funds;
}

export type CatalogFund = Fund & {
  shareClass: "A" | "C" | "D" | "E" | "F" | "I";
  marketType: "otc" | "etf" | "lof";
  minOrder: number;
};

/** One membership source for radar, refresh, DCA and holdings. */
export function loadNasdaqCatalog(): CatalogFund[] {
  const data = JSON.parse(fs.readFileSync(CATALOG, "utf8")) as { funds: CatalogFund[] };
  if (!Array.isArray(data.funds) || data.funds.length === 0) throw new Error("纳指基金目录为空");
  const seen = new Set<string>();
  for (const fund of data.funds) {
    const classified = classifyFund(fund.code, fund.name);
    if (!classified || !classified.manager || seen.has(fund.code) ||
        classified.theme !== fund.theme || classified.productType !== fund.productType ||
        classified.venue !== fund.venue || classified.currency !== fund.currency ||
        classified.manager !== fund.manager ||
        !["A", "C", "D", "E", "F", "I"].includes(fund.shareClass) ||
        !["otc", "etf", "lof"].includes(fund.marketType) ||
        (fund.venue === "exchange") !== (fund.marketType === "etf") ||
        !Number.isFinite(fund.minOrder) || fund.minOrder < 0 ||
        !/^https?:\/\//.test(fund.sourceUrl) || !/^https?:\/\//.test(fund.detailUrl) ||
        !/^20\d{2}-\d{2}-\d{2}$/.test(fund.observedOn)) {
      throw new Error(`纳指基金目录记录无效或重复：${fund.code}`);
    }
    seen.add(fund.code);
  }
  return data.funds;
}

export function seedNasdaqFundCatalog(database: Database.Database): number {
  const funds = loadNasdaqCatalog();
  const csrcEvidence = JSON.parse(fs.readFileSync(CSRC_EVIDENCE, "utf8")) as {
    checkedOn: string;
    entries: Array<{ code: string; basis: "platform_index" | "notice_text"; sourceUrl: string }>;
  };
  const verifiedCodes = new Set(csrcEvidence.entries.map((item) => item.code));
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(csrcEvidence.checkedOn) ||
      verifiedCodes.size !== csrcEvidence.entries.length ||
      csrcEvidence.entries.some((item) => !funds.some((fund) => fund.code === item.code) ||
        !["platform_index", "notice_text"].includes(item.basis) ||
        !/^http:\/\/eid\.csrc\.gov\.cn\/fund\/disclose\/instance_show_pdf_id\.do\?instanceid=\d+$/.test(item.sourceUrl))) {
    throw new Error("公募基金统一信息披露平台目录核验记录无效");
  }
  // Official disclosure is evidence when available, not a membership gate.
  const salesLines = fs.readFileSync(SALES_AUDIT, "utf8").trim().split(/\r?\n/);
  if (salesLines.shift() !== "code\tchannel_kind\tseller\tsource_url") {
    throw new Error("销售机构核验快照缺少表头");
  }
  const salesAudit = salesLines.map((line) => {
    const [code, kind, seller, sourceUrl] = line.split("\t");
    if (!/^\d{6}$/.test(code) || !["direct", "agency"].includes(kind) || !seller || sourceUrl !== `https://q.fund.sohu.com/q/fx.php?code=${code}`) {
      throw new Error(`无效销售机构核验行: ${line}`);
    }
    return { code, kind: kind as "direct" | "agency", seller, sourceUrl };
  }).filter((row) => funds.some((fund) => fund.code === row.code));
  const auditedCodes = new Set(salesAudit.map((row) => row.code));
  if ([...auditedCodes].some((code) => !funds.some((fund) => fund.code === code && fund.venue === "otc"))) {
    throw new Error("销售机构核验快照包含目录外基金");
  }
  const agencyVerified = new Set(fs.readFileSync(AGENCY_AUDIT, "utf8")
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d{6}$/.test(line) && funds.some((fund) => fund.code === line)));
  if ([...agencyVerified].some((code) => !funds.some((fund) => fund.code === code))) {
    throw new Error("代销核验清单与统一基金目录不一致");
  }
  const fundInsert = database.prepare(`
    INSERT INTO nasdaq_funds (code, name, manager, theme, product_type, venue, currency, source_url, detail_url, observed_on, share_class, market_type, min_order)
    VALUES (@code, @name, @manager, @theme, @productType, @venue, @currency, @sourceUrl, @detailUrl, @observedOn, @shareClass, @marketType, @minOrder)
    ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, manager=excluded.manager, theme=excluded.theme, product_type=excluded.product_type,
      venue=excluded.venue, currency=excluded.currency, source_url=excluded.source_url,
      detail_url=excluded.detail_url, observed_on=excluded.observed_on,
      share_class=excluded.share_class, market_type=excluded.market_type, min_order=excluded.min_order
  `);
  const deleteUnverified = database.prepare(`DELETE FROM nasdaq_funds WHERE code NOT IN (${funds.map(() => "?").join(",")})`);
  const channelInsert = database.prepare(`
    INSERT OR IGNORE INTO nasdaq_fund_sales_channels
      (code, channel_kind, seller, verification_status)
    VALUES (?, ?, ?, 'unverified')
  `);
  const auditedChannelInsert = database.prepare(`
    INSERT OR IGNORE INTO nasdaq_fund_sales_channels
      (code, channel_kind, seller, verification_status, evidence_url, evidence_note, checked_at)
    VALUES (?, ?, ?, 'verified', ?, '搜狐基金逐只份额销售机构列表列示；实时交易资格另行核验', ?)
  `);
  const officialAgencyInsert = database.prepare(`
    INSERT INTO nasdaq_fund_sales_channels
      (code, channel_kind, seller, verification_status, evidence_url, evidence_note, checked_at)
    VALUES ('022525', 'agency', ?, 'verified', ?, '天弘基金该份额销售机构页列示；实时交易资格另行核验', ?)
    ON CONFLICT(code, channel_kind, seller) DO UPDATE SET
      verification_status='verified', evidence_url=excluded.evidence_url,
      evidence_note=excluded.evidence_note, checked_at=excluded.checked_at
  `);
  const verifyPlaceholder = database.prepare(`
    UPDATE nasdaq_fund_sales_channels
    SET verification_status='verified', evidence_url=?,
        evidence_note='搜狐基金该份额销售机构列表列示；实时交易资格另行核验', checked_at=?
    WHERE code=? AND channel_kind=? AND seller=? AND verification_status='unverified'
  `);
  const recordChannelCaveat = database.prepare(`
    UPDATE nasdaq_fund_sales_channels
    SET verification_status='unverified', evidence_url=?, evidence_note=?, checked_at=?
    WHERE code=? AND channel_kind=? AND seller=? AND verification_status<>'verified'
  `);
  const channelVerify = database.prepare(`
    UPDATE nasdaq_fund_sales_channels
    SET verification_status='verified', evidence_url=?, evidence_note=?, checked_at=?
    WHERE code=? AND channel_kind=? AND seller=?
  `);
  const channelUnavailable = database.prepare(`
    UPDATE nasdaq_fund_sales_channels
    SET verification_status='unavailable', evidence_url=?, evidence_note=?, checked_at=?
    WHERE code=? AND channel_kind='agency'
  `);
  const clearDirectOnlyAgencyQuote = database.prepare(
    "DELETE FROM nasdaq_channel_quotes WHERE code='021000' AND channel_kind='agency'",
  );
  const hasLegacyQuotaCells = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quota_cells'",
  ).get());
  const clearDirectOnlyLegacyQuota = hasLegacyQuotaCells
    ? database.prepare("DELETE FROM quota_cells WHERE symbol='021000' AND channel_kind='agency'") : null;
  const channelCheck = database.prepare(`
    UPDATE nasdaq_fund_sales_channels
    SET checked_at=COALESCE(checked_at, ?), evidence_note=COALESCE(evidence_note, ?)
    WHERE code=? AND channel_kind=? AND seller=? AND verification_status='unverified'
  `);
  database.transaction(() => {
    deleteUnverified.run(...funds.map((fund) => fund.code));
    for (const fund of funds) {
      fundInsert.run(fund);
      if (fund.venue === "exchange") {
        channelInsert.run(fund.code, "exchange", "证券交易所");
        channelVerify.run(fund.detailUrl, "详情页为场内 ETF；销售路径为证券账户场内交易", fund.observedOn, fund.code, "exchange", "证券交易所");
      } else {
        channelInsert.run(fund.code, "direct", "基金管理人直销");
        channelInsert.run(fund.code, "agency", "天天基金");
        if (agencyVerified.has(fund.code)) {
          channelVerify.run(fund.detailUrl, "详情页显示指向天天基金交易站点的立即购买入口", fund.observedOn, fund.code, "agency", "天天基金");
        } else {
          channelCheck.run(fund.observedOn, "已检查详情页，未看到立即购买入口；代销情况仍需核验", fund.code, "agency", "天天基金");
        }
      }
    }
    for (const sale of salesAudit) {
      auditedChannelInsert.run(sale.code, sale.kind, sale.seller, sale.sourceUrl, OBSERVED_ON);
      if (sale.kind === "direct") {
        verifyPlaceholder.run(sale.sourceUrl, OBSERVED_ON, sale.code, "direct", "基金管理人直销");
      } else if (sale.seller.includes("天天基金")) {
        verifyPlaceholder.run(sale.sourceUrl, OBSERVED_ON, sale.code, "agency", "天天基金");
      }
    }
    // 管理人官网按份额代码列示直销及代销机构；只核验页面实际出现的渠道。
    for (const code of ["016055", "016056", "016057", "016058", "024237"]) {
      const source = `https://www.bosera.com/service/fundSalesOrg.do?fundCode=${code}`;
      channelVerify.run(source, "博时基金该份额销售机构页列出网上直销及直销中心", OBSERVED_ON, code, "direct", "基金管理人直销");
    }
    for (const code of ["016055", "016057"]) {
      const source = `https://www.bosera.com/service/fundSalesOrg.do?fundCode=${code}`;
      channelVerify.run(source, "博时基金该份额销售机构页列出上海天天基金销售有限公司", OBSERVED_ON, code, "agency", "天天基金");
    }
    const southernSource = "https://www.nffund.com/main/files/2022/11/02/794414782298.pdf";
    for (const code of ["016452", "016453"]) {
      channelVerify.run(southernSource, "南方基金该基金招募说明书列出南方基金管理股份有限公司为直销机构", OBSERVED_ON, code, "direct", "基金管理人直销");
    }
    channelVerify.run("https://www.nffund.com/main/files/2025/01/10/033626380323.pdf", "南方基金直销渠道公告列出该 I 类份额", OBSERVED_ON, "021000", "direct", "基金管理人直销");
    channelUnavailable.run("https://www.nffund.com/new/personal-financing/detail.html?fundCode=021000",
      "暂设仅直销：南方基金该 I 类份额官网销售机构栏目当前仅列直销，未列代销",
      new Date().toISOString().slice(0, 10), "021000");
    clearDirectOnlyAgencyQuote.run();
    clearDirectOnlyLegacyQuota?.run();
    // 天弘基金 022525 官方份额页明确列示这六家代销机构。
    for (const seller of [
      "腾安基金销售（深圳）有限公司",
      "北京度小满基金销售有限公司",
      "蚂蚁（杭州）基金销售有限公司",
      "珠海盈米基金销售有限公司",
      "京东肯特瑞基金销售有限公司",
      "北京雪球基金销售有限公司",
    ]) {
      officialAgencyInsert.run(seller, "https://www.thfund.com.cn/fundinfo/022525", new Date().toISOString().slice(0, 10));
    }
    recordChannelCaveat.run("https://wap.huaan.com.cn/funds/040047/index.shtml", "华安基金网页显示本平台不可售；其他直销方式未确认", OBSERVED_ON, "040047", "direct", "基金管理人直销");
    auditedChannelInsert.run("012870", "agency", "北京展恒基金销售股份有限公司", "https://fund.stockstar.com/funds/f10/fundbuy_012870.html", OBSERVED_ON);
  })();
  return funds.length;
}

export type CatalogRow = CatalogFund & {
  directStatus: "verified" | "unverified" | "unavailable" | null;
  agencyStatus: "verified" | "unverified" | "unavailable" | null;
  exchangeStatus: "verified" | "unverified" | "unavailable" | null;
  directEvidenceUrl: string | null;
  agencySellers: Array<{ name: string; sourceUrl: string | null }>;
  exchangeEvidenceUrl: string | null;
  directSellerCount: number;
  agencySellerCount: number;
  nav: number | null;
  navDate: string | null;
  dailyChangePct: number | null;
  trackingErrorPct: number | null;
  trackingTarget: string | null;
  fundTradeStatus: "open" | "limited" | "paused" | null;
  fundDailyLimit: number | null;
  dataUpdatedAt: string | null;
  agencyTradeStatus: "open" | "limited" | "paused" | null;
  agencyDailyLimit: number | null;
  agencyLimitScope: string | null;
  agencyScopeSourceUrl: string | null;
  agencyPurchaseFeePct: number | null;
  agencyQuoteUpdatedAt: string | null;
  agencyQuoteSourceUrl: string | null;
  directTradeStatus: "open" | "limited" | "paused" | null;
  directDailyLimit: number | null;
  directLimitScope: string | null;
  directPurchaseFeePct: number | null;
  directQuoteUpdatedAt: string | null;
  directQuoteSourceUrl: string | null;
};

export function listNasdaqFunds(database: Database.Database): CatalogRow[] {
  const rows = database.prepare(`
    SELECT f.code, f.name, f.manager, f.theme, f.product_type AS productType,
           f.share_class AS shareClass, f.market_type AS marketType, f.min_order AS minOrder,
           f.venue, f.currency, f.source_url AS sourceUrl,
           f.detail_url AS detailUrl, f.observed_on AS observedOn,
           COALESCE(MAX(CASE WHEN c.channel_kind='direct' AND c.verification_status='verified' THEN 'verified' END),
                    MAX(CASE WHEN c.channel_kind='direct' AND c.verification_status='unavailable' THEN 'unavailable' END),
                    MAX(CASE WHEN c.channel_kind='direct' AND c.verification_status='unverified' THEN 'unverified' END)) AS directStatus,
           COALESCE(MAX(CASE WHEN c.channel_kind='agency' AND c.verification_status='verified' THEN 'verified' END),
                    MAX(CASE WHEN c.channel_kind='agency' AND c.verification_status='unavailable' THEN 'unavailable' END),
                    MAX(CASE WHEN c.channel_kind='agency' AND c.verification_status='unverified' THEN 'unverified' END)) AS agencyStatus,
           COALESCE(MAX(CASE WHEN c.channel_kind='exchange' AND c.verification_status='verified' THEN 'verified' END),
                    MAX(CASE WHEN c.channel_kind='exchange' AND c.verification_status='unavailable' THEN 'unavailable' END),
                    MAX(CASE WHEN c.channel_kind='exchange' AND c.verification_status='unverified' THEN 'unverified' END)) AS exchangeStatus,
           MAX(CASE WHEN c.channel_kind='direct' THEN c.evidence_url END) AS directEvidenceUrl,
           MAX(CASE WHEN c.channel_kind='exchange' THEN c.evidence_url END) AS exchangeEvidenceUrl,
           COUNT(DISTINCT CASE WHEN c.channel_kind='direct' AND c.seller<>'基金管理人直销' THEN c.seller END) AS directSellerCount,
           COUNT(DISTINCT CASE WHEN c.channel_kind='agency' AND c.seller<>'天天基金' THEN c.seller END) AS agencySellerCount,
           o.nav, o.nav_date AS navDate, o.daily_change_pct AS dailyChangePct,
           o.tracking_error_pct AS trackingErrorPct, o.tracking_target AS trackingTarget,
           NULL AS fundTradeStatus, NULL AS fundDailyLimit,
           o.updated_at AS dataUpdatedAt,
           qc_agency.status AS agencyTradeStatus,
           CASE WHEN qc_agency.status='paused' THEN NULL ELSE qc_agency.daily_limit END AS agencyDailyLimit,
           qc_agency.quota_scope AS agencyLimitScope,
           qc_agency.source_url AS agencyScopeSourceUrl,
           qc_agency.purchase_fee_pct AS agencyPurchaseFeePct,
           qc_agency.updated_at AS agencyQuoteUpdatedAt,
           qc_agency.source_url AS agencyQuoteSourceUrl,
           qc_direct.status AS directTradeStatus,
           CASE WHEN qc_direct.status='paused' THEN NULL
             ELSE qc_direct.daily_limit END AS directDailyLimit,
           qc_direct.quota_scope AS directLimitScope,
           qc_direct.purchase_fee_pct AS directPurchaseFeePct,
           qc_direct.updated_at AS directQuoteUpdatedAt,
           qc_direct.source_url AS directQuoteSourceUrl
    FROM nasdaq_funds f
    LEFT JOIN nasdaq_fund_sales_channels c ON c.code=f.code
    LEFT JOIN nasdaq_fund_observations o ON o.code=f.code
    LEFT JOIN quota_current qc_agency ON qc_agency.code=f.code AND qc_agency.share_class=f.share_class AND qc_agency.channel_kind='agency'
    LEFT JOIN quota_current qc_direct ON qc_direct.code=f.code AND qc_direct.share_class=f.share_class AND qc_direct.channel_kind='direct'
    GROUP BY f.code
    ORDER BY CASE WHEN f.currency='USD' THEN 1 ELSE 0 END, f.theme, f.venue, f.name, f.code
  `).all() as CatalogRow[];
  const sellers = database.prepare(`
    SELECT code, seller, evidence_url AS sourceUrl
    FROM nasdaq_fund_sales_channels
    WHERE channel_kind='agency' AND verification_status='verified'
    ORDER BY code, seller
  `).all() as Array<{ code: string; seller: string; sourceUrl: string | null }>;
  const byCode = new Map<string, CatalogRow["agencySellers"]>();
  for (const seller of sellers) {
    const list = byCode.get(seller.code) ?? [];
    list.push({ name: seller.seller, sourceUrl: seller.sourceUrl });
    byCode.set(seller.code, list);
  }
  return rows.map((row) => {
    const list = byCode.get(row.code) ?? [];
    const hasFormalTiantian = list.some((seller) => seller.name.includes("天天基金") && seller.name !== "天天基金");
    const deduplicated = hasFormalTiantian ? list.filter((seller) => seller.name !== "天天基金") : list;
    return { ...row, agencySellers: deduplicated.sort((a, b) => Number(b.name.includes("蚂蚁")) - Number(a.name.includes("蚂蚁"))) };
  });
}
