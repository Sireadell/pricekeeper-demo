// Edge cases in the money maths: the exact boundaries and fallbacks that a
// small slip would break. Each one pins down behaviour that scripts/mutation.mjs
// showed no other test was checking. Runs offline with Node's built-in test
// runner, no packages.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.window = { _pkSales: [], _pkWholesale: [], _pkBorrowers: [] };
beforeEach(() => {
  store.clear();
  window._pkSales = [];
  window._pkWholesale = [];
  window._pkBorrowers = [];
});

const { normalizeSale, normalizeSales } = await import('../js/sale-derive.js');
const { ppc, stockPcs, computeWac, recalcThreshold } = await import('../js/inventory-math.js');
const { lowThresholdFromPct } = await import('../js/utils.js');
const {
  saleCustomerName, unpaidTradesForAccount, oneRecordStanding, switchOverCheck, switchAccount,
} = await import('../js/ledger.js');

// ── sale-derive ───────────────────────────────────────────────
test('a missing or non-object sale comes back untouched', () => {
  assert.equal(normalizeSale(null), null);
  assert.equal(normalizeSale(undefined), undefined);
  assert.equal(normalizeSale('x'), 'x');
  assert.deepEqual(normalizeSales(undefined), []);
  assert.deepEqual(normalizeSales(null), []);
});

test('cache drift is reported only when it is more than half a naira, in either direction', () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = m => warned.push(m);
  try {
    const sale = { id: 'a', totalRevenue: 1000, payments: [] };
    assert.equal(normalizeSale({ ...sale, balanceOwing: 999.5 })._pkCacheDrift, 0);
    assert.equal(warned.length, 0);
    assert.equal(normalizeSale({ ...sale, balanceOwing: 1500 })._pkCacheDrift, 500);
    assert.equal(normalizeSale({ ...sale, balanceOwing: 400 })._pkCacheDrift, 600);
    assert.equal(warned.length, 2);
    assert.match(warned[1], /stored balanceOwing=400, derived=1000/);
    assert.match(warned[1], /Δ600/);
  } finally {
    console.warn = realWarn;
  }
});

// ── inventory-math ────────────────────────────────────────────
test('pieces per carton skips a zero and falls through to the next way of working it out', () => {
  assert.equal(ppc({ piecesPerCarton: 0, cartonQty: 12 }), 12);
  assert.equal(ppc({ rowsPerCarton: 4, piecesPerRow: 0, cartonQty: 10 }), 10);
  assert.equal(ppc({ rowsPerCarton: 0, piecesPerRow: 6, cartonQty: 10 }), 10);
  assert.equal(ppc({ cartonQty: 0 }), 1);
});

test('an old item with no piece count is worked out from its own unit', () => {
  assert.equal(stockPcs({ stockQty: 2, stockUnit: 'carton', piecesPerCarton: 12, buyUnit: 'row', piecesPerRow: 6 }), 24);
  assert.equal(stockPcs({ stockQty: 2, buyUnit: 'row', piecesPerRow: 6, piecesPerCarton: 24 }), 12);
  assert.equal(stockPcs({ stockQty: 2, piecesPerCarton: 12 }), 24);
});

test('average cost: free stock keeps the old price, no price history takes the new one', () => {
  // adding free stock does not blend in a zero
  assert.equal(computeWac({ stockQtyPcs: 10, buyUnit: 'piece', buyPrice: 100 }, 5, 0, 'piece').wacPc, 100);
  // stock with no cost on record takes the new price in full
  assert.equal(computeWac({ stockQtyPcs: 10, buyUnit: 'piece' }, 10, 200, 'piece').wacPc, 200);
  // an old item with only the cached per-piece price still blends from it
  assert.equal(computeWac({ stockQtyPcs: 10, buy: 100 }, 10, 200, 'piece').wacPc, 150);
});

test('average cost: an empty shelf with nothing added takes the new price, never a broken number', () => {
  // no stock on either side means there is nothing to blend, so dividing by
  // the total would be zero over zero
  assert.deepEqual(computeWac({ stockQtyPcs: 0, buyUnit: 'piece', buyPrice: 100 }, 0, 120, 'piece'),
    { wacPc: 120, wacBuyUnit: 120 });
});

test('the low-stock threshold keeps the unit the item is counted in', () => {
  const row = { stockUnit: 'row', piecesPerRow: 6 };
  const a = recalcThreshold(row, 60);
  assert.equal(a.lowThresholdUnit, 'row');
  assert.equal(a.lowThreshold, lowThresholdFromPct(60) / 6);
  const b = recalcThreshold({ buyUnit: 'row', piecesPerRow: 6 }, 60);
  assert.equal(b.lowThresholdUnit, 'row');
  assert.equal(recalcThreshold({ piecesPerCarton: 12 }, 60).lowThresholdUnit, 'carton');
});

// ── ledger ────────────────────────────────────────────────────
test('a trade takes its name from the customer record first, then from what was saved on it', () => {
  window._pkWholesale = [{ id: 'c1', name: 'Ade Stores' }];
  assert.equal(saleCustomerName({ custId: 'c1', customerName: 'Other' }), 'Ade Stores');
  assert.equal(saleCustomerName({ custId: 'zz', customerName: 'Bola', custName: 'Old' }), 'Bola');
  assert.equal(saleCustomerName({ custName: 'Old Name' }), 'Old Name');
  assert.equal(saleCustomerName({}), '');
});

test('a trade owing under one kobo is treated as paid', () => {
  window._pkSales = [
    { id: 'a', customerName: 'Ade Stores', balanceOwing: 0.009, createdTs: 1 },
    { id: 'b', customerName: 'Ade Stores', balanceOwing: 0.01, createdTs: 2 },
  ];
  const ids = unpaidTradesForAccount({ name: 'Ade Stores' }).map(s => s.id);
  assert.deepEqual(ids, ['b']);
});

test('money held that is spent past zero shows up as a debt, added to any other no-trade debt', () => {
  const acct = {
    name: 'Ade Stores', oneRecord: { ts: 1 },
    transactions: [
      { bucket: 'noTrade', or: 1, type: 'debt', amount: 300 },
      { bucket: 'held', or: 1, type: 'debt', amount: 200 },
    ],
  };
  const st = oneRecordStanding(acct);
  assert.equal(st.noTrade, 500);
  assert.equal(st.held, 0);
  assert.equal(st.owing, 500);
});

test('the old total and the trades count as matching only when they differ by less than one naira', () => {
  window._pkSales = [{ id: 'a', customerName: 'Ade Stores', balanceOwing: 999, createdTs: 1 }];
  const acct = { name: 'Ade Stores', transactions: [{ type: 'debt', amount: 1000 }] };
  const c = switchOverCheck(acct);
  assert.equal(c.diff, 1);
  assert.equal(c.matches, false);
  const near = switchOverCheck({ name: 'Ade Stores', transactions: [{ type: 'debt', amount: 999.5 }] });
  assert.equal(near.matches, true);
});

test('switching with Business as the truth keeps the gap as an opening line, on the right side', () => {
  // the trades owe 500 but the old record says nothing: the gap is money held
  window._pkSales = [{ id: 'a', customerName: 'Ade Stores', balanceOwing: 500, createdTs: 1 }];
  const noHistory = { name: 'Ade Stores' };
  switchAccount(noHistory, 'business', 'tester');
  assert.equal(noHistory.transactions.length, 1);
  assert.equal(noHistory.transactions[0].bucket, 'held');
  assert.equal(noHistory.transactions[0].amount, 500);
  assert.equal(noHistory.transactions[0].name, 'Opening balance · held for them');

  // the old record says 1,000 owed, the trades say nothing: the gap is a debt
  window._pkSales = [];
  const owed = { name: 'Ade Stores', transactions: [{ type: 'debt', amount: 1000 }] };
  switchAccount(owed, 'business', 'tester');
  const opening = owed.transactions.find(t => t.type === 'opening');
  assert.equal(opening.bucket, 'noTrade');
  assert.equal(opening.amount, 1000);
  assert.equal(opening.name, 'Opening balance · no trade');
});
