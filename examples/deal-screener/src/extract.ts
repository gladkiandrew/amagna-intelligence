import { readFile } from 'node:fs/promises';
import { parseTeaser, TeaserError } from './load.js';
import type { Teaser } from './model.js';

/**
 * Read a teaser written as plain text, the way a human would type one up from a
 * banker's PDF, and turn it into a validated `Teaser` — with a citation for every
 * figure saying which line it came from.
 *
 * This is deliberately not a model. Extraction is where a screening tool is most
 * tempted to let an LLM "read the document", and it is the step where a quietly
 * wrong number does the most damage, because everything downstream is arithmetic
 * on it. So the rules are strict:
 *
 * - A field is either found on a labelled line or it is reported missing. Nothing
 *   is inferred, defaulted, or estimated.
 * - Every extracted value carries the line number and the exact source text, so a
 *   reviewer can check the number against the document in one glance.
 * - The result still goes through `parseTeaser`, so the same validation applies to
 *   typed-up text as to hand-written JSON.
 *
 * Format (see fixtures/pipeline/*.md):
 *
 *   # Project Name
 *   Sector: …
 *   Fiscal year: 2025
 *   Revenue: $12.4m
 *   Revenue history: $9.8m, $10.9m, $11.6m      (oldest first)
 *   Reported EBITDA: $1.9m
 *   Recurring revenue: 48%
 *   Maintenance capex: 2.5% of revenue
 *   Net debt at close: $0
 *   Asking multiple: 6.5x                         (optional)
 *
 *   ## Customers
 *   - Name: 18%
 *
 *   ## Adjustments
 *   - [category, documented|undocumented] Label: $250k | seller's rationale
 *
 *   ## Notes
 *   - Anything the reader flagged
 */

export interface Citation {
  line: number;
  text: string;
}

export interface Extraction {
  teaser: Teaser;
  /** Field name (or `customers[i]` / `adjustments[i]`) → where it came from. */
  citations: Record<string, Citation>;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const FIELDS: {
  key: keyof Teaser;
  label: RegExp;
  kind: 'text' | 'money' | 'share' | 'year' | 'multiple' | 'money-list';
  required: boolean;
}[] = [
  { key: 'sector', label: /^sector$/i, kind: 'text', required: true },
  { key: 'fiscalYear', label: /^fiscal year$/i, kind: 'year', required: true },
  { key: 'revenue', label: /^revenue$/i, kind: 'money', required: true },
  { key: 'revenueHistory', label: /^revenue history$/i, kind: 'money-list', required: true },
  { key: 'reportedEbitda', label: /^reported ebitda$/i, kind: 'money', required: true },
  { key: 'recurringRevenueShare', label: /^recurring revenue$/i, kind: 'share', required: true },
  { key: 'maintenanceCapexShare', label: /^maintenance capex$/i, kind: 'share', required: true },
  { key: 'netDebtAtClose', label: /^net debt at close$/i, kind: 'money', required: true },
  { key: 'askMultiple', label: /^asking multiple$/i, kind: 'multiple', required: false },
];

/** "$12.4m", "$850k", "$1,900,000", "-$125k", "($125k)", "$0". Anything else throws. */
export function parseMoney(text: string): number {
  const cleaned = text.trim().replace(/,/g, '');
  const match = /^(\()?(-)?\$(\d+(?:\.\d+)?)\s*(m|k|bn)?(\))?$/i.exec(cleaned);
  if (!match) throw new Error(`not a dollar amount: "${text}"`);
  const [, open, minus, digits, unit, close] = match;
  if (Boolean(open) !== Boolean(close)) throw new Error(`unbalanced brackets: "${text}"`);
  const scale = { m: 1e6, k: 1e3, bn: 1e9 }[(unit ?? '').toLowerCase() as 'm' | 'k' | 'bn'] ?? 1;
  const value = Math.round(Number(digits) * scale);
  return open || minus ? -value : value;
}

/** "48%" or "2.5% of revenue" → 0.48 / 0.025. */
export function parseShare(text: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*%/.exec(text.trim());
  if (!match) throw new Error(`not a percentage: "${text}"`);
  return Math.round(Number(match[1]) * 100) / 10_000;
}

function parseMultiple(text: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*x$/i.exec(text.trim());
  if (!match) throw new Error(`not a multiple: "${text}"`);
  return Number(match[1]);
}

export function extractTeaser(text: string): Extraction {
  const lines = text.split(/\r?\n/);
  const citations: Record<string, Citation> = {};
  const raw: Record<string, unknown> = { customers: [], adjustments: [], readerNotes: [] };
  const problems: string[] = [];
  let section: 'header' | 'customers' | 'adjustments' | 'notes' | 'other' = 'header';

  lines.forEach((source, index) => {
    const line = source.trim();
    const cite = { line: index + 1, text: line };
    if (line === '') return;

    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (heading) {
      const [, hashes, title = ''] = heading;
      if (hashes === '#') {
        raw.company = title.trim();
        citations.company = cite;
        section = 'header';
      } else {
        const name = title.trim().toLowerCase();
        section =
          name === 'customers'
            ? 'customers'
            : name === 'adjustments'
              ? 'adjustments'
              : name === 'notes'
                ? 'notes'
                : 'other';
      }
      return;
    }

    try {
      if (section === 'header') {
        const field = /^([^:]+):\s*(.+)$/.exec(line);
        if (!field) return;
        const [, label = '', value = ''] = field;
        const spec = FIELDS.find((candidate) => candidate.label.test(label.trim()));
        if (!spec) return;
        if (spec.key in citations) throw new Error(`"${label.trim()}" appears more than once`);
        raw[spec.key] = convert(spec.kind, value);
        citations[spec.key] = cite;
      } else if (section === 'customers' && line.startsWith('- ')) {
        const match = /^-\s+(.+):\s*(\d+(?:\.\d+)?%)\s*$/.exec(line);
        if (!match) throw new Error('customer lines look like "- Name: 18%"');
        const customers = raw.customers as unknown[];
        citations[`customers[${customers.length}]`] = cite;
        customers.push({ name: (match[1] ?? '').trim(), revenueShare: parseShare(match[2] ?? '') });
      } else if (section === 'adjustments' && line.startsWith('- ')) {
        const match =
          /^-\s+\[([a-z-]+),\s*(documented|undocumented)\]\s+(.+?):\s*(\(?-?\$[\d.,]+\s*[mkb]?n?\)?)\s*(?:\|\s*(.+))?$/i.exec(
            line,
          );
        if (!match) {
          throw new Error(
            'adjustment lines look like "- [category, documented] Label: $250k | rationale"',
          );
        }
        const [, category, documented, label, amount = '', rationale] = match;
        const adjustments = raw.adjustments as unknown[];
        const id = `adjustment-${adjustments.length + 1}`;
        citations[`adjustments[${adjustments.length}]`] = cite;
        adjustments.push({
          id,
          label: (label ?? '').trim(),
          amount: parseMoney(amount),
          category: (category ?? '').toLowerCase(),
          documented: (documented ?? '').toLowerCase() === 'documented',
          ...(rationale ? { sellerRationale: rationale.trim() } : {}),
        });
      } else if (section === 'notes' && line.startsWith('- ')) {
        (raw.readerNotes as string[]).push(line.slice(2).trim());
      }
    } catch (error) {
      problems.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const missing = [
    ...(raw.company ? [] : ['company (a "# Name" heading)']),
    ...FIELDS.filter((spec) => spec.required && !(spec.key in citations)).map(
      (spec) => spec.key as string,
    ),
  ];
  if (problems.length > 0 || missing.length > 0) {
    const parts = [
      ...problems,
      ...(missing.length > 0 ? [`missing, and not guessed: ${missing.join(', ')}`] : []),
    ];
    throw new ExtractionError(`could not extract teaser — ${parts.join('; ')}`, missing);
  }
  if ((raw.readerNotes as string[]).length === 0) delete raw.readerNotes;

  try {
    return { teaser: parseTeaser(JSON.stringify(raw)), citations };
  } catch (error) {
    if (error instanceof TeaserError) throw new ExtractionError(error.message);
    throw error;
  }
}

export async function loadTeaserText(path: string): Promise<Extraction> {
  return extractTeaser(await readFile(path, 'utf8'));
}

function convert(kind: (typeof FIELDS)[number]['kind'], value: string): unknown {
  switch (kind) {
    case 'text':
      return value.trim();
    case 'year': {
      const year = Number(value.trim());
      if (!Number.isInteger(year) || year < 1900 || year > 2100)
        throw new Error(`not a year: "${value}"`);
      return year;
    }
    case 'money':
      return parseMoney(value);
    case 'share':
      return parseShare(value);
    case 'multiple':
      return parseMultiple(value);
    case 'money-list':
      return value.split(/,(?=\s*[-($])/).map((entry) => parseMoney(entry));
  }
}
