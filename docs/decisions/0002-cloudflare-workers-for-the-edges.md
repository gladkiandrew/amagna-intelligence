# 2. Cloudflare Workers for every always-on edge

- **Status:** accepted
- **Date:** 2026-10-01

## Context

Parts of the system must be reachable when the operator's laptop is closed: a
capture endpoint for notes from a phone, a chat webhook, a daily scheduled job.
Everything else — the heavy work, the long runs — happens on a machine a human is
sitting at.

So the question was only about the always-on edges, and the honest requirement list
is short: HTTPS endpoint, a cron trigger, secret storage, and near-zero idle cost
for traffic measured in requests per day.

## Decision

Every always-on edge is a Cloudflare Worker: `packages/vault-bridge` and
`packages/cockpit-worker`.

- Non-secret config in `wrangler.jsonc`, so a reader can see what a deployment
  touches. Secrets via `wrangler secret put`, never in the repo.
- No account IDs, zone IDs, or bucket names in committed config.
- State lives in the git-backed vault, not in the Worker. KV appears only for
  idempotency keys, and is optional even there.

## Consequences

**What this buys.** No idle cost and no server to patch. Cold starts are not a
factor at this traffic. Cron triggers mean the daily job runs whether or not the
laptop is awake — which was the actual problem with running it locally. Deploys are
one command and roll back the same way.

**What it costs.** The Workers runtime is not Node: no filesystem, no long-running
process, and some APIs differ (`crypto.subtle.timingSafeEqual` exists there and not
in Node — see `packages/vault-bridge/src/auth.ts`, which handles both so the module
stays testable under plain Node). CPU time per request is bounded, so anything
genuinely long-running cannot live here, which is part of why agent runs do not.
And it is a vendor dependency: the code is portable, the deployment is not.

**What stays off the edge.** Agent runs. They are long, they want a filesystem, and
they are initiated by a human. Putting them in a Worker would mean fighting the
runtime for no benefit.
