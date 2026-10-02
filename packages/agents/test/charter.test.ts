import { describe, expect, it } from 'vitest';
import { CharterError, parseCharter } from '../src/charter.js';

const VALID = `---
name: atlas
role: Coordinator — routes work and writes the operator brief
coordinator: true
capabilities: [routing, prioritisation, synthesis]
keywords: [brief, standup]
tools: [memory.search]
memory_writes: [briefs/**]
escalate: [spend above the agreed cap]
---

# Atlas

## Mandate
Route the day.
`;

describe('parseCharter', () => {
  it('parses the contract and keeps the body as the prompt', () => {
    const charter = parseCharter('atlas.md', VALID);
    expect(charter.name).toBe('atlas');
    expect(charter.coordinator).toBe(true);
    expect(charter.capabilities).toEqual(['routing', 'prioritisation', 'synthesis']);
    expect(charter.keywords).toEqual(['brief', 'standup']);
    expect(charter.memoryWrites).toEqual(['briefs/**']);
    expect(charter.escalate).toEqual(['spend above the agreed cap']);
    expect(charter.prompt).toContain('## Mandate');
    expect(charter.prompt).not.toContain('name: atlas');
  });

  it('defaults coordinator to false', () => {
    expect(
      parseCharter('a.md', VALID.replace('coordinator: true', 'coordinator: false')).coordinator,
    ).toBe(false);
    expect(parseCharter('a.md', VALID.replace('coordinator: true\n', '')).coordinator).toBe(false);
  });

  it.each([
    ['missing name', VALID.replace('name: atlas\n', '')],
    ['missing role', VALID.replace(/role: .*\n/, '')],
    ['no capabilities', VALID.replace(/capabilities: .*\n/, 'capabilities: []\n')],
    ['uppercase name', VALID.replace('name: atlas', 'name: Atlas')],
    ['empty body', VALID.split('---\n\n')[0] + '---\n'],
  ])('rejects a charter with %s', (_label, raw) => {
    expect(() => parseCharter('broken.md', raw)).toThrow(CharterError);
  });

  it('names the offending file in the error', () => {
    expect(() => parseCharter('crew/scribe.md', '---\nname: scribe\n---\n\nbody\n')).toThrow(
      /^crew\/scribe\.md: missing required frontmatter key role/,
    );
  });
});
