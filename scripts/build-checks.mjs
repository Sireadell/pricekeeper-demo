// Builds checks.json for the proof page (checks.html): every test with its
// latest TestSprite result, the bugs the tests found with their red and green
// runs, and every pull request with what TestSprite said about each commit.
// Run: node scripts/build-checks.mjs   (needs the TestSprite and gh logins)
import { readFileSync, writeFileSync } from 'node:fs';
import { suite, ts, pool, PROJECT } from './lib/testsprite.mjs';
import { collectLedger } from './lib/ledger.mjs';

const all = JSON.parse(readFileSync(new URL('../testsprite_tests/test-ids.json', import.meta.url), 'utf8'));
const created = new Set(suite().map(t => t.id));
const bugs = JSON.parse(readFileSync(new URL('../testsprite_tests/bugs.json', import.meta.url), 'utf8'));

const tests = await pool(all, 6, async t => {
  const base = { code: t.code, name: t.name, kind: t.kind || 'browser', checks: t.description, file: t.file };
  if (!created.has(t.id)) return { ...base, last: null };
  const r = await ts('test', 'result', t.id).catch(() => null);
  return {
    ...base,
    last: r && {
      verdict: r.verdict || r.status,
      at: r.finishedAt,
      where: r.environment?.name || '',
      target: r.targetUrl || '',
    },
  };
});

const { pulls, totals } = await collectLedger();
const data = {
  generatedAt: new Date().toISOString(),
  project: PROJECT,
  totals,
  tests,
  bugs,
  pulls: pulls.map(p => ({
    number: p.number,
    title: p.title,
    url: p.url,
    state: p.state,
    commits: p.commits.map(c => ({ sha: c.sha.slice(0, 7), url: c.url, title: c.title, result: c.check.text, state: c.check.state, run: c.check.link })),
  })),
};
writeFileSync(new URL('../checks.json', import.meta.url), JSON.stringify(data, null, 1) + '\n');
console.log(`checks.json: ${tests.length} tests, ${bugs.length} bugs, ${pulls.length} pull requests`);
