import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { formatDate, noteFromMarkdown, noteToMarkdown, type Note } from './note.js';
import type { Frontmatter } from './frontmatter.js';

export interface VaultLoadResult {
  notes: Note[];
  /** Files that failed to parse. Loading a vault never throws on one bad note. */
  failures: { relativePath: string; error: string }[];
}

/**
 * Read every .md file under `root` into a Note. Dotfiles and dot-directories are
 * skipped so an .obsidian/ or .git/ directory inside a vault is invisible here.
 *
 * A malformed note is collected into `failures` rather than thrown: one bad
 * frontmatter block should not make an operator's whole memory unreadable.
 */
export async function loadVault(root: string): Promise<VaultLoadResult> {
  const notes: Note[] = [];
  const failures: VaultLoadResult['failures'] = [];

  for (const absolute of await walk(root)) {
    const relativePath = relative(root, absolute).split(sep).join('/');
    try {
      notes.push(noteFromMarkdown(relativePath, await readFile(absolute, 'utf8')));
    } catch (error) {
      failures.push({
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  notes.sort((a, b) => a.id.localeCompare(b.id));
  return { notes, failures };
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(path)));
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

export interface WriteNoteOptions {
  /** Replace the body. Omit to keep the existing body. */
  body?: string;
  /** Merge into frontmatter. Existing key order is preserved; new keys append. */
  frontmatter?: Frontmatter;
  /** Value for `updated:`. Defaults to today (UTC). Pass null to leave it alone. */
  updated?: Date | null;
}

/**
 * Write-back that preserves frontmatter.
 *
 * The operator owns their notes; an agent editing one must not reformat it,
 * reorder its keys, or drop a field this codebase happens not to model. So the
 * merge is key-by-key over the *existing* order, new keys append at the end, and
 * only `updated` is stamped automatically.
 */
export async function writeNote(
  root: string,
  note: Note,
  options: WriteNoteOptions = {},
): Promise<Note> {
  const merged: Frontmatter = { ...note.frontmatter };
  for (const [key, value] of Object.entries(options.frontmatter ?? {})) {
    merged[key] = value;
  }
  if (options.updated !== null) {
    merged.updated = formatDate(options.updated ?? new Date());
  }

  const rendered = noteToMarkdown({
    ...note,
    frontmatter: merged,
    body: options.body ?? note.body,
  });
  await writeFile(join(root, note.relativePath), rendered, 'utf8');
  // Re-parse so the returned Note's projected fields (name/description/tags/
  // updated) are exactly what a later read of the file would produce.
  return noteFromMarkdown(note.relativePath, rendered);
}
