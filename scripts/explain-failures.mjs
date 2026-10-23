// Explains a red TestSprite run in plain words: which tests failed, the step
// each one stopped on, and what TestSprite saw there. It writes failures.md,
// adds it to the GitHub job summary, and posts it where people will see it.
//
//   SHA       commit the run was for (required)
//   PR        pull request number; looked up from SHA when left out
//   POST      comment (on the pull request, default), issue, or none
//   KIND      browser, server or all (default)
//   CODES     only these tests, e.g. "TS01 TS07 B05"
//   ENV_NAME  only runs in this TestSprite environment; on a pull request,
//             browser runs default to github-pr-<PR>, the one the GitHub App uses
//   SINCE     only runs started after this time; defaults to the commit's time
//   UNTIL     only runs started before this time; defaults to when the
//             TestSprite V3 check on this commit finished, if it has
//   RUN_URL   link to the whole run; defaults to that check's link
//   TITLE     heading for the report
import { appendFileSync, writeFileSync } from 'node:fs';
import { suite, ts, pool, testPage, failedStep, runDetail } from './lib/testsprite.mjs';

const env = process.env;
const REPO = env.GITHUB_REPOSITORY || 'Sireadell/pricekeeper-demo';
const MARK = '<!-- testsprite-explainer -->';

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const sha = env.SHA;
if (!sha) throw new Error('SHA is required');
const commit = await gh(`/commits/${sha}`);
const pr = env.PR || (await gh(`/commits/${sha}/pulls`))[0]?.number || '';
const since = env.SINCE || commit.commit.committer.date;
const check = (await gh(`/commits/${sha}/statuses?per_page=100`))
  .find(s => s.context === 'TestSprite V3' && s.state !== 'pending');
const until = env.UNTIL || check?.updated_at || '9999';
const runUrl = env.RUN_URL || check?.target_url || '';
const codes = env.CODES ? env.CODES.split(/[\s,]+/) : null;
const tests = suite()
  .filter(t => !env.KIND || env.KIND === 'all' || t.kind === env.KIND)
  .filter(t => !codes || codes.includes(t.code));

const results = await pool(tests, 6, async t => {
  const wanted = env.ENV_NAME || (pr && t.kind === 'browser' ? `github-pr-${pr}` : '');
  const { runs = [] } = await ts('test', 'result', t.id, '--history');
  const run = runs
    .filter(r => r.createdAt >= since && r.createdAt <= until && (!wanted || r.environment?.name === wanted))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!run) return { t, state: 'not run' };
  if (run.status === 'passed') return { t, state: 'passed', run };
  const [step, { said, link }] = await Promise.all([failedStep(t.id, run.runId), runDetail(run.runId)]);
  return { t, state: run.status, run, step, said, link };
});

const ran = results.filter(r => r.state !== 'not run');
const bad = ran.filter(r => r.state !== 'passed');
const cell = s => (s || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const short = sha.slice(0, 7);
const lines = [MARK, `### ${env.TITLE || 'TestSprite results, in plain words'}`, ''];

if (!ran.length) {
  lines.push(`No TestSprite results found yet for [${short}](${commit.html_url}).`);
} else if (!bad.length) {
  lines.push(`All ${ran.length} tests passed on [${short}](${commit.html_url}).${runUrl ? ` [Full run](${runUrl})` : ''}`);
} else {
  lines.push(
    `${bad.length} of ${ran.length} tests did not pass on [${short}](${commit.html_url}).${runUrl ? ` [Full run](${runUrl})` : ''}`,
    '',
    '| Test | Result | Where it stopped | What TestSprite saw |',
    '|---|---|---|---|',
    ...bad.map(r => `| [${r.t.code} ${cell(r.t.name)}](${r.link || testPage(r.t.id)}) | ${r.state} | ${cell(r.step) || 'not recorded'} | ${cell(r.said) || 'see the test page'} |`),
    '',
    'Each test name opens that run in TestSprite, with the video and a screenshot of every step.',
    '',
    '<details><summary>What each failed test checks</summary>',
    '',
    ...bad.map(r => `- **${r.t.code}** ${cell(r.t.description)} (\`testsprite_tests/${r.t.file}\`)`),
    '',
    '</details>',
  );
}
const body = lines.join('\n') + '\n';
writeFileSync(env.OUT || 'failures.md', body);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, body.replace(MARK, ''));
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `failed=${bad.length}\nran=${ran.length}\npr=${pr}\n`);
console.log(body);

const post = env.POST || 'comment';
if (post === 'comment' && pr) {
  const comments = await gh(`/issues/${pr}/comments?per_page=100`);
  const old = comments.find(c => c.body?.startsWith(MARK));
  // A green run only updates an earlier explanation; it never adds a new comment.
  if (old) await gh(`/issues/comments/${old.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  else if (bad.length) await gh(`/issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
} else if (post === 'issue') {
  const title = env.TITLE || 'TestSprite check failed';
  const open = (await gh(`/issues?state=open&labels=testsprite&per_page=100`)).find(i => i.title === title);
  if (open && bad.length) await gh(`/issues/${open.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  else if (open) await gh(`/issues/${open.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) })
    .then(() => gh(`/issues/${open.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }));
  else if (bad.length) await gh('/issues', { method: 'POST', body: JSON.stringify({ title, body, labels: ['testsprite'] }) });
}
