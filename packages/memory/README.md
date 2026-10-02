# @amagna/memory

Markdown files as a memory layer: load a folder of notes, index them, search, write
back without disturbing anything you did not mean to change.

```ts
import { loadVault, buildIndex, search, writeNote } from '@amagna/memory';

const { notes, failures } = await loadVault('./vault');
const index = buildIndex(notes);

for (const hit of search(index, 'pricing floor', { limit: 3 })) {
  console.log(hit.score, hit.note.name, hit.matched);
}

await writeNote('./vault', notes[0], { body: 'Revised.', frontmatter: { tags: ['pricing'] } });
```

## Four things worth knowing

**The frontmatter parser is deliberately narrow.** It supports flat scalars, quoted
strings, inline and block sequences, and nothing else — nested maps, multi-line
scalars, and anchors all throw `FrontmatterError` with a line number. A full YAML
parser would silently accept shapes the rest of the pipeline has no code to handle.

**Loading a vault never throws on one bad note.** A malformed file lands in
`failures`, so one broken frontmatter block cannot make the whole memory unreadable.

**Search weights recency.** Scores decay with a configurable half-life (120 days by
default) because last week's note about a client usually beats a structurally similar
one from eight months ago. A note with no `updated:` is treated as neutral rather than
infinitely old — undated reference material should not be buried. Pass
`halfLifeDays: 0` to rank on raw relevance.

**Write-back preserves what it does not understand.** Unmodelled frontmatter keys keep
their values and their position; new keys append. Only `updated` is stamped
automatically, and `updated: null` suppresses even that.

## API

| Export | Does |
|---|---|
| `loadVault(root)` | Walk `.md` files, parse each, return notes + failures. Skips dot-directories. |
| `buildIndex(notes)` | Inverted index with field weights (name 6, description 3, tags 3, body 1). |
| `search(index, query, opts)` | IDF-weighted scoring with recency decay. `tags` filter requires every tag. |
| `getByName(index, name)` | Exact lookup on the declared `name:`. |
| `writeNote(root, note, opts)` | Merge frontmatter, replace body, stamp `updated`, write. |
| `parseNote` / `serializeNote` | The frontmatter round-trip, if you want it directly. |

`buildIndex`/`search` is the seam where an embedding store would go — see
[ADR 1](../../docs/decisions/0001-markdown-memory-not-a-database.md).
