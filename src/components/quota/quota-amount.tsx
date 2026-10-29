import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";
import type { QuotaAmount, QuotaShareTag } from "@/lib/quota-math";
import type { QuotaCell } from "@/server/quota";

export function QuotaMoney({
  value,
  className,
  unknownLabel = "—",
}: {
  value: QuotaAmount;
  className?: string;
  unknownLabel?: string;
}) {
  if (value.kind === "unknown") {
    return <span className={cn("text-muted-foreground", className)}>{unknownLabel}</span>;
  }
  if (value.kind === "unlimited") {
    return <span className={className}>不限额</span>;
  }
  return <Money value={value.value} className={className} />;
}

function shareTagLabel(tag: QuotaShareTag) {
  if (tag === "all-channel") return "全渠道共享";
  if (tag === "shared") return "共享额度";
  return null;
}

export function QuotaCellValue({ cell }: { cell: QuotaCell | null }) {
  if (!cell) {
    return <span className="text-muted-foreground">未知</span>;
  }
  const tag = shareTagLabel(cell.shareTag);
  let body: ReactNode;
  if (cell.status === "paused") {
    body = <span className="bg-paused-wash px-1 text-loss">暂停</span>;
  } else if (cell.investable.kind === "unknown") {
    body = <span className="text-muted-foreground">未知</span>;
  } else if (cell.investable.kind === "unlimited") {
    body = <span className="bg-open-wash px-1 text-gain">不限额</span>;
  } else {
    body = (
      <span className="bg-limit-wash px-1">
        <Money value={cell.investable.value} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      {body}
      {tag ? <span className="text-[11px] text-muted-foreground">{tag}</span> : null}
    </span>
  );
}

export function CoverageNote({
  covered,
  total,
}: {
  covered: number;
  total: number;
}) {
  return (
    <span>
      已覆盖 {covered} / {total} 个额度作用域
    </span>
  );
}
