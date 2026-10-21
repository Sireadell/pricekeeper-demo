// Small helpers: spreadsheet cells, safe text, unit labels, dates and saved
// settings. Runs offline with Node's built-in test runner.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
beforeEach(() => store.clear());

const {
  csvCell, escapeHtml, unitShort, daysAgo, isoDate, fmt, safe, getAppSetting, setAppSetting,
} = await import('../js/utils.js');

test('spreadsheet cells are quoted and cannot run as formulas', () => {
  assert.equal(csvCell('hello'), '"hello"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('@cmd'), '"\'@cmd"');
  assert.equal(csvCell('-abc'), '"\'-abc"');
  assert.equal(csvCell('-5'), '"-5"');
  assert.equal(csvCell(5), '"5"');
  assert.equal(csvCell(null), '""');
});

test('customer text is made safe before it goes on a page', () => {
  assert.equal(escapeHtml('<b>"x"&\'y</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#039;y&lt;/b&gt;');
  assert.equal(escapeHtml(42), '');
  assert.equal(escapeHtml(undefined), '');
});

test('unit short names', () => {
  assert.equal(unitShort('carton'), 'ctn');
  assert.equal(unitShort('row'), 'row');
  assert.equal(unitShort('piece'), 'pc');
  assert.equal(unitShort('bag'), 'bag');
  assert.equal(unitShort(undefined), 'unit');
});

test('days ago reads like a person would say it', () => {
  const DAY = 86400000;
  assert.equal(daysAgo(0), '');
  assert.equal(daysAgo(null, 'never'), 'never');
  assert.equal(daysAgo(Date.now() - 1000), 'today');
  assert.equal(daysAgo(Date.now() - DAY - 1000), 'yesterday');
  assert.equal(daysAgo(Date.now() - 3 * DAY - 1000), '3 days ago');
});

test('dates are written year-month-day with zero padding', () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(isoDate(new Date(2026, 11, 31)), '2026-12-31');
});

test('naira amounts round to the whole naira', () => {
  assert.equal(fmt(1234.6), '₦1,235');
  assert.equal(fmt(1234567), '₦1,234,567');
  assert.equal(fmt(undefined), '₦0');
});

test('saved lists never crash the app, even when the saved text is damaged', () => {
  localStorage.setItem('pkItems', '[{"id":1}]');
  assert.deepEqual(safe('pkItems'), [{ id: 1 }]);
  localStorage.setItem('pkItems', '{not json');
  assert.deepEqual(safe('pkItems'), []);
  assert.deepEqual(safe('missing'), []);
});

test('saved settings: default, round trip, and damaged data falls back', () => {
  assert.equal(getAppSetting('theme', 'light'), 'light');
  setAppSetting('theme', 'dark');
  assert.equal(getAppSetting('theme', 'light'), 'dark');
  assert.equal(getAppSetting('other', 7), 7);
  localStorage.setItem('pkSettings', '{broken');
  assert.equal(getAppSetting('theme', 'light'), 'light');
});
