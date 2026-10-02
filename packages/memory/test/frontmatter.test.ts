import { describe, expect, it } from 'vitest';
import {
  FrontmatterError,
  parseNote,
  serializeFrontmatter,
  serializeNote,
} from '../src/frontmatter.js';

describe('parseNote', () => {
  it('parses the documented subset', () => {
    const { frontmatter, body, hadFrontmatter } = parseNote(
      [
        '---',
        'name: pricing-floor',
        'description: "Why we hold the floor: margin, not volume"',
        'tags: [pricing, sales]',
        'updated: 2026-09-14',
        'owner:',
        'reviewers:',
        '  - atlas',
        "  - 'scribe'",
        '# a comment',
        '---',
        '',
        'Body text.',
      ].join('\n'),
    );

    expect(hadFrontmatter).toBe(true);
    expect(frontmatter).toEqual({
      name: 'pricing-floor',
      description: 'Why we hold the floor: margin, not volume',
      tags: ['pricing', 'sales'],
      updated: '2026-09-14',
      owner: null,
      reviewers: ['atlas', 'scribe'],
    });
    expect(body).toBe('Body text.');
  });

  it('treats a note with no frontmatter as all body', () => {
    const parsed = parseNote('# Just a heading\n');
    expect(parsed.hadFrontmatter).toBe(false);
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('# Just a heading\n');
  });

  it('handles CRLF and a BOM', () => {
    const parsed = parseNote('﻿---\r\nname: x\r\n---\r\n\r\nbody\r\n');
    expect(parsed.frontmatter.name).toBe('x');
    expect(parsed.body).toBe('body\n');
  });

  it('parses an empty inline sequence', () => {
    expect(parseNote('---\ntags: []\n---\n').frontmatter.tags).toEqual([]);
  });

  it.each([
    ['unclosed block', '---\nname: x\n'],
    ['nested map', '---\nowner:\n  name: x\n---\n'],
    ['multi-line scalar', '---\nnote: |\n  hello\n---\n'],
    ['flow mapping', '---\nowner: { name: x }\n---\n'],
    ['anchor', '---\nowner: &ref x\n---\n'],
    ['duplicate key', '---\nname: a\nname: b\n---\n'],
    ['tab indentation', '---\ntags:\n\t- a\n---\n'],
    ['orphan list item', '---\n- a\n---\n'],
    ['unterminated quote', '---\nname: "x\n---\n'],
    ['unterminated sequence', '---\ntags: [a, b\n---\n'],
    ['garbage line', '---\nthis is not a key\n---\n'],
  ])('rejects %s loudly', (_label, raw) => {
    expect(() => parseNote(raw)).toThrow(FrontmatterError);
  });

  it('reports the offending line number', () => {
    try {
      parseNote('---\nname: a\nname: b\n---\n');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterError);
      expect((error as FrontmatterError).line).toBe(3);
    }
  });
});

describe('serializeFrontmatter', () => {
  it('round-trips and preserves key order', () => {
    const raw = [
      '---',
      'name: a',
      'tags: [x, y]',
      'owner:',
      'updated: 2026-01-02',
      '---',
      '',
      'b',
    ].join('\n');
    const parsed = parseNote(raw);
    const round = parseNote(serializeNote(parsed.frontmatter, parsed.body));
    expect(round.frontmatter).toEqual(parsed.frontmatter);
    expect(Object.keys(round.frontmatter)).toEqual(['name', 'tags', 'owner', 'updated']);
  });

  it('quotes values that would otherwise change meaning', () => {
    const yaml = serializeFrontmatter({
      colon: 'a: b',
      truthy: 'yes',
      dash: '-leading',
      empty: '',
    });
    expect(parseNote(`${yaml}\n`).frontmatter).toEqual({
      colon: 'a: b',
      truthy: 'yes',
      dash: '-leading',
      empty: '',
    });
  });
});
