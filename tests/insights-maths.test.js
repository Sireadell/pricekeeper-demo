// Profit insights: weeks and months, profit leaks, top earners, dead stock and
// best supplier. Pure functions, runs offline with Node's built-in test runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROFIT_POLLUTION_CUTOFF_TS, saleTs, isProfitPolluted, monthKey, isoWeekKey,
  topBottomEarners, profitLeaks, salesTrends, deadStock, bestSupplierPerItem,
} from '../js/insights-engine.js';

const DAY = 86400000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('week keys follow the ISO calendar, including year edges', () => {
  assert.equal(isoWeekKey(at(2026, 1, 1)), '2026-W01');
  assert.equal(isoWeekKey(at(2024, 12, 30)), '2025-W01');
  assert.equal(isoWeekKey(at(2021, 1, 3)), '2020-W53');
  assert.equal(isoWeekKey(at(2026, 6, 7)), '2026-W23');
  assert.equal(isoWeekKey(at(2026, 6, 8)), '2026-W24');
});

test('month key is year and zero-padded month', () => {
  assert.equal(monthKey(at(2026, 6, 30)), '2026-06');
  assert.equal(monthKey(at(2026, 1, 5)), '2026-01');
  assert.equal(monthKey(at(2026, 12, 31)), '2026-12');
});

test('sale time: stored time first, then the date, then zero', () => {
  assert.equal(saleTs({ createdTs: 123, date: '2026-06-10' }), 123);
  assert.equal(saleTs({ date: '2026-06-10' }), new Date(2026, 5, 10).getTime());
  assert.equal(saleTs({ date: 'not a date' }), 0);
  assert.equal(saleTs({}), 0);
  assert.equal(saleTs(null), 0);
});

test('only early cashier sales are treated as having fake profit', () => {
  const cashier = { role: 'cashier' };
  assert.equal(isProfitPolluted({ performedBy: cashier, createdTs: at(2026, 5, 20) }), true);
  assert.equal(isProfitPolluted({ performedBy: cashier, createdTs: PROFIT_POLLUTION_CUTOFF_TS - 1 }), true);
  assert.equal(isProfitPolluted({ performedBy: cashier, createdTs: PROFIT_POLLUTION_CUTOFF_TS }), false);
  assert.equal(isProfitPolluted({ performedBy: { role: 'owner' }, createdTs: at(2026, 5, 20) }), false);
  assert.equal(isProfitPolluted({ createdTs: at(2026, 5, 20) }), false);
});

test('top earners add up profit per item and skip voided sales and other months', () => {
  const sales = [
    { createdTs: at(2026, 6, 10), items: [
      { itemId: 'rice', itemName: 'Rice', revenue: 1000, profit: 200 },
      { itemId: 'oil', itemName: 'Oil', revenue: 500, profit: -50 },
    ] },
    { createdTs: at(2026, 6, 12), items: [{ itemId: 'rice', revenue: 2000, cost: 1700 }] },
    { createdTs: at(2026, 6, 14), voided: true, items: [{ itemId: 'rice', revenue: 9000, profit: 9000 }] },
    { createdTs: at(2026, 7, 2), items: [{ itemId: 'rice', revenue: 100, profit: 100 }] },
  ];
  const r = topBottomEarners(sales, '2026-06');
  assert.deepEqual(r.ranked.map(x => x.itemId), ['rice', 'oil']);
  assert.equal(r.ranked[0].profit, 500);
  assert.equal(r.ranked[0].revenue, 3000);
  assert.equal(r.ranked[0].lines, 2);
  assert.equal(r.ranked[1].profit, -50);
  assert.equal(r.excludedPollutedSales, 0);
});

test('early cashier sales count for revenue but never for profit', () => {
  const sales = [
    { createdTs: at(2026, 5, 20), performedBy: { role: 'cashier' }, items: [{ itemId: 'rice', revenue: 800, profit: 800 }] },
    { createdTs: at(2026, 5, 21), items: [{ itemId: 'rice', revenue: 1000, profit: 150 }] },
  ];
  const r = topBottomEarners(sales, '2026-05');
  assert.equal(r.ranked[0].revenue, 1800);
  assert.equal(r.ranked[0].profit, 150);
  assert.equal(r.ranked[0].pollutedLines, 1);
  assert.equal(r.excludedPollutedSales, 1);
});

test('older single-item sales still work', () => {
  const r = topBottomEarners(
    [{ createdTs: at(2026, 6, 10), itemId: 'soap', itemName: 'Soap', totalRevenue: 400, totalCost: 300 }], '2026-06');
  assert.equal(r.ranked[0].profit, 100);
  assert.equal(r.ranked[0].itemName, 'Soap');
});

test('profit leaks: below cost, thin margin and heavy discount are found', () => {
  const sales = [
    { id: 'S1', createdTs: at(2026, 6, 10), items: [
      { itemId: 'a', itemName: 'A', revenue: 90, profit: -10 },
      { itemId: 'b', itemName: 'B', revenue: 1000, profit: 100 },
      { itemId: 'c', itemName: 'C', revenue: 1000, profit: 50 },
      { itemId: 'd', itemName: 'D', revenue: 800, profit: 200, lineDiscount: 200 },
    ] },
    { id: 'S2', createdTs: at(2026, 6, 11), voided: true, items: [{ itemId: 'z', revenue: 100, profit: -500 }] },
  ];
  const leaks = profitLeaks(sales);
  assert.deepEqual(leaks.map(l => l.itemId), ['a', 'c', 'd']);
  assert.deepEqual(leaks[0].reasons, ['below-cost']);
  assert.equal(leaks[0].belowCostLoss, 10);
  assert.deepEqual(leaks[1].reasons, ['thin-margin']);
  assert.equal(leaks[1].minMarginPct, 5);
  assert.deepEqual(leaks[2].reasons, ['discount-heavy']);
  assert.equal(leaks[2].discountTotal, 200);
});

test('a margin exactly at the thin threshold is not flagged', () => {
  const sale = { createdTs: at(2026, 6, 10), items: [{ itemId: 'b', revenue: 1000, profit: 100 }] };
  assert.equal(profitLeaks([sale]).length, 0);
  assert.equal(profitLeaks([sale], { thinMarginPct: 11 }).length, 1);
});

test('profit leaks ignore early cashier sales with fake profit', () => {
  const sale = { createdTs: at(2026, 5, 20), performedBy: { role: 'cashier' }, items: [{ itemId: 'a', revenue: 90, profit: -10 }] };
  assert.equal(profitLeaks([sale]).length, 0);
});

test('trends: weekly and monthly totals, voided skipped, fake profit left out', () => {
  const sales = [
    { createdTs: at(2026, 6, 8), items: [{ itemId: 'a', revenue: 1000, profit: 200 }] },
    { createdTs: at(2026, 6, 10), items: [{ itemId: 'a', revenue: 500, profit: 100 }] },
    { createdTs: at(2026, 6, 15), items: [{ itemId: 'a', revenue: 300, profit: 60 }] },
    { createdTs: at(2026, 6, 16), voided: true, items: [{ itemId: 'a', revenue: 9999, profit: 9999 }] },
    { createdTs: at(2026, 5, 20), performedBy: { role: 'cashier' }, items: [{ itemId: 'a', revenue: 400, profit: 400 }] },
  ];
  const t = salesTrends(sales);
  assert.deepEqual(t.weekly.map(w => w.key), ['2026-W21', '2026-W24', '2026-W25']);
  const w24 = t.weekly.find(w => w.key === '2026-W24');
  assert.equal(w24.revenue, 1500);
  assert.equal(w24.profit, 300);
  assert.equal(w24.salesCount, 2);
  const may = t.monthly.find(m => m.key === '2026-05');
  assert.equal(may.revenue, 400);
  assert.equal(may.profit, 0);
  assert.equal(may.pollutedExcludedFromProfit, 1);
  const jun = t.monthly.find(m => m.key === '2026-06');
  assert.equal(jun.revenue, 1800);
  assert.equal(jun.profit, 360);
  assert.equal(jun.salesCount, 3);
});

const NOW = at(2026, 8, 1);
const tracked = (extra) => ({
  id: 'i1', name: 'Sugar', trackStock: true, stockQty: 10, stockUnit: 'piece',
  buyPrice: 100, buyUnit: 'piece', sell: 150, createdTs: NOW - 100 * DAY, ...extra,
});

test('dead stock: an item nobody bought is listed with the money tied up in it', () => {
  const [r] = deadStock([], [tracked()], { now: NOW });
  assert.equal(r.reason, 'idle');
  assert.equal(r.daysIdle, 100);
  assert.equal(r.moneyTrapped, 1000);
  assert.equal(r.currentSell, 150);
  assert.equal(r.suggestedSell, 120);
  assert.equal(r.discountPct, 20);
});

test('dead stock: the clearance price never drops to cost or below', () => {
  const [near] = deadStock([], [tracked({ sell: 110 })], { now: NOW });
  assert.equal(near.suggestedSell, 101);
  const [loss] = deadStock([], [tracked({ sell: 90 })], { now: NOW });
  assert.equal(loss.suggestedSell, null);
  assert.equal(loss.discountPct, 0);
});

test('dead stock: new, restocked, untracked, empty and no-cost items are left alone', () => {
  const items = [
    tracked({ id: 'new', createdTs: NOW - 10 * DAY }),
    tracked({ id: 'restocked', lastRestockAt: NOW - 5 * DAY }),
    tracked({ id: 'untracked', trackStock: false }),
    tracked({ id: 'empty', stockQty: 0 }),
    tracked({ id: 'nocost', buyPrice: 0 }),
  ];
  assert.deepEqual(deadStock([], items, { now: NOW }), []);
});

test('dead stock: an item that is selling well is left alone', () => {
  const sales = [{ createdTs: NOW - 5 * DAY, items: [{ itemId: 'i1', qty: 5 }] }];
  assert.deepEqual(deadStock(sales, [tracked()], { now: NOW }), []);
});

test('dead stock: a slow seller is flagged by its sell-through share', () => {
  const sales = [{ createdTs: NOW - 10 * DAY, items: [{ itemId: 'i1', qty: 1 }] }];
  const [r] = deadStock(sales, [tracked({ stockQty: 99 })], { now: NOW });
  assert.equal(r.reason, 'slow');
  assert.equal(r.sellThroughPct, 1);
});

test('dead stock: cartons are counted from the live stock, not a stale piece count', () => {
  const item = tracked({
    stockQty: 9, stockUnit: 'carton', piecesPerCarton: 48, stockQtyPcs: 960,
    cartonBuy: 2400, buyPrice: 0, buyUnit: 'carton',
  });
  const [r] = deadStock([], [item], { now: NOW });
  assert.equal(r.moneyTrapped, 9 * 48 * 50);
});

test('dead stock: the biggest pile of trapped money comes first', () => {
  const items = [tracked({ id: 'small', stockQty: 2 }), tracked({ id: 'big', stockQty: 50 })];
  assert.deepEqual(deadStock([], items, { now: NOW }).map(r => r.itemId), ['big', 'small']);
});

test('best supplier: newest price per supplier, compared per piece', () => {
  const item = { id: 'i1', name: 'Rice', piecesPerCarton: 24 };
  const suppliers = [
    { id: 's1', name: 'A' }, { id: 's2', name: 'B' }, { id: 's3', name: 'C', active: false },
  ];
  const supplierPrices = [
    { itemId: 'i1', supplierId: 's1', price: 5000, perUnit: 'carton', createdAt: 1 },
    { itemId: 'i1', supplierId: 's1', price: 4800, perUnit: 'carton', createdAt: 2 },
    { itemId: 'i1', supplierId: 's2', price: 4560, perUnit: 'carton', createdAt: 2 },
    { itemId: 'i1', supplierId: 's3', price: 1000, perUnit: 'carton', createdAt: 2 },
  ];
  const [r] = bestSupplierPerItem({ items: [item], suppliers, supplierPrices });
  assert.equal(r.best.supplierName, 'B');
  assert.equal(r.next.supplierName, 'A');
  assert.equal(r.supplierCount, 2);
  assert.equal(r.saving, 240);
  assert.equal(r.savingPct, 5);
});

test('best supplier: a per-piece price is compared fairly with a carton price', () => {
  const item = { id: 'i1', name: 'Rice', piecesPerCarton: 24 };
  const suppliers = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }];
  const supplierPrices = [
    { itemId: 'i1', supplierId: 's1', price: 4560, perUnit: 'carton', createdAt: 1 },
    { itemId: 'i1', supplierId: 's2', price: 185, perUnit: 'piece', createdAt: 1 },
  ];
  const [r] = bestSupplierPerItem({ items: [item], suppliers, supplierPrices });
  assert.equal(r.best.supplierName, 'B');
  assert.equal(r.saving, 5);
});

test('best supplier: an item with no prices is not listed', () => {
  assert.deepEqual(bestSupplierPerItem({ items: [{ id: 'i1' }], suppliers: [], supplierPrices: [] }), []);
});
