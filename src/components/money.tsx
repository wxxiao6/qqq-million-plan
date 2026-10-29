import { formatMoney, formatQty, formatSignedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

export function Money({
  value,
  signed = false,
  fractionDigits = 2,
  className,
}: {
  value: number | null | undefined;
  signed?: boolean;
  fractionDigits?: number;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <Dash />;
  const tone =
    signed && value > 0
      ? "text-gain"
      : signed && value < 0
        ? "text-loss"
        : signed
          ? "text-foreground"
          : undefined;
  return (
    <span className={cn("font-mono tabular-nums", tone, className)}>
      {signed ? formatSignedMoney(value, fractionDigits) : formatMoney(value, fractionDigits)}
    </span>
  );
}

export function Qty({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <Dash />;
  return <span className="font-mono tabular-nums">{formatQty(value)}</span>;
}
