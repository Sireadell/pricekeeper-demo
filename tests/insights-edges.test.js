// Profit insights, the edge cases. Each test here pins down one rule that the
// main insights tests leave open: ties, exact limits, missing fields and old
// data shapes. Written to catch small wrong edits to js/insights-engine.js
// (see scripts/mutation.mjs). Runs offline with Node's built-in test runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  topBottomEarners, profitLeaks, salesTrends, deadStock, bestSupplierPerItem,
} from '../js/insights-engine.js';

const DAY = 86400000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 8, 1);
const sale = (ts, items, extra = {}) => ({ createdTs: ts, items, ...extra });
const JUNE = at(2026, 6, 10);

// ── top earners ──────────────────────────────────────────────

test('top earners: a profit that is not a number falls back to revenue minus cost', () => {
  const r = topBottomEarners([sale(JUNE, [{ itemId: 'a', revenue: 100, cost: 60, profit: 'abc' }])], '2026-06');
  assert.equal(r.ranked[0].profit, 40);
});

test('top earners: the item name is kept from the first line and filled in if it was missing', () => {
  const r = topBottomEarners([
    sale(JUNE, [{ itemId: 'a', itemName: 'First', revenue: 1, profit: 1 }, { itemId: 'b', revenue: 1, profit: 1 }]),
    sale(JUNE + 1, [{ itemId: 'a', itemName: 'Second', revenue: 1, profit: 1 }, { itemId: 'b', itemName: 'Late name', revenue: 1, profit: 1 }]),
    sale(JUNE + 2, [{ itemId: 'c', revenue: 1, profit: 1 }]),
    sale(JUNE + 3, [{ itemId: 'c', revenue: 1, profit: 1 }]),
  ], '2026-06');
  const name = id => r.ranked.find(x => x.itemId === id).itemName;
  assert.equal(name('a'), 'First');
  assert.equal(name('b'), 'Late name');
  assert.equal(name('c'), '');
});

test('top earners: the biggest profit comes first whatever order the sales were made in', () => {
  const r = topBottomEarners([sale(JUNE, [
    { itemId: 'a', revenue: 10, profit: 10 },
    { itemId: 'b', revenue: 100, profit: 100 },
    { itemId: 'c', revenue: 5, profit: -5 },
    { itemId: 'd', revenue: 50, profit: 50 },
  ])], '2026-06');
  assert.deepEqual(r.ranked.map(x => x.itemId), ['b', 'd', 'a', 'c']);
});

// ── profit leaks ─────────────────────────────────────────────

test('profit leaks: a discount is compared with the price before the discount', () => {
  // 850 paid after 150 off means 1000 before: 15 percent off, below the 20 percent line.
  const light = sale(JUNE, [{ itemId: 'a', revenue: 850, profit: 300, lineDiscount: 150 }]);
  assert.deepEqual(profitLeaks([light]), []);
  // The shop's own record of the price before discount wins when it is there.
  const stored = sale(JUNE, [{ itemId: 'a', revenue: 700, profit: 300, lineDiscount: 100, originalRevenue: 1000 }]);
  assert.deepEqual(profitLeaks([stored]), []);
  const heavy = sale(JUNE, [{ itemId: 'a', revenue: 700, profit: 300, lineDiscount: 300, originalRevenue: 1000 }]);
  assert.deepEqual(profitLeaks([heavy]).map(l => l.reasons), [['discount-heavy']]);
});

test('profit leaks: a discount of exactly the limit is flagged, with a limit you can change', () => {
  const s = sale(JUNE, [{ itemId: 'a', revenue: 800, profit: 300, lineDiscount: 200 }]);
  assert.equal(profitLeaks([s]).length, 1);
  assert.equal(profitLeaks([s], { discountHeavyRatio: 0.21 }).length, 0);
});

test('profit leaks: a line with no discount is never called discount-heavy, even with a zero limit', () => {
  const s = sale(JUNE, [{ itemId: 'a', revenue: 1000, profit: 500 }]);
  assert.deepEqual(profitLeaks([s], { discountHeavyRatio: 0 }), []);
});

test('profit leaks: a discount that cancels the price out is ignored', () => {
  const s = sale(JUNE, [{ itemId: 'a', revenue: -50, profit: 10, lineDiscount: 50 }]);
  assert.deepEqual(profitLeaks([s]), []);
});

test('profit leaks: a sale at exactly cost is a thin margin, not a loss', () => {
  const [r] = profitLeaks([sale(JUNE, [{ itemId: 'a', revenue: 100, profit: 0 }])]);
  assert.deepEqual(r.reasons, ['thin-margin']);
  assert.equal(r.belowCostLines, 0);
  assert.equal(r.belowCostLoss, 0);
  assert.equal(r.minMarginPct, 0);
});

test('profit leaks: a line with no revenue and no loss is not a leak', () => {
  assert.deepEqual(profitLeaks([sale(JUNE, [{ itemId: 'a', revenue: 0, profit: 0 }])]), []);
});

test('profit leaks: the lowest margin is kept and the name stays the first one given', () => {
  const [r] = profitLeaks([
    sale(JUNE, [{ itemId: 'a', itemName: 'First', revenue: 100, profit: 5 }]),
    sale(JUNE + 1, [{ itemId: 'a', itemName: 'Second', revenue: 100, profit: 2 }]),
    sale(JUNE + 2, [{ itemId: 'a', revenue: 100, profit: 8 }]),
    sale(JUNE + 3, [{ itemId: 'b', revenue: 100, profit: 8 }]),
    sale(JUNE + 4, [{ itemId: 'b', revenue: 100, profit: 8 }]),
  ]);
  assert.equal(r.itemId, 'a');
  assert.equal(r.minMarginPct, 2);
  assert.equal(r.thinLines, 3);
  assert.equal(r.itemName, 'First');
});

test('profit leaks: a name that was missing is filled in, and none at all stays empty', () => {
  const leaks = profitLeaks([
    sale(JUNE, [{ itemId: 'a', revenue: 100, profit: 5 }, { itemId: 'n', revenue: 100, profit: 5 }]),
    sale(JUNE + 1, [{ itemId: 'a', itemName: 'Late name', revenue: 100, profit: 5 }, { itemId: 'n', revenue: 100, profit: 5 }]),
  ]);
  assert.equal(leaks.find(l => l.itemId === 'a').itemName, 'Late name');
  assert.equal(leaks.find(l => l.itemId === 'n').itemName, '');
});

test('profit leaks: the biggest loss is listed first', () => {
  const leaks = profitLeaks([sale(JUNE, [
    { itemId: 'a', revenue: 100, profit: -5 },
    { itemId: 'b', revenue: 100, profit: -50 },
    { itemId: 'c', revenue: 100, profit: -20 },
  ])]);
  assert.deepEqual(leaks.map(l => l.itemId), ['b', 'c', 'a']);
});

test('profit leaks: with no losses, the thinnest margin comes first, and items with none come last', () => {
  const leaks = profitLeaks([sale(JUNE, [
    { itemId: 'a', revenue: 100, profit: 8 },
    { itemId: 'b', revenue: 100, profit: 3 },
    { itemId: 'c', revenue: 100, profit: 5 },
    { itemId: 'd', revenue: 100, profit: 50, lineDiscount: 100 },
  ])]);
  assert.deepEqual(leaks.map(l => l.itemId), ['b', 'c', 'a', 'd']);
});

test('profit leaks: with nothing else to tell them apart, the bigger discount comes first', () => {
  const leaks = profitLeaks([sale(JUNE, [
    { itemId: 'a', revenue: 400, profit: 200, lineDiscount: 100 },
    { itemId: 'b', revenue: 400, profit: 200, lineDiscount: 300 },
    { itemId: 'c', revenue: 400, profit: 200, lineDiscount: 200 },
  ])]);
  assert.deepEqual(leaks.map(l => l.itemId), ['b', 'c', 'a']);
});

// ── trends ───────────────────────────────────────────────────

test('trends: a sale with no lines still counts its total revenue', () => {
  const t = salesTrends([{ createdTs: JUNE, totalRevenue: 700 }, { createdTs: JUNE + 1 }]);
  assert.equal(t.monthly[0].revenue, 700);
  assert.equal(t.monthly[0].salesCount, 2);
});

// ── dead stock ───────────────────────────────────────────────

const tracked = extra => ({
  id: 'i1', name: 'Sugar', trackStock: true, stockQty: 10, stockUnit: 'piece',
  buyPrice: 100, buyUnit: 'piece', sell: 150, createdTs: NOW - 100 * DAY, ...extra,
});
const soldLine = (daysAgo, line, id = 'i1') => ({ createdTs: NOW - daysAgo * DAY, items: [{ itemId: id, ...line }] });
const only = (sales, items, opts) => deadStock(sales, items, { now: NOW, ...opts });

test('dead stock: the item name is passed on, and is empty when the item has none', () => {
  assert.equal(only([], [tracked()])[0].itemName, 'Sugar');
  assert.equal(only([], [tracked({ name: undefined })])[0].itemName, '');
});

test('dead stock: the pack size is worked out from rows and pieces per row', () => {
  const item = tracked({ stockUnit: 'carton', stockQty: 2, buyUnit: 'carton', buyPrice: 2400, rowsPerCarton: 4, piecesPerRow: 6 });
  const [r] = only([], [item]);
  // 24 pieces a carton: 2 cartons = 48 pieces at 100 each
  assert.equal(r.moneyTrapped, 4800);
});

test('dead stock: an item with no pack size is counted piece by piece', () => {
  const [r] = only([], [tracked({ stockUnit: 'carton', stockQty: 3, buyUnit: 'carton', buyPrice: 100 })]);
  assert.equal(r.moneyTrapped, 300);
});

test('dead stock: stock counted in rows uses the pieces in a row', () => {
  const [r] = only([], [tracked({ stockUnit: 'row', stockQty: 2, piecesPerRow: 6 })]);
  assert.equal(r.moneyTrapped, 1200);
  assert.equal(r.buyUnit, 'row');
});

test('dead stock: cost comes from the carton price, the unit price, then buy, then cost', () => {
  const base = { buyPrice: undefined, buyUnit: undefined, stockQty: 10 };
  // a price that is zero or below is skipped over, not used
  assert.equal(only([], [tracked({ ...base, cartonBuy: '0', buyPrice: 100 })])[0].moneyTrapped, 1000);
  assert.equal(only([], [tracked({ ...base, cartonBuy: '-50', buyPrice: 100 })])[0].moneyTrapped, 1000);
  assert.equal(only([], [tracked({ ...base, buyPrice: '0', buy: 80 })])[0].moneyTrapped, 800);
  assert.equal(only([], [tracked({ ...base, buyPrice: '-5', buy: 80 })])[0].moneyTrapped, 800);
  assert.equal(only([], [tracked({ ...base, buy: 80 })])[0].moneyTrapped, 800);
  assert.equal(only([], [tracked({ ...base, cost: 60 })])[0].moneyTrapped, 600);
  assert.equal(only([], [tracked({ ...base, buy: 80, cost: 60 })])[0].moneyTrapped, 800);
});

test('dead stock: a carton price or a row price is shared out over the pieces', () => {
  const carton = tracked({ buyPrice: 2400, buyUnit: 'carton', piecesPerCarton: 48, stockQty: 48 });
  assert.equal(only([], [carton])[0].moneyTrapped, 2400);
  const row = tracked({ buyPrice: 600, buyUnit: 'row', piecesPerRow: 6, stockQty: 6 });
  assert.equal(only([], [row])[0].moneyTrapped, 600);
  const piece = tracked({ buyPrice: 100, buyUnit: 'piece', piecesPerRow: 6, stockQty: 6 });
  assert.equal(only([], [piece])[0].moneyTrapped, 600);
});

test('dead stock: the selling price comes from the plain price, then the carton or row price', () => {
  const nopack = tracked({ sell: 0, cartonSell: 150 });
  assert.equal(only([], [nopack])[0].currentSell, 0);
  assert.equal(only([], [nopack])[0].suggestedSell, null);
  const norow = tracked({ sell: 0, rowSell: 150 });
  assert.equal(only([], [norow])[0].currentSell, 0);
  const cartonPack = tracked({ sell: 0, piecesPerCarton: 24, rowSell: 900, piecesPerRow: 6 });
  assert.equal(only([], [cartonPack])[0].currentSell, 150);
  const zeroCarton = tracked({ sell: 0, cartonSell: 0, piecesPerCarton: 24, rowSell: 900, piecesPerRow: 6 });
  assert.equal(only([], [zeroCarton])[0].currentSell, 150);
});

test('dead stock: a selling price equal to cost gets no clearance price', () => {
  const [r] = only([], [tracked({ sell: 100 })]);
  assert.equal(r.suggestedSell, null);
  assert.equal(r.discountPct, 0);
});

test('dead stock: the unit shown is carton if the item has a carton price or a pack size, else piece', () => {
  const plain = tracked({ stockUnit: undefined, buyUnit: undefined });
  assert.equal(only([], [plain])[0].buyUnit, 'piece');
  const cartonPriceOnly = tracked({ stockUnit: undefined, buyUnit: undefined, cartonSell: 100 });
  assert.equal(only([], [cartonPriceOnly])[0].buyUnit, 'carton');
  const packOnly = tracked({ stockUnit: undefined, buyUnit: undefined, piecesPerCarton: 12 });
  assert.equal(only([], [packOnly])[0].buyUnit, 'carton');
});

test('dead stock: the last sale sets the idle days, even if it is older than the window', () => {
  const sales = [soldLine(70, { qty: 1 }), soldLine(60, { qty: 1 }), soldLine(80, { qty: 1 })];
  const [r] = only(sales, [tracked()]);
  assert.equal(r.reason, 'idle');
  assert.equal(r.daysIdle, 60);
  assert.equal(r.unitsSoldInWindow, 0);
});

test('dead stock: a sale on the very first day of the window still counts as selling', () => {
  const [r] = only([soldLine(50, { qty: 1 })], [tracked({ stockQty: 99 })]);
  assert.equal(r.reason, 'slow');
  assert.equal(r.unitsSoldInWindow, 1);
});

test('dead stock: a sale of an item that is not in the list is ignored', () => {
  const sales = [soldLine(1, { qty: 3 }, 'ghost'), soldLine(5, { qty: 1 })];
  assert.deepEqual(only(sales, [tracked({ stockQty: 5 })]), []);
});

test('dead stock: the sold amount adds cartons, rows and loose pieces', () => {
  const item = tracked({ stockQty: 1000, piecesPerCarton: 24, piecesPerRow: 6 });
  const [r] = only([soldLine(5, { cartons: 2, rows: 3, qty: 5 })], [item]);
  assert.equal(r.reason, 'slow');
  // 2 cartons of 24, 3 rows of 6 and 5 pieces
  assert.equal(r.unitsSoldInWindow, 71);
});

test('dead stock: units sold are shown in the same unit as the stock', () => {
  const item = tracked({ stockUnit: 'carton', stockQty: 100, buyUnit: 'carton', buyPrice: 2400, piecesPerCarton: 24 });
  const [r] = only([soldLine(5, { cartons: 2 })], [item]);
  assert.equal(r.reason, 'slow');
  assert.equal(r.unitsSoldInWindow, 2);
  assert.equal(r.stockQty, 100);
});

test('dead stock: a recent restock gives a slow seller time before it is flagged', () => {
  const sales = [soldLine(1, { qty: 1 })];
  assert.deepEqual(only(sales, [tracked({ stockQty: 99, lastRestockAt: NOW - 5 * DAY })]), []);
  assert.equal(only(sales, [tracked({ stockQty: 99, lastRestockAt: NOW - 60 * DAY })]).length, 1);
});

test('dead stock: a slow seller is flagged from exactly the 50th day after it was added', () => {
  const sales = [soldLine(1, { qty: 1 })];
  assert.equal(only(sales, [tracked({ stockQty: 99, createdTs: NOW - 50 * DAY })]).length, 1);
  assert.equal(only(sales, [tracked({ stockQty: 99, createdTs: NOW - 49 * DAY })]).length, 0);
});

test('dead stock: an item idle for exactly the limit is flagged, one day less is not', () => {
  assert.equal(only([], [tracked({ createdTs: NOW - 50 * DAY })]).length, 1);
  assert.equal(only([], [tracked({ createdTs: NOW - 49 * DAY })]).length, 0);
});

test('dead stock: an item with no date at all is judged on how fast it sells', () => {
  const item = tracked({ createdTs: undefined, stockQty: 99 });
  const [r] = only([soldLine(1, { qty: 1 })], [item], { days: 30000 });
  assert.equal(r.reason, 'slow');
});

test('dead stock: a sale recorded with no quantity does not make the item look slow', () => {
  assert.deepEqual(only([soldLine(5, { qty: 0 })], [tracked()]), []);
});

test('dead stock: selling exactly a tenth of the stock is not slow, a little less is', () => {
  // sold 1, 9 left: exactly 10 percent
  assert.deepEqual(only([soldLine(5, { qty: 1 })], [tracked({ stockQty: 9 })]), []);
  assert.equal(only([soldLine(5, { qty: 1 })], [tracked({ stockQty: 10 })]).length, 1);
});

test('dead stock: a bad pack size never gives a percentage that is not a number', () => {
  const item = tracked({ stockUnit: 'carton', stockQty: 1, piecesPerCarton: -4 });
  const [r] = only([soldLine(5, { qty: 4 })], [item]);
  assert.equal(r.sellThroughPct, 0);
});

// ── best supplier ────────────────────────────────────────────

test('best supplier: one supplier alone has nothing to be compared with', () => {
  const [r] = bestSupplierPerItem({
    items: [{ id: 'i1', name: 'Rice' }], suppliers: [{ id: 's1', name: 'A' }],
    supplierPrices: [{ itemId: 'i1', supplierId: 's1', price: 100, perUnit: 'piece', createdAt: 1 }],
  });
  assert.equal(r.next, null);
  assert.equal(r.saving, 0);
  assert.equal(r.savingPct, 0);
  assert.equal(r.supplierCount, 1);
});

test('best supplier: two free prices give no saving and no percentage', () => {
  const [r] = bestSupplierPerItem({
    items: [{ id: 'i1', name: 'Rice' }], suppliers: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
    supplierPrices: [
      { itemId: 'i1', supplierId: 's1', price: 0, perUnit: 'piece', createdAt: 1 },
      { itemId: 'i1', supplierId: 's2', price: 0, perUnit: 'piece', createdAt: 1 },
    ],
  });
  assert.equal(r.saving, 0);
  assert.equal(r.savingPct, 0);
});

test('best supplier: prices per row, per piece and per carton are compared fairly', () => {
  const item = { id: 'i1', name: 'Rice', rowsPerCarton: 4, piecesPerRow: 6 };
  const suppliers = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }, { id: 's3', name: 'C' }];
  const supplierPrices = [
    { itemId: 'i1', supplierId: 's1', price: 2400, perUnit: 'carton', createdAt: 1 },   // 100 a piece
    { itemId: 'i1', supplierId: 's2', price: 570, perUnit: 'row', createdAt: 1 },       // 95 a piece
    { itemId: 'i1', supplierId: 's3', price: 120, perUnit: 'piece', createdAt: 1 },     // 120 a piece
  ];
  const [r] = bestSupplierPerItem({ items: [item], suppliers, supplierPrices });
  assert.equal(r.best.supplierName, 'B');
  assert.equal(r.best.norm, 95);
  assert.equal(r.next.supplierName, 'A');
  assert.equal(r.next.norm, 100);
  // saved on one row of 6 pieces
  assert.equal(r.saving, 30);
  assert.equal(r.savingPct, 5);
});

test('best supplier: an item with no pack size is priced per piece whatever the unit', () => {
  const [r] = bestSupplierPerItem({
    items: [{ id: 'i1' }], suppliers: [{ id: 's1', name: 'A' }],
    supplierPrices: [{ itemId: 'i1', supplierId: 's1', price: 500, perUnit: 'carton', createdAt: 1 }],
  });
  assert.equal(r.best.norm, 500);
  assert.equal(r.itemName, '');
});

test('best supplier: the item with the biggest saving comes first', () => {
  const items = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const suppliers = [{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }];
  const price = (itemId, supplierId, p) => ({ itemId, supplierId, price: p, perUnit: 'piece', createdAt: 1 });
  const supplierPrices = [
    price('a', 's1', 10), price('a', 's2', 12),
    price('b', 's1', 10), price('b', 's2', 40),
    price('c', 's1', 10), price('c', 's2', 20),
  ];
  const out = bestSupplierPerItem({ items, suppliers, supplierPrices });
  assert.deepEqual(out.map(r => r.itemId), ['b', 'c', 'a']);
});
