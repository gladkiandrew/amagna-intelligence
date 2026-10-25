import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmTransport } from './llm.js';

/**
 * The Anthropic provider. Every Anthropic-specific detail lives here and nowhere
 * else: prompt-cache breakpoints on the charter, adaptive thinking, effort, and
 * server-side refusal fallbacks.
 */
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
