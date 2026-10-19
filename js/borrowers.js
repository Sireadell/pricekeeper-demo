// ============================================================
//  borrowers.js (UPDATED)
//  - Listener watches shops/ so owner sees staff changes live
//  - All DB writes go through shops/ (staff-compatible)
//  - Overpayment reduces existing debt with confirmation
//  - Debt warning in trade clears when balance is 0
//  - performedBy stamped on every transaction
//  - Payment recorded here now syncs to trade table (FIFO)
//  - Renamed from "Borrowers" to "Credit Accounts" throughout
//  - bizRefreshActivePanel called after every save/delete so
//    the business.js panel updates without needing a tab switch
// ============================================================

import { fmt, fmtSpan, uid, today, openModal, closeModal, toast, saveLocal, setBtnLoading, escapeHtml, withLoading, findBorrowerByName }
  from './utils.js';
import { currentUser, activeUid } from './auth.js';
import { getCurrentActor, logActivity, makePerformedBy, assertPermission } from './staff-auth.js';
import { db, collection, onSnapshot, query } from './firebase.js';
import { syncBorrowerPaymentToTrades, recordAccountPayment, recordOneRecordPayment, spendHeldOnDebts } from './trade-payment.js';
import { isContactsActive, saveContactDB, deleteContactDB, borrowerToContact, customerToContact } from './contacts.js';
import { saveCustomer } from './db.js';
import { gwWrite } from './write-gateway.js';   // D.8.2b sub-step 1
import { withPending } from './pending-overlay.js';
import { normName, isOneRecord, oneRecordStanding, newAccountFields, planAccountPayment, unpaidTradesForAccount, bucketTag, bucketLines } from './ledger.js';

let unsubBorrowers  = null;
let _borrowerSearch = '';
let _borrowerFilter = 'all';
let _borrowerSort   = 'recent';


// ── DB helpers — always write to shops/ ──────────────────────
// D.8.2b sub-step 1 — legacy (non-contacts) branch rides the write gateway:
// queues offline instead of hanging on a direct setDoc. The contacts branch
// is gateway-backed inside saveContactDB / deleteContactDB.
const saveBorrowerDB = async (uid, b) => {
  if (isContactsActive()) {
    await saveContactDB(uid, borrowerToContact(b));
  } else {
    await gwWrite('set', 'borrowers', b.id, b);
  }
};
const deleteBorrowerDB = async (uid, id) => {
  if (isContactsActive()) {
    await deleteContactDB(uid, id);
  } else {
    await gwWrite('delete', 'borrowers', id, null);
  }
};

// ── Get-or-create a credit account for a name ─────────────────
// Used by the unified Customers panel's "Add credit" action so a customer
// who has never owed can be given credit without leaving the page. Reuses
// the same proven saveBorrowerDB write path (contacts-aware, gateway-backed
// offline) — no new persistence logic. Returns the borrower id.
export async function ensureBorrowerForName(name, phone = '') {
  window._pkBorrowers = window._pkBorrowers || [];
  const existing = findBorrowerByName(window._pkBorrowers, name);
  if (existing) return existing.id;
  const b = { id: uid(), name, phone: phone || '', note: '',
    transactions: [], createdTs: Date.now(), lastActivityTs: Date.now(), ...newAccountFields() };
  window._pkBorrowers.push(b);
  const auid = activeUid();
  if (auid) await saveBorrowerDB(auid, b);
  saveLocal();
  window.bizRefreshActivePanel?.();
  return b.id;
}
window.ensureBorrowerForName = ensureBorrowerForName;

// ── Firestore Listener — watches shops/ so owner sees staff writes ──
export function startBorrowerListener(uid) {
  if (unsubBorrowers) { unsubBorrowers(); unsubBorrowers = null; }
  unsubBorrowers = onSnapshot(query(collection(db, 'shops', uid, 'borrowers')), snap => {
    if (window._pkContactsActive) return;
    window._pkBorrowers = withPending('borrowers', snap.docs.map(d => d.data()));
    saveLocal();
    renderBorrowers();
    window.__PK?.populateTradeCustSelect?.();
  });
}

export function stopBorrowerListener() {
  if (unsubBorrowers) { unsubBorrowers(); unsubBorrowers = null; }
}

// ── Filter / Sort / Search ────────────────────────────────────
export function setBorrowerFilter(filter) {
  _borrowerFilter = filter;
  ['all', 'owing', 'settled'].forEach(f => {
    document.getElementById('bFilter-' + f)?.classList.toggle('active', f === filter);
  });
  renderBorrowers();
}

export function setBorrowerSort(sort) {
  _borrowerSort = sort;
  ['recent', 'balance'].forEach(s => {
    document.getElementById('bSort-' + s)?.classList.toggle('active', s === sort);
  });
  renderBorrowers();
}

export function borrowerSearch() {
  _borrowerSearch = document.getElementById('borrowerSearchInput')?.value.toLowerCase().trim() || '';
  renderBorrowers();
}

// ── Balance helpers ───────────────────────────────────────────
// Single source of truth — Phase C.2. Returns the raw triple; callers
// clamp to zero if they need a "settled view" of an overpaid account.
export function borrowerBalance(b) {
  // D.3.8: a switched account has no running total, see ledger.js.
  if (isOneRecord(b)) {
    const st = oneRecordStanding(b);
    return { debt: st.owing, paid: 0, balance: st.balance };
  }
  const debt = (b?.transactions || []).filter(t => t.type === 'debt')
    .reduce((s, t) => s + (t.amount || 0), 0);
  const paid = (b?.transactions || []).filter(t => t.type === 'payment')
    .reduce((s, t) => s + (t.amount || 0), 0);
  return { debt, paid, balance: debt - paid };
}

// ── Which way does this account point? ────────────────────────
// borrowerBalance answers "how much is owed". This answers the same question
// in both directions, because an account can also hold money FOR a customer.
//
//   owing   > 0  the customer owes the shop
//   deposit > 0  the shop is holding the customer's money
//
// Only one of the two can ever be non-zero.
//
// WHY DEPOSIT IS NOT SIMPLY THE NEGATIVE BALANCE. A payment entry marked
// kind:'adjustment' is a trade-edit bill correction, not money anyone handed
// over, and those corrections can double up with the debt entry they were
// meant to correct. Verified against the live shop on 2026-09-24: ALIYU's
// account sat at -100 while his trade showed 2,125 charged and 2,125 paid,
// so that 100 was an artifact, and paying it back would have handed out money
// he never left.
//
// So a surplus only counts as a deposit once it is bigger than every
// correction on the account. That deliberately understates the deposit on an
// account carrying genuine corrections. Understating means the shop holds
// money it did not credit, which the customer will come and ask about.
// Overstating means paying out money nobody deposited, which nobody catches.
// Only one of those two errors is recoverable.
//
// Deposits created from here on carry no correction, so they show in full.
// The clamp only ever bites on the legacy accounts.
export function accountStanding(b) {
  if (isOneRecord(b)) {
    const st = oneRecordStanding(b);
    return {
      debt: st.owing, paid: 0, balance: st.balance, adjustments: 0,
      owing: st.owing, deposit: st.held, suspect: false,
      oneRecord: true, tradeOwing: st.tradeOwing, noTrade: st.noTrade, trades: st.trades,
    };
  }
  const { debt, paid, balance } = borrowerBalance(b);
  const adjustments = (b?.transactions || [])
    .filter(t => t.type === 'payment' && t.kind === 'adjustment')
    .reduce((s, t) => s + (t.amount || 0), 0);

  const surplus = Math.max(0, -balance);
  const deposit = Math.round(Math.max(0, surplus - adjustments) * 100) / 100;

  return {
    debt,
    paid,
    balance,
    adjustments,
    owing: Math.max(0, balance),
    deposit,
    // Negative, but every bit of it explained by corrections. Reads as settled.
    // Worth a look rather than a payout.
    suspect: surplus > 0 && deposit === 0,
  };
}

// ── Render ────────────────────────────────────────────────────
export function renderBorrowers() {
  const list = document.getElementById('borrowersList');
  if (!list) return;

  const openIds = new Set(
    [...document.querySelectorAll('.borrower-card.open')].map(el => el.id)
  );

  let borrowers = [...(window._pkBorrowers || [])];

  if (_borrowerSort === 'balance') {
    borrowers.sort((a, b) => borrowerBalance(b).balance - borrowerBalance(a).balance);
  } else {
    borrowers.sort((a, b) => (b.lastActivityTs || b.createdTs || 0) - (a.lastActivityTs || a.createdTs || 0));
  }

  // Total owed clamps individual negatives to 0 so overpaid accounts don't
  // mask another borrower's outstanding debt in the header KPI.
  const totalOwed = borrowers.reduce((a, b) => a + Math.max(0, borrowerBalance(b).balance), 0);
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('bTotalOwed',    fmt(totalOwed));
  setEl('bTotalCount',   borrowers.length);
  setEl('bOverdueCount', borrowers.filter(b => borrowerBalance(b).balance > 0).length);

  if (_borrowerFilter === 'owing')   borrowers = borrowers.filter(b => borrowerBalance(b).balance > 0);
  if (_borrowerFilter === 'settled') borrowers = borrowers.filter(b => borrowerBalance(b).balance <= 0);

  if (_borrowerSearch) {
    borrowers = borrowers.filter(b =>
      (b.name || '').toLowerCase().includes(_borrowerSearch) ||
      (b.phone || '').toLowerCase().includes(_borrowerSearch) ||
      (b.note  || '').toLowerCase().includes(_borrowerSearch)
    );
  }

  if (!borrowers.length) {
    const msg = _borrowerSearch
      ? `No accounts match "${escapeHtml(_borrowerSearch)}"`
      : _borrowerFilter === 'owing'   ? 'No accounts currently owing.'
      : _borrowerFilter === 'settled' ? 'No settled accounts yet.'
      : 'No credit accounts yet.<br>Click "Add Account" above.';
    list.innerHTML = `<div class="empty"><div class="ico">${_borrowerSearch ? '🔍' : '👤'}</div><p>${msg}</p></div>`;
    return;
  }

  const isStaff   = !!window._staffOwnerUid;
  const canDelete = !isStaff || (window._staffPerms?.canDelete ?? false);

  list.innerHTML = borrowers.map(b => {
    const { debt: totalDebt, paid, balance } = borrowerBalance(b);
    const settled   = balance <= 0;
    const cardId    = 'bc-' + b.id;
    const isOpen    = openIds.has(cardId);

    return `
      <div class="borrower-card${isOpen ? ' open' : ''}" id="${cardId}">
        <div class="borrow-hdr" onclick="document.getElementById('${cardId}').classList.toggle('open')">
          <div>
            <div class="borrow-name">👤 ${escapeHtml(b.name)}</div>
            ${b.phone ? `<div class="borrow-phone">📞 ${escapeHtml(b.phone)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="text-align:right;">
              <div class="borrow-balance ${settled ? 'settled' : 'owing'}">${settled ? '✅ Settled' : fmt(balance) + ' owing'}</div>
              ${totalDebt ? `<div style="font-size:.65rem;color:var(--muted);">Total: ${fmt(totalDebt)} · Paid: ${fmt(paid)}</div>` : ''}
            </div>
            <div class="actions">
              <button class="ibtn edit" onclick="event.stopPropagation();PK.editBorrower('${b.id}')">✏️</button>
              ${canDelete ? `<button class="ibtn del"  onclick="event.stopPropagation();PK.deleteBorrower('${b.id}')">🗑</button>` : ''}
            </div>
          </div>
        </div>

        <div class="borrow-body">
          <div class="borrow-top-actions">
            <button class="btn-secondary" onclick="PK.openAddDebtModal('${b.id}')">＋ Add Debt</button>
            <button class="btn-secondary" style="border-color:rgba(46,204,113,.3);color:var(--green);"
              onclick="PK.openAddPaymentModal('${b.id}')">💰 Payment</button>
            <button class="borrow-receipt-btn" onclick="PK.showBorrowerReceipt('${b.id}')">🧾 Receipt</button>
            <button class="borrow-receipt-btn" onclick="PK.printBorrowerStatement('${b.id}')">📋 Statement</button>
          </div>

          ${(b.transactions || []).length ? `
            <div class="btx-header">
              <span>Item / Note</span><span>Date</span><span>Amount</span><span>By</span><span>Type</span><span></span>
            </div>
            ${[...(b.transactions || [])].sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0)).map(tx => `
              <div class="btx-row">
                <span class="btx-name">${escapeHtml(tx.name || '—')}</span>
                <span class="btx-date">${tx.date || '—'}</span>
                <span class="btx-amount ${tx.type === 'payment' ? 'pos' : 'neg'}">${tx.type === 'payment' ? '-' : '+'}${fmt(tx.amount || 0)}</span>
                <span class="btx-date" style="color:var(--accent);font-size:.65rem;">${escapeHtml(tx.performedBy?.displayName || '—')}</span>
                <span class="btx-type ${tx.type === 'payment' ? 'btx-pay' : 'btx-debt'}">${tx.type === 'payment' ? 'Payment' : 'Debt'}</span>
                <button class="ibtn del" style="width:24px;height:24px;font-size:.65rem;"
                  onclick="PK.deleteBorrowerTx('${b.id}','${tx.id}')">🗑</button>
              </div>`).join('')}
          ` : `<p style="font-size:.78rem;color:var(--muted);padding:6px 0;">No transactions yet.</p>`}

          <div class="borrow-footer">
            <span>Balance: <strong class="${settled ? 'pos' : 'neg'}">${fmt(balance)}</strong></span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Credit Account Receipt ────────────────────────────────────
export function showBorrowerReceipt(borrowerId) {
  const b = (window._pkBorrowers || []).find(x => x.id === borrowerId);
  if (!b) return toast('Account not found', 'err');

  const appName = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const { debt, paid, balance: bal } = borrowerBalance(b);
  const orSt = isOneRecord(b) ? oneRecordStanding(b) : null;

  const waText = encodeURIComponent(orSt
    ? `*${appName} · Account Summary for ${b.name}*\n\n` +
      `From trades: ${fmt(orSt.tradeOwing)}\nOther debts: ${fmt(orSt.noTrade)}\nYour money with us: ${fmt(orSt.held)}\n` +
      `Balance Owing: ${fmt(Math.max(0, orSt.balance))}\n\nDate: ${today()}\nThank you!`
    : `*${appName} — Credit Account Summary for ${b.name}*\n\n` +
      `Total Debt: ${fmt(debt)}\nTotal Paid: ${fmt(paid)}\n` +
      `Balance Owing: ${fmt(bal)}\n\nDate: ${today()}\nThank you!`
  );

  let overlay = document.getElementById('receiptOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'receiptOverlay';
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="receipt-modal">
      <div class="receipt-paper">
        <h2>${appName}</h2>
        <p class="receipt-title">Credit Account Summary</p>
        <div class="receipt-row"><span>Name:</span><strong>${escapeHtml(b.name)}</strong></div>
        ${orSt ? `
        <div class="receipt-row"><span>From trades:</span><strong>${fmtSpan(orSt.tradeOwing)}</strong></div>
        <div class="receipt-row"><span>Other debts:</span><strong>${fmtSpan(orSt.noTrade)}</strong></div>
        <div class="receipt-row"><span>Your money with us:</span><strong>${fmtSpan(orSt.held)}</strong></div>` : `
        <div class="receipt-row"><span>Total Debt:</span><strong>${fmtSpan(debt)}</strong></div>
        <div class="receipt-row"><span>Total Paid:</span><strong>${fmtSpan(paid)}</strong></div>`}
        <div class="receipt-row big"><span>Balance:</span>
          <strong style="color:${bal>0?'#ff4757':'#2ecc71'}">${fmtSpan(bal)}</strong></div>
        <div class="receipt-date">${today()}</div>
      </div>
      <div class="receipt-actions">
        <button class="btn-secondary" onclick="closeModal('receiptOverlay')">Close</button>
        <a href="https://wa.me/?text=${waText}" target="_blank" class="btn-primary wa-btn">
          📲 WhatsApp
        </a>
        <button class="btn-primary" onclick="window.print()">🖨️ Print</button>
      </div>
    </div>`;
  overlay.classList.add('open');
}

window.showBorrowerReceipt  = showBorrowerReceipt;
window.printBorrowerReceipt = showBorrowerReceipt;

// ── Full Account Statement (printable new-window) ─────────────
export function printBorrowerStatement(borrowerId) {
  const b = (window._pkBorrowers || []).find(x => x.id === borrowerId);
  if (!b) return toast('Account not found', 'err');

  const appName = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const shop = (() => { try { return JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch(e) { return {}; } })();
  const { debt, paid, balance: bal } = borrowerBalance(b);
  const orSt = isOneRecord(b) ? oneRecordStanding(b) : null;

  const txs = [...(b.transactions || [])].sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0));

  let running = 0;
  const tableRows = orSt ? [
    ...orSt.trades.map(s => `<tr><td>${s.date || '—'}</td><td>Trade ${escapeHtml(s.id)}<br><span style="color:#999;font-size:11px">${fmt(s.totalRevenue ?? s.revenue ?? 0)} · paid ${fmt(s.amountReceived || 0)}</span></td><td class="num red">${fmt(s.balanceOwing || 0)}</td><td class="num grn"></td><td class="num"></td></tr>`),
    ...[...bucketLines(b, 'noTrade'), ...bucketLines(b, 'held')].sort((a, x) => (a.createdTs || 0) - (x.createdTs || 0)).map(t => {
      const owes = t.bucket === 'noTrade' ? (t.type !== 'payment') : (t.type === 'debt');
      return `<tr><td>${t.date || '—'}</td><td>${escapeHtml(t.name || '—')}<br><span style="color:#999;font-size:11px">${t.bucket === 'held' ? 'Money held for the customer' : 'No trade'}</span></td><td class="num red">${owes ? fmt(t.amount) : ''}</td><td class="num grn">${!owes ? fmt(t.amount) : ''}</td><td class="num"></td></tr>`;
    }),
  ].join('') : txs.map(tx => {
    const isDebt = tx.type === 'debt';
    running += isDebt ? (tx.amount || 0) : -(tx.amount || 0);
    const runColor = running > 0 ? '#c0392b' : '#27ae60';
    return `<tr>
      <td>${tx.date || '—'}</td>
      <td>${escapeHtml(tx.name || tx.note || '—')}${tx.note && tx.name ? '<br><span style="color:#999;font-size:11px">' + escapeHtml(tx.note) + '</span>' : ''}</td>
      <td class="num red">${isDebt ? fmt(tx.amount) : ''}</td>
      <td class="num grn">${!isDebt ? fmt(tx.amount) : ''}</td>
      <td class="num" style="color:${runColor};font-weight:600">${fmt(Math.abs(running))}</td>
    </tr>`;
  }).join('');

  const noTx = `<tr><td colspan="5" style="text-align:center;color:#999;padding:32px">No transactions recorded.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Statement — ${escapeHtml(b.name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#222;background:#fff;padding:32px 40px}
  .no-print{margin-bottom:20px;display:flex;gap:10px}
  .btn{padding:9px 20px;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:600}
  .btn-p{background:#222;color:#fff}
  .btn-c{background:#eee;color:#333}
  .hdr{text-align:center;padding-bottom:16px;border-bottom:2px solid #222;margin-bottom:24px}
  .hdr h1{font-size:22px;font-weight:700;letter-spacing:0.02em}
  .hdr .sub{font-size:12px;color:#666;margin-top:3px}
  .hdr .title{font-size:14px;font-weight:700;letter-spacing:0.08em;margin-top:10px;text-transform:uppercase}
  .meta{display:flex;justify-content:space-between;margin-bottom:20px}
  .meta dt{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px}
  .meta dd{font-size:14px;font-weight:600}
  .summary{display:flex;gap:0;border:1px solid #ddd;border-radius:6px;overflow:hidden;margin-bottom:24px}
  .sum-item{flex:1;padding:14px 18px;border-right:1px solid #ddd}
  .sum-item:last-child{border-right:none}
  .sum-item dt{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
  .sum-item dd{font-size:16px;font-weight:700}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#222;color:#fff}
  thead th{padding:9px 10px;font-size:11px;font-weight:600;text-align:left}
  thead th.num{text-align:right}
  tbody tr:nth-child(even){background:#f9f9f9}
  tbody td{padding:8px 10px;font-size:12px;border-bottom:1px solid #eee;vertical-align:top}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  td.red{color:#c0392b}
  td.grn{color:#27ae60}
  .foot{margin-top:32px;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:14px}
  @media print{
    .no-print{display:none}
    body{padding:16px 20px}
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="btn btn-p" onclick="window.print()">🖨 Print / Save PDF</button>
  <button class="btn btn-c" onclick="window.close()">✕ Close</button>
</div>
<div class="hdr">
  <h1>${escapeHtml(appName)}</h1>
  ${shop.address ? `<div class="sub">${escapeHtml(shop.address)}</div>` : ''}
  ${shop.phone   ? `<div class="sub">${escapeHtml(shop.phone)}</div>`   : ''}
  <div class="title">Credit Account Statement</div>
</div>
<div class="meta">
  <div>
    <dt>Customer</dt>
    <dd>${escapeHtml(b.name)}</dd>
    ${b.phone ? `<dt style="margin-top:8px">Phone</dt><dd>${escapeHtml(b.phone)}</dd>` : ''}
  </div>
  <div style="text-align:right">
    <dt>Statement Date</dt>
    <dd>${today()}</dd>
    <dt style="margin-top:8px">Total Transactions</dt>
    <dd>${txs.length}</dd>
  </div>
</div>
<div class="summary">${orSt ? `
  <div class="sum-item"><dt>From trades</dt><dd style="color:#c0392b">${fmt(orSt.tradeOwing)}</dd></div>
  <div class="sum-item"><dt>Other debts</dt><dd style="color:#c0392b">${fmt(orSt.noTrade)}</dd></div>
  <div class="sum-item"><dt>Held for customer</dt><dd style="color:#27ae60">${fmt(orSt.held)}</dd></div>
  <div class="sum-item"><dt>Balance Owing</dt><dd style="color:${orSt.balance > 0 ? '#c0392b' : '#27ae60'}">${fmt(Math.max(0, orSt.balance))}</dd></div>` : `
  <div class="sum-item"><dt>Total Debt</dt><dd style="color:#c0392b">${fmt(debt)}</dd></div>
  <div class="sum-item"><dt>Total Paid</dt><dd style="color:#27ae60">${fmt(paid)}</dd></div>
  <div class="sum-item"><dt>Balance Owing</dt><dd style="color:${bal > 0 ? '#c0392b' : '#27ae60'}">${fmt(bal)}</dd></div>`}
</div>
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Description</th>
      <th class="num">Debt</th>
      <th class="num">Payment</th>
      <th class="num">Balance</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows || noTx}
  </tbody>
</table>
<div class="foot">Generated by ${appName} &nbsp;·&nbsp; ${today()}</div>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=860,height=720');
  if (!w) return toast('⚠️ Pop-up blocked — allow pop-ups for this page', 'err');
  w.document.write(html);
  w.document.close();
}

window.printBorrowerStatement = printBorrowerStatement;

// ── Add / Edit Credit Account ─────────────────────────────────
export function openBorrowerModal(id) {
  const title = document.getElementById('bModalTitle');
  if (title) title.textContent = id ? '✏️ Edit Account' : '➕ New Credit Account';
  const idEl = document.getElementById('bId');
  if (idEl) idEl.value = id || '';
  if (id) {
    const b = (window._pkBorrowers || []).find(b => b.id === id);
    const n  = document.getElementById('bName');  if (n)  n.value  = b?.name  || '';
    const p  = document.getElementById('bPhone'); if (p)  p.value  = b?.phone || '';
    const nt = document.getElementById('bNote');  if (nt) nt.value = b?.note  || '';
  } else {
    ['bName','bPhone','bNote'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }
  openModal('borrowerOverlay');
}

// An account and its customer record are matched by name, so a rename on one
// side has to reach the other, or the account loses sight of its trades.
export async function carryRename(oldName, newName, selfId) {
  if (!oldName || normName(oldName) === normName(newName)) return;
  const auid = activeUid();
  const cust = findBorrowerByName(window._pkWholesale, oldName);
  if (cust && cust.id !== selfId) {
    cust.name = newName;
    if (auid) await (isContactsActive() ? saveContactDB(auid, customerToContact(cust)) : saveCustomer(auid, cust));
  }
  const bor = findBorrowerByName(window._pkBorrowers, oldName);
  if (bor && bor.id !== selfId) {
    bor.name = newName;
    if (auid) await saveBorrowerDB(auid, bor);
  }
  // Trades that only carry the name, with no live customer record behind them.
  const live = new Set((window._pkWholesale || []).map(c => c.id));
  const old = normName(oldName);
  const sales = window._pkSales || [];
  for (let i = 0; i < sales.length; i++) {
    const s = sales[i];
    if (live.has(s.custId) || normName(s.customerName || s.custName) !== old) continue;
    sales[i] = { ...s, customerName: newName, ...(s.custName ? { custName: newName } : {}) };
    if (auid) await gwWrite('update', 'sales', s.id, sales[i]);
  }
}

export const editBorrower = id => openBorrowerModal(id);

export async function saveBorrower() {
  const btn   = document.querySelector('#borrowerOverlay .btn-save');
  const name  = document.getElementById('bName')?.value.trim()  || '';
  const phone = document.getElementById('bPhone')?.value.trim() || '';
  const note  = document.getElementById('bNote')?.value.trim()  || '';
  const eid   = document.getElementById('bId')?.value           || '';
  if (!name) return toast('⚠️ Enter account name', 'err');
  if (phone && !/^0\d{10}$/.test(phone)) return toast('⚠️ Phone must be 11 digits starting with 0', 'err');

  // Duplicate name check — block if another account already has this name
  window._pkBorrowers = window._pkBorrowers || [];
  const dupCandidate = findBorrowerByName(window._pkBorrowers, name);
  const duplicate = dupCandidate && dupCandidate.id !== eid ? dupCandidate : null;
  if (duplicate) return toast(`⚠️ An account named "${duplicate.name}" already exists`, 'err');

  setBtnLoading(btn, true);
  try {
    const auid = activeUid();
    if (eid) {
      const idx = window._pkBorrowers.findIndex(b => b.id === eid);
      if (idx >= 0) {
        const oldName = window._pkBorrowers[idx].name;
        window._pkBorrowers[idx] = { ...window._pkBorrowers[idx], name, phone, note, lastActivityTs: Date.now() };
        if (auid) await saveBorrowerDB(auid, window._pkBorrowers[idx]);
        await carryRename(oldName, name, eid);
      }
    } else {
      const b = { id: uid(), name, phone, note, transactions: [], createdTs: Date.now(), lastActivityTs: Date.now(), ...newAccountFields() };
      window._pkBorrowers.push(b);
      if (auid) await saveBorrowerDB(auid, b);
    }
    saveLocal();
    renderBorrowers();
    closeModal('borrowerOverlay');
    toast('✅ Account saved!', 'ok');
    window.bizRefreshActivePanel?.();
  } finally { setBtnLoading(btn, false); }
}

export async function deleteBorrower(id) {
  if (!assertPermission('deleteBorrower')) return;
  const b = (window._pkBorrowers || []).find(b => b.id === id);
  if (!b) return;
  // Deleting would wipe a debt or money held for them with no trace.
  const st = accountStanding(b);
  if (st.owing > 0.009) return toast(`⚠️ ${b.name} still owes ${fmt(st.owing)}. Settle it before deleting.`, 'err');
  if (st.deposit > 0.009) return toast(`⚠️ You are holding ${fmt(st.deposit)} for ${b.name}. Pay it back before deleting.`, 'err');
  if (!confirm(`Delete "${b.name}" and all their records?`)) return;
  const btn = document.querySelector(`#bc-${id} .ibtn.del`);
  await withLoading(btn, async () => {
    window._pkBorrowers = window._pkBorrowers.filter(b => b.id !== id);
    const auid = activeUid();
    const contact = (window._pkContacts || []).find(x => x.id === id);
    if (auid && isContactsActive() && contact?.tags?.includes('customer')) {
      // Same person is also a customer: drop only the credit account side.
      await saveContactDB(auid, { ...contact, tags: contact.tags.filter(t => t !== 'borrower') });
    } else if (auid) {
      await deleteBorrowerDB(auid, id);
    }
    logActivity('DELETE_BORROWER', { name: b.name });
    saveLocal();
    renderBorrowers();
    toast('🗑 Account deleted', 'ok');
    window.bizRefreshActivePanel?.();
  });
}

// ── Transactions ──────────────────────────────────────────────
// D.3.7: goods taken on credit are a trade, with a trade number, stock and
// profit, so "Add Debt" opens New Trade with the customer filled in and
// "On credit" chosen. Only when there is no customer record to put on a trade
// does it fall back to the debt-without-a-trade box.
export async function openAddDebtModal(borrowerId) {
  const b = (window._pkBorrowers || []).find(x => x.id === borrowerId);
  const cust = b ? findBorrowerByName(window._pkWholesale, b.name) : null;
  if (cust && window.PK?.openNewTradeForCredit) {
    closeModal('txOverlay');
    document.getElementById('borrSheet')?.classList.remove('open');
    return window.PK.openNewTradeForCredit(cust.id);
  }
  return openNoTradeDebtModal(borrowerId);
}

// Money lent, or an old balance from before the app: a debt with no goods and
// no trade behind it. Owner only, because it makes debt appear from nothing.
export function openNoTradeDebtModal(borrowerId) {
  if (window._staffOwnerUid) return toast('⚠️ Only the owner can add a debt without a trade', 'err');
  document.getElementById('txBorrowerId').value       = borrowerId;
  document.getElementById('txType').value             = 'debt';
  document.getElementById('txModalTitle').textContent = '➕ Debt without a trade';
  document.getElementById('txItemRow').style.display  = 'none';
  const plan = document.getElementById('txPlan'); if (plan) plan.innerHTML = '';
  ['txName','txAmount','txNote'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('txName').value = 'Cash loan';
  document.getElementById('txDate').value = today();
  const amtIn = document.getElementById('txAmount'); if (amtIn) amtIn.oninput = null;

  const sel = document.getElementById('txItemPicker');
  if (sel) {
    sel.innerHTML = '<option value="">— Custom item / type manually —</option>' +
      (window._pkItems || []).map(i =>
        `<option value="${i.id}" data-sell="${i.sell}">${escapeHtml(i.name)} (sell: ${fmt(i.sell)})</option>`
      ).join('');
    sel.onchange = () => {
      const opt = sel.options[sel.selectedIndex];
      const nameEl = document.getElementById('txName');
      const amtEl  = document.getElementById('txAmount');
      if (opt.value && nameEl) nameEl.value = opt.text.split(' (sell')[0];
      if (opt.dataset.sell && amtEl) amtEl.value = opt.dataset.sell;
    };
  }
  openModal('txOverlay');
}

export function openAddPaymentModal(borrowerId) {
  const b = (window._pkBorrowers || []).find(x => x.id === borrowerId);
  const st = b ? accountStanding(b) : { balance: 0, deposit: 0 };
  const balance = st.balance;

  document.getElementById('txBorrowerId').value       = borrowerId;
  document.getElementById('txType').value             = 'payment';
  // D.3.5 — a settled account and one already holding money are different
  // situations, and the title is where the cashier finds out which.
  document.getElementById('txModalTitle').textContent =
    balance > 0     ? `💰 Record Payment · Owes ${fmt(balance)}`
    : st.deposit > 0 ? `💰 Record Payment · Holding ${fmt(st.deposit)}`
    :                  '💰 Record Payment · ✅ Settled';
  document.getElementById('txItemRow').style.display  = 'none';
  ['txName','txAmount','txNote'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('txName').value = 'Payment received';
  document.getElementById('txDate').value = today();
  const planEl = document.getElementById('txPlan');
  const amtEl  = document.getElementById('txAmount');
  if (planEl) planEl.innerHTML = '';
  if (amtEl) amtEl.oninput = (b && isOneRecord(b)) ? () => _renderPaymentPlan(b) : null;
  openModal('txOverlay');
}

// D.3.8: shows where the money will go before it is saved, from the same
// plan the save uses.
function _renderPaymentPlan(b) {
  const el = document.getElementById('txPlan');
  const amount = parseFloat(document.getElementById('txAmount')?.value) || 0;
  if (!el) return;
  if (amount <= 0) { el.innerHTML = ''; return; }
  const p = planAccountPayment(b, amount);
  const row = (l, v, cls) => `<div class="tx-plan-row"><span>${l}</span><span class="${cls}">${fmt(v)}</span></div>`;
  el.innerHTML = `<div class="tx-plan">${
    p.toTrades.map(t => row(`${t.clears ? 'Clears' : 'Pays part of'} trade <b>${escapeHtml(t.sale.id.slice(-5))}</b>`, t.amount, 'ok')).join('') +
    (p.toNoTrade > 0 ? row('Pays debt with no trade', p.toNoTrade, 'ok') : '') +
    (p.toHeld > 0 ? row('Left over, kept as their money', p.toHeld, 'held') : '')
  }</div>`;
}

export async function saveBorrowerTx() {
  const btn        = document.querySelector('#txOverlay .btn-save');
  const borrowerId = document.getElementById('txBorrowerId')?.value;
  const type       = document.getElementById('txType')?.value        || 'debt';
  const name       = document.getElementById('txName')?.value.trim() || (type === 'payment' ? 'Payment' : 'Item');
  const amount     = parseFloat(document.getElementById('txAmount')?.value);
  const note       = document.getElementById('txNote')?.value.trim() || '';
  const date       = document.getElementById('txDate')?.value        || today();

  if (!amount || amount <= 0) return toast('⚠️ Enter a valid amount', 'err');

  const acct0 = (window._pkBorrowers || []).find(x => x.id === borrowerId);
  const oneRec = isOneRecord(acct0);
  // Overpayment check (old accounts only; a switched account shows the plan)
  if (type === 'payment' && !oneRec) {
    const b       = (window._pkBorrowers || []).find(x => x.id === borrowerId);
    const balance = b ? borrowerBalance(b).balance : 0;

    // D.3.5 — this used to be a bare "are you sure". It is the only way a
    // deposit gets created, so it now says what actually happens to the money
    // rather than sounding like a mistake being waved through.
    if (balance <= 0) {
      if (!confirm(
        `${b?.name || 'This account'} owes you nothing.\n\n` +
        `${fmt(amount)} will be held as their deposit. They can spend it on a ` +
        `future trade, or you can pay it back to them in cash.\n\n` +
        `OK to hold it · Cancel to stop`
      )) return;
    } else if (amount > balance) {
      const excess = amount - balance;
      const reduce = confirm(
        `⚠️ Payment of ${fmt(amount)} exceeds balance of ${fmt(balance)}.\n\n` +
        `Excess: ${fmt(excess)}\n\n` +
        `OK → Record only ${fmt(balance)} (exact balance)\n` +
        `Cancel → Record full ${fmt(amount)}, holding ${fmt(excess)} as their deposit`
      );
      if (reduce) {
        const amtEl = document.getElementById('txAmount');
        if (amtEl) amtEl.value = balance;
      }
    }
  }

  // Re-read amount after possible adjustment
  const finalAmount = parseFloat(document.getElementById('txAmount')?.value);
  if (!finalAmount || finalAmount <= 0) return;

  setBtnLoading(btn, true);
  try {
    window._pkBorrowers = window._pkBorrowers || [];
    const idx = window._pkBorrowers.findIndex(b => b.id === borrowerId);
    if (idx < 0) return;

    const actor = getCurrentActor();
    // A debt typed here never has a trade behind it.
    const tx = {
      id: uid(), type, name, ...(type === 'debt' ? bucketTag(window._pkBorrowers[idx], 'noTrade') : {}),
      amount: finalAmount,
      note, date,
      createdTs: Date.now(),
      performedBy: makePerformedBy(actor),
    };
    window._pkBorrowers[idx].transactions = window._pkBorrowers[idx].transactions || [];
    if (!(type === 'payment' && oneRec)) window._pkBorrowers[idx].transactions.push(tx);
    window._pkBorrowers[idx].lastActivityTs = Date.now();

    const auid = activeUid();

    // ── Payment on a switched account: trades, then no-trade debts, then held ──
    if (type === 'payment' && oneRec) {
      const p = await recordOneRecordPayment(window._pkBorrowers[idx], finalAmount, date, auid,
        `Payment recorded via Business · ${name}`);
      const cleared = p.toTrades.filter(t => t.clears).length;
      toast(`💰 ${fmt(finalAmount)} recorded${cleared ? ` · ${cleared} trade${cleared > 1 ? 's' : ''} cleared` : ''}${p.toHeld > 0 ? ` · ${fmt(p.toHeld)} kept for them` : ''}`, 'ok');
    }
    // ── Payment: ledger entry + trades it clears (FIFO), one linked write ──
    else if (type === 'payment') {
      const b    = window._pkBorrowers[idx];
      const cust = findBorrowerByName(window._pkWholesale, b.name);
      const { applied, leftover } = await recordAccountPayment(
        b, cust?.id || null, finalAmount, date, auid,
        `Payment recorded via Credit Accounts · ${name}`
      );
      if (cust) {
        if (applied > 0 && leftover === 0) {
          toast(`✅ ${fmt(applied)} applied to trade${applied < finalAmount ? 's' : ''} · fully cleared`, 'ok');
        } else if (applied > 0 && leftover > 0) {
          toast(`💰 ${fmt(applied)} applied to trades · ${fmt(leftover)} has no matching trade debt`, 'ok');
        } else {
          toast('💰 Payment recorded!', 'ok');
        }
      } else {
        toast('💰 Payment recorded!', 'ok');
      }
    } else if (auid) {
      await saveBorrowerDB(auid, window._pkBorrowers[idx]);
    }
    // ─────────────────────────────────────────────────────────

    logActivity(type === 'payment' ? 'ADD_PAYMENT' : 'ADD_DEBT', {
      borrower: window._pkBorrowers[idx].name,
      amount: finalAmount,
    });

    saveLocal();
    renderBorrowers();
    window.__PK?.populateTradeCustSelect?.();
    closeModal('txOverlay');

    // Stay on the borrower sheet — re-render it in place rather than
    // collapsing the whole panel back to the list
    window.bizRefreshBorrowersAndSheet?.(borrowerId);

    if (type !== 'payment') toast('➕ Debt added!', 'ok');
  } finally { setBtnLoading(btn, false); }
}

// ── Trades this person still shows as owing ───────────────────
// The account ledger and the trade table are two separate stores, and this
// reads the trade side. Exported so the Customers panel can decide whether to
// offer the settle button without duplicating the lookup.
export function unpaidTradesFor(name) {
  const cust = findBorrowerByName(window._pkWholesale, name);
  if (!cust) return { custId: null, trades: [], total: 0 };
  const trades = (window._pkSales || [])
    .filter(s => s.custId === cust.id && (s.balanceOwing || 0) > 0 && !s.voided)
    .sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0));
  return {
    custId: cust.id,
    trades,
    total: Math.round(trades.reduce((sum, s) => sum + (s.balanceOwing || 0), 0) * 100) / 100,
  };
}

// ── Settle old trades out of money already held ───────────────
// D.3.5, second half. The situation this fixes: someone leaves money with the
// shop, comes back later, takes goods on credit, and nobody presses "Use
// deposit" at the till. The books then say two things at once, that the shop
// is holding their money AND that they owe for a trade.
//
// WHY NO LEDGER ENTRY IS WRITTEN HERE. An unpaid trade already puts a debt
// entry on the account when it is created, so the account has ALREADY counted
// those goods, which is exactly why the deposit shown is the amount left over
// after them. Writing a second entry here would charge the customer twice for
// the same goods. The trade table is the only side that never got told, so the
// trade table is the only side this touches.
//
// That is also why the amount applied is the whole unpaid total rather than
// the deposit figure: with Musa, 5,000 left, 3,000 of goods taken, the deposit
// reads 2,000 because his 3,000 was already spent. Settling the 3,000 trade
// leaves his deposit at 2,000, and both screens finally agree.
//
// Gated to owner and admin along with paying a deposit back. It writes off
// trade debt, and anything that can make debt disappear belongs with whoever
// carries the loss if it is done wrongly.
export async function settleTradesFromDeposit(borrowerId) {
  if (!assertPermission('payBackDeposit')) return;

  const b = (window._pkBorrowers || []).find(x => x.id === borrowerId);
  if (!b) return;
  const { deposit } = accountStanding(b);
  if (deposit <= 0) return toast('⚠️ You are not holding money for this customer', 'err');

  if (isOneRecord(b)) {
    const st = oneRecordStanding(b);
    const use = Math.min(st.held, st.owing);
    if (use <= 0) return toast('⚠️ Nothing owed to pay from it', 'err');
    if (!confirm(`Use ${fmt(use)} of the ${fmt(st.held)} you are holding for ${b.name} to pay what they owe?\n\nOldest trade first. No cash changes hands.\n\nOK to use it · Cancel to stop`)) return;
    const r = await spendHeldOnDebts(b, activeUid());
    logActivity('SETTLE_FROM_DEPOSIT', { borrower: b.name, amount: r.used, trades: r.cleared });
    saveLocal(); renderBorrowers();
    window.bizRefreshBorrowersAndSheet?.(borrowerId);
    return toast(`✅ ${fmt(r.used)} of held money used${r.cleared ? ` · ${r.cleared} trade${r.cleared > 1 ? 's' : ''} cleared` : ''}`, 'ok');
  }

  const { custId, trades, total } = unpaidTradesFor(b.name);
  if (!custId) return toast(`⚠️ No customer record matching ${b.name}, so trades cannot be matched`, 'err');
  if (!trades.length) return toast('⚠️ No unpaid trades to settle', 'err');

  const preview = trades.map(s => `\n• ${s.id} · ${fmt(s.balanceOwing || 0)}`).join('');
  if (!confirm(
    `${b.name}'s money has already paid for ${fmt(total)} of trades that still show as unpaid:${preview}\n\n` +
    `Mark them paid?\n\n` +
    `Their deposit stays at ${fmt(deposit)}, because this money was already counted when the goods went out.\n\n` +
    `OK to settle · Cancel to stop`
  )) return;

  const auid = activeUid();
  const { applied } = await syncBorrowerPaymentToTrades(
    custId, total, today(), auid, `Settled from ${b.name}'s money held by the shop`,
  );

  logActivity('SETTLE_FROM_DEPOSIT', { borrower: b.name, amount: applied, trades: trades.length });
  saveLocal();
  renderBorrowers();
  window.bizRefreshBorrowersAndSheet?.(borrowerId);
  toast(`✅ ${trades.length} trade${trades.length > 1 ? 's' : ''} settled · ${fmt(applied)}`, 'ok');
}

// ── Hand a deposit back as cash ───────────────────────────────
// D.3.5. The shop is holding money for this customer and is now giving it
// back, so the ledger gets a DEBT entry: the account goes from "we hold their
// money" back to level. Nothing is being sold and no trade is touched.
//
// Gated to owner and admin (founder decision, 2026-09-24). The button is
// hidden for everyone else, and this check is here as well because a hidden
// button is not a permission.
//
// The amount is always the whole deposit as accountStanding reports it, never
// a typed figure. A part payback would need its own flow with its own record
// of what is left, and inventing that silently under a button labelled
// "pay it back" is how a customer ends up short.
export async function payBackDeposit(borrowerId) {
  if (!assertPermission('payBackDeposit')) return;

  const idx = (window._pkBorrowers || []).findIndex(b => b.id === borrowerId);
  if (idx < 0) return;
  const b = window._pkBorrowers[idx];
  const { deposit } = accountStanding(b);
  if (deposit <= 0) return toast('⚠️ There is no deposit to pay back', 'err');

  if (!confirm(
    `Pay ${fmt(deposit)} back to ${b.name}?\n\n` +
    `Take ${fmt(deposit)} cash out and hand it over. Their account goes back to zero.\n\n` +
    `OK to record it · Cancel to stop`
  )) return;

  const actor = getCurrentActor();
  b.transactions = b.transactions || [];
  b.transactions.push({
    id: uid(), type: 'debt', kind: 'payback', ...bucketTag(b, 'held'),
    name: 'Deposit paid back',
    amount: deposit,
    note: `${fmt(deposit)} handed back in cash. Account returns to zero.`,
    date: today(), createdTs: Date.now(),
    performedBy: makePerformedBy(actor),
  });
  b.lastActivityTs = Date.now();

  const auid = activeUid();
  if (auid) await saveBorrowerDB(auid, b);

  logActivity('PAY_BACK_DEPOSIT', { borrower: b.name, amount: deposit });
  saveLocal();
  renderBorrowers();
  window.__PK?.populateTradeCustSelect?.();
  window.bizRefreshBorrowersAndSheet?.(borrowerId);
  toast(`↩ ${fmt(deposit)} paid back to ${b.name}`, 'ok');
}

// Deleting a line can wipe a debt, so it takes the same right as deleting an
// account, and it is logged.
export async function deleteBorrowerTx(borrowerId, txId) {
  if (!assertPermission('deleteBorrower')) return;
  const idx = (window._pkBorrowers || []).findIndex(b => b.id === borrowerId);
  if (idx < 0) return;
  const b  = window._pkBorrowers[idx];
  const tx = (b.transactions || []).find(t => t.id === txId);
  if (!tx) return;
  // On a switched account a trade-linked line is history only. Deleting it
  // would erase the record and leave the trade exactly as it was.
  if (isOneRecord(b) && !(tx.bucket && (tx.or || tx.type === 'opening'))) {
    return toast('⚠️ This line comes from a trade. Edit or void the trade instead.', 'err');
  }
  if (!confirm(`Delete "${tx.name || 'this entry'}" (${fmt(tx.amount || 0)})?\n\nThis cannot be undone.`)) return;
  logActivity('DELETE_BORROWER_TX', { borrower: b.name, name: tx.name, type: tx.type, amount: tx.amount });
  window._pkBorrowers[idx].transactions = (window._pkBorrowers[idx].transactions || []).filter(t => t.id !== txId);
  window._pkBorrowers[idx].lastActivityTs = Date.now();
  const auid = activeUid();
  if (auid) await saveBorrowerDB(auid, window._pkBorrowers[idx]);
  saveLocal();
  renderBorrowers();
  toast('🗑 Transaction deleted', 'ok');
  // Stay on the borrower sheet after deleting a tx
  window.bizRefreshBorrowersAndSheet?.(borrowerId);
}