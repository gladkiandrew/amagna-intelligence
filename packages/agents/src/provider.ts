import { createAnthropicTransport } from './anthropic.js';
import { createCommandTransport, parseCommand } from './command.js';
import { LlmError, type LlmTransport } from './llm.js';
import { createOpenAICompatibleTransport } from './openai-compatible.js';

/**
 * Which model answers is configuration, not code. Set `LLM_PROVIDER` and the model:
 *
 *   LLM_PROVIDER=anthropic    LLM_MODEL=claude-opus-5        (ANTHROPIC_API_KEY or a profile)
 *   LLM_PROVIDER=openai       LLM_MODEL=…                    (OPENAI_API_KEY)
 *   LLM_PROVIDER=xai          LLM_MODEL=…                    (XAI_API_KEY)  — Grok
 *   LLM_PROVIDER=openrouter   LLM_MODEL=…                    (OPENROUTER_API_KEY)
 *   LLM_PROVIDER=ollama       LLM_MODEL=llama3.1             (no key; local open-weight)
 *   LLM_PROVIDER=openai-compatible  LLM_BASE_URL=…  LLM_MODEL=…  [LLM_API_KEY]  — vLLM, LM Studio, …
 *   LLM_PROVIDER=command      LLM_COMMAND="claude -p"        (a subscription CLI, no API key)
 *
 * With nothing set, everything runs on the mock transport. `MOCK=1` forces mock.
 * Existing setups keep working: an Anthropic credential with no LLM_PROVIDER still
 * selects Anthropic, as before.
 */
export type Provider = 'mock' | 'anthropic' | 'openai-compatible' | 'command';

type Env = Record<string, string | undefined>;

export const PRESETS: Record<string, { baseUrl: string; keyEnv?: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  xai: { baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  ollama: { baseUrl: 'http://localhost:11434/v1' },
};

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

export interface ProviderChoice {
  provider: Provider;
  /** Preset name when one was used (openai, xai, …), for messages. */
  preset?: string;
  baseUrl?: string;
  apiKey?: string;
  command?: string[];
}

export interface ProviderOptions {
  mode?: 'mock' | 'live';
  /** Explicit key for the chosen provider. */
  apiKey?: string;
}

function hasAnthropicCredential(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE);
}

export function resolveProvider(options: ProviderOptions, env: Env): ProviderChoice {
  if (options.mode === 'mock' || env.MOCK === '1') return { provider: 'mock' };
  const named = env.LLM_PROVIDER?.trim().toLowerCase();

  if (named === 'mock') return { provider: 'mock' };
  if (named === 'anthropic') return { provider: 'anthropic', apiKey: options.apiKey };
  if (named === 'command') {
    const command = parseCommand(env.LLM_COMMAND ?? '');
    if (command.length === 0) {
      throw new LlmError('LLM_PROVIDER=command needs LLM_COMMAND, e.g. "claude -p"', null, false);
    }
    return { provider: 'command', command };
  }
  if (named === 'openai-compatible') {
    if (!env.LLM_BASE_URL) {
      throw new LlmError('LLM_PROVIDER=openai-compatible needs LLM_BASE_URL', null, false);
    }
    return {
      provider: 'openai-compatible',
      baseUrl: env.LLM_BASE_URL,
      apiKey: options.apiKey ?? env.LLM_API_KEY,
    };
  }
  if (named && named in PRESETS) {
    const preset = PRESETS[named]!;
    return {
      provider: 'openai-compatible',
      preset: named,
      baseUrl: env.LLM_BASE_URL ?? preset.baseUrl,
      apiKey: options.apiKey ?? env.LLM_API_KEY ?? (preset.keyEnv ? env[preset.keyEnv] : undefined),
    };
  }
  if (named) {
    throw new LlmError(
      `unknown LLM_PROVIDER ${JSON.stringify(named)}; use anthropic, ${Object.keys(PRESETS).join(', ')}, openai-compatible, command or mock`,
      null,
      false,
    );
  }

  // Nothing named: an explicit key or an Anthropic credential keeps the original
  // behaviour; otherwise stay keyless.
  if (options.mode === 'live' || options.apiKey || hasAnthropicCredential(env)) {
    return { provider: 'anthropic', apiKey: options.apiKey };
  }
  return { provider: 'mock' };
}

/** The model to request. Non-Anthropic providers have no safe default: say which. */
export function resolveModel(
  choice: ProviderChoice,
  requested: string | undefined,
  env: Env,
): string {
  const model = requested ?? env.LLM_MODEL;
  if (model) return model;
  if (choice.provider === 'anthropic') return env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT_MODEL;
  if (choice.provider === 'command') return choice.command?.[0] ?? 'command';
  if (choice.provider === 'mock') return ANTHROPIC_DEFAULT_MODEL;
  throw new LlmError(
    `set LLM_MODEL for ${choice.preset ?? choice.provider} — model names differ per provider`,
    null,
    false,
  );
}

export function createLiveTransport(choice: ProviderChoice, model: string): LlmTransport {
  switch (choice.provider) {
    case 'anthropic':
      return createAnthropicTransport(choice.apiKey ? { apiKey: choice.apiKey } : {});
    case 'openai-compatible':
      return createOpenAICompatibleTransport({
        baseUrl: choice.baseUrl!,
        ...(choice.apiKey ? { apiKey: choice.apiKey } : {}),
      });
    case 'command':
      return createCommandTransport({ command: choice.command!, model });
    case 'mock':
      throw new LlmError('mock is not a live provider', null, false);
  }
}
