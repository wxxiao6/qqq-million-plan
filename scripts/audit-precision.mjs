import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import Decimal from "decimal.js";

const FinancialDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const D = (value) => new FinancialDecimal(value);
const sum = (values) => values.reduce((total, value) => total.plus(value), D(0));
const cents = (value) => D(value).toDecimalPlaces(2);
const noise = (delta) => D(delta).abs().lte("0.00000001");
const active = (row) => row.status === "settled" || row.status === "pending";

// Only SELECT statements. Never fetch users, credentials, session tokens or notes.
export const QUERIES = [
  ["positions", "SELECT id,user_id,account,exposure,symbol,shares,cost,status,recorded_on,dca_plan_id,cash_debited,fee_amount,t_nav,t_date,execution_on,auto_generated FROM positions ORDER BY id"],
  ["plans", "SELECT id,user_id,symbol,account,amount,fee_kind,fee_value,invested_total,status FROM dca_plans ORDER BY id"],
  ["snapshots", "SELECT as_of,user_id,dynamic_mv FROM portfolio_snapshots ORDER BY as_of"],
  ["navs", "SELECT symbol,as_of,nav,source FROM nav_snapshots ORDER BY symbol,as_of"],
  ["navHistory", "SELECT code,nav_date,nav,source FROM fund_nav_history ORDER BY code,nav_date"],
];

export function readLocalSnapshot(filename) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    return db.transaction(() => ({
      ...Object.fromEntries(QUERIES.map(([key, sql]) => [key, db.prepare(sql).all()])),
      integrity: db.pragma("quick_check").map((row) => row.quick_check),
    }))();
  } finally { db.close(); }
}

export function parseRemoteSnapshot(input) {
  if (!Array.isArray(input) || input.length !== QUERIES.length) throw new Error("Unexpected remote query result count");
  for (const result of input) {
    if (result.success !== true || !Array.isArray(result.results)) throw new Error("Remote audit query failed");
    if (result.meta?.changed_db === true || result.meta?.rows_written > 0) throw new Error("Audit input reports a database write");
  }
  return Object.fromEntries(QUERIES.map(([key], index) => [key, input[index].results]));
}

export function auditPrecision(snapshot, source = "local") {
  const { positions, plans, snapshots, navs, navHistory } = snapshot;
  if (![positions, plans, snapshots, navs, navHistory].every(Array.isArray)) throw new Error("Incomplete precision audit snapshot");
  const issues = { subCentAmounts: [], binaryTails: [], invalidNumbers: [], cashBalance: [], automaticShareReview: [], planTotalReview: [], extraConfirmedSharePrecision: [], sourceNavMismatch: [] };
  function money(table, id, symbol, field, value) {
    if (value == null) return;
    if (!Number.isFinite(value) || value < 0) { issues.invalidNumbers.push({ table, id, symbol, field, value }); return; }
    if (D(value).decimalPlaces() <= 2) return;
    const rounded = cents(value), delta = D(value).minus(rounded);
    (noise(delta) ? issues.binaryTails : issues.subCentAmounts).push({ table, id, symbol, field, value, rounded: rounded.toNumber(), delta: delta.toString() });
  }
  for (const row of positions) {
    for (const field of ["cost", "cash_debited", "fee_amount"]) money("positions", row.id, row.symbol, field, row[field]);
    if (row.shares != null && (!Number.isFinite(row.shares) || row.shares <= 0)) issues.invalidNumbers.push({ table: "positions", id: row.id, symbol: row.symbol, field: "shares", value: row.shares });
    if (row.status === "settled" && row.shares != null && D(row.shares).decimalPlaces() > 2) issues.extraConfirmedSharePrecision.push({ id: row.id, symbol: row.symbol, shares: row.shares, classification: "information_only_not_proof_of_error" });
    if (row.cash_debited != null && [row.cost, row.cash_debited, row.fee_amount ?? 0].every(Number.isFinite)) {
      const delta = D(row.cash_debited).minus(row.cost).minus(row.fee_amount ?? 0);
      if (!noise(delta)) issues.cashBalance.push({ id: row.id, symbol: row.symbol, cash: row.cash_debited, cost: row.cost, fee: row.fee_amount ?? 0, delta: delta.toString() });
    }
    if (row.status === "settled" && row.auto_generated && row.t_nav > 0 && row.shares != null) {
      const expected = D(row.cost).div(row.t_nav).toDecimalPlaces(2);
      if (!expected.eq(row.shares)) issues.automaticShareReview.push({ id: row.id, symbol: row.symbol, shares: row.shares, defaultEstimate: expected.toNumber(), note: "Review against platform confirmation; manual corrections or fund-specific rules may be valid" });
    }
  }
  for (const row of plans) {
    for (const field of ["amount", "invested_total", ...(row.fee_kind === "fixed" ? ["fee_value"] : [])]) money("plans", row.id, row.symbol, field, row[field]);
    const recorded = sum(positions.filter((position) => position.dca_plan_id === row.id && active(position)).map((position) => position.cost));
    const delta = D(row.invested_total).minus(recorded);
    if (!noise(delta)) issues.planTotalReview.push({ id: row.id, symbol: row.symbol, stored: row.invested_total, recorded: recorded.toNumber(), delta: delta.toString() });
  }
  for (const row of snapshots) money("portfolio_snapshots", row.as_of, null, "dynamic_mv", row.dynamic_mv);
  for (const row of [...navs, ...navHistory]) if (!Number.isFinite(row.nav) || row.nav <= 0) issues.invalidNumbers.push({ table: "NAV", symbol: row.symbol ?? row.code, value: row.nav });
  const sourceNavs = new Map(navHistory.map((row) => [`${row.code}:${row.nav_date}:${row.source}`, row.nav]));
  let comparableSourceNavs = 0;
  for (const row of navs) {
    const original = sourceNavs.get(`${row.symbol}:${row.as_of}:${row.source}`);
    if (row.source === "manual" || original == null) continue;
    comparableSourceNavs++;
    if (!D(original).eq(row.nav)) issues.sourceNavMismatch.push({ symbol: row.symbol, date: row.as_of, saved: row.nav, source: original });
  }

  const latest = new Map();
  for (const row of navs) if (!latest.has(row.symbol) || latest.get(row.symbol).as_of < row.as_of) latest.set(row.symbol, row);
  const settled = positions.filter((row) => row.status === "settled");
  const accounts = new Map();
  let missingNav = 0;
  for (const row of settled) {
    const nav = latest.get(row.symbol);
    if (row.shares == null || !nav || row.t_date && nav.as_of < row.t_date) { missingNav++; continue; }
    const key = `${row.user_id ?? "legacy"}:${row.symbol}:${row.account}`;
    accounts.set(key, [...(accounts.get(key) ?? []), { ...row, marketValue: D(row.shares).times(nav.nav) }]);
  }
  let rawValue = D(0), accountValue = D(0), rawPnl = D(0), accountPnl = D(0);
  const accountDifferences = [];
  for (const rows of accounts.values()) {
    const value = sum(rows.map((row) => row.marketValue)), cost = sum(rows.map((row) => row.cost));
    const oldPnl = cents(value.minus(cost)), roundedPnl = cents(value).minus(cents(cost));
    rawValue = rawValue.plus(value); accountValue = accountValue.plus(cents(value));
    rawPnl = rawPnl.plus(value.minus(cost)); accountPnl = accountPnl.plus(roundedPnl);
    if (!oldPnl.eq(roundedPnl)) accountDifferences.push({ symbol: rows[0].symbol, account: rows[0].account, legacyPnl: oldPnl.toNumber(), accountPnl: roundedPnl.toNumber(), delta: roundedPnl.minus(oldPnl).toNumber() });
  }
  const costs = settled.map((row) => row.cost), rawCost = sum(costs), rowCosts = sum(costs.map(cents));
  const counts = Object.fromEntries(Object.entries({ positions, plans, snapshots, navs, navHistory }).map(([key, rows]) => [key, rows.length]));
  return {
    schemaVersion: 1, source, auditedAt: new Date().toISOString(), readOnly: true, counts,
    integrity: snapshot.integrity ?? "not_run_remote",
    summary: Object.fromEntries(Object.entries(issues).map(([key, rows]) => [key, rows.length])),
    aggregation: {
      rawSettledCost: rawCost.toString(), roundedWholeCost: cents(rawCost).toNumber(), sumRoundedRowCosts: rowCosts.toNumber(), rowNormalizationDelta: rowCosts.minus(rawCost).toString(),
      rawMarketValue: rawValue.toString(), legacyMarketValueDisplay: cents(rawValue).toNumber(), accountRoundedMarketValue: accountValue.toNumber(), marketValueBoundaryDelta: accountValue.minus(cents(rawValue)).toNumber(),
      legacyPnlDisplay: cents(rawPnl).toNumber(), accountRoundedPnl: accountPnl.toNumber(), accountDifferences, valuedAccounts: accounts.size, missingNav,
    },
    navPrecision: { max: Math.max(0, ...navs.map((row) => D(row.nav).decimalPlaces())), comparableSourceNavs },
    issues,
    limitations: ["Extra share or NAV decimals are not inherently incorrect", "Stored rounded/truncated data cannot reveal the original precision without independent platform records", "Historical snapshots cannot be reconstructed accurately from current positions alone", "Automatic-share mismatches require platform/fund-contract confirmation; no repairs are applied"],
  };
}

export function reportMarkdown(report) {
  const s = report.summary, a = report.aggregation;
  const details = report.issues.subCentAmounts.map((row) => `| ${row.table} | ${row.id} | ${row.symbol ?? "—"} | ${row.field} | ${row.value} | ${row.rounded} |`).join("\n");
  return `# 数据精度只读检查\n\n来源：${report.source}  \n检查时间：${report.auditedAt}  \n数据库未作修改。\n\n## 检查范围\n\n持仓记录 ${report.counts.positions}；定投计划 ${report.counts.plans}；历史资产快照 ${report.counts.snapshots}；持仓净值 ${report.counts.navs}；来源净值 ${report.counts.navHistory}。\n\n## 发现\n\n- 分以下金额：${s.subCentAmounts} 个字段，其中持仓成本 ${report.issues.subCentAmounts.filter((row) => row.table === "positions" && row.field === "cost").length} 笔。\n- 仅为微小二进制尾差：${s.binaryTails} 个字段。\n- 扣款、本金、手续费不守恒：${s.cashBalance} 笔。\n- 自动份额与默认规则不同（须核对，不能直接认定错误）：${s.automaticShareReview} 笔。\n- 计划累计与有效记录不符：${s.planTotalReview} 项。\n- 确认份额超过两位：${s.extraConfirmedSharePrecision} 笔，仅作为信息保留。\n- 已存净值与可比来源缓存不一致：${s.sourceNavMismatch} 条。\n\n## 统计影响（同一批持仓与净值）\n\n- 原始已确认成本：${a.rawSettledCost}；整体取两位：${a.roundedWholeCost}；逐笔取两位再加：${a.sumRoundedRowCosts}；逐笔规范化原始变动：${a.rowNormalizationDelta} 元。\n- 原市值展示：${a.legacyMarketValueDisplay}；账户先计到分再汇总：${a.accountRoundedMarketValue}；差值：${a.marketValueBoundaryDelta} 元。\n- 原收益展示：${a.legacyPnlDisplay}；按账户金额相减再汇总：${a.accountRoundedPnl}。\n- 账户明细有分差：${a.accountDifferences.length} 个；缺净值或份额：${a.missingNav} 笔。\n\n## 分以下金额明细\n\n| 表 | 记录 | 基金 | 字段 | 原值 | 仅按分规范化的候选值 |\n| --- | --- | --- | --- | --- | --- |\n${details}\n\n候选值是数学上的分位规范化，不等于平台真实成本；应核对原始总成本或成交单再决定是否修正。高精度份额不应批量舍入。历史资产快照无法仅凭当前持仓还原。全部逐笔检查信息保存在同目录 JSON 中。\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  if (args.includes("--print-sql")) process.stdout.write(QUERIES.map(([, sql]) => sql).join(";\n") + ";\n");
  else {
    if (option("--input") && option("--db")) throw new Error("Choose --db or --input");
    const data = option("--input") ? parseRemoteSnapshot(JSON.parse(fs.readFileSync(option("--input"), "utf8"))) : readLocalSnapshot(option("--db") ?? "data/ledger.sqlite");
    const report = auditPrecision(data, option("--source") ?? (option("--input") ? "production D1" : "local SQLite"));
    const out = option("--out-dir");
    if (out) {
      fs.mkdirSync(out, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
      fs.writeFileSync(path.join(out, "report.md"), reportMarkdown(report), { mode: 0o600 });
    }
    console.log(JSON.stringify({ source: report.source, readOnly: true, counts: report.counts, summary: report.summary, marketValueBoundaryDelta: report.aggregation.marketValueBoundaryDelta, reportDirectory: out ? path.resolve(out) : null }, null, 2));
  }
}
