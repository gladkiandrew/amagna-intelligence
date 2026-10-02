# @amagna/cockpit-worker

A Telegram bot as the front door to the operation. Three commands, because a chat
cockpit earns its keep by being faster than opening a laptop.

```
/ask <question>   answer from the vault, citing the notes used
/note <text>      capture a note into the inbox (via @amagna/vault-bridge)
/status           what the system thinks is true right now
```

## Deploy

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # long random hex
npx wrangler secret put BRIDGE_TOKEN
npx wrangler deploy

curl -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://cockpit-worker.<subdomain>.workers.dev/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Then set `ALLOWED_CHAT_IDS` in [`wrangler.jsonc`](wrangler.jsonc). It is empty by
default, which denies everyone.

## Three security properties, in order of importance

**The secret token is the authentication.** A webhook URL is a bearer credential that
ends up in shell history, logs and curl examples, so it cannot be the thing protecting
the endpoint. Telegram echoes the `secret_token` you registered in the
`X-Telegram-Bot-Api-Secret-Token` header; that is what proves the caller is Telegram.
Compared in constant time. A failure returns 401 — this is not Telegram, so there is no
retry loop to protect.

**The chat allowlist is the authorization.** A bot's username is public and anyone can
message it. An empty allowlist denies everyone; there is no wildcard to ship by
accident. Matching is exact against a parsed list, not `includes()` on the raw var,
which would let chat `234` match an allowlist of `1234`. An unauthorised chat gets **no
reply at all** — "you are not authorised" confirms the bot is live to anyone probing.

**It always answers 200.** Telegram retries non-2xx responses, so one bug that throws
on a malformed update becomes an infinite redelivery loop. Failures are logged and
acknowledged. The only 401 is the auth check itself.

## Other behaviour

- `@botname` suffixes are stripped, so the same handler works in a group and a DM.
- An edited message is treated as a fresh command.
- Messages from other bots are ignored.
- Ordinary chatter gets no reply — silence keeps the channel signal.
- Replies are plain text, not Markdown: any underscore or bracket in a retrieved note
  would otherwise make Telegram reject the message.
- `/note` derives its `Idempotency-Key` from the message, so Telegram's own webhook
  retries do not create duplicate notes.

`/ask` needs an answering backend injected (`deps.ask`) — the Worker deliberately does
not bundle the agent runtime. Without one it says so plainly rather than failing
silently. See [ADR 3](../../docs/decisions/0003-chat-first-cockpit.md) for why the
cockpit is a chat bot and not a dashboard.
