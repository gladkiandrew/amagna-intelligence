import { HELP_TEXT, parseCommand } from './commands.js';
import type { Env } from './env.js';
import {
  createTelegramClient,
  messageFrom,
  type TelegramClient,
  type TelegramUpdate,
} from './telegram.js';

/**
 * cockpit-worker — a Telegram front door to the operation.
 *
 *   POST /telegram  the bot webhook
 *   GET  /health    liveness
 *
 * Three security properties, in the order they matter:
 *
 * 1. **The secret token is the authentication.** A webhook URL is a bearer
 *    credential that ends up in shell history, logs and curl examples. Telegram's
 *    `secret_token` lets us verify the caller is actually Telegram, so finding the
 *    URL is not enough. Compared in constant time.
 * 2. **The chat allowlist is the authorization.** A bot's username is public and
 *    anyone can message it. An empty allowlist denies everyone; there is no
 *    wildcard to accidentally ship.
 * 3. **It always answers 200.** Telegram retries non-2xx responses, so a bug that
 *    throws on one malformed update would otherwise become an infinite redelivery
 *    loop. Failures are logged and acknowledged, never retried into the ground.
 */
export interface Deps {
  telegram?: TelegramClient;
  /** Answers an /ask. Injected so the Worker does not bundle the agent runtime. */
  ask?: (question: string) => Promise<string>;
  /** Captures a /note. Defaults to POSTing the vault-bridge. */
  capture?: (text: string) => Promise<string>;
  status?: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === 'GET' && pathname === '/health') {
    return new Response('ok', { status: 200 });
  }
  if (request.method !== 'POST' || pathname !== '/telegram') {
    return new Response('not found', { status: 404 });
  }

  const presented = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    !(await secretsMatch(presented, env.TELEGRAM_WEBHOOK_SECRET))
  ) {
    // 401 here, not 200: this is not Telegram, so there is no retry loop to
    // worry about, and an unauthenticated caller should be told nothing else.
    return new Response('unauthorized', { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return ack('malformed update');
  }

  try {
    await dispatch(update, env, deps);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'dispatch_failed',
        update_id: update.update_id ?? null,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return ack('ok');
}

function ack(detail: string): Response {
  return new Response(detail, { status: 200 });
}

async function dispatch(update: TelegramUpdate, env: Env, deps: Deps): Promise<void> {
  const message = messageFrom(update);
  const chatId = message?.chat?.id;
  const text = message?.text;

  if (chatId === undefined || typeof text !== 'string') return;
  if (message?.from?.is_bot) return; // never answer another bot

  const chat = String(chatId);
  if (!isAllowed(chat, env.ALLOWED_CHAT_IDS)) {
    console.warn(JSON.stringify({ event: 'chat_not_allowed', chat }));
    return; // Deny by silence: a rejection message confirms the bot is live.
  }

  const telegram =
    deps.telegram ?? createTelegramClient(env.TELEGRAM_BOT_TOKEN, deps.fetch ?? fetch);
  const command = parseCommand(text);

  switch (command.kind) {
    case 'help':
      return telegram.sendMessage(chat, HELP_TEXT);

    case 'status': {
      const status = deps.status ?? defaultStatus(env, deps);
      return telegram.sendMessage(chat, await status());
    }

    case 'note': {
      const capture = deps.capture ?? defaultCapture(env, deps);
      try {
        return await telegram.sendMessage(chat, `Captured: ${await capture(command.text)}`);
      } catch (error) {
        return telegram.sendMessage(
          chat,
          `Could not capture that: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    case 'ask': {
      if (!deps.ask) {
        return telegram.sendMessage(
          chat,
          'No answering backend is wired up in this deployment. See docs/architecture.md.',
        );
      }
      try {
        return await telegram.sendMessage(chat, await deps.ask(command.question));
      } catch (error) {
        return telegram.sendMessage(
          chat,
          `That failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    case 'empty':
      return telegram.sendMessage(chat, `/${command.name} needs something after it. Try /help.`);

    case 'unknown':
      return telegram.sendMessage(chat, `Unknown command /${command.name}. Try /help.`);

    case 'not-a-command':
      return; // Silence keeps the channel signal; see docs/decisions/0003.
  }
}

/**
 * Allowlist membership.
 *
 * Trimmed, exact string comparison against a parsed list — not `includes()` on
 * the raw var, which would let chat `234` match an allowlist of `1234`.
 */
export function isAllowed(chatId: string, allowedChatIds: string): boolean {
  const allowed = allowedChatIds
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (allowed.length === 0) return false;
  return allowed.includes(chatId.trim());
}

function defaultCapture(env: Env, deps: Deps): (text: string) => Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  return async (text) => {
    const firstLine = text.split('\n')[0] ?? text;
    const response = await doFetch(`${env.BRIDGE_URL.replace(/\/+$/, '')}/note`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.BRIDGE_TOKEN}`,
        'content-type': 'application/json',
        // Derived from the message, so Telegram's own webhook retries do not
        // create duplicate notes.
        'idempotency-key': `tg-${now().toISOString().slice(0, 10)}-${hash(text)}`,
      },
      body: JSON.stringify({ title: firstLine.slice(0, 120), text, source: 'chat' }),
    });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    const body = (await response.json()) as { path?: string };
    return body.path ?? 'note created';
  };
}

function defaultStatus(env: Env, deps: Deps): () => Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  return async () => {
    const response = await doFetch(`${env.BRIDGE_URL.replace(/\/+$/, '')}/health`, {
      headers: { authorization: `Bearer ${env.BRIDGE_TOKEN}` },
    });
    const reachable = response.ok;
    await response.body?.cancel();
    return [
      `bridge: ${reachable ? 'reachable' : `unreachable (${response.status})`}`,
      `allowlisted chats: ${env.ALLOWED_CHAT_IDS.split(',').filter((entry) => entry.trim() !== '').length}`,
    ].join('\n');
  };
}

/** Small, stable, non-cryptographic hash — only used to build idempotency keys. */
export function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function secretsMatch(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  const native = (
    crypto.subtle as { timingSafeEqual?: (p: ArrayBufferView, q: ArrayBufferView) => boolean }
  ).timingSafeEqual;
  if (typeof native === 'function') return native.call(crypto.subtle, x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
} satisfies ExportedHandler<Env>;
