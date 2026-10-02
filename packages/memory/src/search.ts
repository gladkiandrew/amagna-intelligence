import type { MemoryIndex } from './index-build.js';
import { tokenize } from './index-build.js';
import type { Note } from './note.js';

export interface SearchOptions {
  limit?: number;
  /** Only consider notes carrying every one of these tags (case-insensitive). */
  tags?: string[];
  /** Score halves every this many days since `updated:`. 0 disables decay. */
  halfLifeDays?: number;
  /** Clock injection, so recency scoring is testable. */
  now?: Date;
}

export interface SearchHit {
  note: Note;
  score: number;
  /** Query tokens that actually matched, for explainability. */
  matched: string[];
}

const DEFAULT_HALF_LIFE_DAYS = 120;
const DAY_MS = 86_400_000;

/**
 * Keyword search with IDF weighting and recency decay.
 *
 * Recency matters more here than in general document search: this index backs an
 * operator's working memory, where last week's note about a client usually beats
 * a structurally similar note from eight months ago. A note with no `updated:`
 * is treated as neutral (no boost, no penalty) rather than as infinitely old —
 * undated reference material should not be buried.
 */
export function search(
  index: MemoryIndex,
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const { limit = 5, halfLifeDays = DEFAULT_HALF_LIFE_DAYS, now = new Date() } = options;
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const allowed = tagFilter(index, options.tags);
  const totalNotes = Math.max(index.notes.length, 1);
  const scores = new Map<number, { score: number; matched: string[] }>();

  for (const token of queryTokens) {
    const postings = index.postings.get(token);
    if (!postings) continue;
    const df = index.documentFrequency.get(token) ?? 1;
    const idf = Math.log(1 + totalNotes / df);

    for (const [ordinal, termFrequency] of postings) {
      if (allowed && !allowed.has(ordinal)) continue;
      const entry = scores.get(ordinal) ?? { score: 0, matched: [] };
      // Sub-linear in tf: a note that says "pricing" nine times is not nine
      // times more about pricing than one that says it twice.
      entry.score += idf * (1 + Math.log(termFrequency));
      entry.matched.push(token);
      scores.set(ordinal, entry);
    }
  }

  const hits: SearchHit[] = [];
  for (const [ordinal, { score, matched }] of scores) {
    const note = index.notes[ordinal];
    if (!note) continue;
    hits.push({ note, score: score * recencyFactor(note, now, halfLifeDays), matched });
  }

  hits.sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id));
  return hits.slice(0, limit);
}

function tagFilter(index: MemoryIndex, tags: string[] | undefined): Set<number> | null {
  if (!tags || tags.length === 0) return null;
  let allowed: Set<number> | null = null;
  for (const tag of tags) {
    const bucket = new Set<number>(index.byTag.get(tag.toLowerCase()) ?? []);
    if (allowed === null) {
      allowed = bucket;
      continue;
    }
    const intersection = new Set<number>();
    for (const ordinal of allowed) {
      if (bucket.has(ordinal)) intersection.add(ordinal);
    }
    allowed = intersection;
  }
  return allowed ?? new Set<number>();
}

function recencyFactor(note: Note, now: Date, halfLifeDays: number): number {
  if (halfLifeDays <= 0 || !note.updated) return 1;
  const ageDays = Math.max(0, (now.getTime() - note.updated.getTime()) / DAY_MS);
  return 2 ** (-ageDays / halfLifeDays);
}

/** Look a note up by its declared `name:`. */
export function getByName(index: MemoryIndex, name: string): Note | null {
  const ordinal = index.byName.get(name);
  return ordinal === undefined ? null : (index.notes[ordinal] ?? null);
}
