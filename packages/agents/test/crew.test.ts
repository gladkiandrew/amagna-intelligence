import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CharterError, loadCrew } from '../src/index.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '../../../charters/examples');

function charter(name: string, extra = ''): string {
  return `---\nname: ${name}\nrole: Does ${name} things\ncapabilities: [${name}]\n${extra}---\n\nBody for ${name}.\n`;
}

describe('loadCrew', () => {
  it('validates the charters this repo actually ships', async () => {
    const crew = await loadCrew(EXAMPLES);
    expect(crew.length).toBeGreaterThanOrEqual(2);
    expect(crew.filter((c) => c.coordinator)).toHaveLength(1);
    for (const member of crew) {
      expect(member.role.length).toBeGreaterThan(10);
      expect(member.prompt).toMatch(/##/);
    }
  });

  it('rejects two coordinators, because unrouted work would have nowhere to go', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crew-'));
    await writeFile(join(dir, 'a.md'), charter('alpha', 'coordinator: true\n'));
    await writeFile(join(dir, 'b.md'), charter('beta', 'coordinator: true\n'));
    await expect(loadCrew(dir)).rejects.toThrow(/2 coordinators/);
  });

  it('rejects duplicate agent names across files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crew-'));
    await writeFile(join(dir, 'a.md'), charter('alpha'));
    await writeFile(join(dir, 'b.md'), charter('alpha'));
    await expect(loadCrew(dir)).rejects.toThrow(CharterError);
  });
});
