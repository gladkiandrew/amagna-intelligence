/**
 * Hook entry point. Wire it in a Claude Code settings.json as:
 *
 *   {
 *     "hooks": {
 *       "PreToolUse": [{
 *         "matcher": "Write|Edit|MultiEdit",
 *         "hooks": [{
 *           "type": "command",
 *           "command": "node ${CLAUDE_PROJECT_DIR}/packages/guard/dist/src/cli.js",
 *           "timeout": 5000
 *         }]
 *       }]
 *     }
 *   }
 *
 * Build first (`npm run build`). The scope table path comes from
 * AMAGNA_SCOPE_TABLE, defaulting to write-scopes.json beside the project root.
 */
import { runHook } from './hook.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const result = await runHook({
  stdin: await readStdin(),
  scopeTablePath: process.env.AMAGNA_SCOPE_TABLE ?? 'write-scopes.json',
});

if (result.message) process.stderr.write(`${result.message}\n`);
process.exit(result.exitCode);
