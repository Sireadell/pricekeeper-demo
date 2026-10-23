// Small helpers shared by the scripts that read TestSprite results.
// They call the TestSprite command line (npm i -g @testsprite/testsprite-cli),
// which reads its key from TESTSPRITE_API_KEY.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const PROJECT = process.env.TESTSPRITE_PROJECT_ID || '81dc7004-270e-42bb-96d2-a47ea8b1b818';

// Every test in the suite, browser and server, from testsprite_tests/test-ids.json.
// Tests not yet created in TestSprite have no id and are left out.
export function suite() {
  const url = new URL('../../testsprite_tests/test-ids.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'))
    .map(t => ({ ...t, kind: t.kind || 'browser' }))
    .filter(t => t.id);
}

export async function ts(...args) {
  // `test wait` exits 1 for a failed run but still prints the run, so the
  // output is read either way.
  const { stdout } = await run('testsprite', ['--output', 'json', ...args], {
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32',
  }).catch(err => (err.stdout ? err : Promise.reject(err)));
  // Some commands print a second JSON object (a next-step hint) after the
  // answer; keep only the first.
  const end = stdout.search(/^}\s*$/m);
  return JSON.parse(end === -1 ? stdout : stdout.slice(0, end + 1));
}

// Runs fn over items, a few at a time, keeping the input order.
export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// What a finished run reported: the first plain sentence of TestSprite's
// explanation (skipping its "TEST FAILURE" heading), and a link to the run.
export async function runDetail(runId) {
  try {
    const r = await ts('test', 'wait', runId, '--timeout', '5');
    const text = typeof r.error === 'string' ? r.error : r.summary || '';
    const said = text.split(/\n+/).map(l => l.trim()).find(l => l && !/^TEST (FAILURE|BLOCKED)/i.test(l)) || '';
    return { said, link: r.executionUrl || '' };
  } catch {
    return { said: '', link: '' };
  }
}

export const testPage = id => `https://www.testsprite.com/dashboard/tests/${PROJECT}/test/${id}`;

// The step a failed run stopped on, in the words TestSprite recorded.
export async function failedStep(testId, runId) {
  try {
    const { items = [] } = await ts('test', 'steps', testId, '--run-id', runId);
    const bad = items.find(s => s.status === 'failed' || s.outcomeContributesToFailure)
             || items.findLast?.(s => s.status !== 'passed');
    return bad ? `Step ${bad.stepIndex}: ${bad.description}` : '';
  } catch {
    return '';
  }
}
