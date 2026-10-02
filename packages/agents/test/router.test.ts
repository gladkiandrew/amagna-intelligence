import { describe, expect, it } from 'vitest';
import { parseCharter, route, type Charter } from '../src/index.js';

function charter(name: string, fields: Partial<Record<string, string>> = {}): Charter {
  return parseCharter(
    `${name}.md`,
    [
      '---',
      `name: ${name}`,
      `role: ${fields.role ?? `Handles ${name}`}`,
      fields.coordinator ? 'coordinator: true' : '',
      `capabilities: [${fields.capabilities ?? name}]`,
      fields.keywords ? `keywords: [${fields.keywords}]` : '',
      '---',
      '',
      `Prompt for ${name}.`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

const crew = [
  charter('atlas', {
    coordinator: 'true',
    capabilities: 'routing, prioritisation',
    keywords: 'brief, standup',
  }),
  charter('scribe', { capabilities: 'drafting, editing', keywords: 'post, newsletter, copy' }),
  charter('signal', { capabilities: 'analytics, reporting', keywords: 'metrics, dashboard' }),
];

describe('route', () => {
  it('picks the agent whose capability matches', () => {
    expect(route({ text: 'Draft the editing pass on this post' }, crew).agent?.name).toBe('scribe');
    expect(route({ text: 'Pull the analytics for last week' }, crew).agent?.name).toBe('signal');
  });

  it('matches on keywords an operator would actually type', () => {
    expect(route({ text: 'write the newsletter' }, crew).agent?.name).toBe('scribe');
  });

  it('matches on tags from the capture source', () => {
    const decision = route({ text: 'handle this', tags: ['metrics'] }, crew);
    expect(decision.agent?.name).toBe('signal');
  });

  it('explains itself', () => {
    const decision = route({ text: 'draft a post' }, crew);
    expect(decision.candidates[0]?.reasons.join(' ')).toMatch(
      /capability "drafting" matched draft/,
    );
    expect(decision.agent?.name).toBe('scribe');
  });

  it('sends unmatched work to the coordinator and says so', () => {
    const decision = route({ text: 'the kitchen tap is leaking' }, crew);
    expect(decision.agent?.name).toBe('atlas');
    expect(decision.fellBackToCoordinator).toBe(true);
    expect(decision.candidates.find((c) => c.agent === 'atlas')?.reasons.join(' ')).toMatch(
      /coordinator holds unrouted work/,
    );
  });

  it('returns no agent when there is nothing to match and no coordinator', () => {
    const headless = crew.filter((member) => !member.coordinator);
    const decision = route({ text: 'the kitchen tap is leaking' }, headless);
    expect(decision.agent).toBeNull();
    expect(decision.fellBackToCoordinator).toBe(false);
  });

  it('honours an explicit operator override, scoring be damned', () => {
    const decision = route({ text: 'pull the analytics', requestedAgent: 'scribe' }, crew);
    expect(decision.agent?.name).toBe('scribe');
    expect(decision.candidates[0]?.reasons).toEqual(['explicitly requested by the operator']);
  });

  it('falls through to scoring when the override names an unknown agent', () => {
    const decision = route({ text: 'pull the analytics', requestedAgent: 'nobody' }, crew);
    expect(decision.agent?.name).toBe('signal');
  });

  it('is deterministic and ranks every candidate', () => {
    const first = route({ text: 'draft a post' }, crew);
    const second = route({ text: 'draft a post' }, crew);
    expect(first.candidates).toEqual(second.candidates);
    expect(first.candidates).toHaveLength(3);
    expect(first.candidates[0]!.score).toBeGreaterThanOrEqual(first.candidates[1]!.score);
  });

  it('handles an empty crew without throwing', () => {
    expect(route({ text: 'anything' }, []).agent).toBeNull();
  });
});
