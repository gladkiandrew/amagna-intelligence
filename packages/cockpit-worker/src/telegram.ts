/** The slice of Telegram's Update object this cockpit reads. */
export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: { id?: number | string; type?: string };
  from?: { id?: number; is_bot?: boolean; username?: string };
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<void>;
}

const MAX_MESSAGE_CHARS = 4_000; // Telegram's hard limit is 4096.

export function createTelegramClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): TelegramClient {
  return {
    async sendMessage(chatId, text) {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: truncate(text, MAX_MESSAGE_CHARS),
          // Plain text on purpose. Markdown parsing turns any underscore or
          // bracket in retrieved note content into a 400 from Telegram, which is
          // a confusing failure for a cockpit whose whole job is to be reliable.
          disable_web_page_preview: true,
        }),
      });
      if (!response.ok) {
        // Swallowing this would make a silently-dead bot look healthy. The
        // webhook still returns 200 (see index.ts) so Telegram stops retrying.
        throw new Error(`telegram sendMessage failed (${response.status})`);
      }
      await response.body?.cancel();
    },
  };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20).trimEnd()}\n\n[truncated]`;
}

/** Normalise the message out of an update, treating an edit as a fresh message. */
export function messageFrom(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? null;
}
