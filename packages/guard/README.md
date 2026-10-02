# @amagna/guard

A charter that declares which paths its agent may write, with nothing enforcing it, is
a comment. This is the enforcement: a `PreToolUse` hook that blocks an out-of-scope
write with exit code 2.

```ts
import { checkWrite, parseScopeTable } from '@amagna/guard';

const table = parseScopeTable(await readFile('write-scopes.json', 'utf8'));

checkWrite({ agent: 'scribe', path: '~/vault/drafts/post.md' }, table);
// { allowed: true, matchedPattern: '~/vault/drafts/**', … }

checkWrite({ agent: 'scribe', path: '~/vault/drafts/../notes/brain.md' }, table);
// { allowed: false, reason: 'write-scope violation: …', resolvedPath: '…/notes/brain.md' }
```

## Wiring it up

```bash
npm run build   # the hook runs compiled JS, not TypeScript
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PROJECT_DIR}/packages/guard/dist/src/cli.js",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

The scope table path comes from `AMAGNA_SCOPE_TABLE`, defaulting to
`write-scopes.json`. See [`write-scopes.example.json`](write-scopes.example.json).

## Three design decisions

**Exit 2 is the enforcement.** A hook that returns a polite warning is a suggestion,
and an agent running with permissions pre-granted sails straight past it.

**It resolves the path before matching.** `~/vault/drafts/../../.ssh/id_rsa` must not
satisfy `~/vault/drafts/**`, and comparing raw strings is exactly how that bug happens.
The only wildcard is a trailing `/**`; a richer pattern language is richer in ways that
are wrong without anyone noticing.

**It fails open on its own errors.** Unparseable payload, missing or malformed scope
table, unexpected exception — the write is allowed. This hook sits in front of *every*
file write in the system, so a bug in it would halt everything rather than protect
anything; and a payload it cannot parse is one it cannot attribute to an agent, so
there is no claim to enforce. The invariant it holds absolutely: a write it *can*
attribute and that *is* out of scope never gets through.

That makes this a correctness guard against a misbehaving or mis-prompted agent, **not
a security boundary against an adversary** with local write access. Full reasoning:
[ADR 5](../../docs/decisions/0005-write-scope-guard-fails-open.md).

An agent absent from the scope table is unrestricted — listing an agent is what opts it
in. The guard enforces charters; it is not the system's permission model.
