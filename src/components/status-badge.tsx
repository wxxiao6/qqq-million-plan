import { Badge } from "@/components/ui/badge";
import { subscribeLabel } from "@/components/labels";
import { formatLimit } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<string, string> = {
  open: "rounded-full border-gain/20 bg-open-wash px-2.5 text-gain",
  limited: "rounded-full border-limit/25 bg-limit-wash px-2.5 text-limit",
  paused: "rounded-full border-loss/20 bg-paused-wash px-2.5 text-loss",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full font-normal", STATUS_CLASS[status])}
    >
      {subscribeLabel(status)}
    </Badge>
  );
}

export function CellLabel({
  status,
  dailyLimit,
}: {
  status?: string | null;
  dailyLimit?: number | null;
}) {
  if (!status) return <span className="text-muted-foreground">未知</span>;
  if (status === "paused") return <StatusBadge status={status} />;
  if (status === "open" && dailyLimit == null) {
    return <StatusBadge status={status} />;
  }
  if (status === "limited" && dailyLimit != null) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <StatusBadge status={status} />
        <span className="font-mono text-xs">限 {formatLimit(dailyLimit)}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge status={status} />
      {dailyLimit != null ? (
        <span className="font-mono text-xs">限 {formatLimit(dailyLimit)}</span>
      ) : null}
    </span>
  );
}

export function CrowdBadge({
  tag,
}: {
  tag: "过热" | "正常" | "冷" | string | null | undefined;
}) {
  if (!tag) return null;
  const cls =
    tag === "过热"
      ? "rounded-full border-loss/20 bg-paused-wash px-2.5 text-loss"
      : tag === "冷"
        ? "rounded-full border-border bg-muted px-2.5 text-muted-foreground"
        : "rounded-full border-border bg-card px-2.5 text-foreground";
  return (
    <Badge variant="outline" className={cn("rounded-full font-normal", cls)}>
      {tag}
    </Badge>
  );
}
