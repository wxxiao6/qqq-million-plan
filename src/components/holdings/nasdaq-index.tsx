import { Dash } from "@/components/money";

export function NasdaqIndex({ value }: { value: number | null }) {
  return (
    <p className="text-sm text-muted-foreground">
      纳指点位{" "}
      {value == null ? (
        <Dash />
      ) : (
        <span className="font-mono tabular-nums text-foreground">
          {value.toLocaleString("zh-CN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      )}
    </p>
  );
}
