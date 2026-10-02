import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmRequest, LlmResponse, LlmTransport } from './llm.js';

export interface MockTransportOptions {
  /** Directory of recorded responses, laid out as <agent>/<slug>.md. */
  fixturesDir: string;
  /** Agent the run belongs to — selects the fixture subdirectory. */
  agent: string;
  /** Explicit fixture name. Defaults to a slug of the task text. */
  fixture?: string;
}

export const MOCK_MODEL = 'mock-no-api-key';

/**
 * Mock mode is the default, not a test affordance.
 *
 * Anyone who clones this repo can run the whole pipeline — load the vault, route
 * the task, build the prompt, get a response — with no API key and no spend. That
 * matters twice over: a reviewer can see the system work in one command, and the
 * deterministic transcript makes the orchestration itself testable without
 * asserting on model output.
 *
 * A missing fixture is not an error. It returns a clearly-labelled stub that
 * echoes which notes were retrieved, so an unfixtured task still demonstrates
 * routing and recall rather than blowing up the demo.
 */
export function createMockTransport(options: MockTransportOptions): LlmTransport {
  return {
    kind: 'mock',
    async send(request) {
      const name = options.fixture ?? slugify(request.userMessage);
      const path = join(options.fixturesDir, options.agent, `${name}.md`);
      const recorded = await readFile(path, 'utf8').catch(() => null);
      return response(recorded ?? stub(options.agent, request));
    },
  };
}

function response(text: string): LlmResponse {
  return {
    text: text.trim(),
    model: MOCK_MODEL,
    stopReason: 'end_turn',
    refusal: null,
    usage: null,
  };
}

function stub(agent: string, request: LlmRequest): string {
  const noteIds = [...(request.system.volatile ?? '').matchAll(/<note id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  return [
    `**[MOCK]** No recorded fixture for this task, so no model was called.`,
    '',
    `Agent: \`${agent}\` · requested model: \`${request.model}\` · effort: \`${request.effort}\``,
    '',
    noteIds.length > 0
      ? `Retrieved ${noteIds.length} note(s) that a live run would have reasoned over:\n${noteIds
          .map((id) => `- \`${id}\``)
          .join('\n')}`
      : 'No notes matched, so a live run would have reported missing data rather than answering.',
    '',
    `Task: ${truncate(request.userMessage, 240)}`,
    '',
    'Set `ANTHROPIC_API_KEY` to run this for real.',
  ].join('\n');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
