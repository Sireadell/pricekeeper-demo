// Stock maths: unit conversion, stock counts, average cost and low-stock
// thresholds. Runs offline with Node's built-in test runner, no packages.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// lowStockPct() reads the owner's setting from localStorage.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
beforeEach(() => store.clear());

const { ppc, ppr, piecesPerUnit, stockPcs, computeWac, recalcThreshold } =
  await import('../js/inventory-math.js');
const { lowThresholdFromPct, lowStockPct } = await import('../js/utils.js');

test('pieces per carton: explicit, rows x pieces, legacy, fallback', () => {
  assert.equal(ppc({ piecesPerCarton: 24 }), 24);
  assert.equal(ppc({ rowsPerCarton: 4, piecesPerRow: 6 }), 24);
  assert.equal(ppc({ cartonQty: '12' }), 12);
  assert.equal(ppc({}), 1);
});

test('pieces per row never returns 0', () => {
  assert.equal(ppr({ piecesPerRow: 6 }), 6);
  assert.equal(ppr({ piecesPerRow: 0 }), 1);
  assert.equal(ppr({}), 1);
});

test('pieces per unit follows the unit asked for', () => {
  const item = { piecesPerCarton: 24, piecesPerRow: 6 };
  assert.equal(piecesPerUnit(item, 'carton'), 24);
  assert.equal(piecesPerUnit(item, 'row'), 6);
  assert.equal(piecesPerUnit(item, 'piece'), 1);
});

test('stock in pieces: stored count wins, older items are converted', () => {
  assert.equal(stockPcs({ stockQtyPcs: 20 }), 20);
  assert.equal(stockPcs({ stockQtyPcs: 0, stockQty: 5 }), 0);
  assert.equal(stockPcs({ stockQty: 2, stockUnit: 'carton', piecesPerCarton: 24 }), 48);
  assert.equal(stockPcs({ stockQty: 3, stockUnit: 'piece' }), 3);
  assert.equal(stockPcs({}), 0);
});

test('average cost blends old and new stock by piece count', () => {
  const item = { stockQtyPcs: 10, buyPrice: 100, buyUnit: 'piece' };
  assert.deepEqual(computeWac(item, 10, 200, 'piece'), { wacPc: 150, wacBuyUnit: 150 });
});

test('average cost works when restocking by the carton', () => {
  const item = { stockQtyPcs: 24, buyPrice: 2400, buyUnit: 'carton', piecesPerCarton: 24 };
  assert.deepEqual(computeWac(item, 1, 4800, 'carton'), { wacPc: 150, wacBuyUnit: 3600 });
});

test('average cost with no stock on hand takes the new price', () => {
  const item = { stockQtyPcs: 0, buyUnit: 'piece' };
  assert.deepEqual(computeWac(item, 5, 120, 'piece'), { wacPc: 120, wacBuyUnit: 120 });
});

test('average cost is rounded to kobo', () => {
  const item = { stockQtyPcs: 2, buyPrice: 100, buyUnit: 'piece' };
  assert.equal(computeWac(item, 1, 101, 'piece').wacPc, 100.33);
});

test('low-stock threshold is 15% by default and never below 1 piece', () => {
  assert.equal(lowStockPct(), 15);
  assert.equal(lowThresholdFromPct(20), 3);
  assert.equal(lowThresholdFromPct(2), 1);
  assert.equal(lowThresholdFromPct(0), 1);
  assert.equal(lowThresholdFromPct(100, 10), 10);
});

test('owner setting changes the threshold, bad values fall back to 15%', () => {
  localStorage.setItem('pkLowStockPct', '20');
  assert.equal(lowThresholdFromPct(20), 4);
  localStorage.setItem('pkLowStockPct', '95');
  assert.equal(lowStockPct(), 15);
});

test('threshold recalculated after a stock change, in pieces', () => {
  assert.deepEqual(recalcThreshold({ stockUnit: 'piece' }, 20), {
    lowThresholdPcs: 3, lowThreshold: 3, lowThresholdUnit: 'piece', low: false,
  });
  assert.equal(recalcThreshold({ stockUnit: 'piece' }, 1).low, true);
});

test('threshold recalculated for carton stock', () => {
  const r = recalcThreshold({ stockUnit: 'carton', piecesPerCarton: 24 }, 240);
  assert.equal(r.lowThresholdPcs, 36);
  assert.equal(r.lowThreshold, 1.5);
  assert.equal(r.lowThresholdUnit, 'carton');
});
