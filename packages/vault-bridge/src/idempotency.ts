import type { Env } from './env.js';

const TTL_SECONDS = 86_400;

export interface IdempotencyResult<T> {
  body: T;
  /** True when the stored response was replayed instead of doing the work again. */
  replayed: boolean;
}

/**
 * Replay protection for an `Idempotency-Key` header.
 *
 * Why this exists at all: the capture path is driven by phones and chat clients
 * on bad networks. A request that times out *after* the commit landed gets
 * retried, and without a key that retry appends the same note twice. The CAS loop
 * in github.ts makes concurrent writes *safe*, not *idempotent* — it guarantees no
 * write is lost, which is the opposite of what a duplicate retry wants.
 *
 * Honest about the limits:
 *
 * - With no KV namespace bound this is a no-op and the route still works. That is
 *   a deliberate configuration: the Worker stays deployable with one secret and no
 *   resources, at the cost of duplicate-on-retry.
 * - The check-then-write is not atomic. Two genuinely simultaneous requests with
 *   the same key can both miss the read and both do the work. Closing that needs a
 *   Durable Object; for one operator's capture path the KV window is orders of
 *   magnitude smaller than the retry behaviour it exists to absorb, and a Durable
 *   Object would be the wrong amount of machinery for the risk.
 */
export async function withIdempotency<T>(
  env: Pick<Env, 'IDEMPOTENCY'>,
  key: string | null,
  work: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  if (!key || !env.IDEMPOTENCY) {
    return { body: await work(), replayed: false };
  }

  const stored = await env.IDEMPOTENCY.get(cacheKey(key));
  if (stored !== null) {
    return { body: JSON.parse(stored) as T, replayed: true };
  }

  const body = await work();
  await env.IDEMPOTENCY.put(cacheKey(key), JSON.stringify(body), { expirationTtl: TTL_SECONDS });
  return { body, replayed: false };
}

function cacheKey(key: string): string {
  return `idem:${key}`;
}

/**
 * Keys are caller-supplied, so bound and charset-check them before they ever
 * become a storage key. An unrecognised shape is treated as "no key" rather than
 * as an error: a client with a broken key generator should still be able to
 * capture a note.
 */
export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get('idempotency-key');
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 200 || !/^[A-Za-z0-9_:.-]+$/.test(trimmed)) return null;
  return trimmed;
}
