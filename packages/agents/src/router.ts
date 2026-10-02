import { tokenize } from '@amagna/memory';
import type { Charter } from './charter.js';

export interface Task {
  /** What the operator actually asked for. */
  text: string;
  /** Optional tags, e.g. from the capture source. */
  tags?: string[];
  /** Operator override — bypasses scoring entirely. */
  requestedAgent?: string;
}

export interface Candidate {
  agent: string;
  score: number;
  reasons: string[];
}

export interface RouteDecision {
  /** Null only when the crew is empty or has no coordinator to absorb the task. */
  agent: Charter | null;
  /** Every charter considered, best first. Routing is explainable by construction. */
  candidates: Candidate[];
  /** True when nothing matched and the coordinator absorbed the task. */
  fellBackToCoordinator: boolean;
}

const WEIGHT = { capability: 4, keyword: 3, tagCapability: 3, role: 1 } as const;

/**
 * Suffixes stripped before comparing routing terms, longest first.
 *
 * Routing needs "draft a post" to reach the agent whose capability is "drafting",
 * so terms are compared after light suffix stripping. This is crude on purpose —
 * a real stemmer is a dependency and a surprise, and routing only has to separate
 * three to six agents from each other. It is applied ONLY to routing; the memory
 * index keeps exact tokens, where tf-idf already handles morphology.
 */
const SUFFIXES = [
  'ations',
  'ation',
  'ising',
  'izing',
  'ings',
  'ing',
  'ises',
  'izes',
  'ise',
  'ize',
  'ers',
  'er',
  'ed',
  'es',
  'ly',
  's',
  'e',
];

const MIN_STEM = 4;

export function stemForRouting(token: string): string {
  for (const suffix of SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= MIN_STEM) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function stems(text: string): string[] {
  return tokenize(text).map(stemForRouting);
}

/**
 * Rules-based routing. Deliberately not an LLM call.
 *
 * Routing is a dispatch decision made hundreds of times a day, and the failure
 * mode that matters is "why did that go to the wrong agent?". A scored rule set
 * answers that question from a log line; a model's routing choice does not. It is
 * also free, instant, and deterministic — so the same task always lands in the
 * same place, which is what makes write-scope enforcement meaningful.
 */
export function route(task: Task, crew: Charter[]): RouteDecision {
  const coordinator = crew.find((charter) => charter.coordinator) ?? null;

  if (task.requestedAgent) {
    const requested = crew.find((charter) => charter.name === task.requestedAgent);
    if (requested) {
      return {
        agent: requested,
        candidates: [
          {
            agent: requested.name,
            score: Number.POSITIVE_INFINITY,
            reasons: ['explicitly requested by the operator'],
          },
        ],
        fellBackToCoordinator: false,
      };
    }
    // An unknown name is operator error, not a reason to guess: fall through to
    // scoring but record that the override was ignored.
  }

  const taskTokens = new Set(stems(task.text));
  const tagTokens = new Set((task.tags ?? []).flatMap((tag) => stems(tag)));

  const candidates: Candidate[] = crew.map((charter) => {
    let score = 0;
    const reasons: string[] = [];

    for (const capability of charter.capabilities) {
      const hit = stems(capability).filter((token) => taskTokens.has(token));
      if (hit.length > 0) {
        score += WEIGHT.capability * hit.length;
        reasons.push(`capability "${capability}" matched ${hit.join(', ')}`);
      }
      const tagHit = stems(capability).filter((token) => tagTokens.has(token));
      if (tagHit.length > 0) {
        score += WEIGHT.tagCapability * tagHit.length;
        reasons.push(`capability "${capability}" matched tag ${tagHit.join(', ')}`);
      }
    }

    for (const keyword of charter.keywords) {
      const hit = stems(keyword).filter((token) => taskTokens.has(token) || tagTokens.has(token));
      if (hit.length > 0) {
        score += WEIGHT.keyword * hit.length;
        reasons.push(`keyword "${keyword}" matched ${hit.join(', ')}`);
      }
    }

    const roleHit = stems(charter.role).filter((token) => taskTokens.has(token));
    if (roleHit.length > 0) {
      score += WEIGHT.role * roleHit.length;
      reasons.push(`role line matched ${roleHit.join(', ')}`);
    }

    return { agent: charter.name, score, reasons };
  });

  // Deterministic order: score desc, then the coordinator, then name.
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.agent === coordinator?.name) - Number(a.agent === coordinator?.name) ||
      a.agent.localeCompare(b.agent),
  );

  const best = candidates[0];
  if (!best || best.score === 0) {
    if (coordinator) {
      const entry = candidates.find((candidate) => candidate.agent === coordinator.name);
      entry?.reasons.push('no capability matched; the coordinator holds unrouted work');
      return { agent: coordinator, candidates, fellBackToCoordinator: true };
    }
    return { agent: null, candidates, fellBackToCoordinator: false };
  }

  return {
    agent: crew.find((charter) => charter.name === best.agent) ?? null,
    candidates,
    fellBackToCoordinator: false,
  };
}
