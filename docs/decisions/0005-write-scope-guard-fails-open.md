# 5. The write-scope guard fails open

- **Status:** accepted
- **Date:** 2026-10-01

## Context

Each charter declares the paths its agent may write. A declaration enforced by
nothing is a comment. The agent host runs tool calls with permissions pre-granted,
so an in-band "please don't" has no effect — the only intervention that holds is a
pre-tool hook that blocks on a non-zero exit.

That hook then sits in front of **every file write in the system**. Which raises the
question this ADR exists to answer: what should it do when the guard itself fails?

## Decision

`packages/guard` is a `PreToolUse` hook. Exit 0 allows, exit 2 blocks. On its own
internal failure — unparseable payload, missing or malformed scope table, unexpected
exception — **it allows the write.**

The invariant it holds absolutely: a write it *can* attribute to a listed agent and
that *is* out of scope never gets through.

Supporting choices:

- Paths are resolved to absolute, `..`-free form **before** matching. String
  comparison against raw input is how `~/vault/drafts/../../.ssh/id_rsa` gets
  through a `~/vault/drafts/**` pattern.
- The only wildcard is a trailing `/**`. A richer pattern language is richer in ways
  that are wrong without anyone noticing.
- An agent absent from the table is unrestricted. Listing an agent is what opts it
  in; the guard enforces charters, it is not the system's permission model.

## Consequences

**Why fail-open is right here.** A bug in a control that gates every write would
halt the entire system rather than protect anything. And a payload the guard cannot
parse is a payload it cannot attribute to an agent — there is no claim to enforce
against. Failing closed would trade a narrow, bounded risk (one unguarded write in a
rare error path) for a total outage on any guard defect.

**What it costs, stated plainly.** This is a correctness guard, not a security
boundary against an adversary. An attacker who can corrupt the scope table or the
hook payload can disable it. That is accepted: the threat model is a misbehaving or
mis-prompted agent, not a hostile one with local write access — if an attacker has
that, the guard is not the thing standing between them and the files.

**The ongoing cost.** The scope table and each charter's `memory_writes` are two
copies of the same claim, and they drift silently. The refusal message names this
and tells the reader to change both.
