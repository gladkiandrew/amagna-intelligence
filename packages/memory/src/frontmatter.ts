/**
 * A deliberately narrow YAML-frontmatter parser.
 *
 * Why not a real YAML library: the frontmatter contract in this system is four
 * or five flat keys per note, and the whole point of the contract is that a
 * human can keep it in their head. A full YAML parser would silently accept
 * nested maps, anchors, multi-line folds and implicit typing — shapes the rest
 * of the pipeline has no code to handle. So this parser supports exactly the
 * documented subset and throws `FrontmatterError` on anything else, which turns
 * "my note loaded but a field came back weird" into a loud failure at the door.
 *
 * Supported:
 *   key: value              -> string
 *   key: "value: with colon" -> string (single or double quoted, quotes stripped)
 *   key:                     -> null (declared but empty)
 *   key: [a, b, c]           -> string[] (inline flow sequence)
 *   key:                     -> string[] (block sequence)
 *     - a
 *     - b
 *   # comment                -> ignored
 *
 * Not supported (throws): nested maps, multi-line scalars (| and >), anchors,
 * aliases, flow mappings, tabs for indentation.
 */

export type FrontmatterValue = string | string[] | null;
export type Frontmatter = Record<string, FrontmatterValue>;

export class FrontmatterError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`frontmatter line ${line}: ${message}`);
    this.name = 'FrontmatterError';
  }
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  /** Note body with the frontmatter block removed, leading blank lines trimmed. */
  body: string;
  /** True when the source had no `---` block at all. */
  hadFrontmatter: boolean;
}

const FENCE = '---';
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/;

export function parseNote(raw: string): ParsedNote {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (lines[0]?.trim() !== FENCE) {
    return { frontmatter: {}, body: text.replace(/^\n+/, ''), hadFrontmatter: false };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FENCE) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new FrontmatterError('opening --- has no closing ---', 1);

  const frontmatter = parseBlock(lines.slice(1, end), 2);
  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '');
  return { frontmatter, body, hadFrontmatter: true };
}

function parseBlock(blockLines: string[], firstLineNo: number): Frontmatter {
  const out: Frontmatter = {};
  let pendingListKey: string | null = null;

  for (let i = 0; i < blockLines.length; i++) {
    const lineNo = firstLineNo + i;
    const line = blockLines[i] ?? '';
    if (line.includes('\t')) throw new FrontmatterError('tabs are not valid indentation', lineNo);
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    // A block-sequence item, which only makes sense right after an empty key.
    if (line.trimStart().startsWith('- ') || line.trim() === '-') {
      if (!pendingListKey) {
        throw new FrontmatterError('list item without a preceding key', lineNo);
      }
      const item = line.trimStart().slice(1).trim();
      (out[pendingListKey] as string[]).push(unquote(item, lineNo));
      continue;
    }

    if (line !== line.trimStart()) {
      throw new FrontmatterError('nested maps are not supported', lineNo);
    }

    const match = KEY_LINE.exec(line);
    if (!match) throw new FrontmatterError(`cannot parse ${JSON.stringify(line)}`, lineNo);

    const key = match[1] as string;
    const rest = (match[2] ?? '').trim();
    if (key in out) throw new FrontmatterError(`duplicate key ${key}`, lineNo);

    if (rest === '') {
      // Either a declared-empty scalar or the head of a block sequence; we only
      // know once we see (or don't see) the next line.
      const next = nextMeaningful(blockLines, i + 1);
      if (next !== null && (next.trimStart().startsWith('- ') || next.trim() === '-')) {
        out[key] = [];
        pendingListKey = key;
      } else {
        out[key] = null;
        pendingListKey = null;
      }
      continue;
    }

    pendingListKey = null;
    if (rest === '|' || rest === '>' || rest.startsWith('|') || rest.startsWith('>')) {
      throw new FrontmatterError('multi-line scalars are not supported', lineNo);
    }
    if (rest.startsWith('&') || rest.startsWith('*')) {
      throw new FrontmatterError('anchors and aliases are not supported', lineNo);
    }
    if (rest.startsWith('{')) {
      throw new FrontmatterError('flow mappings are not supported', lineNo);
    }
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) {
        throw new FrontmatterError('unterminated [ ... ] sequence', lineNo);
      }
      const inner = rest.slice(1, -1).trim();
      out[key] =
        inner === ''
          ? []
          : inner
              .split(',')
              .map((part) => unquote(part.trim(), lineNo))
              .filter((part) => part !== '');
      continue;
    }
    out[key] = unquote(rest, lineNo);
  }

  return out;
}

function nextMeaningful(lines: string[], from: number): string | null {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    return line;
  }
  return null;
}

function unquote(value: string, lineNo: number): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
    if (first === '"' || first === "'") {
      throw new FrontmatterError('unterminated quoted string', lineNo);
    }
  }
  return value;
}

/** Render frontmatter back to YAML, preserving key insertion order. */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = [FENCE];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === null) {
      lines.push(`${key}:`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${needsQuotes(value) ? JSON.stringify(value) : value}`);
    }
  }
  lines.push(FENCE);
  return lines.join('\n');
}

function needsQuotes(value: string): boolean {
  return (
    value === '' ||
    /[:#]/.test(value) ||
    value !== value.trim() ||
    /^[-[{&*|>!%@`]/.test(value) ||
    /^(true|false|null|yes|no|on|off)$/i.test(value)
  );
}

/** Re-render a whole note from its parts. */
export function serializeNote(frontmatter: Frontmatter, body: string): string {
  const head =
    Object.keys(frontmatter).length > 0 ? `${serializeFrontmatter(frontmatter)}\n\n` : '';
  return `${head}${body.replace(/\s+$/, '')}\n`;
}
