import { describe, expect, it, vi } from 'vitest';
import { HELP_TEXT, parseCommand } from '../src/commands.js';
import type { Env } from '../src/env.js';
import { handle, hash, isAllowed } from '../src/index.js';
import { messageFrom, truncate, type TelegramClient } from '../src/telegram.js';

const SECRET = 'webhook-secret-value';
const CHAT = '123456';

function env(overrides: Partial<Env> = {}): Env {
  return {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    ALLOWED_CHAT_IDS: CHAT,
    BRIDGE_URL: 'https://bridge.example.com',
    BRIDGE_TOKEN: 'bridge-token',
    ...overrides,
  };
}

function spyTelegram(): TelegramClient & { sent: { chatId: string; text: string }[] } {
  const sent: { chatId: string; text: string }[] = [];
  return {
    sent,
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    },
  };
}

function webhook(body: unknown, secret: string | null = SECRET): Request {
  return new Request('https://cockpit.example.com/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function update(
  text: string,
  chatId: string | number = CHAT,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    update_id: 1,
    message: { message_id: 7, text, chat: { id: chatId, type: 'private' }, ...extra },
  };
}

describe('parseCommand', () => {
  it('parses the three verbs and their arguments', () => {
    expect(parseCommand('/ask what is the pricing floor')).toEqual({
      kind: 'ask',
      question: 'what is the pricing floor',
    });
    expect(parseCommand('/note  call the supplier  ')).toEqual({
      kind: 'note',
      text: 'call the supplier',
    });
    expect(parseCommand('/status')).toEqual({ kind: 'status' });
  });

  it('strips the @botname suffix Telegram adds in groups', () => {
    expect(parseCommand('/status@my_cockpit_bot')).toEqual({ kind: 'status' });
    expect(parseCommand('/note@my_cockpit_bot buy milk')).toEqual({
      kind: 'note',
      text: 'buy milk',
    });
  });

  it('is case-insensitive on the verb', () => {
    expect(parseCommand('/STATUS')).toEqual({ kind: 'status' });
  });

  it('treats /help and /start alike', () => {
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(parseCommand('/start')).toEqual({ kind: 'help' });
  });

  it('distinguishes an empty argument from a missing command', () => {
    expect(parseCommand('/ask')).toEqual({ kind: 'empty', name: 'ask' });
    expect(parseCommand('/note   ')).toEqual({ kind: 'empty', name: 'note' });
    expect(parseCommand('/deploy')).toEqual({ kind: 'unknown', name: 'deploy' });
    expect(parseCommand('just chatting')).toEqual({ kind: 'not-a-command', text: 'just chatting' });
  });

  it('keeps multi-line note bodies intact', () => {
    expect(parseCommand('/note line one\nline two')).toEqual({
      kind: 'note',
      text: 'line one\nline two',
    });
  });

  it('bounds the argument length', () => {
    const parsed = parseCommand(`/note ${'a'.repeat(5000)}`);
    expect(parsed.kind).toBe('note');
    expect((parsed as { text: string }).text.length).toBe(2000);
  });
});

describe('isAllowed', () => {
  it('denies everyone when the allowlist is empty — there is no wildcard', () => {
    for (const list of ['', '   ', ',,']) {
      expect(isAllowed(CHAT, list)).toBe(false);
    }
  });

  it('matches exactly, not by substring', () => {
    expect(isAllowed('1234', '1234')).toBe(true);
    expect(isAllowed('234', '1234')).toBe(false);
    expect(isAllowed('12345', '1234')).toBe(false);
  });

  it('tolerates whitespace around entries', () => {
    expect(isAllowed('222', ' 111 , 222 , 333 ')).toBe(true);
  });

  it('handles negative group ids', () => {
    expect(isAllowed('-1001234567890', '-1001234567890')).toBe(true);
  });
});

describe('webhook authentication', () => {
  it.each([
    ['a missing secret header', null],
    ['a wrong secret', 'nope'],
    ['a prefix of the secret', SECRET.slice(0, -1)],
    ['an empty secret', ''],
  ])('rejects %s with 401', async (_label, secret) => {
    const response = await handle(webhook(update('/status'), secret), env(), {
      telegram: spyTelegram(),
    });
    expect(response.status).toBe(401);
  });

  it('refuses every caller when no secret is configured', async () => {
    const response = await handle(
      webhook(update('/status'), ''),
      env({ TELEGRAM_WEBHOOK_SECRET: '' }),
      {},
    );
    expect(response.status).toBe(401);
  });

  it('accepts the correct secret', async () => {
    const telegram = spyTelegram();
    const response = await handle(webhook(update('/status')), env(), {
      telegram,
      status: async () => 'all good',
    });
    expect(response.status).toBe(200);
    expect(telegram.sent).toEqual([{ chatId: CHAT, text: 'all good' }]);
  });
});

describe('authorization', () => {
  it('ignores a chat that is not allowlisted, without replying to it', async () => {
    const telegram = spyTelegram();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await handle(webhook(update('/status', '999')), env(), { telegram });
    expect(response.status).toBe(200);
    expect(telegram.sent).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never answers another bot', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('/status', CHAT, { from: { id: 1, is_bot: true } })), env(), {
      telegram,
    });
    expect(telegram.sent).toEqual([]);
  });
});

describe('always acknowledges', () => {
  it('returns 200 for a malformed body so Telegram stops retrying', async () => {
    const response = await handle(webhook('not json'), env(), { telegram: spyTelegram() });
    expect(response.status).toBe(200);
  });

  it('returns 200 when a handler throws, and logs the failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handle(webhook(update('/status')), env(), {
      telegram: spyTelegram(),
      status: async () => {
        throw new Error('backend down');
      },
    });
    expect(response.status).toBe(200);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it.each([
    ['no message', { update_id: 2 }],
    ['no text', { update_id: 3, message: { chat: { id: CHAT } } }],
    ['no chat', { update_id: 4, message: { text: '/status' } }],
  ])('ignores an update with %s', async (_label, body) => {
    const telegram = spyTelegram();
    const response = await handle(webhook(body), env(), { telegram });
    expect(response.status).toBe(200);
    expect(telegram.sent).toEqual([]);
  });

  it('treats an edited message as a fresh command', async () => {
    const telegram = spyTelegram();
    await handle(
      webhook({ update_id: 5, edited_message: { text: '/status', chat: { id: CHAT } } }),
      env(),
      { telegram, status: async () => 'edited ok' },
    );
    expect(telegram.sent[0]?.text).toBe('edited ok');
  });
});

describe('commands end to end', () => {
  it('answers /help with the command list', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('/help')), env(), { telegram });
    expect(telegram.sent[0]?.text).toBe(HELP_TEXT);
  });

  it('captures a /note through the bridge and reports the path', async () => {
    const telegram = spyTelegram();
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify({ ok: true, path: 'inbox/2026-10-01-call-supplier.md' }), {
        status: 201,
      });
    }) as unknown as typeof fetch;

    await handle(webhook(update('/note call supplier\nabout the delay')), env(), {
      telegram,
      fetch: fakeFetch,
      now: () => new Date('2026-10-01T00:00:00Z'),
    });

    expect(telegram.sent[0]?.text).toBe('Captured: inbox/2026-10-01-call-supplier.md');
    expect(calls[0]?.url).toBe('https://bridge.example.com/note');
    expect(calls[0]?.headers.authorization).toBe('Bearer bridge-token');
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^tg-2026-10-01-[a-z0-9]+$/);
    expect(calls[0]?.body).toMatchObject({
      title: 'call supplier',
      text: 'call supplier\nabout the delay',
      source: 'chat',
    });
  });

  it('sends the same idempotency key for a redelivered note', async () => {
    const keys: string[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)['idempotency-key'] as string);
      return new Response(JSON.stringify({ path: 'p' }), { status: 201 });
    }) as unknown as typeof fetch;

    const deps = {
      telegram: spyTelegram(),
      fetch: fakeFetch,
      now: () => new Date('2026-10-01T00:00:00Z'),
    };
    await handle(webhook(update('/note same text')), env(), deps);
    await handle(webhook(update('/note same text')), env(), deps);
    expect(keys[0]).toBe(keys[1]);
  });

  it('tells the operator when a capture fails instead of going quiet', async () => {
    const telegram = spyTelegram();
    const fakeFetch = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await handle(webhook(update('/note something')), env(), { telegram, fetch: fakeFetch });
    expect(telegram.sent[0]?.text).toMatch(/Could not capture that: bridge returned 500/);
  });

  it('routes /ask to the injected backend', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('/ask what is the floor')), env(), {
      telegram,
      ask: async (question) => `answer to: ${question}`,
    });
    expect(telegram.sent[0]?.text).toBe('answer to: what is the floor');
  });

  it('says so plainly when no answering backend is wired up', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('/ask anything')), env(), { telegram });
    expect(telegram.sent[0]?.text).toMatch(/No answering backend is wired up/);
  });

  it('reports a failing /ask backend to the operator', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('/ask x')), env(), {
      telegram,
      ask: async () => {
        throw new Error('model unreachable');
      },
    });
    expect(telegram.sent[0]?.text).toBe('That failed: model unreachable');
  });

  it('prompts on an empty argument and on an unknown verb', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('/ask')), env(), { telegram });
    await handle(webhook(update('/deploy')), env(), { telegram });
    expect(telegram.sent[0]?.text).toMatch(/\/ask needs something after it/);
    expect(telegram.sent[1]?.text).toMatch(/Unknown command \/deploy/);
  });

  it('stays silent on ordinary chatter', async () => {
    const telegram = spyTelegram();
    await handle(webhook(update('morning')), env(), { telegram });
    expect(telegram.sent).toEqual([]);
  });

  it('/status reports bridge reachability without a backend of its own', async () => {
    const telegram = spyTelegram();
    const fakeFetch = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    await handle(webhook(update('/status')), env({ ALLOWED_CHAT_IDS: `${CHAT},999` }), {
      telegram,
      fetch: fakeFetch,
    });
    expect(telegram.sent[0]?.text).toContain('bridge: reachable');
    expect(telegram.sent[0]?.text).toContain('allowlisted chats: 2');
  });
});

describe('routing', () => {
  it('serves /health and 404s everything else', async () => {
    expect((await handle(new Request('https://c.test/health'), env(), {})).status).toBe(200);
    expect((await handle(new Request('https://c.test/'), env(), {})).status).toBe(404);
    expect(
      (await handle(new Request('https://c.test/telegram', { method: 'GET' }), env(), {})).status,
    ).toBe(404);
  });
});

describe('helpers', () => {
  it('truncate keeps Telegram-sized messages intact and marks longer ones', () => {
    expect(truncate('short', 100)).toBe('short');
    const long = truncate('a'.repeat(5000), 4000);
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long.endsWith('[truncated]')).toBe(true);
  });

  it('hash is stable and differs for different inputs', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });

  it('messageFrom prefers a new message over an edit', () => {
    expect(messageFrom({ message: { text: 'a' }, edited_message: { text: 'b' } })?.text).toBe('a');
    expect(messageFrom({ edited_message: { text: 'b' } })?.text).toBe('b');
    expect(messageFrom({})).toBeNull();
  });
});
