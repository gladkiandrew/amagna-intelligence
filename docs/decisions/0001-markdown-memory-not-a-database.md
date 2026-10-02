# 1. Markdown files are the memory layer, not a database

- **Status:** accepted
- **Date:** 2026-10-01

## Context

The system needs durable memory an operator and a set of agents both read and write:
decisions, client context, playbooks, running notes. The obvious options were a
relational database with an app on top, a vector store, or plain files.

The deciding constraint was not retrieval quality. It was that **the operator has to
be able to read and correct the memory by hand, every day, without a tool.** If the
operator cannot see what the system believes, they cannot catch it believing
something wrong — and in practice they stop looking.

## Decision

Memory is a directory of markdown files with YAML frontmatter, kept in git.

- The file is the record. There is no separate index of record; the index is derived
  and disposable.
- Four frontmatter keys carry meaning (`name`, `description`, `tags`, `updated`).
  Anything else a note declares is preserved on write-back and otherwise ignored.
- Agents write through the same files the operator edits, scoped per agent.
- `git log` is the audit trail. Every automated mutation is a commit with a message.

## Consequences

**What this buys.** The operator edits memory in any editor. Diffs are reviewable,
and a bad automated write is one `git revert` away. The whole corpus greps. Nothing
to run, nothing to migrate, no schema to keep in sync with a prompt.

**What it costs.** Retrieval is keyword-based, so synonym and paraphrase recall is
weaker than embeddings would give. Concurrent writers can race, which is why the
write path uses compare-and-swap (`packages/vault-bridge/src/github.ts`). There is
no transactionality across files: a change that should touch three notes can land
as one commit or three, and nothing enforces the former.

**The seam.** `buildIndex` / `search` is one interface over the notes. Adding an
embedding store means implementing that interface, not rewriting the system. The
files stay the record either way — which is the part that is hard to walk back.

## Alternatives considered

- **Postgres with a UI.** Better queries, worse inspectability, and a second place
  for truth to live. The operator would have stopped reading it.
- **A vector store as the primary record.** Good recall, but a corpus you cannot
  read, diff, or hand-correct. Reasonable as a derived index; wrong as the record.
