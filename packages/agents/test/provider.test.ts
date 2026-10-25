import { describe, expect, it } from 'vitest';
import {
  createCommandTransport,
  createOpenAICompatibleTransport,
  LlmError,
  parseCommand,
  resolveMode,
  resolveModel,
  resolveProvider,
  type LlmRequest,
} from '../src/index.js';

const REQUEST: LlmRequest = {
  system: { stable: 'You are scribe.', volatile: '<context>notes</context>' },
  userMessage: 'Draft a post about pricing',
  model: 'some-model',
  maxTokens: 500,
  effort: 'high',
};

describe('resolveProvider — the model is configuration, not code', () => {
  it('is keyless by default', () => {
    expect(resolveProvider({}, {}).provider).toBe('mock');
    expect(resolveMode({}, {})).toBe('mock');
  });

  it('keeps old setups working: an Anthropic credential alone still means Anthropic', () => {
    expect(resolveProvider({}, { ANTHROPIC_API_KEY: 'k' }).provider).toBe('anthropic');
    expect(resolveProvider({}, { ANTHROPIC_PROFILE: 'work' }).provider).toBe('anthropic');
  });

  it('maps presets for OpenAI, Grok, OpenRouter and local open-weight models', () => {
    expect(resolveProvider({}, { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'o' })).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'o',
    });
    expect(resolveProvider({}, { LLM_PROVIDER: 'xai', XAI_API_KEY: 'x' })).toMatchObject({
      baseUrl: 'https://api.x.ai/v1',
      apiKey: 'x',
    });
    expect(resolveProvider({}, { LLM_PROVIDER: 'ollama' })).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: undefined,
    });
  });

  it('takes any OpenAI-compatible server by URL, and insists on the URL', () => {
    expect(
      resolveProvider(
        {},
        { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://gpu:8000/v1' },
      ),
    ).toMatchObject({ provider: 'openai-compatible', baseUrl: 'http://gpu:8000/v1' });
    expect(() => resolveProvider({}, { LLM_PROVIDER: 'openai-compatible' })).toThrow(LlmError);
  });

  it('runs a subscription CLI with no API key', () => {
    expect(resolveProvider({}, { LLM_PROVIDER: 'command', LLM_COMMAND: 'claude -p' })).toEqual({
      provider: 'command',
      command: ['claude', '-p'],
    });
    expect(() => resolveProvider({}, { LLM_PROVIDER: 'command' })).toThrow(/LLM_COMMAND/);
  });

  it('MOCK=1 wins over everything, and an unknown provider is an error, not a guess', () => {
    expect(resolveProvider({}, { MOCK: '1', LLM_PROVIDER: 'openai' }).provider).toBe('mock');
    expect(() => resolveProvider({}, { LLM_PROVIDER: 'skynet' })).toThrow(/unknown LLM_PROVIDER/);
  });

  it('never guesses a model name for a non-Anthropic provider', () => {
    const openai = resolveProvider({}, { LLM_PROVIDER: 'openai' });
    expect(() => resolveModel(openai, undefined, {})).toThrow(/set LLM_MODEL for openai/);
    expect(resolveModel(openai, undefined, { LLM_MODEL: 'm-1' })).toBe('m-1');
    expect(resolveModel(resolveProvider({}, { ANTHROPIC_API_KEY: 'k' }), undefined, {})).toBe(
      'claude-opus-5',
    );
  });
});

describe('OpenAI-compatible transport', () => {
  function fakeFetch(
    status: number,
    body: unknown,
    seen: { url?: string; init?: RequestInit } = {},
  ) {
    return (async (url: string, init?: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  it('sends the cache-stable charter first and reads the reply and usage back', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const transport = createOpenAICompatibleTransport({
      baseUrl: 'https://api.x.ai/v1/',
      apiKey: 'secret',
      fetch: fakeFetch(
        200,
        {
          model: 'grok-x',
          choices: [{ finish_reason: 'stop', message: { content: ' Draft. ' } }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 3,
            prompt_tokens_details: { cached_tokens: 8 },
          },
        },
        seen,
      ),
    });
    const res = await transport.send(REQUEST);
    expect(seen.url).toBe('https://api.x.ai/v1/chat/completions');
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret');
    const sent = JSON.parse(String(seen.init?.body));
    expect(sent.messages[0]).toEqual({
      role: 'system',
      content: 'You are scribe.\n\n<context>notes</context>',
    });
    expect(sent).not.toHaveProperty('effort');
    expect(res).toMatchObject({
      text: 'Draft.',
      model: 'grok-x',
      refusal: null,
      usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 8 },
    });
  });

  it('sends no auth header to a local server with no key', async () => {
    const seen: { init?: RequestInit } = {};
    const transport = createOpenAICompatibleTransport({
      baseUrl: 'http://localhost:11434/v1',
      fetch: fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }, seen),
    });
    await transport.send(REQUEST);
    expect(seen.init?.headers).not.toHaveProperty('authorization');
  });

  it('reports a content-filter stop as a refusal, not as an answer', async () => {
    const transport = createOpenAICompatibleTransport({
      baseUrl: 'http://x/v1',
      fetch: fakeFetch(200, {
        choices: [{ finish_reason: 'content_filter', message: { content: '' } }],
      }),
    });
    expect((await transport.send(REQUEST)).refusal).toEqual({
      category: 'content_filter',
      explanation: null,
    });
  });

  it('classifies errors: 429 and 5xx retry, auth does not', async () => {
    const at = (status: number) =>
      createOpenAICompatibleTransport({ baseUrl: 'http://x/v1', fetch: fakeFetch(status, 'nope') })
        .send(REQUEST)
        .catch((e: LlmError) => [e.status, e.retryable]);
    expect(await at(429)).toEqual([429, true]);
    expect(await at(503)).toEqual([503, true]);
    expect(await at(401)).toEqual([401, false]);
    expect(await at(400)).toEqual([400, false]);
  });
});

describe('command transport', () => {
  it('splits the command without a shell', () => {
    expect(parseCommand('ollama run "my model:7b" --verbose')).toEqual([
      'ollama',
      'run',
      'my model:7b',
      '--verbose',
    ]);
  });

  it('pipes the prompt in and reads the answer from stdout', async () => {
    const echo = [process.execPath, '-e', 'process.stdin.pipe(process.stdout)'];
    const res = await createCommandTransport({ command: echo, model: 'echo' }).send(REQUEST);
    expect(res.text).toBe(
      'You are scribe.\n\n<context>notes</context>\n\nTask:\nDraft a post about pricing',
    );
    expect(res.model).toBe('echo');
  });

  it('turns a failing command into an LlmError', async () => {
    const fail = [process.execPath, '-e', 'process.exit(3)'];
    await expect(createCommandTransport({ command: fail }).send(REQUEST)).rejects.toThrow(
      /exited 3/,
    );
  });
});
