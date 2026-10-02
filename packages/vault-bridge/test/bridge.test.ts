import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.js';
import { tokensMatch } from '../src/auth.js';
import { appendLine, handle } from '../src/index.js';
import { buildNote, slugify } from '../src/note.js';
import { readIdempotencyKey, withIdempotency } from '../src/idempotency.js';
import { createGithubClient, fromBase64, toBase64 } from '../src/github.js';
import type { GithubClient } from '../src/github.js';

const NOW = new Date('2026-10-01T09:30:00.000Z');
const TOKEN = 'test-bridge-token';

function env(overrides: Partial<Env> = {}): Env {
  return {
    BRIDGE_TOKEN: TOKEN,
    GITHUB_TOKEN: 'gh-token',
    GITHUB_REPO: 'owner/vault',
    GITHUB_BRANCH: 'main',
    NOTES_DIR: 'inbox',
    ...overrides,
  };
}

function fakeGithub(
  files: Record<string, string> = {},
): GithubClient & { files: Record<string, string> } {
  return {
    files,
    async readFile(path) {
      return files[path] ?? null;
    },
    async commitFile(path, transform) {
      files[path] = transform(files[path] ?? null);
      return { attempts: 1 };
    },
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://bridge.example.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('auth', () => {
  it.each([
    ['no header', {}],
    ['wrong scheme', { authorization: TOKEN }],
    ['wrong token', { authorization: 'Bearer nope' }],
    ['empty token', { authorization: 'Bearer ' }],
  ])('returns an identical 401 for %s', async (_label, headers) => {
    const request = new Request('https://bridge.example.com/note', {
      method: 'POST',
      headers,
      body: '{}',
    });
    const response = await handle(request, env(), { github: fakeGithub(), now: () => NOW });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rejects a token that is a prefix of the real one', async () => {
    const request = new Request('https://bridge.example.com/health', {
      headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
    });
    expect((await handle(request, env(), {})).status).toBe(401);
  });

  it('gates /health too — liveness is not a reason to skip auth', async () => {
    const open = new Request('https://bridge.example.com/health');
    expect((await handle(open, env(), {})).status).toBe(401);

    const authed = new Request('https://bridge.example.com/health', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect((await handle(authed, env(), {})).status).toBe(200);
  });
});

describe('tokensMatch', () => {
  it('accepts only an exact match', async () => {
    await expect(tokensMatch('secret', 'secret')).resolves.toBe(true);
    await expect(tokensMatch('secre', 'secret')).resolves.toBe(false);
    await expect(tokensMatch('secrett', 'secret')).resolves.toBe(false);
    await expect(tokensMatch('Secret', 'secret')).resolves.toBe(false);
    await expect(tokensMatch('', '')).resolves.toBe(true);
  });

  it('compares digests, so inputs of wildly different lengths still work', async () => {
    await expect(tokensMatch('a'.repeat(5000), 'b')).resolves.toBe(false);
    const long = 'x'.repeat(5000);
    await expect(tokensMatch(long, long)).resolves.toBe(true);
  });
});

describe('POST /note', () => {
  it('commits a note at a path the Worker chose', async () => {
    const github = fakeGithub();
    const response = await handle(
      post('/note', {
        title: 'Pricing floor holds',
        text: 'Held at the floor.',
        tags: ['Pricing', 'sales'],
      }),
      env(),
      { github, now: () => NOW },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      path: 'inbox/2026-10-01-pricing-floor-holds.md',
      replayed: false,
    });
    const written = github.files['inbox/2026-10-01-pricing-floor-holds.md']!;
    expect(written).toContain('tags: [pricing, sales]');
    expect(written).toContain('captured: chat');
    expect(written).toContain('# Pricing floor holds');
  });

  it('refuses to overwrite an existing note rather than clobbering it', async () => {
    const github = fakeGithub({ 'inbox/2026-10-01-dupe.md': 'existing' });
    const response = await handle(post('/note', { title: 'dupe', text: 'x' }), env(), {
      github,
      now: () => NOW,
    });
    expect(response.status).toBe(409);
    expect(github.files['inbox/2026-10-01-dupe.md']).toBe('existing');
  });

  it.each([
    ['missing title', { text: 'x' }],
    ['missing text', { title: 'x' }],
    ['blank title', { title: '   ', text: 'x' }],
    ['bad source', { title: 'x', text: 'y', source: 'carrier-pigeon' }],
    ['tags not an array', { title: 'x', text: 'y', tags: 'pricing' }],
    ['too many tags', { title: 'x', text: 'y', tags: Array(11).fill('a') }],
    ['title too long', { title: 'a'.repeat(121), text: 'y' }],
  ])('rejects %s with a 400 and writes nothing', async (_label, body) => {
    const github = fakeGithub();
    const response = await handle(post('/note', body), env(), { github, now: () => NOW });
    expect(response.status).toBe(400);
    expect(Object.keys(github.files)).toEqual([]);
  });

  it('rejects an oversized body with 413', async () => {
    const response = await handle(
      post('/note', { title: 'x', text: 'y', padding: 'p'.repeat(20_000) }),
      env(),
      { github: fakeGithub(), now: () => NOW },
    );
    expect(response.status).toBe(413);
  });

  it('cannot be steered out of the notes directory', async () => {
    const github = fakeGithub();
    await handle(post('/note', { title: '../../.github/workflows/evil', text: 'x' }), env(), {
      github,
      now: () => NOW,
    });
    const paths = Object.keys(github.files);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.startsWith('inbox/')).toBe(true);
    expect(paths[0]).not.toContain('..');
  });

  it('strips control characters from committed markdown', async () => {
    const github = fakeGithub();
    const NUL = String.fromCharCode(0);
    const BEL = String.fromCharCode(7);
    const CR = String.fromCharCode(13);
    await handle(post('/note', { title: `cl${NUL}ean`, text: `line one${BEL}${CR}end` }), env(), {
      github,
      now: () => NOW,
    });
    const written = Object.values(github.files)[0]!;
    expect(written).toContain('line oneend');
    expect(written).toContain('# clean');
    for (const char of [NUL, BEL, CR]) {
      expect(written.includes(char)).toBe(false);
    }
    // Newlines are structure, not smuggled input, so they must survive.
    expect(written.includes('\n')).toBe(true);
  });
});

describe('POST /append', () => {
  it('appends one stamped line and creates the file when absent', async () => {
    const github = fakeGithub();
    const response = await handle(post('/append', { line: 'call the supplier' }), env(), {
      github,
      now: () => NOW,
    });
    expect(response.status).toBe(200);
    expect(github.files['inbox/Inbox.md']).toBe('- [ ] call the supplier [added:: 2026-10-01]\n');
  });

  it('appends to existing content without disturbing it', async () => {
    const github = fakeGithub({ 'inbox/Inbox.md': '- [ ] earlier thing\n' });
    await handle(post('/append', { line: 'later thing' }), env(), { github, now: () => NOW });
    expect(github.files['inbox/Inbox.md']).toBe(
      '- [ ] earlier thing\n- [ ] later thing [added:: 2026-10-01]\n',
    );
  });

  it('only allows allowlisted append targets', async () => {
    const github = fakeGithub();
    const response = await handle(
      post('/append', { line: 'x', path: '.github/workflows/ci.yml' }),
      env(),
      {
        github,
        now: () => NOW,
      },
    );
    expect(response.status).toBe(400);
    expect(Object.keys(github.files)).toEqual([]);
  });

  it.each([
    ['empty line', { line: '   ' }],
    ['multi-line', { line: 'a\nb' }],
    ['overlong', { line: 'a'.repeat(501) }],
  ])('rejects %s', async (_label, body) => {
    expect(
      (await handle(post('/append', body), env(), { github: fakeGithub(), now: () => NOW })).status,
    ).toBe(400);
  });
});

describe('routing', () => {
  it('404s an unknown path and 405s a non-POST', async () => {
    expect((await handle(post('/nope', {}), env(), { github: fakeGithub() })).status).toBe(404);
    const put = new Request('https://bridge.example.com/note', {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect((await handle(put, env(), { github: fakeGithub() })).status).toBe(405);
  });

  it('turns an unexpected failure into a 500 that reveals nothing', async () => {
    const exploding: GithubClient = {
      async readFile() {
        return null;
      },
      async commitFile() {
        throw new Error('postgres credentials rejected at 10.0.0.4');
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handle(post('/note', { title: 'x', text: 'y' }), env(), {
      github: exploding,
      now: () => NOW,
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'internal error' });
    consoleError.mockRestore();
  });
});

describe('idempotency', () => {
  function kv(): KVNamespace {
    const store = new Map<string, string>();
    return {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace;
  }

  it('replays the stored response instead of doing the work twice', async () => {
    const work = vi.fn(async () => ({ ok: true, n: 1 }));
    const bound = { IDEMPOTENCY: kv() };

    const first = await withIdempotency(bound, 'abc-123', work);
    const second = await withIdempotency(bound, 'abc-123', work);

    expect(first).toEqual({ body: { ok: true, n: 1 }, replayed: false });
    expect(second).toEqual({ body: { ok: true, n: 1 }, replayed: true });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no namespace is bound — the route still works', async () => {
    const work = vi.fn(async () => ({ ok: true }));
    expect(await withIdempotency({}, 'abc-123', work)).toEqual({
      body: { ok: true },
      replayed: false,
    });
    expect(await withIdempotency({}, 'abc-123', work)).toEqual({
      body: { ok: true },
      replayed: false,
    });
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('end-to-end: a retried capture does not create a second note', async () => {
    const github = fakeGithub();
    const bound = env({ IDEMPOTENCY: kv() });
    const headers = { 'idempotency-key': 'capture-7f3a' };

    const first = await handle(post('/note', { title: 'retry me', text: 'x' }, headers), bound, {
      github,
      now: () => NOW,
    });
    const second = await handle(post('/note', { title: 'retry me', text: 'x' }, headers), bound, {
      github,
      now: () => NOW,
    });

    expect(await first.json()).toMatchObject({ replayed: false });
    expect(await second.json()).toMatchObject({ replayed: true });
    expect(Object.keys(github.files)).toHaveLength(1);
  });

  it.each([
    ['missing', null],
    ['empty', '  '],
    ['too long', 'a'.repeat(201)],
    ['illegal characters', 'key with spaces'],
    ['path-like', '../../etc/passwd'],
  ])('treats a %s key as absent rather than erroring', (_label, value) => {
    const headers: Record<string, string> = value === null ? {} : { 'idempotency-key': value };
    expect(readIdempotencyKey(new Request('https://x.test/', { headers }))).toBeNull();
  });

  it('accepts a normal key', () => {
    expect(
      readIdempotencyKey(
        new Request('https://x.test/', { headers: { 'idempotency-key': 'a-B_9:.x' } }),
      ),
    ).toBe('a-B_9:.x');
  });
});

describe('commitFile compare-and-swap', () => {
  interface Call {
    method: string;
    body?: unknown;
  }

  function stubFetch(responses: { status: number; body?: unknown }[], calls: Call[]): typeof fetch {
    let index = 0;
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const next = responses[index++] ?? { status: 500 };
      if (next.status === 404) return new Response(null, { status: 404 });
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
        status: next.status,
      });
    }) as unknown as typeof fetch;
  }

  const options = {
    token: 't',
    repo: 'owner/vault',
    branch: 'main',
    sleep: async () => {},
    random: () => 0,
  };

  it('sends the sha it read, so a concurrent writer is rejected not clobbered', async () => {
    const calls: Call[] = [];
    const client = createGithubClient({
      ...options,
      fetch: stubFetch(
        [{ status: 200, body: { sha: 'sha-1', content: toBase64('line one\n') } }, { status: 200 }],
        calls,
      ),
    });

    const result = await client.commitFile(
      'inbox/Inbox.md',
      (current) => `${current}line two\n`,
      'append',
    );

    expect(result.attempts).toBe(1);
    expect(calls[1]!.method).toBe('PUT');
    expect(calls[1]!.body).toMatchObject({ sha: 'sha-1', branch: 'main', message: 'append' });
    expect(fromBase64((calls[1]!.body as { content: string }).content)).toBe(
      'line one\nline two\n',
    );
  });

  it('omits the sha when the file does not exist yet', async () => {
    const calls: Call[] = [];
    const client = createGithubClient({
      ...options,
      fetch: stubFetch([{ status: 404 }, { status: 201 }], calls),
    });
    await client.commitFile(
      'inbox/new.md',
      (current) => `${current === null ? '' : current}fresh\n`,
      'create',
    );
    expect(calls[1]!.body).not.toHaveProperty('sha');
  });

  it('re-reads and re-applies the transform after a 409 race', async () => {
    const calls: Call[] = [];
    const client = createGithubClient({
      ...options,
      fetch: stubFetch(
        [
          { status: 200, body: { sha: 'sha-1', content: toBase64('a\n') } },
          { status: 409, body: { message: 'is at sha-2' } },
          { status: 200, body: { sha: 'sha-2', content: toBase64('a\nb-from-other-writer\n') } },
          { status: 200 },
        ],
        calls,
      ),
    });

    const result = await client.commitFile('f.md', (current) => `${current}mine\n`, 'append');

    expect(result.attempts).toBe(2);
    // The other writer's line survived — that is the whole point of re-reading.
    expect(fromBase64((calls[3]!.body as { content: string }).content)).toBe(
      'a\nb-from-other-writer\nmine\n',
    );
    expect(calls[3]!.body).toMatchObject({ sha: 'sha-2' });
  });

  it('gives up with a 503 after losing every race, rather than looping forever', async () => {
    const calls: Call[] = [];
    const responses = Array.from({ length: 5 }, () => [
      { status: 200, body: { sha: 'sha', content: toBase64('a\n') } },
      { status: 409 },
    ]).flat();
    const client = createGithubClient({ ...options, fetch: stubFetch(responses, calls) });

    await expect(client.commitFile('f.md', (c) => `${c}x\n`, 'm')).rejects.toThrow(
      /lost 5 commit races/,
    );
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(5);
  });

  it('does not retry a non-race failure', async () => {
    const calls: Call[] = [];
    const client = createGithubClient({
      ...options,
      fetch: stubFetch(
        [{ status: 200, body: { sha: 's', content: toBase64('a') } }, { status: 403 }],
        calls,
      ),
    });
    await expect(client.commitFile('f.md', () => 'x', 'm')).rejects.toThrow(/failed \(403\)/);
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('surfaces a failed read instead of treating it as "file absent"', async () => {
    const calls: Call[] = [];
    const client = createGithubClient({ ...options, fetch: stubFetch([{ status: 500 }], calls) });
    await expect(client.commitFile('f.md', () => 'x', 'm')).rejects.toThrow(
      /read of f\.md failed \(500\)/,
    );
  });

  it('percent-encodes path segments without encoding the separators', async () => {
    const urls: string[] = [];
    const client = createGithubClient({
      ...options,
      fetch: (async (url: string) => {
        urls.push(String(url));
        return new Response(null, { status: urls.length === 1 ? 404 : 201 });
      }) as unknown as typeof fetch,
    });
    await client.commitFile('inbox/a note & more.md', () => 'x', 'm');
    expect(urls[0]).toContain('/contents/inbox/a%20note%20%26%20more.md');
  });
});

describe('base64 helpers', () => {
  it('round-trip full UTF-8, which btoa alone cannot', () => {
    for (const text of ['plain', 'café — naïve', '🚢 emoji', 'ünïcödé\nlines\n']) {
      expect(fromBase64(toBase64(text))).toBe(text);
    }
  });
});

describe('pure helpers', () => {
  it('appendLine normalises missing and present trailing newlines', () => {
    expect(appendLine(null, '- x')).toBe('- x\n');
    expect(appendLine('', '- x')).toBe('- x\n');
    expect(appendLine('a\n', '- x')).toBe('a\n- x\n');
    expect(appendLine('a', '- x')).toBe('a\n- x\n');
  });

  it('slugify produces safe, bounded, path-free slugs', () => {
    expect(slugify('Pricing Floor — Q4!')).toBe('pricing-floor-q4');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('!!!')).toBe('');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('buildNote falls back to a unique slug when the title has no usable characters', () => {
    const note = buildNote({ title: '!!!', text: 'x' }, 'inbox', NOW);
    expect(note.path).toMatch(/^inbox\/2026-10-01-note-\d+\.md$/);
  });
});
