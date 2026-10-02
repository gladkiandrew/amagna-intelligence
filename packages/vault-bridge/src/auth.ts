import type { Env } from './env.js';
import { json } from './errors.js';

/**
 * Bearer gate for every route. Returns a 401 Response when the caller fails and
 * null when it passes.
 *
 * Two details that are easy to get wrong:
 *
 * - **The comparison is constant-time regardless of input length.** Both sides are
 *   hashed to a fixed-width SHA-256 digest first, then compared without
 *   short-circuiting. Comparing the raw strings would leak the secret's length,
 *   and `===` would leak a matching prefix one character at a time.
 * - **Every failure returns the same 401.** Missing, malformed, and wrong tokens
 *   are indistinguishable, because this URL is assumed to leak eventually and a
 *   caller probing it should learn nothing from the shape of the rejection.
 */
export async function requireAuth(
  request: Request,
  env: Pick<Env, 'BRIDGE_TOKEN'>,
): Promise<Response | null> {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (presented && env.BRIDGE_TOKEN && (await tokensMatch(presented, env.BRIDGE_TOKEN))) {
    return null;
  }
  return json({ ok: false, error: 'unauthorized' }, 401);
}

export async function tokensMatch(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return constantTimeEqual(new Uint8Array(a), new Uint8Array(b));
}

/**
 * Workers exposes a native `crypto.subtle.timingSafeEqual`, which is preferred
 * where it exists. The fallback keeps this module runnable — and therefore
 * testable — under plain Node, and is the standard fixed-length XOR accumulation:
 * every byte is always compared, so the loop's duration does not depend on where
 * the first difference is.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const native = (
    crypto.subtle as { timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean }
  ).timingSafeEqual;
  if (typeof native === 'function') return native.call(crypto.subtle, a, b);

  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}
