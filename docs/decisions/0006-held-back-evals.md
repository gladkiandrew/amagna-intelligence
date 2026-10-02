# 6. The eval set is held back from the system that is being tuned

- **Status:** accepted
- **Date:** 2026-10-01

## Context

The system has a learning loop: runs produce logs, logs get consolidated into notes,
and those notes feed future prompts. It also needs a way to tell whether a change to
a charter actually improved anything.

The two are in direct tension. If the loop that improves the prompts can read the
cases those prompts are judged on, the prompts will get better at those cases and
the measurement stops meaning anything. Goodhart's law, with a very short feedback
cycle.

## Decision

The eval set lives in a directory the consolidation loop is explicitly forbidden to
read, and the prohibition is written where the loop reads its instructions — not
only in a document a human reads.

- Eval cases are never cited in a prompt, never consolidated into notes, and never
  quoted in a log line that the memory layer will later index.
- A held-back slice is reserved from the start. It is scored, and it is not looked
  at while iterating.
- When a charter changes, the eval runs before and after. "It seems better" is not a
  result.

## Consequences

**What this buys.** A number that still means something after twenty iterations. The
ability to say a charter change was a regression and revert it, rather than
accumulating prompt text that nobody can justify removing.

**What it costs.** Real discipline, with no technical enforcement beyond "the loop
does not read that directory" — a human who pastes an eval case into a prompt has
quietly burned it, and nothing will report that. The held-back slice is also
permanently unavailable for improving the system, which at small corpus sizes is a
genuine cost rather than a rounding error.

**Why it is in a public reference architecture.** It is the cheapest thing on this
list to implement and the easiest to skip, and skipping it is why most prompt
iteration produces confident, unfalsifiable claims of improvement.
