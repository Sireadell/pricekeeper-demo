// Offline model test. Thousands of random shop days are replayed against a
// plain, obviously-correct version of the same rules, and the app's own maths
// must agree every time. Covers what stays on screen while offline, what a
// sale owes and has paid, where a customer payment goes, and the average cost
// of stock. Runs offline with Node's built-in test runner, no packages.
// Every run uses fixed seeds, so a failure can be replayed exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.window = { _pkSales: [], _pkWholesale: [], _pkBorrowers: [], addEventListener() {} };

const { netPaid, deriveSaleTotals, normalizeSale } = await import('../js/sale-derive.js');
const { planAccountPayment } = await import('../js/ledger.js');
const { computeWac, piecesPerUnit } = await import('../js/inventory-math.js');

// Small seeded random numbers, so every run is the same run.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const r2 = n => Math.round(n * 100) / 100;

const RUNS = 400;

// ── 1. What stays on screen while offline ─────────────────────
// Reference: a plain map. Start with what the database sent, then apply each
// save made offline, in order. The screen must show the same records.
// The overlay keeps its queue in a module variable, so each run loads a
// fresh copy of it.
test('offline saves stay on screen exactly as a plain replay of them would show', async () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const { notePending, withPending } = await import(`../js/pending-overlay.js?run=${seed}`);
    const r = rng(seed);
    const server = [];
    for (let i = 0; i < int(r, 0, 6); i++) server.push({ id: 's' + i, qty: int(r, 1, 50), name: 'item ' + i });
    const ref = new Map(server.map(d => [d.id, { ...d }]));
    const writes = [];
    const deleted = new Set();

    for (let i = 0; i < int(r, 1, 12); i++) {
      const id = 's' + int(r, 0, 8);
      let kind = pick(r, ['set', 'merge', 'delete']);
      // Nobody edits a record they have just deleted; skip that case.
      if (kind === 'merge' && deleted.has(id)) kind = 'set';
      if (kind === 'delete') {
        writes.push({ op: 'delete', collection: 'sales', docId: id });
        ref.delete(id);
        deleted.add(id);
      } else if (kind === 'merge') {
        const patch = { qty: int(r, 0, 99) };
        writes.push({ op: 'set', collection: 'sales', docId: id, payload: patch, options: { merge: true } });
        if (ref.has(id)) ref.set(id, { ...ref.get(id), ...patch });
      } else {
        const doc = { id, qty: int(r, 0, 99), name: 'made offline ' + i };
        writes.push({ op: 'set', collection: 'sales', docId: id, payload: doc });
        ref.set(id, doc);
        deleted.delete(id);
      }
    }

    notePending(writes);
    const shown = withPending('sales', server.map(d => ({ ...d })));
    const got = new Map(shown.map(d => [d.id, d]));
    assert.equal(got.size, ref.size, `seed ${seed}: different number of records`);
    for (const [id, want] of ref) {
      const have = got.get(id);
      assert.ok(have, `seed ${seed}: ${id} missing from screen`);
      assert.equal(have.qty, want.qty, `seed ${seed}: ${id} shows the wrong quantity`);
    }
  }
});

// ── 2. What a sale owes and has paid ──────────────────────────
function randomSale(r) {
  const total = int(r, 1, 500) * 100;
  const payments = [];
  for (let i = 0; i < int(r, 0, 6); i++) {
    payments.push({
      amount: int(r, 1, 300) * 50,
      type: pick(r, ['payment', 'payment', 'payment', 'refund']),
      removed: r() < 0.15,
    });
  }
  return { id: 'x' + int(r, 0, 9999), totalRevenue: total, payments, balanceOwing: int(r, 0, 9999) };
}

test('a sale never owes less than nothing and its status matches what was paid', () => {
  for (let seed = 1; seed <= RUNS * 5; seed++) {
    const r = rng(seed * 7);
    const sale = randomSale(r);
    // plain reference: add payments, take away refunds, ignore removed ones
    let paid = 0;
    for (const p of sale.payments) {
      if (p.removed) continue;
      paid += p.type === 'refund' ? -p.amount : p.amount;
    }
    const owing = Math.max(0, sale.totalRevenue - paid);
    const d = deriveSaleTotals(sale);
    assert.equal(d.amountReceived, r2(paid), `seed ${seed}: paid`);
    assert.equal(d.balanceOwing, r2(owing), `seed ${seed}: owing`);
    assert.ok(d.balanceOwing >= 0, `seed ${seed}: negative debt`);
    const status = owing <= 0 ? 'paid' : paid <= 0 ? 'credit' : 'partial';
    assert.equal(d.paymentStatus, status, `seed ${seed}: status`);
  }
});

test('a stale saved balance never changes what a sale really owes', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = rng(seed * 13);
    const sale = randomSale(r);
    const a = normalizeSale({ ...sale, balanceOwing: 0 });
    const b = normalizeSale({ ...sale, balanceOwing: 999999 });
    assert.equal(a.balanceOwing, b.balanceOwing);
    assert.equal(a.amountReceived, b.amountReceived);
    assert.equal(a.paymentStatus, b.paymentStatus);
  }
});

test('the order payments were entered in never changes the total', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = rng(seed * 17);
    const sale = randomSale(r);
    const shuffled = { ...sale, payments: sale.payments.slice().sort(() => r() - 0.5) };
    assert.equal(netPaid(shuffled), netPaid(sale));
  }
});

// ── 3. Where a customer payment goes ──────────────────────────
test('a customer payment is never lost, never over-applied, and clears the oldest debt first', () => {
  for (let seed = 1; seed <= RUNS * 2; seed++) {
    const r = rng(seed * 29);
    const trades = [];
    for (let i = 0; i < int(r, 0, 6); i++) {
      trades.push({ id: 't' + i, customerName: 'ade stores', balanceOwing: int(r, 1, 80) * 100, createdTs: i + 1 });
    }
    const noTrade = r() < 0.4 ? int(r, 1, 50) * 100 : 0;
    window._pkSales = trades;
    window._pkWholesale = [];
    window._pkBorrowers = [];
    const acct = {
      name: 'Ade Stores', oneRecord: { ts: 1 },
      transactions: noTrade ? [{ type: 'debt', amount: noTrade }] : [],
    };
    const amount = int(r, 1, 600) * 100;
    const plan = planAccountPayment(acct, amount);

    const applied = plan.toTrades.reduce((s, t) => s + t.amount, 0) + plan.toNoTrade + plan.toHeld;
    assert.equal(r2(applied), r2(amount), `seed ${seed}: money was lost or invented`);
    for (const t of plan.toTrades) {
      assert.ok(t.amount <= t.sale.balanceOwing, `seed ${seed}: paid more than a trade owed`);
    }
    // oldest first: only the last trade paid may be left partly unpaid
    const order = plan.toTrades.map(t => t.sale.createdTs);
    assert.deepEqual(order, order.slice().sort((a, b) => a - b), `seed ${seed}: not oldest first`);
    plan.toTrades.slice(0, -1).forEach(t => assert.ok(t.clears, `seed ${seed}: skipped past an unpaid trade`));
  }
});

// ── 4. Average cost of stock ──────────────────────────────────
test('average cost always sits between the old price and the new price', () => {
  for (let seed = 1; seed <= RUNS * 2; seed++) {
    const r = rng(seed * 31);
    const item = { piecesPerCarton: pick(r, [1, 6, 12, 24]), stockQtyPcs: int(r, 1, 200), buyUnit: 'piece', buyPrice: int(r, 10, 900) };
    const addQty = int(r, 1, 100);
    const unit = pick(r, ['piece', 'carton']);
    const price = int(r, 10, 900) * (unit === 'carton' ? piecesPerUnit(item, 'carton') : 1);
    const { wacPc } = computeWac(item, addQty, price, unit);
    const oldPc = item.buyPrice;
    const newPc = price / piecesPerUnit(item, unit);
    const lo = Math.min(oldPc, newPc) - 0.01, hi = Math.max(oldPc, newPc) + 0.01;
    assert.ok(wacPc >= lo && wacPc <= hi, `seed ${seed}: average cost ${wacPc} outside ${lo}..${hi}`);
  }
});

test('stock bought at one price keeps that price as its average', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = rng(seed * 37);
    const price = int(r, 10, 900);
    const item = { stockQtyPcs: int(r, 1, 200), buyUnit: 'piece', buyPrice: price };
    const { wacPc } = computeWac(item, int(r, 1, 100), price, 'piece');
    assert.equal(wacPc, price);
  }
});
