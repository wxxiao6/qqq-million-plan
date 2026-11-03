import Decimal from "decimal.js";

// An isolated constructor prevents third-party code changing accounting precision.
export const FinancialDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const decimal = (value: Decimal.Value) => new FinancialDecimal(value);

/** Decimal half-up: negative ties round away from zero too. */
export function roundDecimal(value: Decimal.Value, places: number): number {
  const rounded = decimal(value).toDecimalPlaces(places);
  return rounded.isZero() ? 0 : rounded.toNumber();
}

export const roundMoney = (value: Decimal.Value) => roundDecimal(value, 2);
export const isMoneyAmount = (value: number) => Number.isFinite(value) && decimal(value).decimalPlaces() <= 2;
export const sumDecimal = (values: readonly number[]) => values.reduce((sum, value) => sum.plus(value), decimal(0)).toNumber();
export const sumMoney = (values: readonly number[]) => roundMoney(values.reduce((sum, value) => sum.plus(value), decimal(0)));

/** Default OTC estimate. Actual registrar-confirmed shares always take priority. */
export function estimateFundShares(amount: number, nav: number, mode: "half-up" | "truncate" = "half-up"): number {
  return decimal(amount).div(nav).toDecimalPlaces(2, mode === "truncate" ? Decimal.ROUND_DOWN : Decimal.ROUND_HALF_UP).toNumber();
}

/** Match the integer D1 estimator's representable domain; leave other orders for confirmation. */
export function canAutoEstimateFundShares(amount: number, nav: number): boolean {
  return amount >= 0 && isMoneyAmount(amount) && Number.isFinite(nav) && nav > 0 && decimal(nav).decimalPlaces() <= 8
    && decimal(nav).times(100000000).lte(900719925474099)
    && decimal(amount).times(100).lte(Number.MAX_SAFE_INTEGER)
    && decimal(amount).div(nav).times(100).lte(Number.MAX_SAFE_INTEGER);
}
