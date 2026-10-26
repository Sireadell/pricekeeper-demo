// Mutation score for the money maths. It changes one thing at a time in a
// maths file (a + becomes a -, a > becomes a >=, and so on), runs the unit
// tests, and counts how many of those wrong versions the tests catch.
// A caught change is "killed". One that slips through is "survived", and
// means a test is missing, unless it is listed in SAME_RESULT below: a change
// shown to give exactly the same answer for every input, so no test can
// catch it. Those still count as survived, marked with the reason.
// Run: node scripts/mutation.mjs [file ...]   (default: the three maths files)
// No packages needed. The original file is always put back.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['js/sale-derive.js', 'js/inventory-math.js', 'js/ledger.js'];

const SWAPS = [
  ['>=', '>'], ['<=', '<'], ['>', '>='], ['<', '<='],
  ['===', '!=='], ['!==', '==='],
  ['&&', '||'], ['||', '&&'],
  ['+', '-'], ['-', '+'], ['*', '/'], ['/', '*'],
  ['Math.min', 'Math.max'], ['Math.max', 'Math.min'],
  ['true', 'false'], ['false', 'true'],
];

// Changes that give the same answer for every input, with the reason.
// Matched on the file, the swap and the exact line of code, so an edit to
// that line drops the mark and the change is reported as a missing test again.
const SAME_RESULT = [
  { file: 'js/ledger.js', from: '<=', to: '<', text: 'if (left <= 0) break;',
    why: 'When exactly 0 is left the loop goes on, but every later payment is then 0 and the next line skips it, so nothing is paid differently.' },
  { file: 'js/ledger.js', from: '<=', to: '<', text: 'if (pay <= 0) continue;',
    why: 'A payment can only be 0 when nothing is left, and the line above has already stopped the loop by then. Every trade in the list owes at least 0.01.' },
  { file: 'js/ledger.js', from: '>=', to: '>', text: "if (!matches && choice === 'business' && Math.abs(diff) >= 0.01) {",
    why: 'This only runs when the two totals do not match, which means the gap is at least one naira, so the 0.01 check passes either way.' },
  { file: 'js/ledger.js', from: '>', to: '>=', text: "bucket: diff > 0 ? 'noTrade' : 'held',",
    why: 'The gap is never 0 here (it is at least one naira), so both versions pick the same side.' },
  { file: 'js/ledger.js', from: '>', to: '>=', text: "name: diff > 0 ? 'Opening balance · no trade' : 'Opening balance · held for them',",
    why: 'The gap is never 0 here (it is at least one naira), so both versions pick the same name.' },
];

// Find every place a swap can be made, skipping comments and strings.
function sites(src) {
  const out = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (two === '/*') { i = src.indexOf('*/', i) + 2; continue; }
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; }
      i++; continue;
    }
    for (const [from, to] of SWAPS) {
      if (!src.startsWith(from, i)) continue;
      const before = src[i - 1] || ' ', after = src[i + from.length] || ' ';
      const word = /[a-z]/i.test(from[0]);
      if (word && (/\w/.test(before) || /\w/.test(after))) continue;
      // keep "+" and "-" to real arithmetic: not ++, --, +=, -=, => or a sign
      if ((from === '+' || from === '-') && (after === from || after === '=' || before === from || (from === '-' && after === '>'))) continue;
      if (from === '-' && !/[\w)\]]\s*$/.test(src.slice(Math.max(0, i - 6), i))) continue;
      if ((from === '*' || from === '/') && (after === from || after === '=' || before === from || after === '*' || before === '*')) continue;
      if ((from === '>' || from === '<') && (after === '=' || before === '=' || before === '-' || before === '>' || before === '<' || after === '>' || after === '<')) continue;
      out.push({ at: i, from, to, line });
      break;
    }
    i++;
  }
  return out;
}

function runTests() {
  const r = spawnSync(process.execPath, ['--test', ...readdirSync('tests').filter(f => f.endsWith('.test.js')).map(f => 'tests/' + f)], { encoding: 'utf8', timeout: 60000 });
  return r.status === 0;
}

if (!runTests()) { console.error('The tests fail before any change. Fix that first.'); process.exit(2); }

const report = [];
let killed = 0, survived = 0;
for (const file of FILES) {
  const original = readFileSync(file, 'utf8');
  const list = sites(original);
  let k = 0, s = 0;
  console.log(`${file}: ${list.length} changes to try`);
  try {
    for (const m of list) {
      writeFileSync(file, original.slice(0, m.at) + m.to + original.slice(m.at + m.from.length));
      if (runTests()) {
        s++;
        const fullText = original.split('\n')[m.line - 1].trim();
        const text = fullText.slice(0, 90);
        const col = m.at - original.lastIndexOf('\n', m.at - 1);
        const same = SAME_RESULT.find(e => e.file === file && e.from === m.from && e.to === m.to && e.text === fullText);
        report.push({ file, line: m.line, col, from: m.from, to: m.to, text, ...(same ? { sameResult: same.why } : {}) });
        console.log(`  survived  line ${m.line}:${col}: ${m.from} -> ${m.to}   ${text}${same ? '   (same result for every input)' : ''}`);
      } else k++;
    }
  } finally {
    writeFileSync(file, original);
  }
  killed += k; survived += s;
  console.log(`  ${file}: ${k} killed, ${s} survived`);
}

const total = killed + survived;
const score = total ? Math.round((killed / total) * 1000) / 10 : 0;
const sameResult = report.filter(r => r.sameResult).length;
const canBeCaught = total - sameResult;
const scoreOfCatchable = canBeCaught ? Math.round((killed / canBeCaught) * 1000) / 10 : 0;
console.log(`\nMutation score: ${score}% (${killed} killed of ${total})`);
console.log(`Of the ${canBeCaught} changes that alter a result, ${killed} are caught (${scoreOfCatchable}%). ${sameResult} give the same result for every input.`);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/mutation.json', JSON.stringify({ score, killed, survived, total, sameResult, canBeCaught, scoreOfCatchable, survivors: report }, null, 2) + '\n');
