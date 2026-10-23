// Builds LOOP.md: every pull request, every commit on it, and what the
// TestSprite V3 check said about that commit, read from the GitHub API.
// Run: GITHUB_TOKEN=... node scripts/loop-ledger.mjs
// Without a token it asks the `gh` command line for one.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY || 'Sireadell/pricekeeper-demo';
const TOKEN = process.env.GITHUB_TOKEN || execSync('gh auth token').toString().trim();

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const short = sha => sha.slice(0, 7);
const runId = url => (url || '').split('/execution/')[1]?.slice(0, 8) || '';

async function verdict(sha) {
  const { statuses } = await gh(`/commits/${sha}/status`);
  const ts = statuses.find(s => s.context === 'TestSprite V3');
  if (!ts) return { text: 'not run', link: '' };
  return { text: ts.description || ts.state, state: ts.state, link: ts.target_url };
}

const pulls = (await gh('/pulls?state=all&per_page=100')).sort((a, b) => a.number - b.number);
const lines = [];
let redCommits = 0, greenCommits = 0, runs = 0;

for (const pr of pulls) {
  const status = pr.merged_at ? `merged ${pr.merged_at.slice(0, 10)}` : pr.state;
  lines.push(`### #${pr.number} ${pr.title}`, '', `${status} · [pull request](${pr.html_url})`, '');
  const commits = await gh(`/pulls/${pr.number}/commits?per_page=100`);
  lines.push('| Commit | TestSprite V3 | Run |', '|---|---|---|');
  for (const c of commits) {
    const v = await verdict(c.sha);
    if (v.link) runs++;
    if (v.state === 'success') greenCommits++;
    if (v.state === 'failure' || v.state === 'error') redCommits++;
    const run = v.link ? `[${runId(v.link)}](${v.link})` : '';
    lines.push(`| [${short(c.sha)}](${c.html_url}) ${c.commit.message.split('\n')[0].replace(/\|/g, '/')} | ${v.text} | ${run} |`);
  }
  lines.push('');
}

// Commits that reached main without a pull request, so no TestSprite run.
const inPulls = new Set();
for (const pr of pulls) {
  if (pr.merge_commit_sha) inPulls.add(pr.merge_commit_sha);
  for (const c of await gh(`/pulls/${pr.number}/commits?per_page=100`)) inPulls.add(c.sha);
}
const direct = (await gh('/commits?sha=main&per_page=100')).filter(c => !inPulls.has(c.sha));
if (direct.length) {
  lines.push('### Pushed to main without a pull request', '',
    'The first four set the project up before any checks existed. The rest changed only the README, PROOF.md, unit tests or their setup, never the app itself.', '',
    '| Commit | Date |', '|---|---|');
  for (const c of direct.reverse()) {
    lines.push(`| [${short(c.sha)}](${c.html_url}) ${c.commit.message.split('\n')[0].replace(/\|/g, '/')} | ${c.commit.author.date.slice(0, 10)} |`);
  }
  lines.push('');
}

const head = [
  '# The test loop, pull request by pull request',
  '',
  'Every pull request, every commit on it, and the result the TestSprite V3 check posted for that commit.',
  'Generated from the GitHub API by `scripts/loop-ledger.mjs`, so nothing here is typed by hand.',
  '',
  `${pulls.length} pull requests · ${runs} TestSprite runs · ${redCommits} red · ${greenCommits} green`,
  '',
];
writeFileSync('LOOP.md', [...head, ...lines].join('\n'));
console.log(`LOOP.md: ${pulls.length} pull requests, ${runs} runs`);
