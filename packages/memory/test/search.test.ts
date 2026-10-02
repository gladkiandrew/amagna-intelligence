import { describe, expect, it } from 'vitest';
import { buildIndex, getByName, noteFromMarkdown, search, tokenize } from '../src/index.js';

const NOW = new Date('2026-10-01T00:00:00Z');

function note(id: string, frontmatter: string[], body: string) {
  return noteFromMarkdown(`${id}.md`, `---\n${frontmatter.join('\n')}\n---\n\n${body}\n`);
}

const notes = [
  note(
    'notes/pricing-floor',
    [
      'name: pricing-floor',
      'description: Hold the floor; compete on margin',
      'tags: [pricing]',
      'updated: 2026-09-20',
    ],
    'The floor exists so discounting is a decision, not a reflex.',
  ),
  note(
    'notes/old-pricing-experiment',
    [
      'name: old-pricing-experiment',
      'description: A pricing test we ran and retired',
      'tags: [pricing, archive]',
      'updated: 2026-01-05',
    ],
    'Pricing pricing pricing. Retired because the floor held anyway.',
  ),
  note(
    'notes/onboarding',
    [
      'name: onboarding',
      'description: How a new client starts',
      'tags: [delivery]',
      'updated: 2026-09-28',
    ],
    'Kickoff call, access, first deliverable.',
  ),
  note(
    'notes/undated-reference',
    ['name: undated-reference', 'description: Pricing reference tables'],
    'Reference material about pricing.',
  ),
];

const index = buildIndex(notes);

describe('tokenize', () => {
  it('drops stop words and single characters, keeps technical tokens', () => {
    expect(tokenize('The a b c++ CI/CD and node-22')).toEqual(['c++', 'ci', 'cd', 'node-22']);
  });
});

describe('search', () => {
  it('finds notes by keyword and reports which tokens matched', () => {
    const [top] = search(index, 'onboarding kickoff', { now: NOW });
    expect(top?.note.name).toBe('onboarding');
    expect(top?.matched).toContain('kickoff');
  });

  it('prefers the recent note over an older one that repeats the term more', () => {
    const hits = search(index, 'pricing floor', { now: NOW });
    expect(hits[0]?.note.name).toBe('pricing-floor');
    const names = hits.map((hit) => hit.note.name);
    expect(names.indexOf('pricing-floor')).toBeLessThan(names.indexOf('old-pricing-experiment'));
  });

  it('does not bury undated notes', () => {
    const hits = search(index, 'pricing', { now: NOW });
    expect(hits.map((hit) => hit.note.name)).toContain('undated-reference');
  });

  it('ranks by raw relevance when decay is disabled', () => {
    const hits = search(index, 'pricing', { now: NOW, halfLifeDays: 0 });
    expect(hits[0]?.note.name).toBe('old-pricing-experiment');
  });

  it('filters by tag, requiring every tag', () => {
    expect(
      search(index, 'pricing', { tags: ['archive'], now: NOW }).map((h) => h.note.name),
    ).toEqual(['old-pricing-experiment']);
    expect(search(index, 'pricing', { tags: ['archive', 'delivery'], now: NOW })).toEqual([]);
  });

  it('honours limit and returns nothing for an all-stop-word query', () => {
    expect(search(index, 'pricing', { limit: 1, now: NOW })).toHaveLength(1);
    expect(search(index, 'the and of', { now: NOW })).toEqual([]);
  });

  it('is deterministic for equal scores', () => {
    const a = search(index, 'pricing', { now: NOW }).map((h) => h.note.id);
    const b = search(index, 'pricing', { now: NOW }).map((h) => h.note.id);
    expect(a).toEqual(b);
  });
});

describe('getByName', () => {
  it('resolves a declared name and misses cleanly', () => {
    expect(getByName(index, 'onboarding')?.id).toBe('notes/onboarding');
    expect(getByName(index, 'nope')).toBeNull();
  });
});
