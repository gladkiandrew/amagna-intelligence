import type { Check, CheckStatus, Recommendation, Teaser } from './model.js';
import { formatMoney, formatPercent, formatMultiple } from './format.js';

/**
 * Screening thresholds.
 *
 * These are a mandate, not a truth. They live in one exported object so that the
 * memo can print the criterion beside every verdict — a screen whose thresholds
 * are buried in `if` statements cannot be argued with, and a screen nobody can
 * argue with is a screen nobody trusts.
 */
export interface Thresholds {
  minRevenue: number;
  minEbitda: number;
  minRevenueCagr: number;
  watchRevenueCagr: number;
  minEbitdaMargin: number;
  watchEbitdaMargin: number;
  minRecurringShare: number;
  watchRecurringShare: number;
  maxSingleCustomerShare: number;
  watchSingleCustomerShare: number;
  maxTopFiveShare: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minRevenue: 10_000_000,
  minEbitda: 1_500_000,
  minRevenueCagr: 0.05,
  watchRevenueCagr: 0.02,
  minEbitdaMargin: 0.12,
  watchEbitdaMargin: 0.08,
  minRecurringShare: 0.5,
  watchRecurringShare: 0.3,
  maxSingleCustomerShare: 0.25,
  watchSingleCustomerShare: 0.15,
  maxTopFiveShare: 0.6,
};

export function runChecks(
  teaser: Teaser,
  buyerAdjustedEbitda: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Check[] {
  return [
    sizeCheck(teaser, buyerAdjustedEbitda, thresholds),
    growthCheck(teaser, thresholds),
    marginCheck(teaser, buyerAdjustedEbitda, thresholds),
    recurringCheck(teaser, thresholds),
    concentrationCheck(teaser, thresholds),
  ];
}

function sizeCheck(teaser: Teaser, buyerAdjustedEbitda: number, t: Thresholds): Check {
  const bigEnough = teaser.revenue >= t.minRevenue && buyerAdjustedEbitda >= t.minEbitda;
  const borderline = buyerAdjustedEbitda >= t.minEbitda * 0.8;
  return {
    name: 'Size',
    status: bigEnough ? 'pass' : borderline ? 'watch' : 'fail',
    value: `${formatMoney(teaser.revenue)} revenue · ${formatMoney(buyerAdjustedEbitda)} buyer-adjusted EBITDA`,
    criterion: `≥ ${formatMoney(t.minRevenue)} revenue and ≥ ${formatMoney(t.minEbitda)} EBITDA`,
    comment: bigEnough
      ? 'Inside mandate on both measures.'
      : borderline
        ? 'Below the EBITDA floor on buyer-adjusted figures, though within reach if diligence recovers add-backs.'
        : 'Below the mandate floor after adjustment.',
  };
}

export function revenueCagr(teaser: Teaser): number | null {
  const series = [...teaser.revenueHistory, teaser.revenue].filter((value) => value > 0);
  if (series.length < 2) return null;
  const first = series[0] as number;
  const last = series[series.length - 1] as number;
  const periods = series.length - 1;
  return (last / first) ** (1 / periods) - 1;
}

function growthCheck(teaser: Teaser, t: Thresholds): Check {
  const cagr = revenueCagr(teaser);
  if (cagr === null) {
    return {
      name: 'Growth',
      status: 'watch',
      value: 'not computable',
      criterion: `≥ ${formatPercent(t.minRevenueCagr)} revenue CAGR`,
      comment: 'Fewer than two years of revenue were provided. Request the full history.',
    };
  }
  const status: CheckStatus =
    cagr >= t.minRevenueCagr ? 'pass' : cagr >= t.watchRevenueCagr ? 'watch' : 'fail';
  const years = teaser.revenueHistory.length;
  return {
    name: 'Growth',
    status,
    value: `${formatPercent(cagr)} CAGR over ${years} year${years === 1 ? '' : 's'}`,
    criterion: `≥ ${formatPercent(t.minRevenueCagr)} (watch from ${formatPercent(t.watchRevenueCagr)})`,
    comment:
      status === 'pass'
        ? 'Growing ahead of the mandate floor.'
        : status === 'watch'
          ? 'Growing, but slowly enough that the entry multiple has to do the work.'
          : 'Flat to declining. The thesis would have to be margin or consolidation, not growth.',
  };
}

function marginCheck(teaser: Teaser, buyerAdjustedEbitda: number, t: Thresholds): Check {
  const reported = teaser.reportedEbitda / teaser.revenue;
  const adjusted = buyerAdjustedEbitda / teaser.revenue;
  const status: CheckStatus =
    adjusted >= t.minEbitdaMargin ? 'pass' : adjusted >= t.watchEbitdaMargin ? 'watch' : 'fail';
  return {
    name: 'Margin',
    status,
    value: `${formatPercent(adjusted)} buyer-adjusted (${formatPercent(reported)} reported)`,
    criterion: `≥ ${formatPercent(t.minEbitdaMargin)} (watch from ${formatPercent(t.watchEbitdaMargin)})`,
    comment:
      status === 'pass'
        ? 'Margin holds up after the add-back review.'
        : 'Margin depends on add-backs that did not survive review — treat the reported figure as the floor.',
  };
}

function recurringCheck(teaser: Teaser, t: Thresholds): Check {
  const share = teaser.recurringRevenueShare;
  const status: CheckStatus =
    share >= t.minRecurringShare ? 'pass' : share >= t.watchRecurringShare ? 'watch' : 'fail';
  return {
    name: 'Recurring revenue',
    status,
    value: formatPercent(share),
    criterion: `≥ ${formatPercent(t.minRecurringShare)} (watch from ${formatPercent(t.watchRecurringShare)})`,
    comment:
      status === 'pass'
        ? 'A contracted base this size supports leverage.'
        : 'Too much of the revenue is re-won every year to lean on the debt capacity.',
  };
}

/**
 * `customers` lists *named* accounts only. The unnamed long tail is whatever share
 * is left over, and must not appear as a row — a catch-all "remaining 140 accounts"
 * entry would be ranked as the largest customer and invert the concentration test,
 * which is exactly the kind of quiet data-shape bug that makes a screen lie.
 */
export function concentration(teaser: Teaser): {
  top: number;
  topFive: number;
  topName: string | null;
} {
  const sorted = [...teaser.customers].sort((a, b) => b.revenueShare - a.revenueShare);
  const top = sorted[0];
  return {
    top: top?.revenueShare ?? 0,
    topFive: sorted.slice(0, 5).reduce((total, customer) => total + customer.revenueShare, 0),
    topName: top?.name ?? null,
  };
}

function concentrationCheck(teaser: Teaser, t: Thresholds): Check {
  const { top, topFive, topName } = concentration(teaser);
  const status: CheckStatus =
    top > t.maxSingleCustomerShare || topFive > t.maxTopFiveShare
      ? 'fail'
      : top > t.watchSingleCustomerShare
        ? 'watch'
        : 'pass';
  return {
    name: 'Customer concentration',
    status,
    value: `${formatPercent(top)} largest${topName ? ` (${topName})` : ''} · ${formatPercent(topFive)} top five`,
    criterion: `largest ≤ ${formatPercent(t.maxSingleCustomerShare)}, top five ≤ ${formatPercent(t.maxTopFiveShare)}`,
    comment:
      status === 'pass'
        ? 'Spread wide enough that no single loss is existential.'
        : status === 'watch'
          ? 'Watch the largest account — understand contract term and renewal history before bidding.'
          : 'Concentration breaches the mandate. Losing the top account would reprice the whole deal, so any bid needs structure that reflects that.',
  };
}

/**
 * Derived, not asserted: one `fail` is enough to pass on a deal, and anything
 * short of all-clear goes to diligence rather than straight to a bid.
 */
export function recommend(checks: Check[]): Recommendation {
  if (checks.some((check) => check.status === 'fail')) return 'pass';
  if (checks.some((check) => check.status === 'watch')) return 'pursue-with-diligence';
  return 'pursue';
}

export function formatMultipleRange(low: number, high: number): string {
  return `${formatMultiple(low)}–${formatMultiple(high)}`;
}
