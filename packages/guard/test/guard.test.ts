import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkWrite,
  evaluate,
  parseScopeTable,
  runHook,
  ScopeTableError,
  type ScopeTable,
} from '../src/index.js';

const HOME = '/home/op';
const CTX = { home: HOME, cwd: '/work' };

const table: ScopeTable = parseScopeTable(
  JSON.stringify({
    _comment: 'ignored',
    agents: {
      scribe: ['~/vault/drafts/**'],
      atlas: ['~/vault/briefs/**', '~/vault/inbox/Inbox.md'],
    },
  }),
);

describe('parseScopeTable', () => {
  it('skips comment keys', () => {
    expect(Object.keys(table.agents).sort()).toEqual(['atlas', 'scribe']);
  });

  it.each([
    ['not an object', '[]'],
    ['no agents key', '{}'],
    ['agent mapped to a string', '{"agents":{"a":"~/x/**"}}'],
    ['empty pattern list', '{"agents":{"a":[]}}'],
    ['relative pattern', '{"agents":{"a":["vault/**"]}}'],
    ['mid-pattern wildcard', '{"agents":{"a":["~/vault/*/notes"]}}'],
    ['invalid json', '{nope}'],
  ])('rejects a table with %s', (_label, raw) => {
    expect(() => parseScopeTable(raw)).toThrow(ScopeTableError);
  });
});

describe('checkWrite', () => {
  it('allows a write inside a declared prefix, and names the pattern', () => {
    const decision = checkWrite({ agent: 'scribe', path: '~/vault/drafts/post.md' }, table, CTX);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedPattern).toBe('~/vault/drafts/**');
  });

  it('allows the prefix directory itself', () => {
    expect(checkWrite({ agent: 'scribe', path: '/home/op/vault/drafts' }, table, CTX).allowed).toBe(
      true,
    );
  });

  it('allows an exact file match and nothing beside it', () => {
    expect(checkWrite({ agent: 'atlas', path: '~/vault/inbox/Inbox.md' }, table, CTX).allowed).toBe(
      true,
    );
    expect(checkWrite({ agent: 'atlas', path: '~/vault/inbox/Other.md' }, table, CTX).allowed).toBe(
      false,
    );
  });

  it('blocks a write outside scope and explains the charter in the refusal', () => {
    const decision = checkWrite({ agent: 'scribe', path: '~/vault/notes/brain.md' }, table, CTX);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('write-scope violation');
    expect(decision.reason).toContain('~/vault/drafts/**');
    expect(decision.reason).toContain('change the charter and the scope table together');
  });

  it("blocks one agent writing another agent's files", () => {
    expect(
      checkWrite({ agent: 'scribe', path: '~/vault/briefs/2026-10-01.md' }, table, CTX).allowed,
    ).toBe(false);
  });

  it('defeats path traversal, because it resolves before it matches', () => {
    for (const path of [
      '~/vault/drafts/../notes/brain.md',
      '~/vault/drafts/../../.ssh/id_rsa',
      '/home/op/vault/drafts/./../notes/x.md',
    ]) {
      const decision = checkWrite({ agent: 'scribe', path }, table, CTX);
      expect(decision.allowed, path).toBe(false);
      expect(decision.resolvedPath).not.toContain('..');
    }
  });

  it('is not fooled by a sibling directory sharing the prefix string', () => {
    expect(
      checkWrite({ agent: 'scribe', path: '/home/op/vault/drafts-archive/x.md' }, table, CTX)
        .allowed,
    ).toBe(false);
  });

  it('resolves a relative path against cwd before deciding', () => {
    const decision = checkWrite({ agent: 'scribe', path: 'notes/x.md' }, table, CTX);
    expect(decision.resolvedPath).toBe('/work/notes/x.md');
    expect(decision.allowed).toBe(false);
  });

  it('leaves unlisted agents and unattributed calls unrestricted', () => {
    expect(checkWrite({ agent: 'some-other-agent', path: '/etc/passwd' }, table, CTX).allowed).toBe(
      true,
    );
    expect(checkWrite({ path: '/etc/passwd' }, table, CTX).allowed).toBe(true);
  });
});

describe('evaluate', () => {
  it('blocks with exit 2 — a warning would be ignored', () => {
    const result = evaluate(
      {
        tool_name: 'Write',
        agent_type: 'scribe',
        tool_input: { file_path: '/home/op/vault/notes/x.md' },
      },
      table,
      CTX,
    );
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('write-scope violation');
  });

  it('allows an in-scope write with exit 0 and no noise', () => {
    const result = evaluate(
      {
        tool_name: 'Write',
        agent_type: 'scribe',
        tool_input: { file_path: '/home/op/vault/drafts/x.md' },
      },
      table,
      CTX,
    );
    expect(result).toMatchObject({ exitCode: 0, message: '' });
  });

  it('ignores tools that do not write', () => {
    expect(
      evaluate(
        { tool_name: 'Read', agent_type: 'scribe', tool_input: { file_path: '/etc/passwd' } },
        table,
        CTX,
      ).exitCode,
    ).toBe(0);
  });

  it('checks every path in a multi-file edit and blocks if any is out of scope', () => {
    const result = evaluate(
      {
        tool_name: 'MultiEdit',
        agent_type: 'scribe',
        tool_input: {
          edits: [
            { file_path: '/home/op/vault/drafts/a.md' },
            { file_path: '/home/op/vault/notes/b.md' },
          ],
        },
      },
      table,
      CTX,
    );
    expect(result.exitCode).toBe(2);
    expect(result.decisions).toHaveLength(2);
    expect(result.message).toContain('notes/b.md');
    expect(result.message).not.toContain('drafts/a.md');
  });
});

describe('runHook', () => {
  async function tableFile(contents: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'scopes-'));
    const path = join(dir, 'write-scopes.json');
    await writeFile(path, contents, 'utf8');
    return path;
  }

  const valid = JSON.stringify({ agents: { scribe: ['/allowed/**'] } });

  it('blocks an out-of-scope write end to end', async () => {
    const result = await runHook({
      stdin: JSON.stringify({
        tool_name: 'Write',
        agent_type: 'scribe',
        tool_input: { file_path: '/elsewhere/x.md' },
      }),
      scopeTablePath: await tableFile(valid),
    });
    expect(result.exitCode).toBe(2);
  });

  it.each([
    ['unparseable stdin', 'not json'],
    ['empty stdin', ''],
    ['a JSON array', '[]'],
  ])('fails open on %s — a guard bug must not wedge the fleet', async (_label, stdin) => {
    const result = await runHook({ stdin, scopeTablePath: await tableFile(valid) });
    expect(result.exitCode).toBe(0);
  });

  it('fails open when the scope table is missing or malformed', async () => {
    const stdin = JSON.stringify({
      tool_name: 'Write',
      agent_type: 'scribe',
      tool_input: { file_path: '/elsewhere/x.md' },
    });
    expect((await runHook({ stdin, scopeTablePath: '/no/such/file.json' })).exitCode).toBe(0);
    expect((await runHook({ stdin, scopeTablePath: await tableFile('{oops') })).exitCode).toBe(0);
  });
});
