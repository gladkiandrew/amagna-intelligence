import type { Adjustment, AdjustmentCategory, ReviewedAdjustment, Verdict } from './model.js';

interface Policy {
  /** Credited fraction when the seller provided support. */
  documentedHaircut: number;
  /** Credited fraction when they did not. */
  undocumentedHaircut: number;
  rationale: string;
}

/**
 * The add-back policy.
 *
 * This is the part of a screen where deals are won and lost, and it is the part
 * most worth writing down. A seller's "adjusted EBITDA" is an argument, not a
 * fact: every add-back is a claim that a cost will not recur for the buyer. The
 * policy below encodes which of those claims survive contact with a buyer's own
 * P&L, with the reasoning attached so a reader can disagree with the *principle*
 * rather than reverse-engineer it from a number.
 *
 * Two categories are worth reading twice:
 *
 * - `pro-forma-synergy` is credited at zero. Synergies belong in the buyer's model,
 *   not in the seller's EBITDA. Crediting them means paying a multiple to the
 *   seller for work the buyer has to do, and paying it up front in cash.
 * - `related-party-normalisation` is credited in full *including when negative*.
 *   An owner renting the yard to their own company below market is reporting
 *   EBITDA that the buyer cannot reproduce at the market rent they will actually
 *   pay. Restating it down is not pessimism; it is the same discipline applied in
 *   the direction that costs the seller money.
 */
const POLICY: Record<AdjustmentCategory, Policy> = {
  'owner-compensation': {
    documentedHaircut: 1,
    undocumentedHaircut: 0.5,
    rationale:
      'Owner pay above a market replacement salary is a genuine add-back — the buyer hires a manager at market, not at the founder’s drawings. Credited in full where payroll records and a replacement-cost benchmark support it; haircut 50% where the benchmark is asserted rather than evidenced.',
  },
  'discretionary-personal': {
    documentedHaircut: 1,
    undocumentedHaircut: 0,
    rationale:
      'Personal spend run through the company is a real add-back only if it can be itemised. Credited in full against invoices; credited at zero otherwise, because an unitemised "personal expenses" line is as likely to be operating cost as it is to be the owner’s boat.',
  },
  'one-time': {
    documentedHaircut: 1,
    undocumentedHaircut: 0.5,
    rationale:
      'A genuinely non-recurring cost should not depress the earnings a buyer pays for. Credited in full where the event and amount are documented; haircut 50% otherwise, since "one-time" costs have a way of recurring annually.',
  },
  'related-party-normalisation': {
    documentedHaircut: 1,
    undocumentedHaircut: 1,
    rationale:
      'Related-party terms are restated to market in both directions. The buyer inherits the market rate, not the family rate, so this flows through in full — including when it reduces EBITDA.',
  },
  'run-rate-new-contract': {
    documentedHaircut: 0.5,
    undocumentedHaircut: 0.25,
    rationale:
      'Annualising a contract with only a few months of history prices in performance nobody has observed yet. Credited at half with a signed contract and delivered months behind it, a quarter without — and revisited in diligence rather than argued at screening.',
  },
  'accounting-policy': {
    documentedHaircut: 0,
    undocumentedHaircut: 0,
    rationale:
      'A change in accounting policy moves where a cost appears; it does not change the cash. Credited at zero.',
  },
  'pro-forma-synergy': {
    documentedHaircut: 0,
    undocumentedHaircut: 0,
    rationale:
      'Synergies belong in the buyer’s model, not the seller’s EBITDA. Crediting them pays the seller a multiple, in cash at close, for work the buyer has to do afterwards.',
  },
};

export function reviewAdjustments(adjustments: Adjustment[]): ReviewedAdjustment[] {
  return adjustments.map((adjustment) => {
    const policy = POLICY[adjustment.category];
    const haircut = adjustment.documented ? policy.documentedHaircut : policy.undocumentedHaircut;
    const credited = round2(adjustment.amount * haircut);
    return {
      ...adjustment,
      haircut,
      credited,
      verdict: verdictFor(haircut),
      rationale: policy.rationale,
    };
  });
}

function verdictFor(haircut: number): Verdict {
  if (haircut >= 1) return 'accepted';
  if (haircut <= 0) return 'rejected';
  return 'challenged';
}

/** Sum of what actually reaches buyer-adjusted EBITDA. */
export function creditedTotal(reviewed: ReviewedAdjustment[]): number {
  return round2(reviewed.reduce((total, entry) => total + entry.credited, 0));
}

/** Sum of everything the seller claimed, including what we rejected. */
export function claimedTotal(reviewed: ReviewedAdjustment[]): number {
  return round2(reviewed.reduce((total, entry) => total + entry.amount, 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export { POLICY as ADD_BACK_POLICY };
