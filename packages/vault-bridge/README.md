# @amagna/vault-bridge

A Cloudflare Worker that commits notes into a Git-backed markdown vault, safely, from
anywhere.

```
POST /note    { title, text, tags?, source? }   → creates inbox/<date>-<slug>.md
POST /append  { line, path? }                   → appends one line to an allowlisted file
GET  /health                                     → liveness (still behind auth)
```

Every route requires `Authorization: Bearer $BRIDGE_TOKEN`.

## Deploy

```bash
npx wrangler secret put BRIDGE_TOKEN      # long random hex
npx wrangler secret put GITHUB_TOKEN      # fine-grained PAT, contents:write, ONE repo
npx wrangler deploy
```

Non-secret config (`GITHUB_REPO`, `GITHUB_BRANCH`, `NOTES_DIR`) lives in
[`wrangler.jsonc`](wrangler.jsonc) so a reader can see which repository a deployment
writes to. No account IDs or zone IDs are committed.

## The compare-and-swap loop

The piece worth reading is [`src/github.ts`](src/github.ts). The GitHub Contents API is
last-write-wins on its own: two callers that read the same sha and both PUT will have
one silently clobber the other. Sending the sha you read makes GitHub reject the stale
writer with 409/422 instead, so the loop re-reads and re-applies:

```
GET file → sha-1
PUT (transform(content), sha-1) → 409   # someone else committed sha-2
GET file → sha-2                        # re-read
PUT (transform(newContent), sha-2) → 200
```

The transform **must be a pure function of the current content**, because it is called
again on retry. A transform that appends from captured state duplicates its work every
time it loses a race. Five attempts, exponential backoff with jitter, then 503 — and
anything that is not a 409/422 is surfaced rather than retried, because retrying a 401
five times only delays the error.

## Three other properties

**The Worker decides the path, not the caller.** The URL is assumed to leak eventually,
so the worst a stolen token can do here is add well-formed notes to one configured
directory. It cannot traverse out, cannot write `.github/workflows/`, and cannot
overwrite an existing note. `/append` targets are an allowlist, not a parameter.

**Auth is constant-time for any input length.** Both tokens are hashed to fixed-width
SHA-256 digests before comparison — comparing raw strings leaks the secret's length and
`===` leaks a matching prefix. Workers exposes a native `timingSafeEqual`; there is a
portable fallback so the module stays runnable, and testable, under plain Node.

**`Idempotency-Key` solves the opposite problem from CAS.** CAS guarantees no write is
lost, which is exactly wrong for a request that timed out *after* the commit landed and
then got retried. With a KV namespace bound, a repeated key replays the stored
response. Without one it is a no-op and the route still works — the limits are stated
in [`src/idempotency.ts`](src/idempotency.ts), including the non-atomic check-then-write
window.
