import { RefreshMarketButton } from "@/components/quota/refresh-market";
import { EvidenceDialog } from "@/components/quota/evidence-dialog";
import { FundTypeFilter, type FundTypeFilterValue } from "@/components/quota/fund-type-filter";
import Link from "next/link";
import { Band, PageHeader } from "@/components/region";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { groupFundsByManager, isPaused, sortOtcFundGroups, type FundSort, type SalesChannel } from "@/lib/nasdaq-fund-sort";
import { estimatePurchasableQuota, sumVerifiedQuota } from "@/lib/nasdaq-quota-summary";
import { getDb } from "@/server/db";
import { listNasdaqFunds, type CatalogRow } from "@/server/funds/catalog";

export const dynamic = "force-dynamic";

const THEME: Record<CatalogRow["theme"], string> = {
  nasdaq_100: "纳指 100",
  nasdaq_biotech: "纳指生物科技",
  nasdaq_technology: "纳斯达克科技",
  nasdaq_selected: "纳斯达克精选",
};

type Channel = "agency" | "direct" | "exchange";
type FundTheme = CatalogRow["theme"];

function middleEllipsis(name: string, maxChars = 20) {
  const characters = Array.from(name);
  if (characters.length <= maxChars) return name;
  const leading = Math.ceil((maxChars - 1) / 2);
  return `${characters.slice(0, leading).join("")}…${characters.slice(-(maxChars - 1 - leading)).join("")}`;
}

function availableTypes(rows: CatalogRow[]): FundTheme[] {
  const present = new Set(rows.map((row) => row.theme));
  return (Object.keys(THEME) as FundTheme[]).filter((type) => present.has(type));
}

function channelRows(rows: CatalogRow[], channel: SalesChannel): CatalogRow[] {
  return rows.filter((row) => (channel === "agency" ? row.agencyStatus : row.directStatus) !== "unavailable");
}

function quotaHref(channel: SalesChannel, usdChannel: SalesChannel, sort: FundSort, type: FundTypeFilterValue) {
  return `/quota?channel=${channel}&usdChannel=${usdChannel}&sort=${sort}&type=${type}`;
}

function ChannelTabs({ label, selected, href }: { label: string; selected: SalesChannel; href: (channel: SalesChannel) => string }) {
  return <nav aria-label={label} className="mb-4 inline-flex rounded-full border border-border bg-muted/40 p-1">
    {(["agency", "direct"] as const).map((channel) => (
      <Link
        key={channel}
        href={href(channel)}
        scroll={false}
        aria-current={selected === channel ? "page" : undefined}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === channel ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        {channel === "agency" ? "代销" : "直销"}
      </Link>
    ))}
  </nav>;
}

function amount(row: CatalogRow, channel: Channel) {
  if (channel === "exchange") return "场内交易";
  if (channel === "agency" && row.agencyStatus === "unavailable") return "仅直销";
  if (isPaused(row, channel)) return "暂停申购";
  const verified = channel === "direct" ? row.directStatus === "verified" : row.agencyStatus === "verified";
  if (!verified) {
    return "渠道待核验";
  }
  const status = channel === "direct" ? row.directTradeStatus : row.agencyTradeStatus;
  const limit = channel === "direct" ? row.directDailyLimit : row.agencyDailyLimit;
  if (status === "paused") return "暂停申购";
  if (status === "open") return "开放申购（上限未披露）";
  if (status === "limited" && limit != null) {
    return `${row.currency === "USD" ? "$" : "¥"}${limit.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  }
  return "额度待核验";
}

function fee(row: CatalogRow, channel: Channel) {
  if (channel === "exchange") return "以券商为准";
  const value = channel === "direct" ? row.directPurchaseFeePct : row.agencyPurchaseFeePct;
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function QuotaTotals({ rows }: { rows: CatalogRow[] }) {
  if (rows.length === 0) return null;
  const purchasable = estimatePurchasableQuota(rows);
  const totals = {
    direct: sumVerifiedQuota(channelRows(rows, "direct"), "direct"),
    agency: sumVerifiedQuota(channelRows(rows, "agency"), "agency"),
  };
  return <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-card">
    <dl className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="col-span-2 border-b border-border px-5 py-4 sm:col-span-1 sm:border-b-0 sm:border-r">
        <dt className="text-sm font-medium text-foreground">可购买额度</dt>
        <dd className="font-display mt-2 text-3xl font-semibold leading-none tabular-nums">
          {purchasable.coveredShares === 0 ? "—" : `¥${purchasable.total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`}
        </dd>
        <p className="mt-2 text-xs text-muted-foreground">保守估算 · 已核验 {purchasable.coveredShares}/{purchasable.totalShares} 只份额</p>
      </div>
      {(["agency", "direct"] as const).map((channel) => {
        const summary = totals[channel];
        return <div key={channel} className={`min-w-0 px-4 py-4 ${channel === "agency" ? "border-r border-border" : ""}`}>
          <dt className="text-xs text-muted-foreground">{channel === "direct" ? "直销" : "代销"}限额小计</dt>
          <dd className="font-display mt-2 text-2xl font-semibold leading-none tabular-nums">
            {summary.coveredShares === 0 ? "—" : `¥${summary.total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`}
          </dd>
          <p className="mt-2 text-xs text-muted-foreground">覆盖 {summary.coveredShares}/{summary.totalShares} · {summary.quotaGroups} 组额度</p>
        </div>;
      })}
    </dl>
    <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground">同一份额跨渠道的共用限额只计一次；直销、代销小计不可相加。</p>
  </div>;
}

function FundTable({ rows, channel, sort, queryChannel, queryUsdChannel, type, typeOptions }: {
  rows: CatalogRow[]; channel: Channel; sort: FundSort;
  queryChannel: SalesChannel; queryUsdChannel: SalesChannel; type: FundTypeFilterValue;
  typeOptions: FundTheme[];
}) {
  const companyGroups = channel === "exchange"
    ? groupFundsByManager(rows)
    : sortOtcFundGroups(rows, channel, sort);
  const quotaSort = sort === "quota" || sort === "quota_asc";
  const trackingSort = sort === "tracking_asc" || sort === "tracking_desc";
  return <div className="table-scroll"><Table>
    <TableHeader><TableRow>
      <TableHead>基金公司</TableHead>
      <TableHead>名称（代码）</TableHead>
      <TableHead aria-label="基金类型">
        {typeOptions.length > 1 ? <FundTypeFilter selected={type} channel={queryChannel} usdChannel={queryUsdChannel} sort={sort} availableTypes={typeOptions} /> : null}
      </TableHead>
      {channel !== "exchange" ? <TableHead aria-sort={quotaSort ? sort === "quota" ? "descending" : "ascending" : "none"}>
        <Link href={quotaHref(queryChannel, queryUsdChannel, sort === "quota" ? "quota_asc" : "quota", type)} scroll={false}
          aria-label={`可投额度，${quotaSort ? `当前${sort === "quota" ? "降序" : "升序"}，` : ""}点击按${sort === "quota" ? "升序" : "降序"}排列`}
          className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${quotaSort ? "text-foreground" : ""}`}>
          可投额度 <span aria-hidden="true">{sort === "quota" ? "↓" : sort === "quota_asc" ? "↑" : "↕"}</span>
        </Link>
      </TableHead> : null}
      <TableHead>单位净值</TableHead>
      <TableHead>日涨跌</TableHead>
      {channel === "exchange" ? <TableHead>年化跟踪误差</TableHead> : <TableHead aria-sort={trackingSort ? sort === "tracking_asc" ? "ascending" : "descending" : "none"}>
        <Link href={quotaHref(queryChannel, queryUsdChannel, sort === "tracking_asc" ? "tracking_desc" : "tracking_asc", type)} scroll={false}
          aria-label={`年化跟踪误差，${trackingSort ? `当前${sort === "tracking_asc" ? "升序" : "降序"}，` : ""}点击按${sort === "tracking_asc" ? "降序" : "升序"}排列`}
          className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${trackingSort ? "text-foreground" : ""}`}>
          年化跟踪误差 <span aria-hidden="true">{sort === "tracking_asc" ? "↑" : sort === "tracking_desc" ? "↓" : "↕"}</span>
        </Link>
      </TableHead>}
      <TableHead>购买手续费</TableHead>
      <TableHead>净值日期</TableHead>
    </TableRow></TableHeader>
    {companyGroups.map((group, groupIndex) => <TableBody key={`${channel}-${group.rows[0].code}`}>
      {group.rows.map((row, rowIndex) => {
      const agencyEvidence = channel === "agency" ? row.agencySellers.find((seller) => seller.sourceUrl)?.sourceUrl : null;
      const noticeEvidence = channel === "agency" ? row.agencyQuoteSourceUrl : channel === "direct" ? row.directQuoteSourceUrl : null;
      return <TableRow key={`${channel}-${row.code}`} className={groupIndex > 0 && rowIndex === 0 ? "border-t border-t-border" : undefined}>
        {rowIndex === 0 ? <th scope="rowgroup" rowSpan={group.rows.length}
          className="min-w-28 border-r border-border bg-muted/20 px-3 py-3 text-left align-top text-sm font-semibold whitespace-nowrap">
          {group.manager?.replace(/基金$/, "") ?? "待核验"}
        </th> : null}
        <TableCell className="w-72 min-w-72 max-w-72">
          <a href={row.detailUrl} target="_blank" rel="noreferrer" title={row.name} aria-label={`${row.name}，打开基金详情`}
            className="block w-72 truncate whitespace-nowrap font-medium hover:underline">{middleEllipsis(row.name)}</a>
          <span className="mt-1 block font-mono text-xs text-muted-foreground">{row.code} · {row.currency}</span>
        </TableCell>
        <TableCell>{THEME[row.theme]}</TableCell>
        {channel !== "exchange" ? <TableCell>
          <span>{amount(row, channel)}</span>
          {agencyEvidence ? <EvidenceDialog kind="sales" fundName={row.name} code={row.code} sourceUrl={agencyEvidence}
            sellers={row.agencySellers} /> : null}
          {noticeEvidence ? <EvidenceDialog kind="notice" fundName={row.name} code={row.code} sourceUrl={noticeEvidence} /> : null}
        </TableCell> : null}
        <TableCell className="font-mono tabular-nums">{row.nav == null ? "—" : row.nav.toFixed(4)}</TableCell>
        <TableCell className={`font-mono tabular-nums ${row.dailyChangePct == null ? "" : row.dailyChangePct < 0 ? "text-loss" : "text-gain"}`}>
          {percent(row.dailyChangePct)}
        </TableCell>
        <TableCell className="font-mono tabular-nums">{row.trackingErrorPct == null ? "—" : `${row.trackingErrorPct.toFixed(2)}%`}</TableCell>
        <TableCell className="font-mono tabular-nums">{fee(row, channel)}</TableCell>
        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{row.navDate ?? "—"}</TableCell>
      </TableRow>;
    })}</TableBody>)}
  </Table></div>;
}

export default async function QuotaPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; usdChannel?: string; sort?: string; type?: string }>;
}) {
  const params = await searchParams;
  const selectedChannel = params.channel === "direct" ? "direct" : "agency";
  const selectedUsdChannel = params.usdChannel === "direct" ? "direct" : "agency";
  const sort: FundSort = params.sort === "quota_asc" || params.sort === "tracking_asc" || params.sort === "tracking_desc" ? params.sort : "quota";
  const allFunds = listNasdaqFunds(getDb());
  const visibleUniverse = allFunds.filter((fund) => fund.venue === "exchange" ||
    (fund.currency === "USD" ? fund[selectedUsdChannel === "agency" ? "agencyStatus" : "directStatus"] :
      fund[selectedChannel === "agency" ? "agencyStatus" : "directStatus"]) !== "unavailable");
  const defaultType: FundTypeFilterValue = visibleUniverse.some((fund) => fund.theme === "nasdaq_100") ? "nasdaq_100" : "all";
  const type: FundTypeFilterValue = params.type === "all" ? "all" :
    params.type && Object.hasOwn(THEME, params.type) && visibleUniverse.some((fund) => fund.theme === params.type)
      ? params.type as FundTheme : defaultType;
  const selectType = (rows: CatalogRow[]) => type === "all" ? rows : rows.filter((fund) => fund.theme === type);
  const allActiveFunds = allFunds.filter((fund) => fund.productType === "active");
  const allCnyOtc = allFunds.filter((fund) => fund.productType !== "active" && fund.currency === "CNY" && fund.venue === "otc");
  const allCnyExchange = allFunds.filter((fund) => fund.productType !== "active" && fund.currency === "CNY" && fund.venue === "exchange");
  const allUsd = allFunds.filter((fund) => fund.productType !== "active" && fund.currency === "USD");
  const activeFunds = selectType(allActiveFunds);
  const cnyOtc = selectType(allCnyOtc);
  const cnyExchange = selectType(allCnyExchange);
  const usd = selectType(allUsd);
  const visibleCnyOtc = channelRows(cnyOtc, selectedChannel);
  const visibleActiveFunds = channelRows(activeFunds, selectedChannel);
  const visibleUsd = channelRows(usd, selectedUsdChannel);
  const cnyOtcTypes = availableTypes(channelRows(allCnyOtc, selectedChannel));
  const cnyExchangeTypes = availableTypes(allCnyExchange);
  const activeTypes = availableTypes(channelRows(allActiveFunds, selectedChannel));
  const usdTypes = availableTypes(channelRows(allUsd, selectedUsdChannel));

  return <>
    <PageHeader
      title="纳指雷达"
      lead="查看基金、申购状态与额度。"
      aside={<RefreshMarketButton />}
    />
    <div className="page-stack">
      {visibleCnyOtc.length > 0 ? <Band label={`人民币场外基金（${visibleCnyOtc.length}）`}>
        <QuotaTotals rows={cnyOtc} />
        <ChannelTabs label="人民币销售渠道" selected={selectedChannel} href={(channel) => quotaHref(channel, selectedUsdChannel, sort, type)} />
        <FundTable rows={visibleCnyOtc} channel={selectedChannel} sort={sort} queryChannel={selectedChannel} queryUsdChannel={selectedUsdChannel} type={type} typeOptions={cnyOtcTypes} />
      </Band> : null}
      {cnyExchange.length > 0 ? <Band label={`场内 ETF（${cnyExchange.length}）`}>
        <FundTable rows={cnyExchange} channel="exchange" sort={sort} queryChannel={selectedChannel} queryUsdChannel={selectedUsdChannel} type={type} typeOptions={cnyExchangeTypes} />
      </Band> : null}
      {visibleActiveFunds.length > 0 ? <Band label={`主动管理基金（${visibleActiveFunds.length}）`}>
        <ChannelTabs label="主动管理基金销售渠道" selected={selectedChannel} href={(channel) => quotaHref(channel, selectedUsdChannel, sort, type)} />
        <FundTable rows={visibleActiveFunds} channel={selectedChannel} sort={sort} queryChannel={selectedChannel} queryUsdChannel={selectedUsdChannel} type={type} typeOptions={activeTypes} />
      </Band> : null}
      {visibleUsd.length > 0 ? <Band label={`美元计价 QDII 份额（${visibleUsd.length}）`}>
        <ChannelTabs label="美元销售渠道" selected={selectedUsdChannel} href={(channel) => quotaHref(selectedChannel, channel, sort, type)} />
        <FundTable rows={visibleUsd} channel={selectedUsdChannel} sort={sort} queryChannel={selectedChannel} queryUsdChannel={selectedUsdChannel} type={type} typeOptions={usdTypes} />
      </Band> : null}
    </div>
  </>;
}
