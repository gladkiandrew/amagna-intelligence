import { readFile } from 'node:fs/promises';
import { ADD_BACK_POLICY, type AddBackPolicy, type Policy } from './adjustments.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from './checks.js';
import { DEFAULT_ASSUMPTIONS, type LboAssumptions } from './lbo.js';
import type { AdjustmentCategory } from './model.js';
import { DEFAULT_HIGH_MULTIPLE, DEFAULT_LOW_MULTIPLE, type ScreenOptions } from './screen.js';

/**
 * A mandate is a buyer's written-down judgement: what size of business they buy,
 * what they will pay, how they lever it, and which seller add-backs they believe.
 *
 * Different buyers screen the same teaser differently, and that difference should
 * live in a file someone can read and argue with, not in code. A search fund and a
 * lower-middle-market PE fund looking at the same $2m-EBITDA company disagree on
 * almost every threshold, and both are right for their own capital.
 *
 * Every field is optional and overrides the default; anything omitted inherits it.
 */
export interface Mandate {
  name: string;
  description: string;
  thresholds: Thresholds;
  lowMultiple: number;
  highMultiple: number;
  assumptions: LboAssumptions;
  policy: AddBackPolicy;
}

export class MandateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MandateError';
  }
}

export const DEFAULT_MANDATE: Mandate = {
  name: 'Default',
  description: 'The built-in thresholds, multiples, LBO assumptions and add-back policy.',
  thresholds: DEFAULT_THRESHOLDS,
  lowMultiple: DEFAULT_LOW_MULTIPLE,
  highMultiple: DEFAULT_HIGH_MULTIPLE,
  assumptions: DEFAULT_ASSUMPTIONS,
  policy: ADD_BACK_POLICY,
};

export function parseMandate(raw: string): Mandate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MandateError(`not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!isObject(parsed)) throw new MandateError('mandate must be a JSON object');

  const name = parsed.name;
  if (typeof name !== 'string' || name.trim() === '') throw new MandateError('name is required');
  const description = typeof parsed.description === 'string' ? parsed.description : '';

  const thresholds = mergeNumbers(DEFAULT_THRESHOLDS, parsed.thresholds, 'thresholds');
  const assumptions = mergeNumbers(DEFAULT_ASSUMPTIONS, parsed.assumptions, 'assumptions');
  const lowMultiple = optionalPositive(parsed.lowMultiple, 'lowMultiple') ?? DEFAULT_LOW_MULTIPLE;
  const highMultiple =
    optionalPositive(parsed.highMultiple, 'highMultiple') ?? DEFAULT_HIGH_MULTIPLE;
  if (lowMultiple > highMultiple) {
    throw new MandateError(`lowMultiple (${lowMultiple}) is above highMultiple (${highMultiple})`);
  }

  const policy = mergePolicy(parsed.policy);
  return { name, description, thresholds, lowMultiple, highMultiple, assumptions, policy };
}

export async function loadMandate(path: string): Promise<Mandate> {
  return parseMandate(await readFile(path, 'utf8'));
}

export function mandateOptions(mandate: Mandate): ScreenOptions {
  return {
    thresholds: mandate.thresholds,
    assumptions: mandate.assumptions,
    lowMultiple: mandate.lowMultiple,
    highMultiple: mandate.highMultiple,
    policy: mandate.policy,
  };
}

function mergeNumbers<T extends object>(base: T, override: unknown, label: string): T {
  if (override === undefined) return { ...base };
  if (!isObject(override)) throw new MandateError(`${label} must be an object`);
  const merged: Record<string, number> = { ...(base as Record<string, number>) };
  for (const [key, value] of Object.entries(override)) {
    if (!(key in base)) throw new MandateError(`${label}.${key} is not a known setting`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new MandateError(`${label}.${key} must be a non-negative number`);
    }
    merged[key] = value;
  }
  return merged as T;
}

function mergePolicy(override: unknown): AddBackPolicy {
  if (override === undefined) return { ...ADD_BACK_POLICY };
  if (!isObject(override)) throw new MandateError('policy must be an object');
  const merged: AddBackPolicy = { ...ADD_BACK_POLICY };
  for (const [category, value] of Object.entries(override)) {
    if (!(category in ADD_BACK_POLICY)) {
      throw new MandateError(`policy.${category} is not an adjustment category`);
    }
    if (!isObject(value)) throw new MandateError(`policy.${category} must be an object`);
    const base = ADD_BACK_POLICY[category as AdjustmentCategory];
    const entry: Policy = { ...base };
    for (const key of ['documentedHaircut', 'undocumentedHaircut'] as const) {
      if (value[key] === undefined) continue;
      const share = value[key];
      if (typeof share !== 'number' || share < 0 || share > 1) {
        throw new MandateError(`policy.${category}.${key} must be between 0 and 1`);
      }
      entry[key] = share;
    }
    if (value.rationale !== undefined) {
      if (typeof value.rationale !== 'string' || value.rationale.trim() === '') {
        throw new MandateError(`policy.${category}.rationale must be a non-empty string`);
      }
      entry.rationale = value.rationale;
    }
    merged[category as AdjustmentCategory] = entry;
  }
  return merged;
}

function optionalPositive(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new MandateError(`${label} must be a positive number`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
