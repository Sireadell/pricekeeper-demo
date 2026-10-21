// Price maths: margins, profit, money display and what a sale still owes.
// Runs offline with Node's built-in test runner, no packages.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pct, profit, fmt, fmtCompact, itemNeedsCost } from '../js/utils.js';
import { netPaid, deriveSaleTotals, normalizeSale } from '../js/sale-derive.js';

test('margin percentage', () => {
  assert.equal(pct(100, 130), '30.0');
  assert.equal(pct(150, 100), '-33.3');
  assert.equal(pct(0, 50), '0.0');
});

test('profit per sale line', () => {
  assert.equal(profit(100, 130, 5), 150);
  assert.equal(profit(100, 130), 30);
  assert.equal(profit(100, 80, 2), -40);
});

test('naira formatting', () => {
  assert.equal(fmt(5000), '₦5,000');
  assert.equal(fmt(null), '₦0');
  assert.equal(fmtCompact(999), '999');
  assert.equal(fmtCompact(1500), '1.5K');
  assert.equal(fmtCompact(2000000), '2M');
});

test('an item needs a cost only when every cost field is empty', () => {
  assert.equal(itemNeedsCost({}), true);
  assert.equal(itemNeedsCost(null), true);
  assert.equal(itemNeedsCost({ buyPrice: 0, buy: '0' }), true);
  assert.equal(itemNeedsCost({ cartonBuy: '2400' }), false);
  assert.equal(itemNeedsCost({ buy: 50 }), false);
});

test('amount paid adds payments, takes off refunds, skips removed ones', () => {
  assert.equal(netPaid({ payments: [{ amount: 500 }, { amount: 300 }] }), 800);
  assert.equal(netPaid({ payments: [{ amount: 1000 }, { type: 'refund', amount: 200 }] }), 800);
  assert.equal(netPaid({ payments: [{ amount: 1000 }, { amount: 500, removed: true }] }), 1000);
  assert.equal(netPaid({ payments: [{ amount: 0.1 }, { amount: 0.2 }] }), 0.3);
  assert.equal(netPaid({}), 0);
});

test('a sale is paid, part paid or on credit', () => {
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 1000, payments: [{ amount: 1000 }] }),
    { amountReceived: 1000, balanceOwing: 0, paymentStatus: 'paid' });
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 1000, payments: [{ amount: 400 }] }),
    { amountReceived: 400, balanceOwing: 600, paymentStatus: 'partial' });
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 1000, payments: [] }),
    { amountReceived: 0, balanceOwing: 1000, paymentStatus: 'credit' });
});

test('overpaying never leaves a negative balance', () => {
  assert.deepEqual(deriveSaleTotals({ totalRevenue: 1000, payments: [{ amount: 1200 }] }),
    { amountReceived: 1200, balanceOwing: 0, paymentStatus: 'paid' });
});

test('older sales that store revenue instead of totalRevenue', () => {
  assert.equal(deriveSaleTotals({ revenue: 500, payments: [{ amount: 200 }] }).balanceOwing, 300);
});

test('a stale saved balance is corrected from the payment history', t => {
  t.mock.method(console, 'warn', () => {});
  const stored = { id: 'T1', totalRevenue: 1000, balanceOwing: 1000, payments: [{ amount: 1000 }] };
  const fixed = normalizeSale(stored);
  assert.equal(fixed.balanceOwing, 0);
  assert.equal(fixed.paymentStatus, 'paid');
  assert.equal(fixed._pkCacheDrift, 1000);
  assert.equal(stored.balanceOwing, 1000, 'the original sale is not changed');
});
