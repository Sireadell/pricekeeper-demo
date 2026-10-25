// A second, separate way of working out the money, to check the app against.
// The app works in naira with decimals. This file works in whole kobo (one
// hundredth of a naira) and in exact fractions, with no rounding along the
// way, and walks through every combination of a small set of totals and
// payments. If the app and this slower method ever disagree, a test fails.
// Runs offline with Node's built-in test runner, no packages.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { _pkSales: [], _pkWholesale: [], _pkBorrowers: [] };

const { deriveSaleTotals } = await import('../js/sale-derive.js');
const { computeWac, stockPcs } = await import('../js/inventory-math.js');

const kobo = naira => Math.round(naira * 100);

// What a trade owes, worked out in whole kobo.
function oracleSale(totalNaira, payments) {
  let paid = 0;
  for (const p of payments) {
    if (p.removed) continue;
    paid += (p.type === 'refund' ? -1 : 1) * kobo(p.amount);
  }
  const owing = Math.max(0, kobo(totalNaira) - paid);
  const status = owing === 0 ? 'paid' : paid <= 0 ? 'credit' : 'partial';
  return { paid, owing, status };
}

const TOTALS = [0, 0.01, 99.99, 800, 1300.5, 25000];
const EVENTS = [
  { amount: 0 },
  { amount: 100 },
  { amount: 800 },
  { amount: 1300.5 },
  { amount: 0.1 },
  { amount: 0.2 },
  { amount: 50, type: 'refund' },
  { amount: 800, type: 'refund' },
  { amount: 300, removed: true },
];

// Every list of up to three payments from the set above.
function* paymentLists() {
  yield [];
  for (const a of EVENTS) {
    yield [a];
    for (const b of EVENTS) {
      yield [a, b];
      for (const c of EVENTS) yield [a, b, c];
    }
  }
}

test('what a trade owes matches the whole-kobo method for every total and payment list tried', () => {
  let checked = 0;
  for (const total of TOTALS) {
    for (const payments of paymentLists()) {
      const got = deriveSaleTotals({ totalRevenue: total, payments });
      const want = oracleSale(total, payments);
      const label = `${JSON.stringify(total)} ${JSON.stringify(payments)}`;
      assert.equal(kobo(got.amountReceived), want.paid, `paid: ${label}`);
      assert.equal(kobo(got.balanceOwing), want.owing, `owing: ${label}`);
      assert.equal(got.paymentStatus, want.status, `status: ${label}`);
      checked++;
    }
  }
  assert.equal(checked, 6 * (1 + 9 + 81 + 729));
});

// Average cost in exact fractions: (old pieces x old price + new pieces x new
// price) / total pieces. Compared to the app within one kobo, because the app
// rounds to two decimals.
test('average cost matches the exact-fraction method within one kobo', () => {
  const OLD_PCS = [0, 1, 7, 24, 100];
  const OLD_PRICE_KOBO = [0, 5, 99, 12050];
  const ADD_PCS = [1, 3, 12, 50];
  const ADD_PRICE_KOBO = [0, 1, 250, 33333];
  let checked = 0;
  for (const oldPcs of OLD_PCS) for (const op of OLD_PRICE_KOBO)
    for (const addPcs of ADD_PCS) for (const ap of ADD_PRICE_KOBO) {
      const item = { stockQtyPcs: oldPcs, buyUnit: 'piece', buyPrice: op / 100 };
      const got = computeWac(item, addPcs, ap / 100, 'piece').wacPc;
      const blend = ap > 0 && oldPcs > 0 && op > 0;
      const wantKobo = blend ? (oldPcs * op + addPcs * ap) / (oldPcs + addPcs) : (ap || op);
      assert.ok(Math.abs(kobo(got) - wantKobo) <= 1,
        `old ${oldPcs} @ ${op}, add ${addPcs} @ ${ap}: app ${got}, exact ${wantKobo / 100}`);
      checked++;
    }
  assert.equal(checked, 5 * 4 * 4 * 4);
});

test('stock in cartons and rows becomes pieces the same way as plain multiplication', () => {
  for (const qty of [0, 1, 2, 7, 13]) for (const per of [1, 6, 12, 24]) {
    assert.equal(stockPcs({ stockQty: qty, stockUnit: 'carton', piecesPerCarton: per }), qty * per);
    assert.equal(stockPcs({ stockQty: qty, stockUnit: 'row', piecesPerRow: per }), qty * per);
  }
});
