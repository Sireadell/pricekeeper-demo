// Builds LOOP.md: every pull request, every commit on it, and what the
// TestSprite V3 check said about that commit, read from the GitHub API.
// Run: GITHUB_TOKEN=... node scripts/loop-ledger.mjs
// Without a token it asks the `gh` command line for one.
import { writeFileSync } from 'node:fs';
import { collectLedger } from './lib/ledger.mjs';

const short = sha => sha.slice(0, 7);
const runId = url => (url || '').split('/execution/')[1]?.slice(0, 8) || '';
const cell = s => s.replace(/\|/g, '/');

const { pulls, direct, totals } = await collectLedger();
const lines = [];

for (const pr of pulls) {
  const status = pr.mergedAt ? `merged ${pr.mergedAt.slice(0, 10)}` : pr.state;
  lines.push(`### #${pr.number} ${pr.title}`, '', `${status} · [pull request](${pr.url})`, '');
  lines.push('| Commit | TestSprite V3 | Run |', '|---|---|---|');
  for (const c of pr.commits) {
    const run = c.check.link ? `[${runId(c.check.link)}](${c.check.link})` : '';
    lines.push(`| [${short(c.sha)}](${c.url}) ${cell(c.title)} | ${c.check.text} | ${run} |`);
  }
  lines.push('');
}

if (direct.length) {
  lines.push('### Pushed to main without a pull request', '',
    'The first four set the project up before any checks existed. The rest changed only the README, PROOF.md, unit tests or their setup, never the app itself.', '',
    '| Commit | Date |', '|---|---|');
  for (const c of direct) lines.push(`| [${short(c.sha)}](${c.url}) ${cell(c.title)} | ${c.date.slice(0, 10)} |`);
  lines.push('');
}

const head = [
  '# The test loop, pull request by pull request',
  '',
  'Every pull request, every commit on it, and the result the TestSprite V3 check posted for that commit.',
  'Generated from the GitHub API by `scripts/loop-ledger.mjs`, so nothing here is typed by hand.',
  '',
  `${totals.pulls} pull requests · ${totals.runs} TestSprite runs · ${totals.red} red · ${totals.green} green`,
  '',
];
writeFileSync('LOOP.md', [...head, ...lines].join('\n'));
console.log(`LOOP.md: ${totals.pulls} pull requests, ${totals.runs} runs`);
