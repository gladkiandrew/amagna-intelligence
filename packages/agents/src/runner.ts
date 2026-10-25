import { search, type MemoryIndex } from '@amagna/memory';
import type { Charter } from './charter.js';
import type { Effort, LlmTransport } from './llm.js';
import { createMockTransport } from './mock.js';
import {
  ANTHROPIC_DEFAULT_MODEL,
  createLiveTransport,
  resolveModel,
  resolveProvider,
  type ProviderChoice,
} from './provider.js';
import { buildPrompt } from './prompt.js';
import type { Task } from './router.js';

/** Used only when the provider is Anthropic and no model is configured. */
export const DEFAULT_MODEL = ANTHROPIC_DEFAULT_MODEL;
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
   * Force a mode. Default: live when a provider is configured (`LLM_PROVIDER`, or
   * an Anthropic credential for backwards compatibility), mock otherwise. `MOCK=1`
   * in the environment also forces mock. See provider.ts.
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
  let transport: LlmTransport;
  let requestedModel: string;
  if (options.transport) {
    // Injected (tests, the demo): the caller owns the transport, so just label the model.
    transport = options.transport;
    requestedModel = options.model ?? env.LLM_MODEL ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  } else {
    const choice = resolveProvider(options, env);
    requestedModel = resolveModel(choice, options.model, env);
    transport = resolveTransport(charter, choice, requestedModel, options, env);
  }

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

/** Keyless by default: no configured provider and no explicit `mode: 'live'` means mock. */
export function resolveMode(
  options: Pick<RunOptions, 'mode' | 'apiKey'>,
  env: Record<string, string | undefined>,
): 'mock' | 'live' {
  if (options.mode) return options.mode;
  return resolveProvider(options, env).provider === 'mock' ? 'mock' : 'live';
}

function resolveTransport(
  charter: Charter,
  choice: ProviderChoice,
  model: string,
  options: RunOptions,
  env: Record<string, string | undefined>,
): LlmTransport {
  if (choice.provider !== 'mock') {
    return createLiveTransport(choice, model);
  }
  return createMockTransport({
    fixturesDir: options.fixturesDir ?? env.AMAGNA_FIXTURES_DIR ?? 'fixtures',
    agent: charter.name,
    ...(options.fixture ? { fixture: options.fixture } : {}),
  });
}
