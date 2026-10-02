import { BridgeError } from './errors.js';

const MAX_BODY_BYTES = 16_384;
const MAX_TITLE_CHARS = 120;
const MAX_TEXT_CHARS = 8_000;
const MAX_TAGS = 10;

/**
 * Control characters, which must never reach the committed markdown — a payload
 * could otherwise smuggle a stray carriage return or NUL into a frontmatter block.
 * Matching them is the entire point here, so the no-control-regex rule is off.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export interface NotePayload {
  title?: unknown;
  text?: unknown;
  tags?: unknown;
  source?: unknown;
}

export interface BuiltNote {
  /** Repo-relative path the Worker chose. Never taken from the caller. */
  path: string;
  markdown: string;
  title: string;
  slug: string;
}

const SOURCES = ['chat', 'mobile', 'email', 'automation', 'manual'] as const;
export type Source = (typeof SOURCES)[number];

export async function readPayload(request: Request): Promise<NotePayload> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new BridgeError(413, 'body too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new BridgeError(400, 'body must be JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BridgeError(400, 'body must be a JSON object');
  }
  return parsed as NotePayload;
}

/**
 * Validate a payload into one note.
 *
 * The property that matters: **the Worker decides the path, the caller does not.**
 * This URL is assumed to leak eventually, so the worst a stolen token can do on
 * this route is add well-formed notes to one configured directory. It cannot write
 * `.github/workflows/`, cannot traverse out of the notes directory, and cannot
 * overwrite an existing note, because the filename is derived from a timestamp
 * plus a sanitised slug rather than from anything the caller sent.
 */
export function buildNote(payload: NotePayload, notesDir: string, now: Date): BuiltNote {
  const title = requireText(payload.title, 'title', MAX_TITLE_CHARS);
  const text = requireText(payload.text, 'text', MAX_TEXT_CHARS);
  const source = requireEnum(payload.source ?? 'chat', SOURCES, 'source');
  const tags = readTags(payload.tags);

  const day = now.toISOString().slice(0, 10);
  const titleSlug = slugify(title);
  const slug = titleSlug === '' ? `${day}-note-${now.getTime()}` : `${day}-${titleSlug}`;
  const path = `${trimSlashes(notesDir)}/${slug}.md`;

  const markdown = [
    '---',
    `name: ${slug}`,
    `description: ${quoteIfNeeded(title)}`,
    `tags: [${tags.join(', ')}]`,
    `updated: ${day}`,
    `captured: ${source}`,
    `captured_at: ${now.toISOString()}`,
    '---',
    '',
    `# ${title}`,
    '',
    text,
    '',
  ].join('\n');

  return { path, markdown, title, slug };
}

function requireText(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BridgeError(400, `${field} is required`);
  }
  const text = value.trim();
  if (text.length > maxChars) throw new BridgeError(400, `${field} exceeds ${maxChars} characters`);
  return text.replace(CONTROL_CHARS, '');
}

function requireEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new BridgeError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function readTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BridgeError(400, 'tags must be an array of strings');
  if (value.length > MAX_TAGS) throw new BridgeError(400, `at most ${MAX_TAGS} tags`);
  return value.map((entry) => {
    if (typeof entry !== 'string') throw new BridgeError(400, 'tags must be an array of strings');
    const tag = entry
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '');
    if (tag === '') throw new BridgeError(400, 'a tag reduced to nothing after sanitising');
    return tag;
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function quoteIfNeeded(value: string): string {
  return /[:#]/.test(value) ? JSON.stringify(value) : value;
}
