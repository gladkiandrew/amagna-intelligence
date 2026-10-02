import { checkWrite, type CheckContext, type Decision } from './check.js';
import { loadScopeTable, type ScopeTable } from './scopes.js';

/**
 * The shape a Claude Code PreToolUse hook receives on stdin. Only the fields the
 * guard needs are modelled; everything else is ignored by design, so a host that
 * adds fields does not break the guard.
 */
export interface HookPayload {
  tool_name?: string;
  agent_type?: string;
  tool_input?: {
    file_path?: string;
    notebook_path?: string;
    edits?: { file_path?: string }[];
  };
}

export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export interface HookResult {
  /** 0 = allow, 2 = block. Exit 2 is what the host treats as a refusal. */
  exitCode: 0 | 2;
  /** Written to stderr so the agent sees why it was refused. */
  message: string;
  decisions: Decision[];
}

/**
 * Evaluate one hook payload.
 *
 * Two deliberate choices, both of which matter more than the matching logic:
 *
 * 1. **Exit 2 is the enforcement.** A hook that returns a polite warning is a
 *    suggestion, and an agent running with permissions pre-granted will sail past
 *    it. Blocking on a non-zero exit is the only thing that holds.
 *
 * 2. **It fails OPEN on its own errors.** An unparseable payload or an unreadable
 *    scope table allows the write. That looks backwards for a security control,
 *    and it is the right call here: this guard sits in front of *every* file write
 *    in the system, so a bug in it would wedge the entire fleet rather than
 *    protect anything. A payload the guard cannot parse is also a payload it
 *    cannot attribute to an agent — there is nothing to enforce against. The
 *    invariant it does hold absolutely: a write it *can* attribute and that *is*
 *    out of scope never gets through.
 */
export function evaluate(
  payload: HookPayload,
  table: ScopeTable,
  context: CheckContext = {},
): HookResult {
  if (payload.tool_name && !WRITE_TOOLS.has(payload.tool_name)) {
    return { exitCode: 0, message: '', decisions: [] };
  }

  const paths = targetPaths(payload);
  if (paths.length === 0) {
    return { exitCode: 0, message: '', decisions: [] };
  }

  const decisions = paths.map((path) =>
    checkWrite({ agent: payload.agent_type, path }, table, context),
  );
  const blocked = decisions.filter((decision) => !decision.allowed);
  if (blocked.length === 0) {
    return { exitCode: 0, message: '', decisions };
  }
  return {
    exitCode: 2,
    message: blocked.map((decision) => decision.reason).join('\n\n'),
    decisions,
  };
}

function targetPaths(payload: HookPayload): string[] {
  const input = payload.tool_input ?? {};
  const paths = [
    input.file_path,
    input.notebook_path,
    ...(input.edits ?? []).map((edit) => edit.file_path),
  ];
  return paths.filter((path): path is string => typeof path === 'string' && path.trim() !== '');
}

export interface RunHookOptions {
  stdin: string;
  scopeTablePath: string;
  /** Overrides for home/cwd resolution. Tests set these; the hook does not. */
  context?: CheckContext;
}

/** Full hook run, including the fail-open behaviour described on `evaluate`. */
export async function runHook(options: RunHookOptions): Promise<HookResult> {
  let payload: HookPayload;
  try {
    const parsed: unknown = JSON.parse(options.stdin || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('payload is not an object');
    }
    payload = parsed as HookPayload;
  } catch {
    return { exitCode: 0, message: '', decisions: [] };
  }

  let table: ScopeTable;
  try {
    table = await loadScopeTable(options.scopeTablePath);
  } catch {
    return { exitCode: 0, message: '', decisions: [] };
  }

  try {
    return evaluate(payload, table, options.context ?? {});
  } catch {
    return { exitCode: 0, message: '', decisions: [] };
  }
}
