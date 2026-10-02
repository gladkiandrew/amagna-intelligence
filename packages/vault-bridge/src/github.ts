import { BridgeError } from './errors.js';

const API = 'https://api.github.com';
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 200;

export interface GithubClientOptions {
  token: string;
  /** "owner/repo". */
  repo: string;
  branch: string;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injectable for tests, so the retry loop doesn't make tests slow. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests, so backoff jitter is deterministic. */
  random?: () => number;
}

/**
 * Transform the current contents of a file into its next contents.
 *
 * It MUST be a pure function of `current`: on a commit race the loop below
 * re-reads and calls it again, so a transform that appends from captured state
 * (rather than from the argument it was handed) duplicates work on every retry.
 */
export type Transform = (current: string | null) => string;

export interface GithubClient {
  commitFile(path: string, transform: Transform, message: string): Promise<{ attempts: number }>;
  readFile(path: string): Promise<string | null>;
}

export function createGithubClient(options: GithubClientOptions): GithubClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vault-bridge',
    'Content-Type': 'application/json',
  });

  const fileUrl = (path: string): string =>
    `${API}/repos/${options.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function getFile(path: string): Promise<{ sha: string; text: string } | null> {
    const response = await doFetch(`${fileUrl(path)}?ref=${encodeURIComponent(options.branch)}`, {
      headers: headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new BridgeError(502, `GitHub read of ${path} failed (${response.status})`);
    }
    const body = (await response.json()) as { sha: string; content: string };
    return { sha: body.sha, text: fromBase64(body.content) };
  }

  return {
    async readFile(path) {
      return (await getFile(path))?.text ?? null;
    },

    /**
     * Read-transform-write with compare-and-swap.
     *
     * The Contents API is last-write-wins on its own: two callers that read the
     * same sha and both PUT will have one silently clobber the other. Sending the
     * sha we read makes GitHub reject the stale writer with 409/422 instead, so we
     * re-read and re-apply the transform. Exponential backoff with jitter keeps
     * two writers that collide from colliding again in lockstep.
     *
     * Anything that is not 409/422 is a real failure and is surfaced rather than
     * retried — retrying a 401 five times just delays the error.
     */
    async commitFile(path, transform, message) {
      let delay = BASE_DELAY_MS;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const current = await getFile(path);
        const response = await doFetch(fileUrl(path), {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({
            message,
            branch: options.branch,
            content: toBase64(transform(current?.text ?? null)),
            ...(current ? { sha: current.sha } : {}),
          }),
        });
        if (response.ok) return { attempts: attempt };

        if (response.status !== 409 && response.status !== 422) {
          throw new BridgeError(502, `GitHub write of ${path} failed (${response.status})`);
        }
        await response.body?.cancel();
        if (attempt < MAX_ATTEMPTS) {
          await sleep(delay + random() * 150);
          delay *= 2;
        }
      }
      throw new BridgeError(
        503,
        `GitHub write of ${path} lost ${MAX_ATTEMPTS} commit races; retry`,
      );
    },
  };
}

// The Contents API speaks base64. These two round-trip full UTF-8 (emoji,
// accents) — btoa/atob alone operate on latin1 and would mangle it.
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
