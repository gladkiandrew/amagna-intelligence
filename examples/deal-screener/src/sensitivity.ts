import { formatMultiple, formatPercent } from './format.js';
import { DEFAULT_ASSUMPTIONS, paperLbo, type LboAssumptions } from './lbo.js';
import type { Teaser } from './model.js';

/**
 * Return sensitivity tables.
 *
 * A single IRR is a point estimate dressed up as an answer. The useful question at
 * screening is how much of the return survives if you overpay by a turn, exit a
 * turn lower, or the business grows slower than the base case. These grids rerun
 * the same paper LBO across those axes, so every cell comes from the same code
 * path as the headline number and the base case always sits in the middle.
 */
export interface SensitivityCell {
  moic: number;
  irr: number;
}

export interface SensitivityGrid {
  title: string;
  rowLabel: string;
  columnLabel: string;
  rows: number[];
  columns: number[];
  formatRow: (value: number) => string;
  formatColumn: (value: number) => string;
  /** cells[row][column] */
  cells: SensitivityCell[][];
  /** Printed under the table when an assumption silently binds. */
  note?: string;
}

export interface Sensitivity {
  entryExit: SensitivityGrid;
  leverageGrowth: SensitivityGrid;
}

const step = (centre: number, delta: number): number[] => [
  round(centre - delta),
  round(centre),
  round(centre + delta),
];

export function sensitivity(
  teaser: Teaser,
  buyerAdjustedEbitda: number,
  base: LboAssumptions = DEFAULT_ASSUMPTIONS,
): Sensitivity {
  const run = (overrides: Partial<LboAssumptions>): SensitivityCell => {
    const result = paperLbo(teaser, buyerAdjustedEbitda, { ...base, ...overrides });
    return { moic: result.moic, irr: result.irr };
  };

  const entries = step(base.entryMultiple, 1);
  const exits = step(base.exitMultiple, 1);
  const leverage = step(base.leverageTurns, 1).filter((turns) => turns >= 0);
  const growth = step(base.ebitdaGrowth, 0.04);
  const leverageCap = base.entryMultiple * base.maxLeverageShareOfEv;
  const capped = leverage.filter((turns) => turns > leverageCap);

  return {
    entryExit: {
      title: 'Entry multiple vs. exit multiple',
      rowLabel: 'Entry',
      columnLabel: 'Exit',
      rows: entries,
      columns: exits,
      formatRow: formatMultiple,
      formatColumn: formatMultiple,
      cells: entries.map((entryMultiple) =>
        exits.map((exitMultiple) => run({ entryMultiple, exitMultiple })),
      ),
    },
    leverageGrowth: {
      title: 'Leverage vs. annual EBITDA growth',
      rowLabel: 'Leverage',
      columnLabel: 'Growth',
      rows: leverage,
      columns: growth,
      formatRow: formatMultiple,
      formatColumn: formatPercent,
      cells: leverage.map((leverageTurns) =>
        growth.map((ebitdaGrowth) =>
          run({ leverageTurns, ebitdaGrowth, revenueGrowth: ebitdaGrowth }),
        ),
      ),
      ...(capped.length > 0
        ? {
            note: `Debt is still capped at ${formatPercent(base.maxLeverageShareOfEv)} of enterprise value, so rows above ${formatMultiple(leverageCap)} are borrowing ${formatMultiple(leverageCap)}, not what the row says.`,
          }
        : {}),
    },
  };
}

/** Markdown table, IRR with MOIC in brackets. Deterministic like the rest of the memo. */
export function renderGrid(grid: SensitivityGrid): string[] {
  const header = `| ${grid.rowLabel} \\ ${grid.columnLabel} | ${grid.columns.map(grid.formatColumn).join(' | ')} |`;
  const divider = `|---|${grid.columns.map(() => '---').join('|')}|`;
  const body = grid.rows.map(
    (row, i) =>
      `| ${grid.formatRow(row)} | ${(grid.cells[i] ?? [])
        .map((cell) => `${formatPercent(cell.irr)} (${cell.moic.toFixed(2)}x)`)
        .join(' | ')} |`,
  );
  const lines = [`**${grid.title}** — IRR (MOIC)`, '', header, divider, ...body];
  if (grid.note) lines.push('', `*${grid.note}*`);
  return lines;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
