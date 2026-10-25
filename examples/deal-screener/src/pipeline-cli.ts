/**
 * `npm run pipeline -- [teaser-folder] [--mandate path/to/mandate.json]`
 *
 * Screens every teaser in the folder against one mandate and prints the ranked
 * pipeline. Defaults to the bundled fictional teasers and the lower-middle-market
 * PE mandate.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMandate } from './mandate.js';
import { loadPipeline, renderPipeline, screenPipeline } from './pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = args.indexOf('--mandate');
const mandatePath =
  flag >= 0 ? args[flag + 1] : join(here, '..', 'mandates', 'lower-middle-market-pe.json');
const folder = args.find((arg, i) => !arg.startsWith('--') && i !== flag + 1);

if (!mandatePath) throw new Error('--mandate needs a path');
const mandate = await loadMandate(resolve(mandatePath));
const teasers = await loadPipeline(resolve(folder ?? join(here, '..', 'fixtures', 'pipeline')));
process.stdout.write(renderPipeline(screenPipeline(teasers, mandate), mandate));
