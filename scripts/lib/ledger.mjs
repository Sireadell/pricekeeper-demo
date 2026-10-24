// Reads every pull request, every commit on it, and what the TestSprite V3
// check said about that commit, from the GitHub API. Used by LOOP.md and by
// the proof page.
import { execSync } from 'node:child_process';

const REPO = process.env.GITHUB_REPOSITORY || 'Sireadell/pricekeeper-demo';
const TOKEN = process.env.GITHUB_TOKEN || execSync('gh auth token').toString().trim();

export async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function verdict(sha) {
  const { statuses } = await gh(`/commits/${sha}/status`);
  const ts = statuses.find(s => s.context === 'TestSprite V3');
  if (!ts) return { text: 'not run', state: '', link: '' };
  return { text: ts.description || ts.state, state: ts.state, link: ts.target_url };
}

export async function collectLedger() {
  const pulls = (await gh('/pulls?state=all&per_page=100')).sort((a, b) => a.number - b.number);
  const inPulls = new Set();
  const out = [];
  for (const pr of pulls) {
    if (pr.merge_commit_sha) inPulls.add(pr.merge_commit_sha);
    const commits = [];
    for (const c of await gh(`/pulls/${pr.number}/commits?per_page=100`)) {
      inPulls.add(c.sha);
      commits.push({
        sha: c.sha,
        url: c.html_url,
        title: c.commit.message.split('\n')[0],
        check: await verdict(c.sha),
      });
    }
    out.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at ? 'merged' : pr.state,
      mergedAt: pr.merged_at,
      commits,
    });
  }
  // Commits that reached main without a pull request, so no TestSprite run.
  const direct = (await gh('/commits?sha=main&per_page=100'))
    .filter(c => !inPulls.has(c.sha))
    .reverse()
    .map(c => ({ sha: c.sha, url: c.html_url, title: c.commit.message.split('\n')[0], date: c.commit.author.date }));
  const all = out.flatMap(p => p.commits);
  const totals = {
    pulls: out.length,
    runs: all.filter(c => c.check.link).length,
    red: all.filter(c => c.check.state === 'failure' || c.check.state === 'error').length,
    green: all.filter(c => c.check.state === 'success').length,
  };
  return { pulls: out, direct, totals };
}
