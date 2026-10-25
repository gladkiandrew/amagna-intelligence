import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { loadTeaserText } from './extract.js';
import { formatMoney, formatMultiple, formatPercent } from './format.js';
import { loadTeaser } from './load.js';
import type { Mandate } from './mandate.js';
import { mandateOptions } from './mandate.js';
import type { Recommendation, Screen, Teaser } from './model.js';
import { screen } from './screen.js';

/**
 * Screen a stack of teasers against one mandate and rank them.
 *
 * This is the part of deal screening that actually eats a deal team's week: not
 * the one memo, but reading forty teasers to find the three worth a call. Every
 * teaser goes through the identical screen, so the ranking reflects the mandate
 * rather than which book someone happened to read first.
 *
 * Ranking: recommendation first (pursue, then pursue-with-diligence, then pass),
 * then base-case IRR within each group, then company name so ties are stable.
 */
export interface PipelineRow {
  source: string;
  screen: Screen;
}

const ORDER: Record<Recommendation, number> = { pursue: 0, 'pursue-with-diligence': 1, pass: 2 };
const LABEL: Record<Recommendation, string> = {
  pursue: 'Pursue',
  'pursue-with-diligence': 'Diligence',
  pass: 'Pass',
};

export function screenPipeline(
  teasers: { source: string; teaser: Teaser }[],
  mandate: Mandate,
): PipelineRow[] {
  const options = mandateOptions(mandate);
  return teasers
    .map(({ source, teaser }) => ({ source, screen: screen(teaser, options) }))
    .sort(
      (a, b) =>
        ORDER[a.screen.recommendation] - ORDER[b.screen.recommendation] ||
        b.screen.lbo.irr - a.screen.lbo.irr ||
        a.screen.teaser.company.localeCompare(b.screen.teaser.company, 'en'),
    );
}

/** Reads every `.json` and `.md` teaser in a folder, in name order. */
export async function loadPipeline(
  directory: string,
): Promise<{ source: string; teaser: Teaser }[]> {
  const files = (await readdir(directory))
    .filter((name) => ['.json', '.md'].includes(extname(name)) && !name.startsWith('expected-'))
    .sort();
  const loaded = [];
  for (const name of files) {
    const path = join(directory, name);
    const teaser =
      extname(name) === '.json' ? await loadTeaser(path) : (await loadTeaserText(path)).teaser;
    loaded.push({ source: name, teaser });
  }
  return loaded;
}

export function renderPipeline(rows: PipelineRow[], mandate: Mandate): string {
  const lines = [
    `# Pipeline screen — ${mandate.name}`,
    '',
    mandate.description,
    '',
    `${rows.length} teaser${rows.length === 1 ? '' : 's'} screened. Ranked by recommendation, then base-case IRR.`,
    '',
    '| # | Company | Sector | Revenue | Buyer-adj. EBITDA | Ask on buyer-adj. | IRR | MOIC | Call | Why |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  rows.forEach(({ screen: result }, index) => {
    const { teaser, valuation, lbo } = result;
    const flagged = result.checks.filter((check) => check.status !== 'pass');
    const why =
      flagged.length === 0
        ? 'All checks clear'
        : flagged.map((check) => `${check.name} ${check.status}`).join(', ');
    lines.push(
      `| ${index + 1} | ${teaser.company} | ${teaser.sector} | ${formatMoney(teaser.revenue)} | ${formatMoney(valuation.buyerAdjustedEbitda)} (${formatPercent(valuation.buyerAdjustedEbitda / teaser.revenue)}) | ${valuation.askMultipleOnBuyerAdjusted === null ? 'n/a' : formatMultiple(valuation.askMultipleOnBuyerAdjusted)} | ${formatPercent(lbo.irr)} | ${lbo.moic.toFixed(2)}x | ${LABEL[result.recommendation]} | ${why} |`,
    );
  });
  lines.push(
    '',
    'IRR and MOIC are the paper-LBO base case under this mandate. Every company here is fictional.',
    '',
  );
  return lines.join('\n');
}
