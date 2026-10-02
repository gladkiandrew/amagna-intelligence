import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ScopeTable } from './scopes.js';

export interface WriteAttempt {
  /** The chartered agent making the write, or undefined for an unattributed call. */
  agent?: string | undefined;
  /** The path the tool wants to write. Relative paths resolve against `cwd`. */
  path: string;
}

export interface CheckContext {
  home?: string;
  cwd?: string;
}

export interface Decision {
  allowed: boolean;
  /** Human-readable, and written to go straight into a block message. */
  reason: string;
  /** The pattern that permitted the write, when one did. */
  matchedPattern?: string;
  /** The absolute path the decision was actually made about. */
  resolvedPath: string;
}

/**
 * Decide whether `attempt` is inside the agent's declared scope.
 *
 * The path is resolved to an absolute, `..`-free form *before* matching. That is
 * the whole security property: a pattern like `~/vault/notes/**` must not be
 * satisfied by `~/vault/notes/../../.ssh/id_rsa`, and comparing raw strings is
 * exactly how that mistake gets made.
 */
export function checkWrite(
  attempt: WriteAttempt,
  table: ScopeTable,
  context: CheckContext = {},
): Decision {
  const home = context.home ?? homedir();
  const cwd = context.cwd ?? process.cwd();
  const resolvedPath = resolve(cwd, expandHome(attempt.path, home));

  if (!attempt.agent) {
    return {
      allowed: true,
      reason: 'no agent attributed; the host permission model governs this call',
      resolvedPath,
    };
  }

  const patterns = table.agents[attempt.agent];
  if (!patterns) {
    return {
      allowed: true,
      reason: `agent "${attempt.agent}" is not in the scope table, so it is unrestricted`,
      resolvedPath,
    };
  }

  for (const pattern of patterns) {
    const expanded = expandHome(pattern, home);
    if (expanded.endsWith('/**')) {
      const prefix = resolve(expanded.slice(0, -3));
      if (resolvedPath === prefix || resolvedPath.startsWith(`${prefix}/`)) {
        return {
          allowed: true,
          reason: `inside "${pattern}"`,
          matchedPattern: pattern,
          resolvedPath,
        };
      }
      continue;
    }
    if (resolvedPath === resolve(expanded)) {
      return {
        allowed: true,
        reason: `exact match on "${pattern}"`,
        matchedPattern: pattern,
        resolvedPath,
      };
    }
  }

  return {
    allowed: false,
    reason: [
      `write-scope violation: agent "${attempt.agent}" may not write ${resolvedPath}.`,
      `Its charter declares these paths:`,
      ...patterns.map((pattern) => `  - ${pattern}`),
      `If this write is legitimate, change the charter and the scope table together — not just the table.`,
    ].join('\n'),
    resolvedPath,
  };
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
  return path;
}

/** True when a path is already absolute (or home-relative), for caller validation. */
export function isAbsoluteish(path: string): boolean {
  return isAbsolute(path) || path.startsWith('~');
}
