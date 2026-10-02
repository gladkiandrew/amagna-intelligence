export interface Env {
  /** From BotFather. `wrangler secret put TELEGRAM_BOT_TOKEN`. */
  TELEGRAM_BOT_TOKEN: string;
  /**
   * The `secret_token` passed to setWebhook. Telegram echoes it in the
   * X-Telegram-Bot-Api-Secret-Token header, which is the only thing that
   * distinguishes a real Telegram POST from anyone who found the URL.
   */
  TELEGRAM_WEBHOOK_SECRET: string;
  /** Comma-separated chat IDs. Empty means nobody — there is no wildcard. */
  ALLOWED_CHAT_IDS: string;
  /** vault-bridge deployment that /note writes through. */
  BRIDGE_URL: string;
  /** Bearer token for that bridge. */
  BRIDGE_TOKEN: string;
}
