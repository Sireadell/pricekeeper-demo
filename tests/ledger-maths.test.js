// Money owed per customer account: what an account owes, where a payment goes
// and the switch to one record. Runs offline with Node's built-in test runner.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ledger.js reads the shop's sales and customers from window.
globalThis.window = { _pkSales: [], _pkWholesale: [], _pkBorrowers: [] };
beforeEach(() => {
  window._pkSales = [];
  window._pkWholesale = [];
  window._pkBorrowers = [];
});

const {
  normName, isOneRecord, shopOnOneRecord, newAccountFields, tradesForAccount,
  unpaidTradesForAccount, oneRecordStanding, planAccountPayment, legacyTotal,
  switchOverCheck, switchAccount, bucketTag,
} = await import('../js/ledger.js');

const account = (extra) => ({ name: 'Ade Stores', oneRecord: { ts: 1 }, transactions: [], ...extra });

test('names match whatever the case or spacing', () => {
  assert.equal(normName('  Ade   STORES '), 'ade stores');
  assert.equal(normName(null), '');
});

test('an account finds its own live trades, oldest first', () => {
  window._pkSales = [
    { id: 'new', customerName: 'ade stores', balanceOwing: 500, createdTs: 2 },
    { id: 'old', customerName: ' Ade  Stores ', balanceOwing: 300, createdTs: 1 },
    { id: 'voided', customerName: 'Ade Stores', balanceOwing: 999, createdTs: 3, voided: true },
    { id: 'other', customerName: 'Bola', balanceOwing: 700, createdTs: 1 },
    { id: 'paid', customerName: 'Ade Stores', balanceOwing: 0, createdTs: 4 },
  ];
  assert.deepEqual(tradesForAccount(account()).map(s => s.id), ['old', 'new', 'paid']);
  assert.deepEqual(unpaidTradesForAccount(account()).map(s => s.id), ['old', 'new']);
});

test('a trade is matched through the customer record when it has one', () => {
  window._pkWholesale = [{ id: 'c1', name: 'Ade Stores' }];
  window._pkSales = [{ id: 'x', custId: 'c1', balanceOwing: 100, createdTs: 1 }];
  assert.equal(tradesForAccount(account()).length, 1);
});

test('what an account owes: unpaid trades plus debts with no trade, less money held', () => {
  window._pkSales = [
    { customerName: 'Ade Stores', balanceOwing: 300, createdTs: 1 },
    { customerName: 'Ade Stores', balanceOwing: 500, createdTs: 2 },
  ];
  const b = account({ transactions: [
    { bucket: 'noTrade', type: 'debt', amount: 200, or: 1 },
    { bucket: 'held', type: 'payment', amount: 100, or: 1 },
    { bucket: 'noTrade', type: 'debt', amount: 5000 },
  ] });
  const st = oneRecordStanding(b);
  assert.equal(st.tradeOwing, 800);
  assert.equal(st.noTrade, 200);
  assert.equal(st.held, 100);
  assert.equal(st.owing, 1000);
  assert.equal(st.balance, 900);
});

test('the opening line counts even without the after-switch mark', () => {
  const b = account({ transactions: [{ type: 'opening', bucket: 'noTrade', amount: 50 }] });
  assert.equal(oneRecordStanding(b).noTrade, 50);
});

test('a debt paid past zero shows up as money held', () => {
  const b = account({ transactions: [
    { bucket: 'noTrade', type: 'debt', amount: 200, or: 1 },
    { bucket: 'noTrade', type: 'payment', amount: 300, or: 1 },
  ] });
  const st = oneRecordStanding(b);
  assert.equal(st.noTrade, 0);
  assert.equal(st.held, 100);
  assert.equal(st.balance, -100);
});

test('a payment clears the oldest trade first, then old debts, then is held', () => {
  window._pkSales = [
    { id: 'old', customerName: 'Ade Stores', balanceOwing: 300, createdTs: 1 },
    { id: 'new', customerName: 'Ade Stores', balanceOwing: 500, createdTs: 2 },
  ];
  const b = account({ transactions: [{ bucket: 'noTrade', type: 'debt', amount: 200, or: 1 }] });
  const plan = planAccountPayment(b, 1100);
  assert.deepEqual(plan.toTrades.map(t => [t.sale.id, t.amount, t.clears]), [['old', 300, true], ['new', 500, true]]);
  assert.equal(plan.toNoTrade, 200);
  assert.equal(plan.toHeld, 100);
});

test('a part payment leaves the second trade only part cleared', () => {
  window._pkSales = [
    { id: 'old', customerName: 'Ade Stores', balanceOwing: 300, createdTs: 1 },
    { id: 'new', customerName: 'Ade Stores', balanceOwing: 500, createdTs: 2 },
  ];
  const plan = planAccountPayment(account(), 400);
  assert.deepEqual(plan.toTrades.map(t => [t.sale.id, t.amount, t.clears]), [['old', 300, true], ['new', 100, false]]);
  assert.equal(plan.toNoTrade, 0);
  assert.equal(plan.toHeld, 0);
});

test('the old running total is debts minus payments, ignoring other line types', () => {
  const b = account({ transactions: [
    { type: 'debt', amount: 1000 }, { type: 'payment', amount: 400 }, { type: 'opening', amount: 777 },
  ] });
  assert.equal(legacyTotal(b), 600);
  assert.equal(legacyTotal(null), 0);
});

test('switch-over check: matches, differs, and tolerates under one naira', () => {
  window._pkSales = [{ customerName: 'Ade Stores', balanceOwing: 800, createdTs: 1 }];
  const mk = amount => account({ oneRecord: undefined, transactions: [{ type: 'debt', amount }] });
  assert.deepEqual(switchOverCheck(mk(800)), { business: 800, trades: 800, diff: 0, matches: true });
  assert.equal(switchOverCheck(mk(800.5)).matches, true);
  const off = switchOverCheck(mk(950));
  assert.equal(off.diff, 150);
  assert.equal(off.matches, false);
});

test('switching to one record: keep Business adds an opening line for the gap', () => {
  window._pkSales = [{ customerName: 'Ade Stores', balanceOwing: 800, createdTs: 1 }];
  const b = account({ oneRecord: undefined, transactions: [{ type: 'debt', amount: 950 }] });
  switchAccount(b, 'business', { name: 'Owner' });
  const opening = b.transactions.find(t => t.type === 'opening');
  assert.equal(opening.amount, 150);
  assert.equal(opening.bucket, 'noTrade');
  assert.equal(b.oneRecord.choice, 'business');
  assert.equal(oneRecordStanding(b).owing, 950);
});

test('switching to one record: a negative gap is kept as money held', () => {
  window._pkSales = [{ customerName: 'Ade Stores', balanceOwing: 800, createdTs: 1 }];
  const b = account({ oneRecord: undefined, transactions: [{ type: 'debt', amount: 700 }] });
  switchAccount(b, 'business');
  const opening = b.transactions.find(t => t.type === 'opening');
  assert.equal(opening.bucket, 'held');
  assert.equal(opening.amount, 100);
});

test('switching to one record: trusting the trades drops the gap, a match needs no choice', () => {
  window._pkSales = [{ customerName: 'Ade Stores', balanceOwing: 800, createdTs: 1 }];
  const off = account({ oneRecord: undefined, transactions: [{ type: 'debt', amount: 950 }] });
  switchAccount(off, 'trades');
  assert.equal(off.transactions.some(t => t.type === 'opening'), false);
  assert.equal(off.oneRecord.choice, 'trades');
  const same = account({ oneRecord: undefined, transactions: [{ type: 'debt', amount: 800 }] });
  switchAccount(same, 'business');
  assert.equal(same.oneRecord.choice, 'matched');
  assert.equal(same.transactions.some(t => t.type === 'opening'), false);
});

test('new accounts are born switched once the shop has switched', () => {
  assert.equal(isOneRecord({ oneRecord: { ts: 1 } }), true);
  assert.equal(isOneRecord({}), false);
  assert.deepEqual(newAccountFields(), {});
  window._pkBorrowers = [{ name: 'X', oneRecord: { ts: 1 } }];
  assert.equal(shopOnOneRecord(), true);
  assert.equal(typeof newAccountFields().oneRecord.ts, 'number');
});

test('a debt or payment written after the switch counts, one written before it does not count twice', () => {
  const switched = account();
  assert.deepEqual(bucketTag(switched, 'noTrade'), { bucket: 'noTrade', or: 1 });
  switched.transactions.push({ type: 'debt', amount: 300, ...bucketTag(switched, 'noTrade') });
  switched.transactions.push({ type: 'payment', amount: 50, ...bucketTag(switched, 'held') });
  const st = oneRecordStanding(switched);
  assert.equal(st.noTrade, 300);
  assert.equal(st.held, 50);
  assert.equal(st.balance, 250);

  // written before the switch: it is already inside the old total
  const old = account({ oneRecord: undefined });
  assert.deepEqual(bucketTag(old, 'noTrade'), { bucket: 'noTrade' });
  old.transactions.push({ type: 'debt', amount: 300, ...bucketTag(old, 'noTrade') });
  old.oneRecord = { ts: 2 };
  assert.equal(oneRecordStanding(old).noTrade, 0);
});
