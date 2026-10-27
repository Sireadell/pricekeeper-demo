// More checks on the small helpers behind the money screens: how amounts are
// shown, how a sale's paid and owing figures are worked out, and how stock
// units convert. Runs offline with Node's built-in test runner, no packages.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
beforeEach(() => store.clear());

const U = await import('../js/utils.js');
const { netPaid, deriveSaleTotals, normalizeSale, normalizeSales } =
  await import('../js/sale-derive.js');
const { ppc, ppr, piecesPerUnit, stockPcs, computeWac, recalcThreshold } =
  await import('../js/inventory-math.js');

// Showing amounts

test('fmt: thousands get commas and the naira sign', () => {
  assert.equal(U.fmt(5000), '₦5,000');
  assert.equal(U.fmt(1234567), '₦1,234,567');
});

test('fmt: blank and null give zero', () => {
  assert.equal(U.fmt(), '₦0');
  assert.equal(U.fmt(null), '₦0');
});

test('fmt: kobo are rounded to a whole naira', () => {
  assert.equal(U.fmt(10.4), '₦10');
  assert.equal(U.fmt(10.6), '₦11');
});

test('fmtSpan wraps only the naira sign, once', () => {
  const s = U.fmtSpan(2500);
  assert.equal(s, '<span class="currency">₦</span>2,500');
  assert.equal(s.split('₦').length - 1, 1);
});

test('fmtCompact: K, M and B steps', () => {
  assert.equal(U.fmtCompact(999), '999');
  assert.equal(U.fmtCompact(1000), '1K');
  assert.equal(U.fmtCompact(1500), '1.5K');
  assert.equal(U.fmtCompact(2500000), '2.5M');
  assert.equal(U.fmtCompact(3000000000), '3B');
});

test('fmtCompact: a minus amount keeps its sign', () => {
  assert.equal(U.fmtCompact(-1500), '-1.5K');
  assert.equal(U.fmtCompact(-2000000), '-2M');
});

test('fmtCompact: blank gives 0', () => {
  assert.equal(U.fmtCompact(), '0');
  assert.equal(U.fmtCompact(null), '0');
});

// Margin and profit

test('pct: margin on cost to one decimal place', () => {
  assert.equal(U.pct(100, 130), '30.0');
  assert.equal(U.pct(300, 400), '33.3');
});

test('pct: no cost gives 0.0 instead of a divide by zero', () => {
  assert.equal(U.pct(0, 500), '0.0');
  assert.equal(U.pct(undefined, 500), '0.0');
});

test('pct: selling under cost is a negative margin', () => {
  assert.equal(U.pct(200, 150), '-25.0');
});

test('profit: per piece times quantity', () => {
  assert.equal(U.profit(100, 130, 5), 150);
  assert.equal(U.profit(100, 130), 30);
});

test('profit: a loss is negative, and a zero quantity counts as one', () => {
  assert.equal(U.profit(130, 100, 2), -60);
  assert.equal(U.profit(100, 150, 0), 50);
});

// Items missing information

test('itemNeedsCost: any positive cost field is enough', () => {
  assert.equal(U.itemNeedsCost({ cartonBuy: '5000' }), false);
  assert.equal(U.itemNeedsCost({ buy: 12 }), false);
  assert.equal(U.itemNeedsCost({ cost: '1' }), false);
});

test('itemNeedsCost: empty, zero or missing item needs a cost', () => {
  assert.equal(U.itemNeedsCost({}), true);
  assert.equal(U.itemNeedsCost({ buyPrice: 0, buy: '' }), true);
  assert.equal(U.itemNeedsCost(null), true);
});

test('itemNeedsStock: only tracked items with no stock set', () => {
  assert.equal(U.itemNeedsStock({ trackStock: true, stockQty: null }), true);
  assert.equal(U.itemNeedsStock({ trackStock: true, stockQty: 0 }), false);
  assert.equal(U.itemNeedsStock({ trackStock: false, stockQty: null }), false);
  assert.equal(U.itemNeedsStock(null), false);
});

// Text safety

test('escapeHtml: turns page-breaking characters into safe text', () => {
  assert.equal(U.escapeHtml('<b>"Tom" & \'Jo\'</b>'),
    '&lt;b&gt;&quot;Tom&quot; &amp; &#039;Jo&#039;&lt;/b&gt;');
});

test('escapeHtml: a non-text value gives an empty string', () => {
  assert.equal(U.escapeHtml(42), '');
  assert.equal(U.escapeHtml(undefined), '');
});

test('csvCell: quotes are doubled and the cell is wrapped', () => {
  assert.equal(U.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(U.csvCell(null), '""');
});

test('csvCell: text that would run as a spreadsheet formula is defused', () => {
  assert.equal(U.csvCell('=SUM(A1:A9)'), '"\'=SUM(A1:A9)"');
  assert.equal(U.csvCell('@cmd'), '"\'@cmd"');
});

test('csvCell: plain numbers, including minus ones, are left alone', () => {
  assert.equal(U.csvCell(-500), '"-500"');
  assert.equal(U.csvCell('-12.5'), '"-12.5"');
});

// Dates and labels

test('isoDate: pads month and day', () => {
  assert.equal(U.isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(U.isoDate(new Date(2026, 11, 31)), '2026-12-31');
});

test('daysAgo: today, yesterday, then a count of days', () => {
  const day = 86400000;
  assert.equal(U.daysAgo(Date.now() - 1000), 'today');
  assert.equal(U.daysAgo(Date.now() - day - 1000), 'yesterday');
  assert.equal(U.daysAgo(Date.now() - 5 * day - 1000), '5 days ago');
});

test('daysAgo: no time gives the fallback', () => {
  assert.equal(U.daysAgo(0), '');
  assert.equal(U.daysAgo(null, 'never'), 'never');
});

test('unitShort: known units are shortened, others pass through', () => {
  assert.equal(U.unitShort('carton'), 'ctn');
  assert.equal(U.unitShort('piece'), 'pc');
  assert.equal(U.unitShort('bag'), 'bag');
  assert.equal(U.unitShort(), 'unit');
});

// A sale's paid and owing figures

test('netPaid: refunds subtract and removed payments count for nothing', () => {
  const sale = { payments: [
    { amount: 1000 },
    { amount: 300, type: 'refund' },
    { amount: 999, removed: true },
  ] };
  assert.equal(netPaid(sale), 700);
});

test('netPaid: no payments, or no sale, is zero', () => {
  assert.equal(netPaid({}), 0);
  assert.equal(netPaid(null), 0);
});

test('netPaid: kobo are added without floating point drift', () => {
  assert.equal(netPaid({ payments: [{ amount: 0.1 }, { amount: 0.2 }] }), 0.3);
});

test('deriveSaleTotals: unpaid, part paid and fully paid', () => {
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 800, payments: [] }),
    { amountReceived: 0, balanceOwing: 800, paymentStatus: 'credit' });
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 800, payments: [{ amount: 300 }] }),
    { amountReceived: 300, balanceOwing: 500, paymentStatus: 'partial' });
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 800, payments: [{ amount: 800 }] }),
    { amountReceived: 800, balanceOwing: 0, paymentStatus: 'paid' });
});

test('deriveSaleTotals: an overpayment owes nothing and keeps the real amount', () => {
  const t = deriveSaleTotals({ totalRevenue: 500, payments: [{ amount: 700 }] });
  assert.equal(t.balanceOwing, 0);
  assert.equal(t.amountReceived, 700);
  assert.equal(t.paymentStatus, 'paid');
});

test('deriveSaleTotals: falls back to revenue when there is no total', () => {
  assert.equal(deriveSaleTotals({ revenue: 400, payments: [] }).balanceOwing, 400);
});

test('normalizeSale: replaces a wrong saved balance and leaves the input alone', () => {
  const sale = { id: 's1', totalRevenue: 1000, balanceOwing: 0, payments: [{ amount: 400 }] };
  const warn = console.warn; console.warn = () => {};
  let out;
  try { out = normalizeSale(sale); } finally { console.warn = warn; }
  assert.equal(out.balanceOwing, 600);
  assert.equal(out._pkCacheDrift, 600);
  assert.equal(sale.balanceOwing, 0);
});

test('normalizeSale: a sale whose saved figures are right shows no drift', () => {
  const out = normalizeSale({ id: 's2', totalRevenue: 1000, balanceOwing: 600, payments: [{ amount: 400 }] });
  assert.equal(out._pkCacheDrift, 0);
});

test('normalizeSales: a missing list gives an empty list', () => {
  assert.deepEqual(normalizeSales(undefined), []);
  assert.equal(normalizeSale(null), null);
});

// Stock units

test('ppr and piecesPerUnit: unknown unit counts as one piece', () => {
  assert.equal(ppr({ piecesPerRow: '12' }), 12);
  assert.equal(ppr({}), 1);
  assert.equal(piecesPerUnit({ piecesPerCarton: 24 }, 'piece'), 1);
  assert.equal(piecesPerUnit({ piecesPerCarton: 24 }, 'carton'), 24);
});

test('ppc: a zero or minus carton size is ignored', () => {
  assert.equal(ppc({ piecesPerCarton: 0, cartonQty: 10 }), 10);
  assert.equal(ppc({ piecesPerCarton: -5 }), 1);
});

test('stockPcs: a stored piece count wins, even if it is zero', () => {
  assert.equal(stockPcs({ stockQtyPcs: 0, stockQty: 5, piecesPerCarton: 10 }), 0);
});

test('stockPcs: older items convert from their stock unit', () => {
  assert.equal(stockPcs({ stockQty: 3, stockUnit: 'carton', piecesPerCarton: 12 }), 36);
  assert.equal(stockPcs({}), 0);
});

test('computeWac: blends old and new cost by number of pieces', () => {
  const item = { stockQtyPcs: 10, buy: 100, buyUnit: 'piece' };
  assert.deepEqual(computeWac(item, 10, 200, 'piece'), { wacPc: 150, wacBuyUnit: 150 });
});

test('computeWac: first purchase uses the new price', () => {
  assert.equal(computeWac({ buyUnit: 'piece' }, 5, 80, 'piece').wacPc, 80);
});

test('recalcThreshold: marks low when stock is at or under the alert level', () => {
  const r = recalcThreshold({ stockUnit: 'piece' }, 10);
  assert.equal(r.lowThresholdPcs, 2);
  assert.equal(r.low, false);
  assert.equal(recalcThreshold({ stockUnit: 'piece' }, 1).low, true);
});

test('recalcThreshold: honours the owner alert percentage', () => {
  store.set('pkLowStockPct', '50');
  const r = recalcThreshold({ stockUnit: 'piece' }, 10);
  assert.equal(r.lowThresholdPcs, 5);
  assert.equal(r.low, false);
  assert.equal(recalcThreshold({ stockUnit: 'piece' }, 7).lowThresholdPcs, 4);
});
