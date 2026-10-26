// Mutation score for the money maths. It changes one thing at a time in a
// maths file (a + becomes a -, a > becomes a >=, and so on), runs the unit
// tests, and counts how many of those wrong versions the tests catch.
// A caught change is "killed". One that slips through is "survived", and
// means a test is missing, unless it is listed in SAME_RESULT below: a change
// shown to give exactly the same answer for every input, so no test can
// catch it. Those still count as survived, marked with the reason.
// Run: node scripts/mutation.mjs [file ...]   (default: every file listed below)
// No packages needed. The original file is always put back.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['js/sale-derive.js', 'js/inventory-math.js', 'js/ledger.js', 'js/insights-engine.js', 'js/utils.js', 'js/pending-overlay.js'];

// Some files mix maths with screen code (pop-ups, buttons) that no unit test
// reaches. For those, only the listed stretches are changed: each pair is the
// text that starts a stretch and the text that ends it (the end is not
// included). A file not listed here is changed everywhere.
const SCOPE = {
  'js/utils.js': [
    ['export const fmt =', 'export function askConfirm'],
    ['export const today =', 'export function openModal'],
    ['export function findBorrowerByName', 'export function safe'],
    ['export const lowStockPct', 'export function getAppSetting'],
    ['export function daysAgo', 'export const CSV_BOM'],
  ],
  // The waiting-saves list and how it is laid over the database copy. Not the
  // parts that read the phone's store or touch the page (refreshPending,
  // _clearSentFlags): no unit test reaches those.
  'js/pending-overlay.js': [
    ['function _add', 'async function _activeUid'],
    ['export function hasPending', "window.addEventListener('pkOfflineWrite'"],
    ['export function notePending', null],
  ],
};

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
  { file: 'js/insights-engine.js', from: '>', to: '>=', text: 'const margin   = revenue > 0 ? (profit / revenue) * 100 : (profit < 0 ? -100 : 0);',
    why: 'The margin is only looked at when the revenue is above 0 (the thin-margin check needs that), so what it is worked out as for a revenue of exactly 0 is never used.' },
  { file: 'js/insights-engine.js', from: '<', to: '<=', text: 'const margin   = revenue > 0 ? (profit / revenue) * 100 : (profit < 0 ? -100 : 0);',
    why: 'This branch is for a revenue of 0 or less, where the margin is never looked at (the thin-margin check needs revenue above 0), so the figure picked here is never used.' },
  { file: 'js/insights-engine.js', from: '>', to: '>=', text: 'return ppc > 1 ? parseFloat(item.cartonBuy) / ppc : parseFloat(item.cartonBuy);',
    why: 'With one piece in a carton, dividing the carton price by 1 gives the carton price, the same as the other side.' },
  { file: 'js/insights-engine.js', from: '>', to: '>=', text: "if (item.buyUnit === 'carton' && ppc > 1) return parseFloat(item.buyPrice) / ppc;",
    why: 'With one piece in a carton, dividing by 1 gives the buy price, and skipping the line also ends on the buy price (the row line below does not apply to a carton).' },
  { file: 'js/insights-engine.js', from: '>', to: '>=', text: "if (item.buyUnit === 'row') return ppr > 0 ? parseFloat(item.buyPrice) / ppr : parseFloat(item.buyPrice);",
    why: 'The pieces in a row is never exactly 0 here (a 0 or missing figure is turned into 1 earlier), so the two checks agree for every value.' },
  { file: 'js/insights-engine.js', from: '>', to: '>=', text: 'if (parseFloat(item.rowSell) > 0 && ppr > 1)    return parseFloat(item.rowSell) / ppr;',
    why: 'A row price of exactly 0 gives 0 divided by the row size, which is 0, the same as carrying on to the final 0.' },
  { file: 'js/insights-engine.js', from: '>', to: '>=', text: 'if (lastSale.get(ln.itemId) == null || ts > lastSale.get(ln.itemId)) lastSale.set(ln.itemId, ts);',
    why: 'When a sale has exactly the same time as the one already kept, saving it again stores the same time.' },
  { file: 'js/pending-overlay.js', from: '&&', to: '||', text: "(writes || []).forEach(w => _add(_byCol, { ...w, payload: w.payload && typeof w.payload === 'object' ? { ...w.payload } : w.payload }));",
    why: 'The two sides only differ for a payload that is empty or not an object, and the next step stores a copy of whatever it gets, which comes out the same either way.' },
  { file: 'js/pending-overlay.js', from: '===', to: '!==', text: "(writes || []).forEach(w => _add(_byCol, { ...w, payload: w.payload && typeof w.payload === 'object' ? { ...w.payload } : w.payload }));",
    why: 'The next step (_add) copies the payload again before storing it, so whether this line passes on a copy or the original object, the stored record is the same.' },
];

// Find every place a swap can be made, skipping comments and strings.
function sites(src, ranges) {
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
    if (ranges && !ranges.some(([a, b]) => i >= a && i < b)) { i++; continue; }
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
  const ranges = SCOPE[file] && SCOPE[file].map(([a, b]) => {
    const from = original.indexOf(a), to = b ? original.indexOf(b, from) : -1;
    if (from < 0) throw new Error(`SCOPE start not found in ${file}: ${a}`);
    return [from, to < 0 ? original.length : to];
  });
  const list = sites(original, ranges);
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
writeFileSync(process.env.MUTATION_OUT || 'docs/mutation.json', JSON.stringify({ score, killed, survived, total, sameResult, canBeCaught, scoreOfCatchable, survivors: report }, null, 2) + '\n');
