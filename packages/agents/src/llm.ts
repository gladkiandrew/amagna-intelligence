/**
 * The runner talks to a transport, not to a vendor SDK.
 *
 * Nothing in this file names a vendor. Each provider lives in its own small
 * adapter (anthropic.ts, openai-compatible.ts, command.ts, mock.ts) and
 * provider.ts picks one from the environment. That keeps the agent logic testable
 * without a network or a key, makes mock mode a transport swap rather than a
 * branch threaded through the business logic, and means changing models is a
 * config change, not a code change.
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
