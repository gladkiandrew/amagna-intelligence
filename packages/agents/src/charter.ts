import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseNote, type Frontmatter } from '@amagna/memory';

/**
 * A charter is a markdown file: frontmatter declares the agent's *contract*
 * (what it may do, what it may write, when it must escalate) and the body is the
 * prompt sent to the model.
 *
 * Keeping both in one reviewable file is the point. See
 * docs/decisions/0004-charters-not-autonomous-agents.md.
 */
export interface Charter {
  /** Slug. Unique within a crew. */
  name: string;
  /** One line, shown in routing explanations and the cockpit's /status. */
  role: string;
  /** Exactly one charter per crew may be the coordinator; unrouted work goes there. */
  coordinator: boolean;
  /** Routing surface: what this agent claims it can do. */
  capabilities: string[];
  /** Extra routing hints — words an operator would actually type. */
  keywords: string[];
  /** Declared tool names. Advisory here; the host decides what it actually grants. */
  tools: string[];
  /** Path globs this agent may write. Enforced by @amagna/guard, not by trust. */
  memoryWrites: string[];
  /** Conditions under which the agent must stop and hand back to a human. */
  escalate: string[];
  /** The charter body — becomes the system prompt. */
  prompt: string;
  /** Source file, for error messages. */
  sourcePath: string;
}

export class CharterError extends Error {
  constructor(
    message: string,
    readonly sourcePath: string,
  ) {
    super(`${sourcePath}: ${message}`);
    this.name = 'CharterError';
  }
}

export function parseCharter(sourcePath: string, raw: string): Charter {
  let frontmatter: Frontmatter;
  let body: string;
  try {
    ({ frontmatter, body } = parseNote(raw));
  } catch (error) {
    throw new CharterError(error instanceof Error ? error.message : String(error), sourcePath);
  }

  const name = requireString(frontmatter, 'name', sourcePath);
  const role = requireString(frontmatter, 'role', sourcePath);
  const capabilities = list(frontmatter.capabilities);
  if (capabilities.length === 0) {
    throw new CharterError('capabilities must declare at least one entry', sourcePath);
  }
  if (body.trim() === '') {
    throw new CharterError('charter body is empty; the body is the prompt', sourcePath);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new CharterError(`name ${JSON.stringify(name)} must be a lowercase slug`, sourcePath);
  }

  return {
    name,
    role,
    coordinator: isTrue(frontmatter.coordinator),
    capabilities,
    keywords: list(frontmatter.keywords),
    tools: list(frontmatter.tools),
    memoryWrites: list(frontmatter.memory_writes),
    escalate: list(frontmatter.escalate),
    prompt: body.trim(),
    sourcePath,
  };
}

export async function loadCharter(path: string): Promise<Charter> {
  return parseCharter(path, await readFile(path, 'utf8'));
}

/**
 * Load every charter in a directory and validate the crew as a whole: names must
 * be unique and at most one agent may claim `coordinator: true`. A crew with two
 * coordinators has no defined place to send unrouted work, so that is an error
 * rather than a silent tie-break.
 */
export async function loadCrew(dir: string): Promise<Charter[]> {
  const files = (await readdir(dir)).filter((name) => /\.md$/i.test(name)).sort();
  const charters = await Promise.all(files.map((file) => loadCharter(join(dir, file))));

  const seen = new Map<string, string>();
  for (const charter of charters) {
    const existing = seen.get(charter.name);
    if (existing) {
      throw new CharterError(
        `duplicate agent name ${charter.name} (also in ${existing})`,
        charter.sourcePath,
      );
    }
    seen.set(charter.name, charter.sourcePath);
  }

  const coordinators = charters.filter((charter) => charter.coordinator);
  if (coordinators.length > 1) {
    throw new CharterError(
      `crew declares ${coordinators.length} coordinators (${coordinators.map((c) => c.name).join(', ')}); exactly one may`,
      dir,
    );
  }
  return charters;
}

function requireString(frontmatter: Frontmatter, key: string, sourcePath: string): string {
  const value = frontmatter[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CharterError(`missing required frontmatter key ${key}`, sourcePath);
  }
  return value.trim();
}

function isTrue(value: Frontmatter[string] | undefined): boolean {
  return typeof value === 'string' && /^(true|yes)$/i.test(value.trim());
}

function list(value: Frontmatter[string] | undefined): string[] {
  if (Array.isArray(value)) return value.map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}
