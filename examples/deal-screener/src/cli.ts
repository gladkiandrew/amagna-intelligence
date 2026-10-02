/**
 * `npm run screen -- [path-to-teaser.json]`
 *
 * Prints the memo to stdout. Runs keyless by default; set ANTHROPIC_API_KEY to
 * have a model write the investment-view paragraph instead of the deterministic
 * one.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTeaser } from './load.js';
import { renderMemo } from './memo.js';
import { screen } from './screen.js';
import { writeNarrative } from './narrative.js';

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(process.argv[2] ?? join(here, '..', 'fixtures', 'project-palm.json'));

const teaser = await loadTeaser(path);
const result = screen(teaser);
const narrative = await writeNarrative(result);

process.stdout.write(
  renderMemo(result, { narrative: narrative.text, narrativeMode: narrative.mode }) + '\n',
);
