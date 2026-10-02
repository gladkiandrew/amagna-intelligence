# deal-screener

A private-equity screening memo from a teaser. **Every figure is computed in
TypeScript; the model writes one paragraph.**

```bash
npm run screen                                   # the bundled Project Palm teaser
npm run screen -- ./path/to/your-teaser.json     # your own
```

Fictional input: "Project Palm", $18m revenue, $2.4m reported EBITDA.

## What it does

1. **Reviews the add-backs** against a policy table ([`src/adjustments.ts`](src/adjustments.ts))
   — accept, challenge with a haircut, or reject, each with its reasoning attached.
2. **Derives buyer-adjusted EBITDA** and contrasts it with the seller's own adjusted
   figure.
3. **Runs five screening checks** — size, growth, margin, recurring revenue,
   concentration — printing the criterion beside every verdict so a reader can disagree
   with the threshold rather than reverse-engineer it.
4. **Values it** at 5–7x, and restates the seller's ask against the EBITDA a buyer can
   actually underwrite.
5. **Runs a paper LBO** — 6.0x entry, 3.0x leverage, 5-year hold, exit at entry.
6. **Derives the diligence list** from what the screen actually found.

## The add-back review is the interesting part

A seller's "adjusted EBITDA" is an argument, not a fact. Two rows carry the point:

- **Pro-forma synergies are credited at zero.** They belong in the buyer's model, not
  the seller's EBITDA. Crediting them pays the seller a multiple, in cash at close, for
  work the buyer has to do afterwards.
- **A below-market related-party rent flows through as a negative.** The owner rents
  the yard to their own company at $60k against a $185k appraisal, so reported EBITDA is
  $125k higher than a buyer can reproduce at the rent they will actually pay.
  Normalisation runs in both directions.

Undocumented add-backs are haircut rather than believed or discarded — unproven is not
the same as wrong.

Result: $2.4m reported → **$2.985m buyer-adjusted**, against the seller's $3.535m. Their
6.0x ask is $21.2m, which is 7.1x of buyer-adjusted — above a $14.9m–$20.9m range. The
paper LBO returns 2.30x / 18.1% with no multiple expansion.

## Why the model only writes a paragraph

An arithmetic error in a memo someone acts on is worse than no memo, and a plausible
wrong number is harder to catch than an obviously wrong one — nobody re-derives a figure
that is formatted confidently.

So the model receives a fact sheet of **computed values only**, with no raw teaser and
no instruction to calculate anything. Its charter forbids producing a figure that is not
already in that context. The memo labels the section it wrote, and says so again in the
footer. A test extracts every figure from the narrative and asserts each one is a
rendering of a computed value.

Everything is deterministic, which is why [`fixtures/expected-memo.md`](fixtures/expected-memo.md)
is compared byte for byte in CI — and why formatting avoids `Intl.NumberFormat`, whose
output varies with the ICU data in the running Node build.

Full reasoning: [ADR 7](../../docs/decisions/0007-deterministic-math-model-narrative.md).

## Teaser format

See [`fixtures/project-palm.json`](fixtures/project-palm.json). Validated at the
boundary by [`src/load.ts`](src/load.ts) — a missing `reportedEbitda` that silently
became `NaN` would produce a memo full of confident-looking garbage, which is the worst
failure mode this example can have.

`customers` lists **named accounts only**. A catch-all "remaining 140 accounts" row
would be ranked as the largest customer and invert the concentration test.
