# 8. Generated content answers to a fact file, and an audit pass proves it

- **Status:** accepted
- **Date:** 2026-10-01

## Context

The moment a system generates copy about a real subject — a company, a client, a
product — it will invent specifics. Not maliciously and not often: it will round a
number, name an award, assert a founding year, or add "serving the area for over 20
years" because that sentence belongs in that kind of paragraph.

Every one of those is a liability, and none of them look wrong on the page. A human
reviewing generated copy catches tone problems reliably and invented facts almost
never, because an invented fact reads exactly like a real one.

## Decision

Two mechanisms, and the second is the one that does the work.

**The fact contract.** Each subject gets a structured file — `facts.json` or
equivalent — that is the *only* permitted source of specifics. Generation reads it
and may use nothing else. Anything the generator wants but cannot find there is
emitted as an explicit placeholder (`[needs-data: years in business]`), never
estimated. The file carries provenance per field: who asserted it, when, from where.

**The fabrication audit.** A separate pass over the generated output that extracts
every concrete claim — numbers, dates, named entities, superlatives, credentials —
and checks each against the fact file. Unmatched claims are listed with their
location. The audit is a gate, not a report: output with unsourced claims does not
ship.

The audit runs as a *different* pass from generation, with the generated text as its
input. A generator asked to check its own work grades generously.

## Consequences

**What this buys.** "No fabrication" stops being an instruction in a prompt and
becomes a thing that fails a build. A reviewer's attention goes to the handful of
flagged claims instead of being spread thinly across everything. And the placeholders
are useful output: the list of `[needs-data]` markers *is* the list of questions to
ask the subject.

**What it costs.** Someone has to populate the fact file, and that is real work that
feels like overhead right up until the first time the audit catches something. The
claim extractor is heuristic: it over-flags (a generic "fast turnaround" trips the
superlative rule) and it can miss a fabrication phrased vaguely enough. Over-flagging
is the correct direction to be wrong in, but it has a cost in review time, and a
silent miss is still possible — this reduces fabrication risk, it does not eliminate
it.

**The generalisation.** Any pipeline that generates assertions about the real world
needs a named, structured source of truth for specifics and a separate pass that
checks the output against it. A prompt that says "do not fabricate" is not a control.
