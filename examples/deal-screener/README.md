# deal-screener

A private-equity screening memo from a teaser. **Every figure is computed in
TypeScript; the model writes one paragraph.**

```bash
npm run screen                                   # the bundled Project Palm teaser
npm run screen -- ./path/to/your-teaser.json     # your own
npm run pipeline                                 # rank five fictional teasers
npm run pipeline -- --mandate examples/deal-screener/mandates/search-fund.json
```

**Every company, customer and figure in this folder is fictional.** It is a worked
example, not a record of real deals.

## Why I built it

I built this while learning how private-equity deal teams screen companies: reading a
teaser, normalising EBITDA, sizing a paper LBO, and deciding quickly whether a business
deserves a call. My view is that AI is most useful at that front end of the funnel,
doing the reading and arithmetic so the team's time goes to judgement and
relationships. Building the screen was how I learned to do it by hand.

## Where it applies

| Who | How they'd use it |
|---|---|
| Lower-middle-market PE funds | Triage inbound banker teasers against the fund's mandate before anyone books a call |
| Search funds | Screen dozens of small businesses quickly with tighter size and concentration limits |
| Independent sponsors | Show a capital partner exactly which add-backs survive and why |
| Private credit lenders | Size debt off buyer-adjusted EBITDA, not the seller's figure |
| M&A advisors, family offices | Pressure-test a seller's adjusted EBITDA before it goes to market |


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

## Mandates

A mandate is a buyer's judgement written down: size floors, growth and margin bars,
concentration limits, the valuation range, LBO assumptions, and which add-backs it
believes. Three are bundled in [`mandates/`](mandates):

- **Lower-middle-market PE**: the defaults, written out.
- **Search fund**: smaller floors, lower multiples, tighter concentration limits, and
  owner pay credited at half, because the searcher becomes the CEO.
- **Independent sponsor**: undocumented add-backs credited at zero and run-rate claims
  cut to a quarter, because each one has to survive a capital partner's diligence.

Any field left out inherits the default, and unknown settings are rejected rather than
ignored. Project Palm is "pursue with diligence" under the PE mandate and "pass" under
the search-fund one, for reasons the memo prints.

## Sensitivity

The memo reruns the same paper LBO across entry × exit multiple and leverage × EBITDA
growth, with the base case in the centre cell. When an assumption silently binds (the
leverage cap at 55% of EV, for example), the table says so instead of printing a row
that means something other than its label.

## Text teasers, with citations

[`src/extract.ts`](src/extract.ts) reads a teaser typed up as plain text (see
[`fixtures/pipeline/*.md`](fixtures/pipeline)) and returns the teaser plus a citation
for every figure: the line number and the exact source text. A field is either found on
a labelled line or reported as missing; nothing is inferred or defaulted. An unreadable
figure ("roughly $5m") is an error on its line, not a skipped line.

## Pipeline

[`src/pipeline.ts`](src/pipeline.ts) screens a folder of teasers against one mandate and
ranks them: pursue, then diligence, then pass, and by base-case IRR within each group.
The ranked table is committed as
[`fixtures/pipeline/expected-pipeline.md`](fixtures/pipeline/expected-pipeline.md) and
compared byte for byte in CI.

## Teaser format

See [`fixtures/project-palm.json`](fixtures/project-palm.json). Validated at the
boundary by [`src/load.ts`](src/load.ts) — a missing `reportedEbitda` that silently
became `NaN` would produce a memo full of confident-looking garbage, which is the worst
failure mode this example can have.

`customers` lists **named accounts only**. A catch-all "remaining 140 accounts" row
would be ranked as the largest customer and invert the concentration test.
