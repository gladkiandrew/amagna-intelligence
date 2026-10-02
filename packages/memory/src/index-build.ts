import type { Note } from './note.js';

/**
 * A small inverted index. Deliberately small: the search quality that matters
 * for agent recall comes from the *fields* a note declares and from recency, not
 * from a better scorer. An embedding store is the obvious upgrade and the
 * interface here (`buildIndex` / `search`) is the seam for it — see
 * docs/decisions/0001-markdown-memory-not-a-database.md.
 */
export interface MemoryIndex {
  notes: Note[];
  /** token -> note ordinal -> weighted term frequency */
  postings: Map<string, Map<number, number>>;
  /** token -> number of notes containing it */
  documentFrequency: Map<string, number>;
  byTag: Map<string, number[]>;
  byName: Map<string, number>;
}

/** Field weights. Name and description are curated; body is not. */
const FIELD_WEIGHT = { name: 6, description: 3, tags: 3, body: 1 } as const;

/**
 * Stop words. Short and conservative on purpose: an over-eager list silently makes
 * terms unsearchable, and in a working vault "no" and "not" carry meaning ("why we
 * say no"). These are the words that matched everything in practice.
 */
const STOP_WORDS = new Set([
  'a',
  'about',
  'again',
  'all',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'his',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'may',
  'me',
  'might',
  'must',
  'my',
  'of',
  'on',
  'or',
  'our',
  'out',
  'she',
  'should',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'up',
  'us',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#-]+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function buildIndex(notes: Note[]): MemoryIndex {
  const postings = new Map<string, Map<number, number>>();
  const documentFrequency = new Map<string, number>();
  const byTag = new Map<string, number[]>();
  const byName = new Map<string, number>();

  notes.forEach((note, ordinal) => {
    byName.set(note.name, ordinal);
    for (const tag of note.tags) {
      const bucket = byTag.get(tag.toLowerCase()) ?? [];
      bucket.push(ordinal);
      byTag.set(tag.toLowerCase(), bucket);
    }

    const seen = new Set<string>();
    const add = (text: string, weight: number): void => {
      for (const token of tokenize(text)) {
        const bucket = postings.get(token) ?? new Map<number, number>();
        bucket.set(ordinal, (bucket.get(ordinal) ?? 0) + weight);
        postings.set(token, bucket);
        seen.add(token);
      }
    };

    add(note.name.replace(/[/_-]+/g, ' '), FIELD_WEIGHT.name);
    add(note.description, FIELD_WEIGHT.description);
    add(note.tags.join(' '), FIELD_WEIGHT.tags);
    add(note.body, FIELD_WEIGHT.body);

    for (const token of seen) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  });

  return { notes, postings, documentFrequency, byTag, byName };
}
