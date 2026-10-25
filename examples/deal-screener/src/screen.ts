import {
  ADD_BACK_POLICY,
  claimedTotal,
  creditedTotal,
  reviewAdjustments,
  type AddBackPolicy,
} from './adjustments.js';
import { DEFAULT_THRESHOLDS, recommend, runChecks, type Thresholds } from './checks.js';
import { DEFAULT_ASSUMPTIONS, paperLbo, type LboAssumptions } from './lbo.js';
import type { Screen, Teaser, Valuation } from './model.js';

export interface ScreenOptions {
  thresholds?: Thresholds;
  assumptions?: LboAssumptions;
  lowMultiple?: number;
  highMultiple?: number;
  /** The add-back policy. A mandate can be stricter or looser than the default. */
  policy?: AddBackPolicy;
}

export const DEFAULT_LOW_MULTIPLE = 5;
export const DEFAULT_HIGH_MULTIPLE = 7;

/**
 * The whole screen, in order: review the add-backs, derive buyer-adjusted EBITDA,
 * judge the business against the mandate, value it, and run a paper LBO.
 *
 * Every number below is computed here in TypeScript. The language model in this
 * example writes one paragraph of narrative over the finished object and touches
 * nothing else — see narrative.ts for why that boundary is where it is.
 */
export function screen(teaser: Teaser, options: ScreenOptions = {}): Screen {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const assumptions = options.assumptions ?? DEFAULT_ASSUMPTIONS;
  const lowMultiple = options.lowMultiple ?? DEFAULT_LOW_MULTIPLE;
  const highMultiple = options.highMultiple ?? DEFAULT_HIGH_MULTIPLE;

  const adjustments = reviewAdjustments(teaser.adjustments, options.policy ?? ADD_BACK_POLICY);
  const buyerAdjustedEbitda = round2(teaser.reportedEbitda + creditedTotal(adjustments));
  const sellerAdjustedEbitda = round2(teaser.reportedEbitda + claimedTotal(adjustments));

  const checks = runChecks(teaser, buyerAdjustedEbitda, thresholds);

  const askEnterpriseValue =
    teaser.askMultiple === undefined ? null : round2(teaser.askMultiple * sellerAdjustedEbitda);
  const valuation: Valuation = {
    buyerAdjustedEbitda,
    sellerAdjustedEbitda,
    lowMultiple,
    highMultiple,
    lowEnterpriseValue: round2(buyerAdjustedEbitda * lowMultiple),
    highEnterpriseValue: round2(buyerAdjustedEbitda * highMultiple),
    midEnterpriseValue: round2((buyerAdjustedEbitda * (lowMultiple + highMultiple)) / 2),
    askEnterpriseValue,
    // The number that ends the conversation: what the seller's ask actually costs
    // per turn of EBITDA a buyer believes in.
    askMultipleOnBuyerAdjusted:
      askEnterpriseValue === null || buyerAdjustedEbitda <= 0
        ? null
        : Math.round((askEnterpriseValue / buyerAdjustedEbitda) * 100) / 100,
  };

  return {
    teaser,
    checks,
    adjustments,
    valuation,
    lbo: paperLbo(teaser, buyerAdjustedEbitda, assumptions),
    recommendation: recommend(checks),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
