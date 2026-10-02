/**
 * Formatting lives in one module so the memo is byte-stable.
 *
 * `Intl.NumberFormat` is deliberately avoided: its output varies with the ICU data
 * in the running Node build, which would make the expected-output fixture pass on
 * one machine and fail on another. A screening memo that renders differently in CI
 * than on a laptop is not a memo you can review a diff of.
 */

/** $18.0m / $2.4m / $850k / $0. Always USD, always two significant decimals. */
export function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${sign}$${trim(absolute / 1_000_000, 1)}m`;
  if (absolute >= 1_000) return `${sign}$${trim(absolute / 1_000, 0)}k`;
  return `${sign}$${trim(absolute, 0)}`;
}

/** Exact dollars, with thousands separators: $2,436,000. For tables. */
export function formatExact(value: number): string {
  const sign = value < 0 ? '-' : '';
  const rounded = Math.round(Math.abs(value));
  return `${sign}$${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** 13.3% — one decimal, always. */
export function formatPercent(value: number): string {
  return `${trim(value * 100, 1)}%`;
}

/** 6.0x */
export function formatMultiple(value: number): string {
  return `${trim(value, 1)}x`;
}

function trim(value: number, decimals: number): string {
  return value.toFixed(decimals);
}
