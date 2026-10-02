/**
 * Command parsing for the cockpit.
 *
 * The surface is deliberately tiny — three verbs. A chat cockpit earns its keep by
 * being faster than opening a laptop, and every command past the third is one the
 * operator has to remember instead of just typing. Anything richer belongs in the
 * app, not the bot.
 */
export type Command =
  | { kind: 'ask'; question: string }
  | { kind: 'note'; text: string }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'unknown'; name: string }
  | { kind: 'empty'; name: string }
  | { kind: 'not-a-command'; text: string };

const MAX_ARG_CHARS = 2_000;

export function parseCommand(raw: string): Command {
  const text = raw.trim();
  if (!text.startsWith('/')) {
    return { kind: 'not-a-command', text };
  }

  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?([\s\S]*)$/.exec(text);
  if (!match) return { kind: 'unknown', name: text.slice(1, 32) };

  // Telegram appends @botname when a command is sent in a group; strip it so the
  // same handler works in a group and a DM.
  const name = (match[1] as string).toLowerCase();
  const argument = (match[2] ?? '').trim().slice(0, MAX_ARG_CHARS);

  switch (name) {
    case 'ask':
      return argument === '' ? { kind: 'empty', name } : { kind: 'ask', question: argument };
    case 'note':
      return argument === '' ? { kind: 'empty', name } : { kind: 'note', text: argument };
    case 'status':
      return { kind: 'status' };
    case 'help':
    case 'start':
      return { kind: 'help' };
    default:
      return { kind: 'unknown', name };
  }
}

export const HELP_TEXT = [
  'Cockpit commands:',
  '',
  '/ask <question> — answer from the vault, citing the notes used',
  '/note <text> — capture a note into the inbox',
  '/status — what the system thinks is true right now',
  '',
  'Anything that is not a command is ignored.',
].join('\n');
