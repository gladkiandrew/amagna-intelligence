import { LlmError, type LlmRequest, type LlmResponse, type LlmTransport } from './llm.js';

/**
 * One adapter for every server that speaks the `/chat/completions` shape: OpenAI,
 * xAI (Grok), OpenRouter, and open-weight models served locally by Ollama, vLLM or
 * LM Studio. It uses the platform `fetch`, so it adds no dependency.
 *
 * Deliberately conservative: it sends only fields every compatible server accepts.
 * `effort` has no portable equivalent, so it is not sent — a provider-specific knob
 * belongs in a provider-specific adapter, not in a lowest-common-denominator one.
 */
export interface OpenAICompatibleOptions {
  /** e.g. https://api.openai.com/v1, https://api.x.ai/v1, http://localhost:11434/v1 */
  baseUrl: string;
  /** Optional: local servers usually need none. */
  apiKey?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export function createOpenAICompatibleTransport(options: OpenAICompatibleOptions): LlmTransport {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    kind: 'live',
    async send(request: LlmRequest): Promise<LlmResponse> {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxTokens,
            // Stable charter first, volatile context after: providers that cache by
            // prefix (most do) get the same benefit as the Anthropic breakpoint.
            messages: [
              {
                role: 'system',
                content: [request.system.stable, request.system.volatile]
                  .filter(Boolean)
                  .join('\n\n'),
              },
              { role: 'user', content: request.userMessage },
            ],
          }),
        });
      } catch (error) {
        throw new LlmError(
          `connection failed: ${error instanceof Error ? error.message : String(error)}`,
          null,
          true,
        );
      }

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        if (res.status === 401 || res.status === 403) {
          throw new LlmError('authentication failed — check the API key', res.status, false);
        }
        throw new LlmError(
          `API error ${res.status}: ${detail}`,
          res.status,
          res.status === 429 || res.status >= 500,
        );
      }

      const body = (await res.json()) as ChatCompletion;
      const choice = body.choices?.[0];
      const refused =
        Boolean(choice?.message?.refusal) || choice?.finish_reason === 'content_filter';
      return {
        text: (choice?.message?.content ?? '').trim(),
        model: body.model ?? request.model,
        stopReason: choice?.finish_reason ?? null,
        refusal: refused
          ? {
              category: choice?.finish_reason ?? null,
              explanation: choice?.message?.refusal ?? null,
            }
          : null,
        usage: body.usage
          ? {
              inputTokens: body.usage.prompt_tokens ?? 0,
              outputTokens: body.usage.completion_tokens ?? 0,
              cacheReadTokens: body.usage.prompt_tokens_details?.cached_tokens ?? 0,
            }
          : null,
      };
    },
  };
}
