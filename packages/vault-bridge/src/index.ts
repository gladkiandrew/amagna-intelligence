import { requireAuth } from './auth.js';
import type { Env } from './env.js';
import { BridgeError, json } from './errors.js';
import { createGithubClient, type GithubClient } from './github.js';
import { buildNote, readPayload } from './note.js';
import { readIdempotencyKey, withIdempotency } from './idempotency.js';

/**
 * vault-bridge — the remote write path into a Git-backed markdown vault.
 *
 *   POST /note    create one note under NOTES_DIR
 *   POST /append  append one line to an existing file (the inbox)
 *   GET  /health  liveness, still behind auth
 *
 * The design idea worth stealing: **the vault is a git repository, so the write
 * path is the GitHub API and the audit log is `git log`.** There is no database to
 * run, no sync protocol to debug, and every mutation an automation makes is a
 * commit with a message, reviewable and revertable by hand. The cost is that two
 * writers can race, which is what the compare-and-swap loop in github.ts exists
 * to handle.
 */
export interface Deps {
  github?: GithubClient;
  now?: () => Date;
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  try {
    const denied = await requireAuth(request, env);
    if (denied) return denied;

    const { pathname } = new URL(request.url);

    if (request.method === 'GET' && pathname === '/health') {
      return json({ ok: true, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method not allowed' }, 405);
    }

    const github =
      deps.github ??
      createGithubClient({
        token: env.GITHUB_TOKEN,
        repo: env.GITHUB_REPO,
        branch: env.GITHUB_BRANCH,
      });
    const now = deps.now ?? (() => new Date());

    if (pathname === '/note') return await handleNote(request, env, github, now());
    if (pathname === '/append') return await handleAppend(request, env, github, now());
    return json({ ok: false, error: 'not found' }, 404);
  } catch (error) {
    if (error instanceof BridgeError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    // Log the detail, return none: an unhandled error must not describe internals
    // to an unauthenticated-in-practice caller.
    console.error(
      JSON.stringify({
        event: 'unhandled_error',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ ok: false, error: 'internal error' }, 500);
  }
}

async function handleNote(
  request: Request,
  env: Env,
  github: GithubClient,
  now: Date,
): Promise<Response> {
  const key = readIdempotencyKey(request);
  const payload = await readPayload(request);
  const note = buildNote(payload, env.NOTES_DIR, now);

  const { body, replayed } = await withIdempotency(env, key, async () => {
    const { attempts } = await github.commitFile(
      note.path,
      // Pure in `current`: on a retry this is called again with a fresh read.
      // A note path is timestamped, so an existing file means a genuine collision
      // and we refuse rather than overwrite someone's note.
      (current) => {
        if (current !== null) throw new BridgeError(409, `${note.path} already exists`);
        return note.markdown;
      },
      `note: ${note.title}`,
    );
    return { ok: true as const, path: note.path, attempts };
  });

  return json({ ...body, replayed }, 201);
}

async function handleAppend(
  request: Request,
  env: Env,
  github: GithubClient,
  now: Date,
): Promise<Response> {
  const key = readIdempotencyKey(request);
  const payload = (await readPayload(request)) as { path?: unknown; line?: unknown };

  const line = typeof payload.line === 'string' ? payload.line.trim() : '';
  if (line === '' || line.length > 500)
    throw new BridgeError(400, 'line is required, max 500 chars');
  if (line.includes('\n')) throw new BridgeError(400, 'line must be a single line');

  // The caller may choose *which* file only from a fixed set. Accepting an
  // arbitrary path here would hand a leaked token write access to the whole repo.
  const target = typeof payload.path === 'string' ? payload.path : 'inbox/Inbox.md';
  if (!APPENDABLE.has(target)) {
    throw new BridgeError(400, `path must be one of: ${[...APPENDABLE].join(', ')}`);
  }

  const stamped = `- [ ] ${line} [added:: ${now.toISOString().slice(0, 10)}]`;
  const { body, replayed } = await withIdempotency(env, key, async () => {
    const { attempts } = await github.commitFile(
      target,
      (current) => appendLine(current, stamped),
      `append: ${line.slice(0, 60)}`,
    );
    return { ok: true as const, path: target, line: stamped, attempts };
  });

  return json({ ...body, replayed }, 200);
}

/** Append targets are an allowlist, not a parameter. */
const APPENDABLE = new Set(['inbox/Inbox.md']);

export function appendLine(current: string | null, line: string): string {
  if (current === null || current.trim() === '') return `${line}\n`;
  return current.endsWith('\n') ? `${current}${line}\n` : `${current}\n${line}\n`;
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
} satisfies ExportedHandler<Env>;
