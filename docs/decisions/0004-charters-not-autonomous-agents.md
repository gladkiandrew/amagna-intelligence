# 4. Charters are prompts with contracts, not autonomous processes

- **Status:** accepted
- **Date:** 2026-10-01

## Context

"Agent" is used for two very different things: a markdown file describing a role
that a human invokes, and a process that loops, chooses its own next action, and
keeps running. The first is a prompt with a contract. The second is a system that
takes actions nobody asked for in an order nobody chose.

Autonomy was tried, in the mild form: scheduled runs that decided their own work.
The failure was not dramatic. It was that **nobody could answer "why did it do
that?"** — and once that is true, the output stops being trusted, which makes the
automation worthless even when it is correct.

## Decision

A charter is a markdown file. Frontmatter declares the contract (capabilities, tools,
writable paths, escalation conditions); the body is the prompt. Charters are not
processes.

- A run is **one bounded call**: recall → prompt → model → result. No loop, and the
  model does not choose what happens next.
- **Routing is rules-based**, not a model decision (`packages/agents/src/router.ts`).
  It is deterministic, free, instant, and a log line explains it.
- Writable paths are **enforced**, not trusted — see ADR 5.
- Escalation conditions are declared in the charter and appended to every prompt by
  code, so an agent cannot drop them by editing its own file.
- Nothing publishes. Drafting agents draft; a human ships.

## Consequences

**What this buys.** Every run is explainable after the fact: which charter, which
notes, which route, and why. Charters are reviewable in a pull request, because they
are text. Cost is bounded by construction — one call per task, not an unbounded
loop. A misbehaving charter is a bad paragraph, not a runaway process.

**What it costs.** Genuinely multi-step work has to be decomposed by a human or by a
calling workflow; the agent will not figure out step two on its own. Some work that
an autonomous loop would complete end-to-end instead stops and waits. That is the
trade, taken deliberately: a system whose output is trusted and slightly narrow beats
one that is broad and ignored.

**Where the boundary is soft.** A workflow that calls `run()` several times in a
scripted order is still inside this decision. A workflow where the *model* chooses
which call comes next is not, and would need this ADR revisited.
