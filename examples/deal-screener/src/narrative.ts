import { parseCharter, resolveMode, run, type LlmTransport } from '@amagna/agents';
import { formatExact, formatMoney, formatMultiple, formatPercent } from './format.js';
import type { Screen } from './model.js';

/**
 * The narrative is the only model-written part of the memo, and the boundary is
 * the point of the example.
 *
 * A language model is good at "here is what this pattern of facts usually means,
 * and here is what I would want to know next". It is bad at arithmetic you intend
 * to act on, and it is worse at arithmetic that *looks* right. So the model is
 * handed a finished, computed screen and asked to interpret it — it never derives
 * a figure, and the memo labels which paragraph it wrote.
 *
 * In mock mode (the default, with no model configured) the paragraph is composed from the
 * same computed facts, so the demo produces a complete memo with no spend and no
 * pretence that a model was involved.
 */
const CHARTER = `---
name: screener
role: Writes the investment view on a completed screening memo
capabilities: [interpretation, investment-view]
escalate:
  - any figure that is not already in the screen
---

# Screener — investment view

## Mandate

You are handed a screening memo whose numbers are already computed. Write the
"Investment view" paragraph: what this pattern of facts means for a buyer, and
what would change the answer.

## Rules

- **Never produce a number that is not already in the context.** Do not recompute,
  re-derive, re-round, or extend a figure. Quote what is there or refer to it in
  words.
- **Lead with the thing that decides the deal**, not with a summary of the business.
- **Name the one fact that would most change your view**, and say which direction.
- **Three to five sentences.** A screening view that needs a page has not screened.
- No hedging boilerplate. "Attractive opportunity with some risks" is not a view.
`;

export interface NarrativeOptions {
  transport?: LlmTransport;
  apiKey?: string;
  model?: string;
  env?: Record<string, string | undefined>;
  fixturesDir?: string;
}

export interface NarrativeResult {
  text: string;
  mode: 'mock' | 'live';
  model: string;
}

export async function writeNarrative(
  result: Screen,
  options: NarrativeOptions = {},
): Promise<NarrativeResult> {
  const charter = parseCharter('internal:screener', CHARTER);
  const env = options.env ?? process.env;

  // Mock mode composes the paragraph from the computed screen rather than reading
  // a recorded fixture, so the demo text always matches the numbers above it.
  const transport: LlmTransport | undefined =
    options.transport ?? (hasCredential(options, env) ? undefined : deterministicTransport(result));

  const outcome = await run(
    charter,
    { text: `Write the investment view.\n\n${factSheet(result)}` },
    {
      ...(transport ? { transport } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.model ? { model: options.model } : {}),
      env,
      maxTokens: 1_000,
      effort: 'medium',
    },
  );

  return { text: outcome.text, mode: outcome.mode, model: outcome.model };
}

function deterministicTransport(result: Screen): LlmTransport {
  return {
    kind: 'mock',
    async send() {
      return {
        text: deterministicView(result),
        model: 'deterministic-mock',
        stopReason: 'end_turn',
        refusal: null,
        usage: null,
      };
    },
  };
}

function hasCredential(
  options: NarrativeOptions,
  env: Record<string, string | undefined>,
): boolean {
  // Any configured provider counts (LLM_PROVIDER, or an Anthropic credential).
  return resolveMode(options.apiKey ? { apiKey: options.apiKey } : {}, env) === 'live';
}

/**
 * The facts handed to the model: computed values only, rendered as text. There is
 * no raw teaser and no instruction to calculate anything.
 */
export function factSheet(result: Screen): string {
  const { teaser, valuation, lbo } = result;
  return [
    `Company: ${teaser.company} (${teaser.sector}), FY${teaser.fiscalYear}`,
    `Revenue: ${formatExact(teaser.revenue)}`,
    `Reported EBITDA: ${formatExact(teaser.reportedEbitda)}`,
    `Seller-adjusted EBITDA: ${formatExact(valuation.sellerAdjustedEbitda)}`,
    `Buyer-adjusted EBITDA: ${formatExact(valuation.buyerAdjustedEbitda)} (${formatPercent(valuation.buyerAdjustedEbitda / teaser.revenue)} margin)`,
    `Recurring revenue: ${formatPercent(teaser.recurringRevenueShare)}`,
    `Recommendation: ${result.recommendation}`,
    '',
    'Checks:',
    ...result.checks.map(
      (check) =>
        `- ${check.name}: ${check.status.toUpperCase()} — ${check.value}. ${check.comment}`,
    ),
    '',
    'Add-back verdicts:',
    ...result.adjustments.map(
      (adjustment) =>
        `- ${adjustment.label}: claimed ${formatExact(adjustment.amount)}, ${adjustment.verdict}, credited ${formatExact(adjustment.credited)}`,
    ),
    '',
    `Valuation range: ${formatMoney(valuation.lowEnterpriseValue)}–${formatMoney(valuation.highEnterpriseValue)} at ${formatMultiple(valuation.lowMultiple)}–${formatMultiple(valuation.highMultiple)}`,
    valuation.askMultipleOnBuyerAdjusted === null
      ? 'No ask disclosed.'
      : `Seller ask: ${formatMoney(valuation.askEnterpriseValue ?? 0)}, i.e. ${formatMultiple(valuation.askMultipleOnBuyerAdjusted)} of buyer-adjusted EBITDA`,
    `Paper LBO: entry ${formatMultiple(lbo.entryMultiple)}, equity ${formatMoney(lbo.entryEquity)}, MOIC ${lbo.moic.toFixed(2)}x, IRR ${formatPercent(lbo.irr)} over ${lbo.holdYears} years`,
  ].join('\n');
}

/**
 * The mock paragraph. Composed from the computed screen so it is always consistent
 * with the memo it sits in — and deterministic, so the expected-output fixture can
 * include it.
 */
export function deterministicView(result: Screen): string {
  const { teaser, valuation, lbo } = result;
  const failures = result.checks.filter((check) => check.status === 'fail');
  const watches = result.checks.filter((check) => check.status === 'watch');
  const gap =
    valuation.askEnterpriseValue === null
      ? null
      : valuation.askEnterpriseValue - valuation.midEnterpriseValue;

  const sentences: string[] = [];

  sentences.push(
    failures.length > 0
      ? `The deal fails screening on ${listNames(failures)}, and nothing in the valuation compensates for that.`
      : gap !== null && gap > 0
        ? `This is an add-back argument, not a valuation argument: the seller's ask of ${formatMoney(valuation.askEnterpriseValue ?? 0)} is ${formatMultiple(valuation.askMultipleOnBuyerAdjusted ?? 0)} of the EBITDA a buyer can actually underwrite, against a ${formatMultiple(valuation.lowMultiple)}–${formatMultiple(valuation.highMultiple)} range.`
        : `The business clears the mandate, and the ask sits inside the range a buyer could defend.`,
  );

  sentences.push(
    `Of the ${formatMoney(valuation.sellerAdjustedEbitda - teaser.reportedEbitda)} of claimed adjustments, ${formatMoney(valuation.buyerAdjustedEbitda - teaser.reportedEbitda)} survives review — the rest is either unevidenced or belongs in a buyer's own model.`,
  );

  sentences.push(
    `At the midpoint the paper LBO returns ${lbo.moic.toFixed(2)}x / ${formatPercent(lbo.irr)} with no multiple expansion, which means the return is real but entirely dependent on holding ${formatPercent(teaser.recurringRevenueShare)} recurring revenue through the hold.`,
  );

  if (watches.length > 0) {
    sentences.push(
      `The fact most likely to change this view is ${watches[0]?.name.toLowerCase()} — ${watches[0]?.value} — which would move the deal either to a straight pursue or to a structured bid depending on what the contracts say.`,
    );
  } else {
    sentences.push(
      'The fact most likely to change this view is the durability of the recurring base; a single renewal cycle of evidence would move this to a straight pursue.',
    );
  }

  return sentences.join(' ');
}

function listNames(checks: { name: string }[]): string {
  const names = checks.map((check) => check.name.toLowerCase());
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
