/**
 * Everything the Worker needs, and nothing hardcoded.
 *
 * Secrets are set with `wrangler secret put` and never appear in wrangler.jsonc;
 * the non-secret vars are there so a reader can see exactly which repository a
 * deployment writes to.
 */
export interface Env {
  /** Shared secret for every route. `wrangler secret put BRIDGE_TOKEN`. */
  BRIDGE_TOKEN: string;
  /** Fine-grained PAT with contents:write on GITHUB_REPO only. */
  GITHUB_TOKEN: string;
  /** "owner/repo" — the markdown vault this bridge writes to. */
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  /** Directory new notes land in, e.g. "inbox". */
  NOTES_DIR: string;
  /**
   * Optional KV namespace for Idempotency-Key replay. Absent is a supported
   * configuration — see idempotency.ts for what you give up.
   */
  IDEMPOTENCY?: KVNamespace;
}
