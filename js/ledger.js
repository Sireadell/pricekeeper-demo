// ============================================================
//  ledger.js · D.3.8 one record for money owed
//
//  Before this, the same money was written twice: on each trade, and as a
//  running total on the customer's account. Every path that updated one and
//  not the other made Business and the Trade table disagree, and the owner
//  had to sort it out by hand (Shamsu, 2026-10-06).
//
//  An account that has been switched over (b.oneRecord set) keeps no running
//  total. What it owes is worked out every time from three things:
//
//    1. what its trades still owe            (the trades themselves)
//    2. debts with no trade behind them      (lines tagged bucket:'noTrade')
//    3. money the shop is holding for them   (lines tagged bucket:'held')
//
//  Trade-linked lines keep being written to the account as history, but they
//  count for nothing here. Editing, voiding or paying a trade changes the
//  trade, and Business follows on its own.
//
//  Bucket lines use the ordinary debt/payment types so the old formula on a
//  phone still running old code keeps working:
//    noTrade  debt = they owe more      payment = they owe less
//    held     payment = we hold more    debt    = we hold less
//  The one exception is the switch-over opening line, type 'opening', which
//  the old formula ignores on purpose: the old total already contains it.
// ============================================================

import { uid, today } from './utils.js';

const r2 = n => Math.round((n || 0) * 100) / 100;
export const normName = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function isOneRecord(b) { return !!b?.oneRecord; }

// The shop has switched once any account has. New accounts made after that
// are born switched, so nothing ever lands in the old system again.
export function shopOnOneRecord() {
  return (window._pkBorrowers || []).some(isOneRecord);
}
export function newAccountFields() {
  return shopOnOneRecord() ? { oneRecord: { ts: Date.now() } } : {};
}

// Name a trade belongs to: the customer record it points at, else the name
// saved on the trade (customerName, or custName on old trades).
export function saleCustomerName(s) {
  const c = (window._pkWholesale || []).find(x => x.id === s.custId);
  return c?.name || s.customerName || s.custName || '';
}

// Every live trade for this account, oldest first.
export function tradesForAccount(b) {
  const n = normName(b?.name);
  if (!n) return [];
  return (window._pkSales || [])
    .filter(s => !s.voided && normName(saleCustomerName(s)) === n)
    .sort((a, x) => (a.createdTs || 0) - (x.createdTs || 0));
}
export function unpaidTradesForAccount(b) {
  return tradesForAccount(b).filter(s => (s.balanceOwing || 0) > 0.009);
}

// Signed effect of one bucket line on its own bucket.
function bucketValue(t) {
  if (t.type === 'opening') return t.amount || 0;
  if (t.bucket === 'noTrade') return t.type === 'debt' ? (t.amount || 0) : -(t.amount || 0);
  if (t.bucket === 'held')    return t.type === 'payment' ? (t.amount || 0) : -(t.amount || 0);
  return 0;
}
// Only lines written after the switch count (marked or:1), plus the opening
// line. Anything before the switch is already inside the opening figure, so
// counting it again would double it.
export function bucketLines(b, bucket) {
  return (b?.transactions || []).filter(t => t.bucket === bucket && (t.or || t.type === 'opening'));
}
// Fields for a new bucket line on account b.
export function bucketTag(b, bucket) {
  return isOneRecord(b) ? { bucket, or: 1 } : { bucket };
}

export function oneRecordStanding(b) {
  const trades = unpaidTradesForAccount(b);
  const tradeOwing = r2(trades.reduce((a, s) => a + (s.balanceOwing || 0), 0));
  const noTradeNet = r2(bucketLines(b, 'noTrade').reduce((a, t) => a + bucketValue(t), 0));
  const heldNet    = r2(bucketLines(b, 'held').reduce((a, t) => a + bucketValue(t), 0));
  // A no-trade debt paid past zero is money held, and held money spent past
  // zero is a debt. Neither should happen, but if it does it shows up rather
  // than vanishing.
  const noTrade = Math.max(0, noTradeNet) + Math.max(0, -heldNet);
  const held    = Math.max(0, heldNet) + Math.max(0, -noTradeNet);
  const owing   = r2(tradeOwing + noTrade);
  return { trades, tradeOwing, noTrade: r2(noTrade), held: r2(held), owing, balance: r2(owing - held) };
}

// ── Where a payment would go, without saving anything ──────────
// Oldest unpaid trade first, then no-trade debts, then whatever is left is
// held. Used for the preview in Record Payment and for the save itself, so
// what the cashier sees is exactly what is written.
export function planAccountPayment(b, amount) {
  const st = oneRecordStanding(b);
  let left = r2(amount);
  const toTrades = [];
  for (const s of st.trades) {
    if (left <= 0) break;
    const pay = r2(Math.min(left, s.balanceOwing || 0));
    if (pay <= 0) continue;
    toTrades.push({ sale: s, amount: pay, clears: pay >= r2(s.balanceOwing || 0) });
    left = r2(left - pay);
  }
  const toNoTrade = r2(Math.min(left, st.noTrade));
  left = r2(left - toNoTrade);
  return { toTrades, toNoTrade, toHeld: left, standing: st };
}

// ── Switch-over: does this account's old total match its trades? ─
// The old total is the plain sum of every debt and payment line. If it
// equals what the trades owe, the account switches with nothing to decide.
// Otherwise the owner chooses which side is right.
export function legacyTotal(b) {
  return r2((b?.transactions || []).reduce((a, t) =>
    a + (t.type === 'debt' ? (t.amount || 0) : t.type === 'payment' ? -(t.amount || 0) : 0), 0));
}
export function switchOverCheck(b) {
  const business = legacyTotal(b);
  const trades = r2(unpaidTradesForAccount(b).reduce((a, s) => a + (s.balanceOwing || 0), 0));
  const diff = r2(business - trades);
  return { business, trades, diff, matches: Math.abs(diff) < 1 };
}

// Applies the owner's choice and switches the account. Mutates b in place.
//   'trades'   the trades are right, the difference is dropped
//   'business' Business is right, the difference is kept as an opening line
export function switchAccount(b, choice, performedBy) {
  const { diff, matches } = switchOverCheck(b);
  b.transactions = b.transactions || [];
  if (!matches && choice === 'business' && Math.abs(diff) >= 0.01) {
    b.transactions.push({
      id: uid(),
      type: 'opening',
      bucket: diff > 0 ? 'noTrade' : 'held',
      name: diff > 0 ? 'Opening balance · no trade' : 'Opening balance · held for them',
      amount: Math.abs(diff),
      note: 'Carried over when Business switched to one record',
      date: today(),
      createdTs: Date.now(),
      performedBy,
    });
  }
  b.oneRecord = { ts: Date.now(), choice: matches ? 'matched' : choice, diff };
  b.lastActivityTs = Date.now();
  return b;
}
