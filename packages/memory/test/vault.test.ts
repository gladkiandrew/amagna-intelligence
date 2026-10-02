import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadVault, writeNote } from '../src/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-vault-'));
});

async function put(relativePath: string, contents: string): Promise<void> {
  const full = join(root, relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, contents, 'utf8');
}

describe('loadVault', () => {
  it('loads nested notes, skips dot-directories and non-markdown', async () => {
    await put('a.md', '---\nname: a\n---\n\nalpha\n');
    await put('deep/b.md', '---\nname: b\n---\n\nbravo\n');
    await put('.obsidian/workspace.md', '---\nname: hidden\n---\n');
    await put('notes.txt', 'ignored');

    const { notes, failures } = await loadVault(root);
    expect(notes.map((note) => note.id)).toEqual(['a', 'deep/b']);
    expect(failures).toEqual([]);
  });

  it('collects a malformed note instead of failing the whole vault', async () => {
    await put('good.md', '---\nname: good\n---\n\nok\n');
    await put('bad.md', '---\nname: a\nname: b\n---\n');

    const { notes, failures } = await loadVault(root);
    expect(notes.map((note) => note.id)).toEqual(['good']);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.relativePath).toBe('bad.md');
    expect(failures[0]?.error).toMatch(/duplicate key/);
  });
});

describe('writeNote', () => {
  it('preserves unmodelled frontmatter keys and their order, and stamps updated', async () => {
    await put(
      'note.md',
      [
        '---',
        'name: n',
        'owner: atlas',
        'custom_field: keep-me',
        'tags: [x]',
        '---',
        '',
        'old body',
      ].join('\n'),
    );
    const { notes } = await loadVault(root);
    const note = notes[0]!;

    const written = await writeNote(root, note, {
      body: 'new body',
      frontmatter: { tags: ['x', 'y'] },
      updated: new Date('2026-10-01T12:00:00Z'),
    });

    // The returned Note is re-parsed from disk, so the body carries the file's
    // own trailing newline — exactly what a later loadVault() would yield.
    expect(written.body).toBe('new body\n');
    expect(written.tags).toEqual(['x', 'y']);
    expect(written.frontmatter.custom_field).toBe('keep-me');
    expect(written.frontmatter.updated).toBe('2026-10-01');
    // `updated` was not declared originally, so it appends rather than reordering.
    expect(Object.keys(written.frontmatter)).toEqual([
      'name',
      'owner',
      'custom_field',
      'tags',
      'updated',
    ]);

    const onDisk = await readFile(join(root, 'note.md'), 'utf8');
    expect(onDisk).toBe(
      [
        '---',
        'name: n',
        'owner: atlas',
        'custom_field: keep-me',
        'tags: [x, y]',
        'updated: 2026-10-01',
        '---',
        '',
        'new body',
        '',
      ].join('\n'),
    );
  });

  it('leaves updated alone when explicitly told to', async () => {
    await put('note.md', '---\nname: n\nupdated: 2020-01-01\n---\n\nbody\n');
    const { notes } = await loadVault(root);
    const written = await writeNote(root, notes[0]!, { body: 'edited', updated: null });
    expect(written.frontmatter.updated).toBe('2020-01-01');
  });
});
