/**
 * `npm run demo` — the whole system, end to end, with no API key and no network.
 *
 * Six stages, in the order the architecture actually runs:
 *
 *   1. load a markdown vault into an index
 *   2. recall against it
 *   3. load the crew's charters
 *   4. route tasks by declared capability
 *   5. run each task as its agent (mock transport, recorded fixtures)
 *   6. enforce write scopes, and show a refusal
 *
 * Then the deal screener, as a worked example of the deterministic-math /
 * model-narrative split.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, loadVault, search } from '@amagna/memory';
import { loadCrew, route, run, type Charter, type Task } from '@amagna/agents';
import { checkWrite, parseScopeTable } from '@amagna/guard';
import { loadTeaser, renderMemo, screen, writeNarrative } from '@amagna/deal-screener';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = join(ROOT, 'examples', 'demo-vault');
const CHARTERS = join(ROOT, 'charters', 'examples');
const FIXTURES = join(ROOT, 'scripts', 'fixtures');

const RULE = '─'.repeat(78);

function heading(number: number, title: string): void {
  console.log(`\n${RULE}\n ${number}. ${title}\n${RULE}`);
}

function indent(text: string, prefix = '   '): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : prefix + line))
    .join('\n');
}

// ---------------------------------------------------------------- 1. the vault

heading(1, 'Markdown memory — load a vault of notes');

const { notes, failures } = await loadVault(VAULT);
console.log(
  `   ${notes.length} notes loaded from examples/demo-vault, ${failures.length} failed to parse`,
);
for (const note of notes.slice(0, 4)) {
  console.log(`   · ${note.id.padEnd(38)} ${note.description}`);
}
console.log(`   · … and ${notes.length - 4} more`);

const memory = buildIndex(notes);
console.log(`   index: ${memory.postings.size} distinct terms, ${memory.byTag.size} tags`);

// ----------------------------------------------------------------- 2. recall

heading(2, 'Recall — keyword relevance, with recency weighting');

const QUERY = 'should we discount below our price floor';
console.log(`   query: "${QUERY}"\n`);
for (const hit of search(memory, QUERY, { limit: 3, now: new Date('2026-10-01T00:00:00Z') })) {
  console.log(`   ${hit.score.toFixed(2).padStart(6)}  ${hit.note.name}`);
  console.log(`           matched: ${[...new Set(hit.matched)].join(', ')}`);
}

// --------------------------------------------------------------- 3. charters

heading(3, 'Charters — the crew, loaded from markdown');

const crew: Charter[] = await loadCrew(CHARTERS);
for (const member of crew) {
  const tag = member.coordinator ? ' (coordinator)' : '';
  console.log(`   ${member.name}${tag}`);
  console.log(`      ${member.role}`);
  console.log(`      can write: ${member.memoryWrites.join(', ') || '(nothing)'}`);
}

// ---------------------------------------------------------------- 4. routing

heading(4, 'Routing — rules-based, deterministic, explainable');

interface DemoTask extends Task {
  fixture?: string;
}

const tasks: DemoTask[] = [
  { text: 'Draft a short post about why we hold the pricing floor', fixture: 'pricing-floor-post' },
  {
    text: "Consolidate this week's logs into notes worth keeping",
    fixture: 'weekly-consolidation',
  },
  { text: 'What are my priorities today?', fixture: 'monday-brief' },
  { text: 'The office printer is jammed again' },
];

const routed = tasks.map((task) => ({ task, decision: route(task, crew) }));

for (const { task, decision } of routed) {
  const why = decision.candidates[0]?.reasons[0] ?? 'no reason recorded';
  console.log(`   "${task.text}"`);
  console.log(`      → ${decision.agent?.name ?? '(unrouted)'}  —  ${why}`);
  if (decision.fellBackToCoordinator) {
    console.log('        (nothing matched; the coordinator holds unrouted work)');
  }
}

// ------------------------------------------------------------------- 5. runs

heading(5, 'Runs — charter + recalled notes → output (mock mode, no API key)');

for (const { task, decision } of routed) {
  const agent = decision.agent;
  if (!agent) continue;

  const result = await run(agent, task, {
    memory,
    env: {}, // force keyless: no credential is read from the environment
    fixturesDir: FIXTURES,
    ...(task.fixture ? { fixture: task.fixture } : {}),
    now: new Date('2026-10-01T00:00:00Z'),
  });

  console.log(`\n   ── ${result.agent} · mode=${result.mode} · model=${result.model}`);
  console.log(
    `      cited: ${result.cited.map((entry) => entry.id).join(', ') || '(nothing matched)'}`,
  );
  console.log('');
  console.log(indent(result.text, '      '));
}

// ------------------------------------------------------------------ 6. guard

heading(6, 'Write-scope guard — the charter as an enforced boundary');

// In production this table lives beside the hook and is read from disk; inlined
// here so the demo needs no setup. Paths match the charters loaded above.
const scopes = parseScopeTable(
  JSON.stringify({
    agents: {
      atlas: ['/demo-vault/briefs/**', '/demo-vault/inbox/**'],
      scribe: ['/demo-vault/drafts/**'],
      ledger: ['/demo-vault/notes/**', '/demo-vault/retros/**'],
    },
  }),
);

const attempts = [
  { agent: 'scribe', path: '/demo-vault/drafts/pricing-post.md', note: 'in scope' },
  { agent: 'scribe', path: '/demo-vault/notes/pricing-floor.md', note: "another agent's file" },
  {
    agent: 'scribe',
    path: '/demo-vault/drafts/../notes/pricing-floor.md',
    note: 'traversal attempt',
  },
  { agent: 'ledger', path: '/demo-vault/notes/pricing-floor.md', note: 'in scope' },
  { agent: 'unlisted-helper', path: '/anywhere/at/all.md', note: 'not a chartered agent' },
];

for (const attempt of attempts) {
  const decision = checkWrite(attempt, scopes);
  const mark = decision.allowed ? 'ALLOW' : 'BLOCK';
  console.log(`   ${mark}  ${attempt.agent} → ${attempt.path}`);
  console.log(`          ${attempt.note}: ${decision.reason.split('\n')[0]}`);
}

// ---------------------------------------------------------------- 7. screener

heading(7, 'Deal screener — deterministic math, model-written narrative only');

const teaser = await loadTeaser(
  join(ROOT, 'examples', 'deal-screener', 'fixtures', 'project-palm.json'),
);
const result = screen(teaser);
const narrative = await writeNarrative(result, { env: {} });

console.log(`   ${teaser.company} · ${teaser.sector}`);
console.log(`   reported EBITDA        $${teaser.reportedEbitda.toLocaleString('en-US')}`);
console.log(
  `   seller-adjusted        $${result.valuation.sellerAdjustedEbitda.toLocaleString('en-US')}`,
);
console.log(
  `   buyer-adjusted         $${result.valuation.buyerAdjustedEbitda.toLocaleString('en-US')}`,
);
console.log(
  `   valuation range        $${result.valuation.lowEnterpriseValue.toLocaleString('en-US')} – $${result.valuation.highEnterpriseValue.toLocaleString('en-US')}`,
);
console.log(
  `   paper LBO              ${result.lbo.moic.toFixed(2)}x MOIC · ${(result.lbo.irr * 100).toFixed(1)}% IRR`,
);
console.log(`   recommendation         ${result.recommendation}`);
console.log('');
console.log(indent(narrative.text, '   '));

const memo = renderMemo(result, { narrative: narrative.text, narrativeMode: narrative.mode });
console.log(`\n   Full memo: ${memo.split('\n').length} lines. Print it with: npm run screen`);

console.log(`\n${RULE}`);
console.log(' Done. Nothing above called a network or read a credential.');
console.log(' Set LLM_PROVIDER + LLM_MODEL to run stages 5 and 7 against any real model.');
console.log(`${RULE}\n`);
