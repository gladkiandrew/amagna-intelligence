# 7. Models write the narrative; code does the arithmetic

- **Status:** accepted
- **Date:** 2026-10-01

## Context

`examples/deal-screener` produces a screening memo: size and margin checks, an
add-back review, a valuation range, and a paper LBO. A language model could write
the whole thing, and the output would look right.

Looking right is the problem. An arithmetic error in a memo that someone acts on is
worse than no memo, and a plausible wrong number is harder to catch than an obviously
wrong one. Nobody re-derives a figure that is formatted confidently.

## Decision

Every figure is computed in TypeScript. The model is handed the finished, computed
screen and writes exactly one thing: the "Investment view" paragraph.

- The model's input is a fact sheet of **computed values only** — no raw teaser, and
  no instruction to calculate anything (`src/narrative.ts`).
- Its charter forbids producing a figure that is not already in that context.
- The memo labels the model-written section, and says so again in the footer.
- The policy decisions — which add-backs survive, at what haircut — are a table in
  `src/adjustments.ts` with the reasoning attached, so a reader can disagree with the
  principle instead of reverse-engineering it from a number.
- A committed `expected-memo.md` is compared byte for byte in the test suite, which
  is only possible because the pipeline is deterministic (and why formatting avoids
  `Intl.NumberFormat`, whose output varies with the ICU data in the running build).

## Consequences

**What this buys.** The numbers are testable, and they are tested: the LBO reconciles
line by line, the table ties after rounding, and the memo is byte-stable. The model
is used for the thing it is actually good at — "here is what this pattern of facts
means, and here is what I would want to know next". A reader always knows which
sentence came from where.

**What it costs.** Every new check is code, so the screen extends more slowly than a
prompt would. The policy table is opinionated and will not match another firm's
mandate without editing. And the narrative can still be wrong in its *judgement*
even though its figures are not — which is why it is one labelled paragraph at the
end rather than the frame the whole memo is read through.

**The general rule.** Let the model write the part a human would argue with, not the
part a human would check.
