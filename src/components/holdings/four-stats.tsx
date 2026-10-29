import { Money } from "@/components/money";
import type { ExposureSummary } from "@/server/ledger";

export function FourStats({
  summary,
  featured = false,
}: {
  summary: ExposureSummary;
  /** 页顶总览将市值作为唯一视觉锚点，其余指标保持辅助。 */
  featured?: boolean;
}) {
  if (!summary.hasSettled) return null;

  const returnRate =
    summary.holdingPnl != null && summary.cost > 0
      ? summary.holdingPnl / summary.cost
      : null;

  if (featured) {
    return (
      <dl className="holding-overview">
        <div className="holding-overview-main">
          <dt>动态资产市值</dt>
          <dd>
            <Money value={summary.marketValue} className="font-display text-5xl sm:text-6xl" />
          </dd>
        </div>
        <div className="holding-overview-return">
          <dt>持有收益</dt>
          <dd>
            <Money value={summary.holdingPnl} signed className="font-display text-3xl sm:text-4xl" />
          </dd>
          <p>
            收益率{" "}
            {returnRate == null ? (
              "—"
            ) : (
              <span className={returnRate > 0 ? "text-gain" : returnRate < 0 ? "text-loss" : undefined}>
                {`${returnRate > 0 ? "+" : ""}${(returnRate * 100).toFixed(2)}%`}
              </span>
            )}
          </p>
        </div>
        <div className="holding-overview-context">
          <div>
            <dt>总成本</dt>
            <dd><Money value={summary.cost} fractionDigits={4} /></dd>
          </div>
          <div>
            <dt>当日收益</dt>
            <dd><Money value={summary.today} signed /></dd>
          </div>
        </div>
      </dl>
    );
  }

  return (
    <dl className="holding-exposure-stats">
      <div className="holding-exposure-main">
        <dt>总市值</dt>
        <dd><Money value={summary.marketValue} className="font-display text-3xl" /></dd>
      </div>
      <div className="holding-exposure-pnl">
        <dt>持有收益</dt>
        <dd><Money value={summary.holdingPnl} signed className="font-display text-2xl" /></dd>
      </div>
      <div className="holding-exposure-context">
        <div>
          <dt>总成本</dt>
          <dd><Money value={summary.cost} fractionDigits={4} /></dd>
        </div>
        <div>
          <dt>当日收益</dt>
          <dd><Money value={summary.today} signed /></dd>
        </div>
      </div>
    </dl>
  );
}
