import { readFile } from 'node:fs/promises';

/**
 * The scope table: which path patterns each agent may write.
 *
 * Patterns are absolute paths. `~` expands to the home directory. A trailing
 * `/**` means "this directory and everything under it"; anything else is an
 * exact file match. There are deliberately no other wildcards — a pattern
 * language rich enough to be clever is rich enough to be wrong in a way nobody
 * notices until an agent has overwritten something.
 *
 * An agent absent from the table is UNRESTRICTED. That is the right default
 * because the guard's job is to enforce charters, not to be the system's
 * permission model: the main thread and any non-chartered caller are governed by
 * the host's own permissions. Listing an agent is what opts it in.
 */
export interface ScopeTable {
  agents: Record<string, string[]>;
}

export class ScopeTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeTableError';
  }
}

export function parseScopeTable(raw: string): ScopeTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ScopeTableError(`not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ScopeTableError('must be a JSON object');
  }

  const agentsValue = (parsed as { agents?: unknown }).agents;
  if (typeof agentsValue !== 'object' || agentsValue === null || Array.isArray(agentsValue)) {
    throw new ScopeTableError('must have an "agents" object');
  }

  const agents: Record<string, string[]> = {};
  for (const [agent, patterns] of Object.entries(agentsValue as Record<string, unknown>)) {
    if (agent.startsWith('_')) continue; // comment keys
    if (!Array.isArray(patterns) || patterns.some((entry) => typeof entry !== 'string')) {
      throw new ScopeTableError(`agent "${agent}" must map to an array of pattern strings`);
    }
    if (patterns.length === 0) {
      throw new ScopeTableError(
        `agent "${agent}" has an empty pattern list; remove the agent to leave it unrestricted, or give it a scope`,
      );
    }
    for (const pattern of patterns as string[]) {
      if (!pattern.startsWith('/') && !pattern.startsWith('~/')) {
        throw new ScopeTableError(
          `agent "${agent}" pattern ${JSON.stringify(pattern)} must be absolute or start with ~/`,
        );
      }
      if (pattern.includes('*') && !pattern.endsWith('/**')) {
        throw new ScopeTableError(
          `agent "${agent}" pattern ${JSON.stringify(pattern)}: the only wildcard is a trailing /**`,
        );
      }
    }
    agents[agent] = patterns as string[];
  }

  return { agents };
}

export async function loadScopeTable(path: string): Promise<ScopeTable> {
  return parseScopeTable(await readFile(path, 'utf8'));
}
