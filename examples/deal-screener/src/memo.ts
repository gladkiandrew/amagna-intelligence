import { DEFAULT_ASSUMPTIONS, type LboAssumptions } from './lbo.js';
import { formatExact, formatMoney, formatMultiple, formatPercent } from './format.js';
import { revenueCagr } from './checks.js';
import type { Recommendation, Screen, Verdict } from './model.js';
import { renderGrid, sensitivity } from './sensitivity.js';

const STATUS_MARK = { pass: 'PASS', watch: 'WATCH', fail: 'FAIL' } as const;
const VERDICT_MARK: Record<Verdict, string> = {
  accepted: 'Accept',
  challenged: 'Challenge',
  rejected: 'Reject',
};
const RECOMMENDATION_TEXT: Record<Recommendation, string> = {
  pursue: 'Pursue — all screening criteria clear.',
  'pursue-with-diligence':
    'Pursue, with the watch items below answered before a bid. No criterion failed, but not everything is clear.',
  pass: 'Pass at screening. At least one mandate criterion failed.',
};

export interface MemoOptions {
  /** One narrative paragraph. The only part of this document a model writes. */
  narrative?: string;
  /** Labelled in the output so a reader always knows which they are looking at. */
  narrativeMode?: 'mock' | 'live';
  assumptions?: LboAssumptions;
}

/**
 * Render the screen as a memo.
 *
 * Deterministic by construction: same input, same bytes, which is what makes
 * `fixtures/expected-memo.md` a real test rather than a decorative one. The
 * narrative paragraph is injected and clearly attributed; everything else is
 * computed.
 */
export function renderMemo(result: Screen, options: MemoOptions = {}): string {
  const assumptions = options.assumptions ?? DEFAULT_ASSUMPTIONS;
  const { teaser, valuation, lbo } = result;
  const cagr = revenueCagr(teaser);

  const lines: string[] = [];
  const push = (...entries: string[]): void => {
    lines.push(...entries);
  };

  push(`# Screening memo — ${teaser.company}`);
  push('');
  push(`${teaser.sector} · FY${teaser.fiscalYear}`);
  push('');
  push(`**Recommendation: ${RECOMMENDATION_TEXT[result.recommendation]}**`);
  push('');

  push('## The numbers');
  push('');
  push('| | |');
  push('|---|---|');
  push(`| Revenue (FY${teaser.fiscalYear}) | ${formatExact(teaser.revenue)} |`);
  push(
    `| Revenue CAGR | ${cagr === null ? 'n/a' : formatPercent(cagr)} over ${teaser.revenueHistory.length} year(s) |`,
  );
  push(
    `| Reported EBITDA | ${formatExact(teaser.reportedEbitda)} (${formatPercent(teaser.reportedEbitda / teaser.revenue)}) |`,
  );
  push(
    `| Seller-adjusted EBITDA | ${formatExact(valuation.sellerAdjustedEbitda)} (${formatPercent(valuation.sellerAdjustedEbitda / teaser.revenue)}) |`,
  );
  push(
    `| **Buyer-adjusted EBITDA** | **${formatExact(valuation.buyerAdjustedEbitda)}** (${formatPercent(valuation.buyerAdjustedEbitda / teaser.revenue)}) |`,
  );
  push(`| Recurring revenue | ${formatPercent(teaser.recurringRevenueShare)} |`);
  push('');

  push('## Screening checks');
  push('');
  push('| Check | Result | Measured | Criterion |');
  push('|---|---|---|---|');
  for (const check of result.checks) {
    push(`| ${check.name} | ${STATUS_MARK[check.status]} | ${check.value} | ${check.criterion} |`);
  }
  push('');
  for (const check of result.checks) {
    if (check.status !== 'pass')
      push(`- **${check.name} (${STATUS_MARK[check.status]}).** ${check.comment}`);
  }
  if (result.checks.every((check) => check.status === 'pass'))
    push('- Nothing outside the mandate.');
  push('');

  push('## Add-back review');
  push('');
  push(
    `The seller claims ${formatExact(valuation.sellerAdjustedEbitda - teaser.reportedEbitda)} of adjustments. ` +
      `${formatExact(valuation.buyerAdjustedEbitda - teaser.reportedEbitda)} of that survives review.`,
  );
  push('');
  push('| Adjustment | Claimed | Verdict | Credited |');
  push('|---|---|---|---|');
  for (const adjustment of result.adjustments) {
    push(
      `| ${adjustment.label}${adjustment.documented ? '' : ' *(undocumented)*'} | ${formatExact(adjustment.amount)} | ${VERDICT_MARK[adjustment.verdict]}${adjustment.haircut > 0 && adjustment.haircut < 1 ? ` (${formatPercent(adjustment.haircut)})` : ''} | ${formatExact(adjustment.credited)} |`,
    );
  }
  push(
    `| **Total** | **${formatExact(valuation.sellerAdjustedEbitda - teaser.reportedEbitda)}** | | **${formatExact(valuation.buyerAdjustedEbitda - teaser.reportedEbitda)}** |`,
  );
  push('');

  const contested = result.adjustments.filter((adjustment) => adjustment.verdict !== 'accepted');
  if (contested.length > 0) {
    push('Where we differ from the seller:');
    push('');
    for (const adjustment of contested) {
      push(
        `- **${adjustment.label}** — ${VERDICT_MARK[adjustment.verdict].toLowerCase()}. ${adjustment.rationale}`,
      );
    }
    push('');
  }

  const negatives = result.adjustments.filter((adjustment) => adjustment.amount < 0);
  if (negatives.length > 0) {
    push('Adjustments that move against the seller:');
    push('');
    for (const adjustment of negatives) {
      push(
        `- **${adjustment.label}** — ${formatExact(adjustment.amount)}. ${adjustment.rationale}`,
      );
    }
    push('');
  }

  push('## Valuation');
  push('');
  push(
    `At ${formatMultiple(valuation.lowMultiple)}–${formatMultiple(valuation.highMultiple)} on buyer-adjusted EBITDA of ${formatExact(valuation.buyerAdjustedEbitda)}:`,
  );
  push('');
  push(
    `- **${formatMoney(valuation.lowEnterpriseValue)} – ${formatMoney(valuation.highEnterpriseValue)}** enterprise value (midpoint ${formatMoney(valuation.midEnterpriseValue)})`,
  );
  if (valuation.askEnterpriseValue !== null && valuation.askMultipleOnBuyerAdjusted !== null) {
    const aboveRange = valuation.askEnterpriseValue > valuation.highEnterpriseValue;
    push(
      `- Seller's ask of ${formatMultiple(teaser.askMultiple ?? 0)} on their own adjusted figure is ${formatMoney(valuation.askEnterpriseValue)}, which is ${formatMultiple(valuation.askMultipleOnBuyerAdjusted)} of buyer-adjusted EBITDA — ${aboveRange ? 'above the top of our range' : 'inside our range'}.`,
    );
    push(
      `- The gap is ${formatMoney(Math.abs(valuation.askEnterpriseValue - valuation.midEnterpriseValue))} against our midpoint, and almost all of it is the add-back disagreement rather than the multiple.`,
    );
  }
  push('');

  push('## Paper LBO');
  push('');
  push(
    `Entry at ${formatMultiple(lbo.entryMultiple)} (${formatMoney(lbo.enterpriseValue)}), ` +
      `${formatMoney(lbo.entryDebt)} of debt, ${formatMoney(lbo.entryEquity)} of equity including ${formatMoney(lbo.transactionFees)} of fees. ` +
      `${lbo.holdYears}-year hold, exit at ${formatMultiple(lbo.exitMultiple)}.`,
  );
  push('');
  push('| Year | Revenue | EBITDA | Interest | Cash taxes | Capex | FCF | Closing debt |');
  push('|---|---|---|---|---|---|---|---|');
  for (const year of lbo.years) {
    push(
      `| ${year.year} | ${formatMoney(year.revenue)} | ${formatMoney(year.ebitda)} | ${formatMoney(year.interest)} | ${formatMoney(year.cashTaxes)} | ${formatMoney(year.capex)} | ${formatMoney(year.freeCashFlow)} | ${formatMoney(year.closingDebt)} |`,
    );
  }
  push('');
  push(
    `Exit EBITDA ${formatMoney(lbo.exitEbitda)} × ${formatMultiple(lbo.exitMultiple)} = ${formatMoney(lbo.exitEnterpriseValue)}, ` +
      `less ${formatMoney(lbo.exitDebt)} of remaining debt${lbo.exitCash > 0 ? `, plus ${formatMoney(lbo.exitCash)} of cash built up after the debt was repaid,` : ''} = **${formatMoney(lbo.exitEquity)}** of equity.`,
  );
  push('');
  push(
    `- **MOIC ${lbo.moic.toFixed(2)}x · IRR ${formatPercent(lbo.irr)}** over ${lbo.holdYears} years`,
  );
  push('');
  push('Assumptions, so you can disagree with them:');
  push('');
  push(
    `- ${formatPercent(assumptions.revenueGrowth)} revenue growth, ${formatPercent(assumptions.ebitdaGrowth)} EBITDA growth, no margin expansion`,
  );
  push(
    `- ${formatMultiple(assumptions.leverageTurns)} leverage capped at ${formatPercent(assumptions.maxLeverageShareOfEv)} of EV, ${formatPercent(assumptions.interestRate)} interest, 100% cash sweep`,
  );
  push(
    `- ${formatPercent(assumptions.taxRate)} cash tax, D&A proxied by maintenance capex at ${formatPercent(teaser.maintenanceCapexShare)} of revenue`,
  );
  push(
    '- Exit at the entry multiple: the return comes from deleveraging and growth, not from re-rating',
  );
  push('');

  push('## Sensitivity');
  push('');
  push(
    'The same paper LBO rerun one turn and four points either side of the base case, which sits in the middle cell of each table.',
  );
  push('');
  const grids = sensitivity(teaser, valuation.buyerAdjustedEbitda, assumptions);
  push(...renderGrid(grids.entryExit));
  push('');
  push(...renderGrid(grids.leverageGrowth));
  push('');

  push('## Diligence priorities');
  push('');
  for (const item of diligenceList(result)) push(`- ${item}`);
  push('');

  if (options.narrative && options.narrative.trim() !== '') {
    push(
      `## Investment view${options.narrativeMode === 'mock' ? ' *(mock — no model was called)*' : ''}`,
    );
    push('');
    push(options.narrative.trim());
    push('');
  }

  push('---');
  push('');
  push(
    'Every figure above is computed from the teaser by `examples/deal-screener`. Only the investment-view paragraph is model-written.',
  );
  push('');

  return lines.join('\n');
}

/**
 * The diligence list is derived from what the screen actually found, not written
 * by hand. A watch item with no diligence question attached to it is a watch item
 * that will be forgotten.
 */
export function diligenceList(result: Screen): string[] {
  const items: string[] = [];

  for (const check of result.checks) {
    if (check.status === 'pass') continue;
    items.push(`${check.name}: ${check.comment}`);
  }

  for (const adjustment of result.adjustments) {
    if (adjustment.verdict === 'accepted') continue;
    if (!adjustment.documented) {
      items.push(
        `Obtain support for "${adjustment.label}" (${adjustment.verdict}, currently undocumented).`,
      );
    } else if (adjustment.verdict === 'challenged') {
      items.push(
        `Test the basis for "${adjustment.label}" — credited at ${Math.round(adjustment.haircut * 100)}% pending diligence.`,
      );
    }
  }

  for (const note of result.teaser.readerNotes ?? []) items.push(note);

  if (items.length === 0)
    items.push('Nothing outstanding from the screen itself; proceed to a management meeting.');
  return items;
}
