import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSUMPTIONS,
  concentration,
  creditedTotal,
  claimedTotal,
  deterministicView,
  diligenceList,
  factSheet,
  formatExact,
  formatMoney,
  formatMultiple,
  formatPercent,
  loadTeaser,
  paperLbo,
  parseTeaser,
  recommend,
  renderMemo,
  reviewAdjustments,
  revenueCagr,
  screen,
  TeaserError,
  writeNarrative,
  type Adjustment,
  type Check,
  type Teaser,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');

const palm = await loadTeaser(join(FIXTURES, 'project-palm.json'));
const result = screen(palm);

describe('formatting', () => {
  it('is locale-independent and stable', () => {
    expect(formatMoney(18_000_000)).toBe('$18.0m');
    expect(formatMoney(2_985_000)).toBe('$3.0m');
    expect(formatMoney(358_200)).toBe('$358k');
    expect(formatMoney(-125_000)).toBe('-$125k');
    expect(formatMoney(0)).toBe('$0');
    expect(formatExact(2_985_000)).toBe('$2,985,000');
    expect(formatExact(-125_000)).toBe('-$125,000');
    expect(formatPercent(0.1658)).toBe('16.6%');
    expect(formatMultiple(6)).toBe('6.0x');
  });
});

describe('teaser validation', () => {
  it.each([
    ['missing revenue', { company: 'x', sector: 'y', fiscalYear: 2025 }],
    ['zero revenue', { ...plain(), revenue: 0 }],
    ['non-numeric EBITDA', { ...plain(), reportedEbitda: '2400000' }],
    ['share above 1', { ...plain(), recurringRevenueShare: 1.4 }],
    [
      'unknown adjustment category',
      { ...plain(), adjustments: [{ amount: 1, category: 'vibes', documented: true }] },
    ],
    [
      'adjustment missing documented',
      { ...plain(), adjustments: [{ amount: 1, category: 'one-time' }] },
    ],
    ['no customers', { ...plain(), customers: [] }],
    [
      'customer shares over 100%',
      {
        ...plain(),
        customers: [
          { name: 'a', revenueShare: 0.8 },
          { name: 'b', revenueShare: 0.5 },
        ],
      },
    ],
  ])('rejects %s rather than producing NaN', (_label, input) => {
    expect(() => parseTeaser(JSON.stringify(input))).toThrow(TeaserError);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseTeaser('{nope')).toThrow(TeaserError);
  });

  it('accepts a minimal valid teaser', () => {
    expect(parseTeaser(JSON.stringify(plain())).company).toBe('x');
  });
});

function plain(): Record<string, unknown> {
  return {
    company: 'x',
    sector: 'y',
    fiscalYear: 2025,
    revenue: 1_000_000,
    revenueHistory: [900_000],
    reportedEbitda: 100_000,
    recurringRevenueShare: 0.5,
    maintenanceCapexShare: 0.02,
    netDebtAtClose: 0,
    customers: [{ name: 'a', revenueShare: 0.1 }],
    adjustments: [],
  };
}

describe('add-back review', () => {
  const reviewed = reviewAdjustments(palm.adjustments);
  const byId = new Map(reviewed.map((entry) => [entry.id, entry]));

  it('accepts documented owner compensation in full', () => {
    expect(byId.get('owner-salary')).toMatchObject({ verdict: 'accepted', credited: 420_000 });
  });

  it('credits undocumented personal spend at zero', () => {
    expect(byId.get('personal-spend')).toMatchObject({ verdict: 'rejected', credited: 0 });
  });

  it('halves an annualised run-rate from a part-year contract', () => {
    expect(byId.get('municipal-contract')).toMatchObject({
      verdict: 'challenged',
      credited: 150_000,
    });
  });

  it('rejects an accounting-policy change — it moves cost, not cash', () => {
    expect(byId.get('repairs-capitalisation')).toMatchObject({ verdict: 'rejected', credited: 0 });
  });

  it("rejects the buyer's own synergies, which belong in the buyer's model", () => {
    expect(byId.get('route-density')).toMatchObject({ verdict: 'rejected', credited: 0 });
  });

  it('passes a below-market related-party rent through in full, as a NEGATIVE', () => {
    const rent = byId.get('yard-rent');
    expect(rent).toMatchObject({ verdict: 'accepted', credited: -125_000 });
    expect(rent!.credited).toBeLessThan(0);
  });

  it('haircuts an undocumented one-time cost rather than believing or discarding it', () => {
    const [entry] = reviewAdjustments([
      adjustment({ amount: 200_000, category: 'one-time', documented: false }),
    ]);
    expect(entry).toMatchObject({ verdict: 'challenged', credited: 100_000 });
  });

  it('totals to the seller claim and the credited figure separately', () => {
    expect(claimedTotal(reviewed)).toBe(1_135_000);
    expect(creditedTotal(reviewed)).toBe(585_000);
  });

  it('is pure: reviewing twice gives the same answer', () => {
    expect(reviewAdjustments(palm.adjustments)).toEqual(reviewed);
  });
});

function adjustment(overrides: Partial<Adjustment>): Adjustment {
  return {
    id: 'a',
    label: 'An adjustment',
    amount: 0,
    category: 'one-time',
    documented: true,
    ...overrides,
  };
}

describe('derived EBITDA', () => {
  it('computes buyer-adjusted and seller-adjusted EBITDA from the same adjustments', () => {
    expect(result.valuation.buyerAdjustedEbitda).toBe(2_985_000);
    expect(result.valuation.sellerAdjustedEbitda).toBe(3_535_000);
  });

  it('is 16.6% margin buyer-adjusted against 13.3% reported', () => {
    expect(formatPercent(result.valuation.buyerAdjustedEbitda / palm.revenue)).toBe('16.6%');
    expect(formatPercent(palm.reportedEbitda / palm.revenue)).toBe('13.3%');
  });
});

describe('checks', () => {
  const byName = new Map(result.checks.map((check) => [check.name, check]));

  it('computes revenue CAGR across the full series', () => {
    expect(formatPercent(revenueCagr(palm) as number)).toBe('8.2%');
    expect(revenueCagr({ ...palm, revenueHistory: [] })).toBeNull();
  });

  it('passes size, growth, margin and recurring revenue', () => {
    for (const name of ['Size', 'Growth', 'Margin', 'Recurring revenue']) {
      expect(byName.get(name)?.status, name).toBe('pass');
    }
  });

  it('flags the largest account as a watch, not a failure, at 21%', () => {
    expect(byName.get('Customer concentration')).toMatchObject({ status: 'watch' });
  });

  it('counts only named accounts, so a long-tail bucket cannot invert the test', () => {
    const { top, topFive, topName } = concentration(palm);
    expect(topName).toBe('Harbour Point REIT');
    expect(top).toBeCloseTo(0.21, 10);
    expect(topFive).toBeCloseTo(0.55, 10);
  });

  it('fails concentration once a single account breaches the cap', () => {
    const concentrated = screen({
      ...palm,
      customers: [{ name: 'One account', revenueShare: 0.4 }],
    });
    const check = concentrated.checks.find((entry) => entry.name === 'Customer concentration');
    expect(check?.status).toBe('fail');
    expect(concentrated.recommendation).toBe('pass');
  });

  it('prints the criterion beside every verdict so a reader can disagree', () => {
    for (const check of result.checks) {
      expect(check.criterion.length, check.name).toBeGreaterThan(0);
      expect(check.comment.length, check.name).toBeGreaterThan(0);
    }
  });

  it('derives the recommendation from the worst check', () => {
    const pass = (name: string): Check => ({
      name,
      status: 'pass',
      value: '',
      criterion: '',
      comment: '',
    });
    expect(recommend([pass('a'), pass('b')])).toBe('pursue');
    expect(recommend([pass('a'), { ...pass('b'), status: 'watch' }])).toBe('pursue-with-diligence');
    expect(
      recommend([
        { ...pass('a'), status: 'watch' },
        { ...pass('b'), status: 'fail' },
      ]),
    ).toBe('pass');
  });

  it('recommends pursue-with-diligence for Project Palm', () => {
    expect(result.recommendation).toBe('pursue-with-diligence');
  });
});

describe('valuation', () => {
  it('ranges 5x–7x on buyer-adjusted EBITDA', () => {
    expect(result.valuation.lowEnterpriseValue).toBe(14_925_000);
    expect(result.valuation.highEnterpriseValue).toBe(20_895_000);
    expect(result.valuation.midEnterpriseValue).toBe(17_910_000);
  });

  it("restates the seller's ask against the EBITDA a buyer can underwrite", () => {
    expect(result.valuation.askEnterpriseValue).toBe(21_210_000);
    expect(result.valuation.askMultipleOnBuyerAdjusted).toBe(7.11);
    expect(result.valuation.askEnterpriseValue!).toBeGreaterThan(
      result.valuation.highEnterpriseValue,
    );
  });

  it('omits the ask comparison when no ask was disclosed', () => {
    const { askMultiple: _omitted, ...withoutAsk } = palm;
    const quiet = screen(withoutAsk as Teaser);
    expect(quiet.valuation.askEnterpriseValue).toBeNull();
    expect(quiet.valuation.askMultipleOnBuyerAdjusted).toBeNull();
    expect(renderMemo(quiet)).not.toContain("Seller's ask");
  });
});

describe('paper LBO', () => {
  const lbo = result.lbo;

  it('sizes entry on buyer-adjusted EBITDA, not the seller figure', () => {
    expect(lbo.enterpriseValue).toBe(17_910_000);
    expect(lbo.enterpriseValue).toBe(result.valuation.buyerAdjustedEbitda * 6);
  });

  it('caps leverage at the tighter of turns and share of EV', () => {
    expect(lbo.entryDebt).toBe(8_955_000); // 3.0x binds before 55% of EV
    const expensive = paperLbo(palm, result.valuation.buyerAdjustedEbitda, {
      ...DEFAULT_ASSUMPTIONS,
      entryMultiple: 4,
    });
    // At 4.0x EV, the 55%-of-EV cap binds before 3.0x of EBITDA does.
    expect(expensive.entryDebt).toBe(Math.round(2_985_000 * 4 * 0.55));
  });

  it('funds fees and net debt from the equity cheque', () => {
    expect(lbo.transactionFees).toBe(358_200);
    expect(lbo.entryEquity).toBe(9_313_200);
    const levered = paperLbo({ ...palm, netDebtAtClose: 1_000_000 }, 2_985_000);
    expect(levered.entryEquity).toBe(lbo.entryEquity + 1_000_000);
  });

  it('sweeps cash to debt and never goes below zero', () => {
    let previous = lbo.entryDebt;
    for (const year of lbo.years) {
      expect(year.closingDebt).toBeLessThanOrEqual(previous);
      expect(year.closingDebt).toBeGreaterThanOrEqual(0);
      previous = year.closingDebt;
    }
  });

  it('reconciles each year: FCF equals EBITDA less interest, taxes, capex and working capital', () => {
    for (const year of lbo.years) {
      const expected =
        year.ebitda - year.interest - year.cashTaxes - year.capex - year.workingCapitalOutflow;
      expect(year.freeCashFlow).toBeCloseTo(expected, 0);
    }
  });

  it('shrinks interest as debt amortises', () => {
    const interest = lbo.years.map((year) => year.interest);
    for (let i = 1; i < interest.length; i++) {
      expect(interest[i]!).toBeLessThan(interest[i - 1]!);
    }
  });

  it('returns 2.30x / 18.1% with no multiple expansion', () => {
    expect(lbo.exitMultiple).toBe(lbo.entryMultiple);
    expect(lbo.moic).toBe(2.3);
    expect(formatPercent(lbo.irr)).toBe('18.1%');
  });

  it('ties MOIC to IRR over the hold period', () => {
    expect((1 + lbo.irr) ** lbo.holdYears).toBeCloseTo(lbo.moic, 2);
  });

  it('is deterministic', () => {
    expect(paperLbo(palm, 2_985_000)).toEqual(paperLbo(palm, 2_985_000));
  });

  it('does not charge tax on a loss-making year', () => {
    const marginal = paperLbo({ ...palm, maintenanceCapexShare: 0.5 }, 2_985_000);
    expect(marginal.years.every((year) => year.cashTaxes >= 0)).toBe(true);
    expect(marginal.years.some((year) => year.cashTaxes === 0)).toBe(true);
  });
});

describe('the memo', () => {
  it('matches the committed expected output byte for byte', async () => {
    const expected = await readFile(join(FIXTURES, 'expected-memo.md'), 'utf8');
    const narrative = await writeNarrative(result, { env: {} });
    const rendered = `${renderMemo(result, { narrative: narrative.text, narrativeMode: narrative.mode })}\n`;
    expect(rendered).toBe(expected);
  });

  it('is byte-stable across renders', () => {
    expect(renderMemo(result)).toBe(renderMemo(result));
  });

  it('labels the model-written paragraph and nothing else', () => {
    const memo = renderMemo(result, { narrative: 'A view.', narrativeMode: 'mock' });
    expect(memo).toContain('## Investment view *(mock — no model was called)*');
    expect(memo).toContain('Only the investment-view paragraph is model-written.');

    const live = renderMemo(result, { narrative: 'A view.', narrativeMode: 'live' });
    expect(live).toContain('## Investment view\n');
    expect(live).not.toContain('no model was called');
  });

  it('omits the investment view entirely when there is no narrative', () => {
    expect(renderMemo(result)).not.toContain('## Investment view');
  });

  it('shows the add-back disagreement in money terms', () => {
    const memo = renderMemo(result);
    expect(memo).toContain(
      'The seller claims $1,135,000 of adjustments. $585,000 of that survives review.',
    );
    expect(memo).toContain('-$125,000');
  });

  it('prints the LBO assumptions, not just the answer', () => {
    const memo = renderMemo(result);
    expect(memo).toContain('Assumptions, so you can disagree with them');
    expect(memo).toContain('9.5% interest');
    expect(memo).toContain('Exit at the entry multiple');
  });
});

describe('diligence list', () => {
  const items = diligenceList(result);

  it('is derived from the findings, not hand-written', () => {
    expect(items.some((item) => item.startsWith('Customer concentration:'))).toBe(true);
    expect(items.some((item) => item.includes('Obtain support for "Personal expenses'))).toBe(true);
    expect(items.some((item) => item.includes('credited at 50% pending diligence'))).toBe(true);
  });

  it("carries the reader's own notes through", () => {
    expect(items).toContain('Harbour Point REIT contract term and renewal date are not disclosed.');
  });

  it('says so plainly when there is nothing outstanding', () => {
    const clean = screen({
      ...palm,
      customers: [{ name: 'a', revenueShare: 0.05 }],
      adjustments: [
        adjustment({ amount: 500_000, category: 'owner-compensation', documented: true }),
      ],
      readerNotes: [],
    });
    expect(clean.recommendation).toBe('pursue');
    expect(diligenceList(clean)).toEqual([
      'Nothing outstanding from the screen itself; proceed to a management meeting.',
    ]);
  });
});

describe('the narrative boundary', () => {
  it('hands the model computed figures only — never the raw teaser', () => {
    const sheet = factSheet(result);
    expect(sheet).toContain('Buyer-adjusted EBITDA: $2,985,000');
    expect(sheet).toContain('MOIC 2.30x');
    // No instruction to calculate, and no un-reviewed seller claim to anchor on.
    expect(sheet).not.toContain('calculate');
    expect(sheet).not.toContain('revenueHistory');
  });

  it('runs keyless and says it was a mock', async () => {
    const narrative = await writeNarrative(result, { env: {} });
    expect(narrative.mode).toBe('mock');
    expect(narrative.text).toBe(deterministicView(result));
  });

  it('leads with the add-back gap when the ask exceeds the range', () => {
    expect(deterministicView(result)).toMatch(/^This is an add-back argument/);
  });

  it('leads with the failure when a check fails', () => {
    const failing = screen({ ...palm, customers: [{ name: 'One', revenueShare: 0.9 }] });
    expect(deterministicView(failing)).toMatch(
      /^The deal fails screening on customer concentration/,
    );
  });

  it('never invents a number: every figure in the view is a rendering of a computed value', () => {
    // Collect every way the screen's own numbers could legitimately be written,
    // then require each figure in the narrative to be one of them. This is the
    // assertion that actually matters: the model-written paragraph must not
    // introduce arithmetic of its own.
    const { teaser, valuation, lbo } = result;
    const numbers = [
      teaser.revenue,
      teaser.reportedEbitda,
      valuation.buyerAdjustedEbitda,
      valuation.sellerAdjustedEbitda,
      valuation.sellerAdjustedEbitda - teaser.reportedEbitda,
      valuation.buyerAdjustedEbitda - teaser.reportedEbitda,
      valuation.lowEnterpriseValue,
      valuation.highEnterpriseValue,
      valuation.midEnterpriseValue,
      valuation.askEnterpriseValue ?? 0,
      lbo.enterpriseValue,
      lbo.entryDebt,
      lbo.entryEquity,
      lbo.exitEquity,
    ];
    const shares = [
      teaser.recurringRevenueShare,
      lbo.irr,
      valuation.buyerAdjustedEbitda / teaser.revenue,
      teaser.reportedEbitda / teaser.revenue,
    ];
    const multiples = [
      valuation.lowMultiple,
      valuation.highMultiple,
      valuation.askMultipleOnBuyerAdjusted ?? 0,
      lbo.entryMultiple,
      lbo.exitMultiple,
      lbo.moic,
    ];

    const allowed = new Set<string>([
      ...numbers.flatMap((value) => [formatMoney(value), formatExact(value)]),
      ...shares.map((value) => formatPercent(value)),
      ...multiples.flatMap((value) => [formatMultiple(value), `${value.toFixed(2)}x`]),
    ]);

    // The view also quotes a check's own `value` string verbatim, which is still a
    // computed figure — so those count as legitimate sources too.
    const quoted = result.checks.map((check) => check.value).join(' ');

    const figures = deterministicView(result).match(/-?\$[\d.,]+[mk]?|\d+\.\d+x|\d+\.\d+%/g) ?? [];
    expect(figures.length).toBeGreaterThan(4);
    for (const figure of figures) {
      const sourced = allowed.has(figure) || quoted.includes(figure);
      expect(sourced, `${figure} is not a rendering of any computed value`).toBe(true);
    }
  });

  it('uses an injected transport when one is given, and reports live mode', async () => {
    const narrative = await writeNarrative(result, {
      env: {},
      transport: {
        kind: 'live',
        async send() {
          return {
            text: 'A real model said this.',
            model: 'claude-opus-5',
            stopReason: 'end_turn',
            refusal: null,
            usage: null,
          };
        },
      },
    });
    expect(narrative).toMatchObject({
      text: 'A real model said this.',
      mode: 'live',
      model: 'claude-opus-5',
    });
  });
});
