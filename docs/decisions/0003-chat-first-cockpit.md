# 3. The cockpit is a chat bot, not a dashboard

- **Status:** accepted
- **Date:** 2026-10-01

## Context

The operator needs to reach the system from a phone, at arbitrary moments, usually
to do one of three things: capture something before it is forgotten, ask what the
system knows, or check that nothing is on fire. A dashboard was built first and
went unused.

The reason it went unused is worth stating precisely: **a dashboard is a place you
have to decide to go.** Capture has to be faster than the impulse to postpone it, or
it does not happen.

## Decision

The front door is a Telegram bot (`packages/cockpit-worker`) with three commands:
`/ask`, `/note`, `/status`.

Rules that come with that choice:

- **The command surface stays at three.** Every verb past the third is one the
  operator has to remember instead of just typing.
- **Silence is a valid response.** The bot answers commands. It does not acknowledge
  chatter, and it does not post progress updates. A channel that pings on every
  automated run gets muted, and a muted channel is worse than no channel.
- **An unrecognised chat gets no reply at all.** A bot username is public; replying
  "you are not authorised" confirms the bot is live to anyone probing it.
- **Anything richer than three verbs belongs in an app**, not in more commands.

## Consequences

**What this buys.** Capture latency is a few seconds from any device, with no app to
open and no session to log into. Push works. The operator already has the client
installed and it is already on their home screen.

**What it costs.** No rich output: tables and charts read badly in chat, which puts
a real ceiling on what `/status` can usefully say. Telegram's platform constraints
become ours (message length, formatting, webhook retry semantics — which is why the
webhook always answers 200; see `packages/cockpit-worker/src/index.ts`). And the
webhook URL is a credential, so authentication rests on the `secret_token` header
rather than on the URL being secret.

**What was explicitly given up.** A single pane of glass. In exchange for the three
things the operator actually does from a phone being nearly frictionless.
