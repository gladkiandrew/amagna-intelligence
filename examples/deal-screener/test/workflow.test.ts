import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANDATE,
  extractTeaser,
  ExtractionError,
  loadMandate,
  loadPipeline,
  loadTeaser,
  MandateError,
  mandateOptions,
  paperLbo,
  parseMandate,
  parseMoney,
  parseShare,
  renderPipeline,
  screen,
  screenPipeline,
  sensitivity,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PIPELINE = join(ROOT, 'fixtures', 'pipeline');
const MANDATES = join(ROOT, 'mandates');

const palm = await loadTeaser(join(ROOT, 'fixtures', 'project-palm.json'));

describe('mandates', () => {
  it('an empty mandate is exactly the defaults', () => {
    const mandate = parseMandate(JSON.stringify({ name: 'Blank' }));
    expect(mandate.thresholds).toEqual(DEFAULT_MANDATE.thresholds);
    expect(mandate.assumptions).toEqual(DEFAULT_MANDATE.assumptions);
    expect(mandate.policy).toEqual(DEFAULT_MANDATE.policy);
    expect(screen(palm, mandateOptions(mandate))).toEqual(screen(palm));
  });

  it('the bundled lower-middle-market mandate reproduces the default memo numbers', async () => {
    const mandate = await loadMandate(join(MANDATES, 'lower-middle-market-pe.json'));
    const result = screen(palm, mandateOptions(mandate));
    expect(result.valuation.buyerAdjustedEbitda).toBe(2_985_000);
    expect(result.lbo.moic).toBe(2.3);
  });

  it('a stricter add-back policy credits less', async () => {
    const sponsor = await loadMandate(join(MANDATES, 'independent-sponsor.json'));
    const strict = screen(palm, mandateOptions(sponsor));
    const run = strict.adjustments.find((a) => a.id === 'municipal-contract');
    expect(run?.haircut).toBe(0.25);
    expect(run?.credited).toBe(75_000);
    expect(strict.valuation.buyerAdjustedEbitda).toBe(2_910_000);
  });

  it('a search-fund mandate judges the same company differently', async () => {
    const search = await loadMandate(join(MANDATES, 'search-fund.json'));
    const result = screen(palm, mandateOptions(search));
    // Owner comp is only half an add-back when the buyer becomes the CEO.
    expect(result.adjustments.find((a) => a.id === 'owner-salary')?.credited).toBe(210_000);
    // A 21% customer is fine for a fund, fatal for a single-company buyer.
    expect(result.checks.find((c) => c.name === 'Customer concentration')?.status).toBe('fail');
    expect(result.recommendation).toBe('pass');
    expect(screen(palm).recommendation).toBe('pursue-with-diligence');
  });

  it.each([
    ['no name', {}],
    ['unknown threshold', { name: 'x', thresholds: { minVibes: 1 } }],
    ['negative assumption', { name: 'x', assumptions: { interestRate: -0.1 } }],
    ['inverted range', { name: 'x', lowMultiple: 8, highMultiple: 5 }],
    ['unknown category', { name: 'x', policy: { 'good-feelings': { documentedHaircut: 1 } } }],
    ['haircut above 1', { name: 'x', policy: { 'one-time': { documentedHaircut: 1.5 } } }],
  ])('rejects a mandate with %s', (_label, input) => {
    expect(() => parseMandate(JSON.stringify(input))).toThrow(MandateError);
  });
});

describe('sensitivity', () => {
  const base = screen(palm);
  const grids = sensitivity(palm, base.valuation.buyerAdjustedEbitda);

  it('puts the base case in the centre cell of both grids', () => {
    for (const grid of [grids.entryExit, grids.leverageGrowth]) {
      expect(grid.cells[1]?.[1]).toEqual({ moic: base.lbo.moic, irr: base.lbo.irr });
    }
  });

  it('pays less, earns more: IRR falls as the entry multiple rises', () => {
    const column = grids.entryExit.cells.map((row) => row[1]?.irr ?? 0);
    expect(column[0]).toBeGreaterThan(column[1] ?? 0);
    expect(column[1]).toBeGreaterThan(column[2] ?? 0);
  });

  it('says so when the leverage cap binds instead of printing a misleading row', () => {
    expect(grids.leverageGrowth.note).toContain('capped at 55.0%');
  });
});

describe('paper LBO cash', () => {
  it('counts cash built up after the debt is repaid', () => {
    const light = paperLbo(palm, 2_985_000, {
      ...DEFAULT_MANDATE.assumptions,
      leverageTurns: 1,
    });
    expect(light.exitDebt).toBe(0);
    expect(light.exitCash).toBeGreaterThan(0);
    expect(light.exitEquity).toBe(light.exitEnterpriseValue + light.exitCash);
  });
});

describe('teaser extraction', () => {
  it('parses money and percentages the way a teaser writes them', () => {
    expect(parseMoney('$12.4m')).toBe(12_400_000);
    expect(parseMoney('$850k')).toBe(850_000);
    expect(parseMoney('$1,900,000')).toBe(1_900_000);
    expect(parseMoney('-$125k')).toBe(-125_000);
    expect(parseMoney('($125k)')).toBe(-125_000);
    expect(parseMoney('$0')).toBe(0);
    expect(() => parseMoney('about 2 million')).toThrow();
    expect(parseShare('48%')).toBe(0.48);
    expect(parseShare('2.5% of revenue')).toBe(0.025);
  });

  it('extracts a full teaser and cites every figure to its line', async () => {
    const text = await readFile(join(PIPELINE, 'project-cedar.md'), 'utf8');
    const { teaser, citations } = extractTeaser(text);
    expect(teaser.company).toBe('Project Cedar');
    expect(teaser.revenue).toBe(14_600_000);
    expect(teaser.revenueHistory).toEqual([11_200_000, 12_400_000, 13_500_000]);
    expect(teaser.reportedEbitda).toBe(2_100_000);
    expect(teaser.askMultiple).toBe(6.5);
    expect(teaser.customers[0]).toEqual({
      name: 'Regional property management group',
      revenueShare: 0.31,
    });
    expect(teaser.adjustments).toHaveLength(3);
    expect(teaser.adjustments[1]).toMatchObject({
      category: 'one-time',
      documented: false,
      amount: 120_000,
    });
    const lines = text.split('\n');
    for (const [field, citation] of Object.entries(citations)) {
      expect(lines[citation.line - 1]?.trim(), field).toBe(citation.text);
    }
    expect(citations.revenue?.text).toBe('Revenue: $14.6m');
  });

  it('reports missing fields instead of guessing them', () => {
    const text = '# Project Gap\nSector: Test\nRevenue: $5m\n\n## Customers\n- A: 10%\n';
    try {
      extractTeaser(text);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).missing).toEqual(
        expect.arrayContaining(['fiscalYear', 'reportedEbitda', 'revenueHistory']),
      );
      expect((error as ExtractionError).message).toContain('not guessed');
    }
  });

  it('refuses a figure it cannot read rather than skipping the line', () => {
    const text = (s: string) =>
      `# P\nSector: S\nFiscal year: 2025\nRevenue: ${s}\nRevenue history: $1m, $2m\nReported EBITDA: $1m\nRecurring revenue: 50%\nMaintenance capex: 1%\nNet debt at close: $0\n## Customers\n- A: 10%\n`;
    expect(() => extractTeaser(text('roughly $5m'))).toThrow(/line 4/);
    expect(extractTeaser(text('$5m')).teaser.revenue).toBe(5_000_000);
  });

  it('rejects a duplicated field', () => {
    const text =
      '# P\nSector: S\nFiscal year: 2025\nRevenue: $5m\nRevenue: $6m\nRevenue history: $1m\nReported EBITDA: $1m\nRecurring revenue: 50%\nMaintenance capex: 1%\nNet debt at close: $0\n## Customers\n- A: 10%\n';
    expect(() => extractTeaser(text)).toThrow(/more than once/);
  });
});

describe('pipeline', () => {
  const mandatePath = join(MANDATES, 'lower-middle-market-pe.json');

  it('screens every fictional teaser and ranks pursue > diligence > pass', async () => {
    const rows = screenPipeline(await loadPipeline(PIPELINE), await loadMandate(mandatePath));
    expect(rows).toHaveLength(5);
    const order = { pursue: 0, 'pursue-with-diligence': 1, pass: 2 };
    const ranks = rows.map((row) => order[row.screen.recommendation]);
    expect([...ranks].sort()).toEqual(ranks);
    expect(rows[0]?.screen.teaser.company).toBe('Project Summit');
    expect(rows.at(-1)?.screen.recommendation).toBe('pass');
  });

  it('matches the committed pipeline output byte for byte', async () => {
    const mandate = await loadMandate(mandatePath);
    const rendered = renderPipeline(screenPipeline(await loadPipeline(PIPELINE), mandate), mandate);
    expect(rendered).toBe(await readFile(join(PIPELINE, 'expected-pipeline.md'), 'utf8'));
  });
});
