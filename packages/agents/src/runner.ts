import { search, type MemoryIndex } from '@amagna/memory';
import type { Charter } from './charter.js';
import { createAnthropicTransport, type Effort, type LlmTransport } from './llm.js';
import { createMockTransport } from './mock.js';
import { buildPrompt } from './prompt.js';
import type { Task } from './router.js';

export const DEFAULT_MODEL = 'claude-opus-5';
export const DEFAULT_MAX_TOKENS = 16_000;
export const DEFAULT_RECALL_LIMIT = 5;

export interface RunOptions {
  /** Memory to recall from. Omit to run with no retrieved context. */
  memory?: MemoryIndex;
  recallLimit?: number;
  model?: string;
  maxTokens?: number;
  effort?: Effort;
  /**
   * Force a mode. Default: live when a credential is present, mock otherwise.
   * `MOCK=1` in the environment also forces mock.
   */
  mode?: 'mock' | 'live';
  apiKey?: string;
  fixturesDir?: string;
  /** Fixture basename override, for recording a specific scenario. */
  fixture?: string;
  /** Inject a transport directly. Tests and the demo use this. */
  transport?: LlmTransport;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface RunResult {
  agent: string;
  mode: 'mock' | 'live';
  model: string;
  text: string;
  /** Notes injected into the prompt, best first. */
  cited: { id: string; name: string; score: number }[];
  stopReason: string | null;
  refused: boolean;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null;
}

/**
 * Run one task as one agent: recall → prompt → model → result.
 *
 * Note what this does *not* do. It does not loop, it does not let the model pick
 * its next action, and it does not write anything. A charter run is one bounded
 * call whose output a human or a calling workflow decides what to do with — see
 * docs/decisions/0004-charters-not-autonomous-agents.md.
 */
export async function run(
  charter: Charter,
  task: Task,
  options: RunOptions = {},
): Promise<RunResult> {
  const env = options.env ?? process.env;
  const hits = options.memory
    ? search(options.memory, `${task.text} ${(task.tags ?? []).join(' ')}`, {
        limit: options.recallLimit ?? DEFAULT_RECALL_LIMIT,
        ...(options.now ? { now: options.now } : {}),
      })
    : [];

  const prompt = buildPrompt(charter, hits);
  const transport = options.transport ?? resolveTransport(charter, options, env);
  const requestedModel = options.model ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const response = await transport.send({
    system: { stable: prompt.stable, volatile: prompt.volatile },
    userMessage: task.text,
    model: requestedModel,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    effort: options.effort ?? 'high',
  });

  return {
    agent: charter.name,
    mode: transport.kind,
    model: response.model,
    text: response.text,
    cited: prompt.cited,
    stopReason: response.stopReason,
    refused: response.refusal !== null,
    usage: response.usage,
  };
}

/** Keyless by default: no credential and no explicit `mode: 'live'` means mock. */
export function resolveMode(
  options: Pick<RunOptions, 'mode' | 'apiKey'>,
  env: Record<string, string | undefined>,
): 'mock' | 'live' {
  if (options.mode) return options.mode;
  if (env.MOCK === '1') return 'mock';
  const hasCredential = Boolean(
    options.apiKey ?? env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_PROFILE,
  );
  return hasCredential ? 'live' : 'mock';
}

function resolveTransport(
  charter: Charter,
  options: RunOptions,
  env: Record<string, string | undefined>,
): LlmTransport {
  if (resolveMode(options, env) === 'live') {
    return createAnthropicTransport(options.apiKey ? { apiKey: options.apiKey } : {});
  }
  return createMockTransport({
    fixturesDir: options.fixturesDir ?? env.AMAGNA_FIXTURES_DIR ?? 'fixtures',
    agent: charter.name,
    ...(options.fixture ? { fixture: options.fixture } : {}),
  });
}
