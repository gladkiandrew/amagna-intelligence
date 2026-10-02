import { readFile } from 'node:fs/promises';
import type { Adjustment, AdjustmentCategory, Teaser } from './model.js';

const CATEGORIES: AdjustmentCategory[] = [
  'owner-compensation',
  'discretionary-personal',
  'one-time',
  'related-party-normalisation',
  'run-rate-new-contract',
  'accounting-policy',
  'pro-forma-synergy',
];

export class TeaserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeaserError';
  }
}

/**
 * Validate a teaser at the boundary rather than trusting the JSON.
 *
 * The figures here drive a valuation. A missing `reportedEbitda` that silently
 * becomes `NaN` would produce a memo full of confident-looking garbage, which is
 * the single worst failure mode this example can have.
 */
export function parseTeaser(raw: string): Teaser {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TeaserError(`not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TeaserError('teaser must be a JSON object');
  }
  const input = parsed as Record<string, unknown>;

  const teaser: Teaser = {
    company: requireString(input, 'company'),
    sector: requireString(input, 'sector'),
    fiscalYear: requireNumber(input, 'fiscalYear'),
    revenue: requirePositive(input, 'revenue'),
    revenueHistory: requireNumberArray(input, 'revenueHistory'),
    reportedEbitda: requireNumber(input, 'reportedEbitda'),
    recurringRevenueShare: requireShare(input, 'recurringRevenueShare'),
    maintenanceCapexShare: requireShare(input, 'maintenanceCapexShare'),
    netDebtAtClose: requireNumber(input, 'netDebtAtClose'),
    customers: requireCustomers(input.customers),
    adjustments: requireAdjustments(input.adjustments),
  };

  if (input.askMultiple !== undefined) teaser.askMultiple = requirePositive(input, 'askMultiple');
  if (input.readerNotes !== undefined) {
    if (!Array.isArray(input.readerNotes) || input.readerNotes.some((n) => typeof n !== 'string')) {
      throw new TeaserError('readerNotes must be an array of strings');
    }
    teaser.readerNotes = input.readerNotes as string[];
  }

  const totalShare = teaser.customers.reduce((total, customer) => total + customer.revenueShare, 0);
  if (totalShare > 1.0001) {
    throw new TeaserError(
      `customer revenue shares sum to ${totalShare.toFixed(4)}, which exceeds 1`,
    );
  }

  return teaser;
}

export async function loadTeaser(path: string): Promise<Teaser> {
  return parseTeaser(await readFile(path, 'utf8'));
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') throw new TeaserError(`${key} is required`);
  return value;
}

function requireNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TeaserError(`${key} must be a finite number`);
  }
  return value;
}

function requirePositive(input: Record<string, unknown>, key: string): number {
  const value = requireNumber(input, key);
  if (value <= 0) throw new TeaserError(`${key} must be greater than zero`);
  return value;
}

function requireShare(input: Record<string, unknown>, key: string): number {
  const value = requireNumber(input, key);
  if (value < 0 || value > 1) throw new TeaserError(`${key} must be between 0 and 1`);
  return value;
}

function requireNumberArray(input: Record<string, unknown>, key: string): number[] {
  const value = input[key];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    throw new TeaserError(`${key} must be an array of finite numbers`);
  }
  return value as number[];
}

function requireCustomers(value: unknown): Teaser['customers'] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TeaserError('customers must be a non-empty array');
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null)
      throw new TeaserError(`customers[${index}] must be an object`);
    const customer = entry as Record<string, unknown>;
    const share = customer.revenueShare;
    if (typeof customer.name !== 'string' || customer.name.trim() === '') {
      throw new TeaserError(`customers[${index}].name is required`);
    }
    if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) {
      throw new TeaserError(`customers[${index}].revenueShare must be between 0 and 1`);
    }
    return { name: customer.name, revenueShare: share };
  });
}

function requireAdjustments(value: unknown): Adjustment[] {
  if (!Array.isArray(value)) throw new TeaserError('adjustments must be an array');
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TeaserError(`adjustments[${index}] must be an object`);
    }
    const adjustment = entry as Record<string, unknown>;
    const category = adjustment.category;
    if (typeof category !== 'string' || !CATEGORIES.includes(category as AdjustmentCategory)) {
      throw new TeaserError(
        `adjustments[${index}].category must be one of: ${CATEGORIES.join(', ')} (got ${String(category)})`,
      );
    }
    if (typeof adjustment.amount !== 'number' || !Number.isFinite(adjustment.amount)) {
      throw new TeaserError(`adjustments[${index}].amount must be a finite number`);
    }
    if (typeof adjustment.documented !== 'boolean') {
      throw new TeaserError(`adjustments[${index}].documented must be true or false`);
    }
    const built: Adjustment = {
      id:
        typeof adjustment.id === 'string' && adjustment.id !== ''
          ? adjustment.id
          : `adjustment-${index}`,
      label: typeof adjustment.label === 'string' ? adjustment.label : `Adjustment ${index + 1}`,
      amount: adjustment.amount,
      category: category as AdjustmentCategory,
      documented: adjustment.documented,
    };
    if (typeof adjustment.sellerRationale === 'string')
      built.sellerRationale = adjustment.sellerRationale;
    return built;
  });
}
