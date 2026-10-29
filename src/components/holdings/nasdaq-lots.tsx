import { platformLabel, positionStatusLabel } from "@/components/labels";
import { Money } from "@/components/money";
import type { NasdaqPlatformGroup } from "@/server/ledger";

export function NasdaqLots({ groups }: { groups: NasdaqPlatformGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <div className="mt-6 space-y-5">
      {groups.map((group) => {
        const hasSettled = group.lots.some((lot) => lot.status === "settled");
        return (
          <section key={group.account}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 border-b border-border/70 pb-2">
              <h3 className="text-base font-semibold">{platformLabel(group.account)}</h3>
              {hasSettled ? (
                <p className="text-sm text-muted-foreground">
                  当日收益 <Money value={group.today} signed className="font-display text-lg" />
                </p>
              ) : null}
            </div>
            <ul className="divide-y divide-border/70">
              {group.lots.map((lot) => (
                <li
                  key={lot.id}
                  className={
                    lot.status === "pending"
                      ? "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm text-muted-foreground"
                      : "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
                  }
                >
                  <span className="min-w-40">
                    <span className="font-mono text-xs">{lot.symbol}</span>
                    {lot.name ? (
                      <span className="ml-2 text-muted-foreground">{lot.name}</span>
                    ) : null}
                    {lot.status === "pending" ? (
                      <span className="ml-2 text-xs">{positionStatusLabel(lot.status)}</span>
                    ) : null}
                  </span>
                  <span>{dailyLabel(lot.navAsOf)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function dailyLabel(navAsOf: string | null) {
  return navAsOf ? `当日（${navAsOf.slice(5)} 净值）` : "当日";
}
