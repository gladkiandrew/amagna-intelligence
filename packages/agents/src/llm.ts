import Anthropic from '@anthropic-ai/sdk';

/**
 * The runner talks to a transport, not to a vendor SDK.
 *
 * One small adapter below holds every Anthropic-specific detail, which keeps the
 * agent logic testable without a network or a key — and makes the mock mode that
 * powers `npm run demo` a transport swap rather than a branch threaded through
 * the business logic.
 */
export interface LlmRequest {
  /**
   * Split so the cache prefix is stable. `stable` is the charter: byte-identical
   * across every task for that agent, so it earns a cache breakpoint. `volatile`
   * is the retrieved context, which changes per task and must come after it —
   * caching is a prefix match, so putting the volatile half first would
   * invalidate the charter on every call.
   */
  system: { stable: string; volatile?: string };
  userMessage: string;
  model: string;
  maxTokens: number;
  effort: Effort;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmResponse {
  text: string;
  model: string;
  stopReason: string | null;
  /** Set when the model declined the request rather than answering it. */
  refusal: { category: string | null; explanation: string | null } | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null;
}

export interface LlmTransport {
  readonly kind: 'mock' | 'live';
  send(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface AnthropicTransportOptions {
  apiKey?: string;
  /** Inject a pre-built client (useful when the host already owns auth). */
  client?: Anthropic;
}

export function createAnthropicTransport(options: AnthropicTransportOptions = {}): LlmTransport {
  // A bare `new Anthropic()` also resolves ANTHROPIC_AUTH_TOKEN and an
  // `ant auth login` profile, so an unset ANTHROPIC_API_KEY does not mean
  // "no credentials". The caller decides which path to take; see runner.ts.
  const client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});

  return {
    kind: 'live',
    async send(request) {
      try {
        const response = await client.beta.messages.create({
          model: request.model,
          max_tokens: request.maxTokens,
          output_config: { effort: request.effort },
          // Thinking is on by default on the Opus-5 family; leaving `thinking`
          // unset runs adaptive thinking, which is what we want here.
          //
          // Server-side fallbacks: if a safety classifier declines the request,
          // the API re-runs it on a fallback model inside the same call instead
          // of handing us a dead turn. `"default"` routes by refusal category so
          // there is no model list to maintain.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [
            { type: 'text', text: request.system.stable, cache_control: { type: 'ephemeral' } },
            ...(request.system.volatile
              ? [{ type: 'text' as const, text: request.system.volatile }]
              : []),
          ],
          messages: [{ role: 'user', content: request.userMessage }],
        });

        const text = response.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();

        return {
          text,
          model: response.model,
          stopReason: response.stop_reason ?? null,
          refusal:
            response.stop_reason === 'refusal'
              ? {
                  category: response.stop_details?.category ?? null,
                  explanation: response.stop_details?.explanation ?? null,
                }
              : null,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          },
        };
      } catch (error) {
        throw toLlmError(error);
      }
    },
  };
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError(`rate limited: ${error.message}`, error.status ?? 429, true);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmError(
      'authentication failed — check the API key or profile',
      error.status ?? 401,
      false,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError(`connection failed: ${error.message}`, null, true);
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? null;
    return new LlmError(
      `API error ${status ?? 'unknown'}: ${error.message}`,
      status,
      status !== null && status >= 500,
    );
  }
  return new LlmError(error instanceof Error ? error.message : String(error), null, false);
}
