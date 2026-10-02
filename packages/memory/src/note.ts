import { parseNote, serializeNote, type Frontmatter } from './frontmatter.js';

/**
 * The note contract. Four frontmatter keys carry meaning to the index; anything
 * else a note declares is preserved untouched on write-back but ignored here.
 *
 *   name:        stable slug, unique within a vault (defaults to the file path)
 *   description: one line, used for recall ranking and shown in search results
 *   tags:        flat list, used for filtering
 *   updated:     YYYY-MM-DD, drives recency decay in search
 */
export interface Note {
  /** Vault-relative path without the .md extension. Stable identity. */
  id: string;
  /** Vault-relative path including extension. */
  relativePath: string;
  name: string;
  description: string;
  tags: string[];
  /** Parsed from `updated:`; null when absent or unparseable. */
  updated: Date | null;
  body: string;
  /** Everything the frontmatter declared, including keys this system ignores. */
  frontmatter: Frontmatter;
}

export function noteFromMarkdown(relativePath: string, raw: string): Note {
  const { frontmatter, body } = parseNote(raw);
  const id = relativePath.replace(/\.md$/i, '');
  return {
    id,
    relativePath,
    name: asString(frontmatter.name) ?? id,
    description: asString(frontmatter.description) ?? '',
    tags: asList(frontmatter.tags),
    updated: parseDate(asString(frontmatter.updated)),
    body,
    frontmatter,
  };
}

export function noteToMarkdown(note: Note): string {
  return serializeNote(note.frontmatter, note.body);
}

function asString(value: Frontmatter[string] | undefined): string | null {
  if (typeof value === 'string') return value;
  return null;
}

function asList(value: Frontmatter[string] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(',').map((part) => part.trim());
  }
  return [];
}

/**
 * Accepts YYYY-MM-DD only, and checks the round-trip so 2026-02-31 is rejected
 * rather than silently rolling into March.
 */
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
