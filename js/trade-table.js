// ============================================================
//  trade-table.js — v6 (Phase D.3.4b redesign)
//  - New header / toolbar / summary tiles / table layout
//  - Status filter chips (separate from time-range filter)
//  - Select mode + bulk Export / Void / Delete
//  - Row action popover (Print / View / Edit / Void / Delete)
//  - Loading skeleton + redesigned empty states
//  - Mobile card stack at ≤768 px
//  - Privacy mode: hides Profit column + tile via body.pk-privacy-on
// ============================================================

import { fmt, escapeHtml, isoDate, csvCell, CSV_BOM } from './utils.js';
import { currentUser, activeUid as resolveUid } from './auth.js';
import { voidSale, deleteSaleDB, saveBorrower } from './db.js';
import { saveLocal, toast, withLoading, findBorrowerByName, fmtCompact } from './utils.js';
import { logActivity, getCurrentActor, makePerformedBy, costBlindForCurrentRole } from './staff-auth.js';
import { restoreStock, takeStock } from './trade-payment.js';
import { isOneRecord } from './ledger.js';

// Stock on void / unvoid / delete. A void puts the goods back on the shelf
// and records that inside voidedBy (already on the staff void whitelist in
// firestore.rules, so no rules change). Unvoid only takes stock back off when
// that mark is there: trades voided before this existed never had their
// stock returned, and taking it again would count those goods twice.
function _voidStock(sale, activeUid) {
  restoreStock(sale.items, activeUid);
  return { ...getCurrentActor(), stockReturned: true };
}
function _unvoidStock(sale, activeUid) {
  if (sale.voidedBy && sale.voidedBy.stockReturned) takeStock(sale.items, activeUid);
}
function _deleteStock(sale, activeUid) {
  if (!sale.voided) restoreStock(sale.items, activeUid);
}

const PAGE_SIZE = 10;

// D.3.4b UPDATE — time-range vocabulary widened from {all,today,week,
// month,custom} to {all,today,yesterday,week,lastweek,month,lastmonth,
// year,custom}. Old values still pass the filter (they're a subset of
// the new vocabulary's keys).
let _tableFilter    = 'month';   // default time-range on load = current month ('all' still selectable)
// status: any mix of paid|partial|credit|voided. Empty means All. Several
// chips can be on at once (e.g. Partial + Credit = everyone who still owes).
const _tableStatuses = new Set();
const _STATUS_KEYS = ['paid', 'partial', 'credit', 'voided'];
const _statusMatch = s => !_tableStatuses.size || _tableStatuses.has(_saleStatus(s));
let _tableFromDate  = '';
let _tableToDate    = '';
let _tablePage      = 0;
let _tableSearch    = '';
let _tableStaffFilter = '';
let _tableCustFilter  = '';

// D.3.4b select mode + loading flag
let _pkTradeSelMode = false;
let _pkTradeSelIds  = new Set();
let _pkTradeReady   = false;
setTimeout(() => {
  if (!_pkTradeReady) {
    _pkTradeReady = true;
    try { renderTradeTable(); } catch (_) {}
  }
}, 1200);

export function tradeTableSearch(val) {
  _tableSearch = (val || '').toLowerCase().trim();
  _tablePage   = 0;
  renderTradeTable();
}
window.tradeTableSearch = tradeTableSearch;

// Legacy entry point — picker-chip flow goes through setTradeTimeRange,
// but trade.js / app.js still call this name for backwards-compat.
export function setTradeTableFilter(filter) { setTradeTimeRange(filter); }

export function setTradeTimeRange(filter) {
  _tableFilter = filter;
  _tablePage   = 0;
  const dateWrap = document.getElementById('tfbDates');
  if (dateWrap) dateWrap.style.display = filter === 'custom' ? '' : 'none';
  if (filter !== 'custom') {
    const from = document.getElementById('tradeFromDate');
    const to   = document.getElementById('tradeToDate');
    if (from) from.value = '';
    if (to)   to.value   = '';
  }
  _closeTradePicker();
  renderTradeTable();
}

export function setTradeStaffFilter(username) {
  _tableStaffFilter = username || '';
  _tablePage = 0;
  _closeTradePicker();
  renderTradeTable();
}

export function setTradeCustomerFilter(custId) {
  _tableCustFilter = custId || '';
  _tablePage = 0;
  _closeTradePicker();
  renderTradeTable();
}

// D.3.4b: status filter via chip
export function setTradeStatus(status) {
  // All clears the others; any other chip toggles on/off. Turning every
  // chip on is the same as All, so it collapses back to All.
  if (!status || status === 'all') _tableStatuses.clear();
  else if (_tableStatuses.has(status)) _tableStatuses.delete(status);
  else _tableStatuses.add(status);
  if (_STATUS_KEYS.every(k => _tableStatuses.has(k))) _tableStatuses.clear();
  _tablePage   = 0;
  renderTradeTable();
}

// D.3.4b: select mode toggle
export function toggleTradeSelectMode() {
  _pkTradeSelMode = !_pkTradeSelMode;
  if (!_pkTradeSelMode) _pkTradeSelIds = new Set();
  renderTradeTable();
}

export function toggleTradeRowSelected(e, id) {
  if (e) {
    const t = e.target;
    if (t && t.closest('.pk-tr-more')) return;
    if (t && t.closest('.pk-tr-popover')) return;
    e.stopPropagation();
  }
  if (_pkTradeSelIds.has(id)) _pkTradeSelIds.delete(id);
  else                        _pkTradeSelIds.add(id);
  renderTradeTable();
}

// Derive the status bucket from a sale record
function _saleStatus(s) {
  if (s.voided) return 'voided';
  const bal  = s.balanceOwing  || 0;
  const paid = s.amountReceived || 0;
  if (bal <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'credit';
}

const TIME_LABELS = {
  all:        'All time',
  today:      'Today',
  yesterday:  'Yesterday',
  week:       'This week',
  lastweek:   'Last week',
  month:      'This month',
  lastmonth:  'Last month',
  year:       'This year',
  custom:     'Custom range',
};

const TIME_OPTIONS = [
  ['all',       'All time'],
  null, // divider
  ['today',     'Today'],
  ['yesterday', 'Yesterday'],
  ['week',      'This week'],
  ['lastweek',  'Last week'],
  ['month',     'This month'],
  ['lastmonth', 'Last month'],
  ['year',      'This year'],
  null,
  ['custom',    '＋ Custom range…'],
];

// Date math for the time-range filter.
function _timeRangeBounds(filter, now = new Date()) {
  const toIso = isoDate;
  const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  if (filter === 'today') {
    return { from: toIso(now), to: toIso(now) };
  }
  if (filter === 'yesterday') {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return { from: toIso(y), to: toIso(y) };
  }
  if (filter === 'week') {
    const cut = new Date(); cut.setDate(cut.getDate() - 6);
    return { from: toIso(cut), to: toIso(now) };
  }
  if (filter === 'lastweek') {
    const end = new Date(); end.setDate(end.getDate() - 7);
    const start = new Date(); start.setDate(start.getDate() - 13);
    return { from: toIso(start), to: toIso(end) };
  }
  if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toIso(start), to: toIso(now) };
  }
  if (filter === 'lastmonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toIso(start), to: toIso(end) };
  }
  if (filter === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: toIso(start), to: toIso(now) };
  }
  return null; // all / custom / unknown
}

// Active-staff list for the picker. Owner mode only: filter by
// staff.active !== false so soft-archived members disappear from
// the dropdown (historical "By: {name}" rendering in old trades is
// independent — it reads sale.performedBy, not the staff list).
//
// Source priority:
//   1. window._pkStaff if populated (refreshed at auth)
//   2. window._pkStaffCache (set by business.js when Staff panel opens)
//   3. Fallback: union of usernames from sales (preserves picker for
//      users who haven't visited Business → Staff yet)
function _getActiveStaff() {
  const fromCache = window._pkStaff || window._pkStaffCache;
  if (Array.isArray(fromCache) && fromCache.length) {
    return fromCache
      .filter(s => s && s.active !== false)
      .map(s => ({ username: s.username, displayName: s.displayName || s.username }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  const allSales = window._pkSales || [];
  const staffMap = {};
  allSales.forEach(s => {
    if (s.performedBy?.username) {
      staffMap[s.performedBy.username] = s.performedBy.displayName || s.performedBy.username;
    }
  });
  return Object.entries(staffMap)
    .map(([username, displayName]) => ({ username, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function renderTradeTable() {
  const wrap = document.getElementById('tradeTableWrap');
  if (!wrap) return;

  const allSales = [...(window._pkSales || [])];

  // Loading skeleton: only on the very first paint with no data
  if (!_pkTradeReady && allSales.length === 0) {
    _renderLoadingState(wrap);
    _renderHeaderSummary([], 0, 0, 0, 0, 0);
    _renderChipCounts([]);
    return;
  }
  if (allSales.length > 0) _pkTradeReady = true;

  // ── 1. Apply time-range filter ─────────────────────────────
  let sales = allSales.slice();

  if (_tableFilter === 'custom') {
    const from = document.getElementById('tradeFromDate')?.value;
    const to   = document.getElementById('tradeToDate')?.value;
    _tableFromDate = from || '';
    _tableToDate   = to   || '';
    if (from) sales = sales.filter(s => (s.date || '') >= from);
    if (to)   sales = sales.filter(s => (s.date || '') <= to);
  } else if (['unpaid','partial','paid','voided'].includes(_tableFilter)) {
    // Legacy compat — old setTradeTableFilter values now route through status
    _tableStatuses.clear();
    _tableStatuses.add(_tableFilter === 'unpaid' ? 'credit' : _tableFilter);
    _tableFilter = 'all';
  } else if (_tableFilter !== 'all') {
    const bounds = _timeRangeBounds(_tableFilter);
    if (bounds) {
      if (bounds.from) sales = sales.filter(s => (s.date || '') >= bounds.from);
      if (bounds.to)   sales = sales.filter(s => (s.date || '') <= bounds.to);
    }
  }

  // ── 2. Customer + staff filter (internal picker-chip state) ─
  if (_tableCustFilter) sales = sales.filter(s => s.custId === _tableCustFilter);

  if (_tableStaffFilter) {
    sales = sales.filter(s =>
      (s.performedBy?.username === _tableStaffFilter) ||
      (s.performedBy?.displayName === _tableStaffFilter)
    );
  }

  // ── 3. Search filter ──────────────────────────────────
  if (_tableSearch) {
    sales = sales.filter(s => {
      if ((s.id || '').toLowerCase().includes(_tableSearch)) return true;
      const cust = (window._pkWholesale || []).find(c => c.id === s.custId);
      if ((cust?.name || '').toLowerCase().includes(_tableSearch)) return true;
      if ((s.performedBy?.displayName || '').toLowerCase().includes(_tableSearch)) return true;
      if (Array.isArray(s.items))
        return s.items.some(it => (it.itemName || '').toLowerCase().includes(_tableSearch));
      return (s.itemName || '').toLowerCase().includes(_tableSearch);
    });
  }

  // ── 4. Chip counts BEFORE the status filter, AFTER search, so a searched
  // customer's chips show their own numbers, not the whole shop's ──
  const chipBase = sales.slice();

  // ── 5. Status filter (several chips can be on) ───────────
  if (_tableStatuses.size) sales = sales.filter(_statusMatch);


  sales = sales.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0));

  // ── 6. Summary numbers (reflect current filter) ──────────
  const validSales = sales.filter(s => !s.voided);
  const totalRev  = validSales.reduce((a, s) => a + (s.totalRevenue ?? s.revenue ?? 0), 0);
  const totalProf = validSales.reduce((a, s) => a + (s.totalProfit ?? 0), 0);
  const totalDisc = validSales.reduce((a, s) => a + (s.totalDiscount || 0), 0);
  const totalBal  = validSales.reduce((a, s) => a + (s.balanceOwing  || 0), 0);

  _renderHeaderSummary(sales, totalRev, totalProf, totalDisc, totalBal, sales.length);
  _renderChipCounts(chipBase);
  _renderToolbarUI();

  // ── 7. Empty states ──────────────────────────────────────
  if (!sales.length) {
    if (!allSales.length) {
      wrap.innerHTML = _emptyZero();
    } else {
      wrap.innerHTML = _emptyFiltered(_tableSearch);
    }
    _clearPagination();
    return;
  }

  // ── 8. Pagination ────────────────────────────────────────
  const totalPages = Math.ceil(sales.length / PAGE_SIZE);
  if (_tablePage >= totalPages) _tablePage = totalPages - 1;
  if (_tablePage < 0) _tablePage = 0;
  const pageSales = sales.slice(_tablePage * PAGE_SIZE, (_tablePage + 1) * PAGE_SIZE);

  // ── 9. Permissions ───────────────────────────────────────
  const perms    = window._staffPerms;
  const isStaff  = !!window._staffOwnerUid;
  const canEdit   = !isStaff || (perms?.canEdit   ?? false);
  const canVoid   = !isStaff || (perms?.canVoid   ?? false);
  const canDelete = !isStaff || (perms?.canDelete ?? false);

  // Store permission flags on the wrap BEFORE building innerHTML so
  // the row render path (which reads wrap.dataset) sees the current
  // values, not the previous render's stale ones.
  wrap.dataset.canEdit   = canEdit   ? '1' : '0';
  wrap.dataset.canVoid   = canVoid   ? '1' : '0';
  wrap.dataset.canDelete = canDelete ? '1' : '0';

  // ── 10. Desktop table + mobile cards (same wrap, CSS swaps) ─
  // Serial base: page 0 → 1, page 1 → 11, ... sort is descending by
  // createdTs so the first row on page 1 is the newest (= #1).
  const serialBase  = _tablePage * PAGE_SIZE;
  const desktopHTML = _renderDesktopTable(pageSales, _pkTradeSelMode, serialBase);
  const mobileHTML  = _renderMobileCards(pageSales, _pkTradeSelMode, serialBase);
  wrap.innerHTML = `
    <div class="pk-tr-desktop-view">${desktopHTML}</div>
    <div class="pk-tr-mobile-view">${mobileHTML}</div>
  `;

  _renderPagination(totalPages, sales.length);
  _refreshBulkBar();
}

// ── Render: desktop table ───────────────────────────────────
function _renderDesktopTable(pageSales, selMode, serialBase) {
  const checkboxCol = selMode
    ? '<th class="checkbox"></th>'
    : '';
  // ACTIONS column header gets a visible label per Task 5b. The col-by
  // class on the "By" header + body cells mirrors col-profit so the
  // CSS rule for [data-mode="cashier"] can hide both consistently.
  // The "#" column is a reverse-global serial: newest trade = #1, oldest
  // = #N. Sits before Trade ID; when bulk-select is on, it sits second
  // after the checkbox column. Serial is computed from the page offset
  // (serialBase = _tablePage * PAGE_SIZE) plus the row's index on the
  // page, so it continues uninterrupted across pages.
  return `
    <table class="pk-tr-table">
      <thead>
        <tr>
          ${checkboxCol}
          <th class="pk-tr-serial num">#</th>
          <th>Trade ID</th>
          <th>Customer</th>
          <th class="num">Items</th>
          <th class="num">Amount</th>
          <th class="num col-profit">Profit</th>
          <th class="num">Balance</th>
          <th>Status</th>
          <th class="col-by">By</th>
          <th>Date</th>
          <th class="actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pageSales.map((sale, idx) => _renderRow(sale, selMode, serialBase + idx + 1)).join('')}
      </tbody>
    </table>
  `;
}

// ── Render: one desktop row ─────────────────────────────────
function _renderRow(sale, selMode, serial) {
  const cust   = (window._pkWholesale || []).find(c => c.id === sale.custId);
  const custName = cust?.name || sale.customerName || sale.custName || 'Walk-in';
  const rev    = sale.totalRevenue ?? sale.revenue ?? 0;
  const prof   = sale.totalProfit ?? 0;
  const bal    = sale.balanceOwing || 0;
  const iCount = Array.isArray(sale.items) ? sale.items.length : 1;
  const voided = !!sale.voided;
  const status = _saleStatus(sale);
  // TODO: surface edit history banner inside edit modal — the row-level
  //       "edited" pill was removed; sale.editedAt is now consumed only
  //       by the modal (see trade.js _editTrade).
  const byName = sale.performedBy?.displayName || sale.performedBy?.username || 'Owner';

  const refundDue = !voided && (sale.refundDue || 0) > 0 ? sale.refundDue : 0;
  const hasRefundedPayment = !voided && (sale.payments || []).some(p => p.type === 'refund' && !p.removed);
  const _rawOverpay = !voided && !refundDue && !hasRefundedPayment
    ? Math.max(0, Math.round(((sale.amountReceived || 0) - (sale.totalRevenue ?? sale.revenue ?? 0)) * 100) / 100)
    : 0;
  const silentOverpay = (_rawOverpay > 0 && !(sale.overpaymentApplied > 0)) ? _rawOverpay : 0;
  const effectiveOverpay = refundDue || silentOverpay;

  const sel = _pkTradeSelIds.has(sale.id);
  const rowClass = [
    voided ? 'is-voided' : '',
    sel ? 'is-selected' : '',
    effectiveOverpay > 0 ? 'has-refund' : '',
  ].filter(Boolean).join(' ');

  const onclickAttr = selMode
    ? ` onclick="PK.toggleTradeRowSelected(event,'${sale.id}')"`
    : ` onclick="PK.expandTradeRow('${sale.id}')"`;

  const cb = selMode
    ? `<td><span class="pk-tr-rowcheck"></span></td>`
    : '';

  const statusLabel = (refundDue > 0 || silentOverpay <= 0)
    ? (effectiveOverpay > 0 ? `↩ REFUND ₦${_fmtAmount(effectiveOverpay)}` : ({ paid: '✓ PAID', partial: 'PARTIAL', credit: 'CREDIT', voided: 'VOIDED' }[status] || ''))
    : null; // silentOverpay: two-badge layout
  const statusClass = effectiveOverpay > 0 ? 'refund' : status;

  const isLoss = prof < 0;
  const profitCell = voided
    ? `<td class="num col-profit"><span style="color:var(--muted);">—</span></td>`
    : `<td class="num ${isLoss ? 'red' : 'green'} col-profit">${isLoss ? '−' : '+'}${_fmtAmount(Math.abs(prof))}</td>`;

  const balClass = (voided || bal <= 0)
    ? 'pk-tr-bal--zero'
    : status === 'credit' ? 'pk-tr-bal--credit' : 'pk-tr-bal--partial';
  const balanceCell = effectiveOverpay > 0
    ? `<td class="num pk-tr-bal pk-tr-bal--refund"><span class="currency">−₦</span>${_fmtAmount(effectiveOverpay)}</td>`
    : (voided || bal <= 0)
      ? `<td class="num pk-tr-bal pk-tr-bal--zero">—</td>`
      : `<td class="num pk-tr-bal ${balClass}"><span class="currency">₦</span>${_fmtAmount(bal)}</td>`;

  // Inline action set — depends on row state. The trailing
  // event.stopPropagation prevents the row's expand-on-click.
  const actions = _renderRowActions(sale, status, voided);

  return `
    <tr class="${rowClass}" data-id="${escapeHtml(sale.id || '')}"${onclickAttr}>
      ${cb}
      <td class="pk-tr-serial num">${serial}</td>
      <td>
        <span class="pk-tr-id">${escapeHtml(sale.id || '—')}</span>
        ${sale._pkSyncPending ? '<span class="pk-tr-sync" title="Pending sync">⧗</span>' : ''}
      </td>
      <td class="name">${escapeHtml(custName)}${sale.visitorName ? `<span class="pk-tr-visitor">via ${escapeHtml(sale.visitorName)}</span>` : ''}</td>
      <td class="num">${iCount}</td>
      <td class="num gold"><span class="currency">₦</span>${_fmtAmount(rev)}</td>
      ${profitCell}
      ${balanceCell}
      <td onclick="event.stopPropagation()">
        ${silentOverpay > 0
          ? `<div class="pk-tr-refund-pair">
              <span class="pk-tr-status pk-tr-status--refund" onclick="PK.popoverFire('flagoverpay','${sale.id}')" style="cursor:pointer" title="Flag for refund">↩ REFUND ₦${_fmtAmount(silentOverpay)}</span>
              <span class="pk-tr-status pk-tr-status--dismiss" onclick="PK.popoverFire('dismissoverpay','${sale.id}')" style="cursor:pointer" title="Applied to previous debt — dismiss">✓ Applied</span>
             </div>`
          : `<span class="pk-tr-status pk-tr-status--${statusClass}"
               ${refundDue > 0 ? `onclick="PK.openRefundAction('${sale.id}')" style="cursor:pointer" title="Click to mark as refunded"` : ''}>${statusLabel}</span>`}
        ${_extraNote(sale, voided)}
      </td>
      <td class="col-by"><span class="pk-tr-by">${escapeHtml(byName)}</span></td>
      <td><span class="pk-tr-date">${_fmtDateCompact(sale)}</span></td>
      <td onclick="event.stopPropagation()">${actions}</td>
    </tr>
  `;
}

// Inline action set per row state. Every action that used to live behind
// the ⋯ popover (Print, Void/Unvoid, Delete, view payments) is now shown
// directly on the row instead, since the desktop table has room for it
// and clicking ⋯ first just slowed down daily use. Refund-related actions
// (Mark refunded / Flag / Dismiss) are not duplicated here, they already
// render as clickable badges in the status cell. Role-gating (canEdit /
// canVoid / canDelete) still applies per button.
function _renderRowActions(sale, status, voided) {
  const wrap = document.getElementById('tradeTableWrap');
  const canEdit   = wrap?.dataset.canEdit   === '1';
  const canVoid   = wrap?.dataset.canVoid   === '1';
  const canDelete = wrap?.dataset.canDelete === '1';
  const id        = sale.id;

  const printBtn = `<button class="pk-tr-act-btn pk-tr-act-btn--icon" type="button"
      onclick="PK.popoverFire('print','${id}')"
      aria-label="Print receipt" title="Print receipt">🖨</button>`;

  const deleteBtn = canDelete
    ? `<button class="pk-tr-act-btn pk-tr-act-btn--danger pk-tr-act-btn--icon" type="button"
        onclick="PK.popoverFire('delete','${id}')"
        aria-label="Delete trade" title="Delete trade">⌫</button>`
    : '';

  if (voided) {
    const unvoidBtn = canVoid
      ? `<button class="pk-tr-act-btn pk-tr-act-btn--icon" type="button"
          onclick="PK.popoverFire('unvoid','${id}')"
          aria-label="Unvoid trade" title="Unvoid trade">↺</button>`
      : '';
    return `<div class="pk-tr-actions-cell">${printBtn}${unvoidBtn}${deleteBtn}</div>`;
  }

  // Pay button — uses the MISSION §3.5 locked Pay SVG glyph (a credit
  // card with magstripe + signature line). currentColor inherits the
  // success-green token so the icon reads as a money-in action.
  const payBtn = (status === 'partial' || status === 'credit')
    ? `<button class="pk-tr-act-btn pk-tr-act-btn--pay" type="button"
        onclick="PK.tradeQuickPay(event,'${id}')"
        aria-label="Record payment"><svg class="pk-tr-pay-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" stroke-width="1.5"/><line x1="2.5" y1="9" x2="21.5" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="14.5" x2="9" y2="14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Pay</button>`
    : '';

  // "View payments" — only shown on PAID rows, since PARTIAL/CREDIT rows
  // already carry the Pay button. Mirrors the popover's old dropped-in
  // condition (hasPaymentActivity) so it only appears where there's
  // actually a payment ledger worth opening.
  const hasPaymentActivity = (sale.amountReceived || 0) > 0
    || (Array.isArray(sale.payments) && sale.payments.length > 0);
  const paymentBtn = (status === 'paid' && hasPaymentActivity)
    ? `<button class="pk-tr-act-btn pk-tr-act-btn--icon" type="button"
        onclick="PK.popoverFire('pay','${id}')"
        aria-label="View payments" title="View payments">💰</button>`
    : '';

  const editBtn = canEdit
    ? `<button class="pk-tr-act-btn" type="button"
        onclick="PK.tradeQuickEdit(event,'${id}')"
        aria-label="Edit trade">✎ Edit</button>`
    : '';

  const voidBtn = canVoid
    ? `<button class="pk-tr-act-btn pk-tr-act-btn--danger pk-tr-act-btn--icon" type="button"
        onclick="PK.popoverFire('void','${id}')"
        aria-label="Void trade" title="Void trade">⊘</button>`
    : '';

  return `<div class="pk-tr-actions-cell">${payBtn}${paymentBtn}${printBtn}${editBtn}${voidBtn}${deleteBtn}</div>`;
}

// ── Render: mobile card stack ───────────────────────────────
function _renderMobileCards(pageSales, selMode, serialBase) {
  return pageSales.map((sale, idx) => {
    const serial = serialBase + idx + 1;
    const cust = (window._pkWholesale || []).find(c => c.id === sale.custId);
    const custName = cust?.name || sale.customerName || sale.custName || 'Walk-in';
    const rev = sale.totalRevenue ?? sale.revenue ?? 0;
    const prof = sale.totalProfit ?? 0;
    const bal = sale.balanceOwing || 0;
    const iCount = Array.isArray(sale.items) ? sale.items.length : 1;
    const voided = !!sale.voided;
    const status = _saleStatus(sale);
    const byName = sale.performedBy?.displayName || sale.performedBy?.username || 'Owner';
    const sel = _pkTradeSelIds.has(sale.id);

    const refundDue = !voided && (sale.refundDue || 0) > 0 ? sale.refundDue : 0;
    const hasRefundedPayment = !voided && (sale.payments || []).some(p => p.type === 'refund' && !p.removed);
    const _rawOverpay = !voided && !refundDue && !hasRefundedPayment
      ? Math.max(0, Math.round(((sale.amountReceived || 0) - (sale.totalRevenue ?? sale.revenue ?? 0)) * 100) / 100)
      : 0;
    const silentOverpay = (_rawOverpay > 0 && !(sale.overpaymentApplied > 0)) ? _rawOverpay : 0;
    const effectiveOverpay = refundDue || silentOverpay;

    const cls = [
      'pk-tr-mcard',
      voided ? 'is-voided' : '',
      selMode ? 'is-selectable' : '',
      sel ? 'is-selected' : '',
      effectiveOverpay > 0 ? 'has-refund' : '',
    ].filter(Boolean).join(' ');

    const onclickAttr = selMode
      ? ` onclick="PK.toggleTradeRowSelected(event,'${sale.id}')"`
      : ` onclick="PK.expandTradeRow('${sale.id}')"`;

    const mCardStatusLabel = effectiveOverpay > 0
      ? `↩ REFUND ₦${_fmtAmount(effectiveOverpay)}`
      : { paid: '✓ PAID', partial: 'PARTIAL', credit: 'CREDIT', voided: 'VOIDED' }[status] || '';
    const mCardStatusClass = effectiveOverpay > 0 ? 'refund' : status;
    // For silent overpay on mobile: two-badge layout inside the right column
    const mCardStatusHtml = silentOverpay > 0
      ? `<div class="pk-tr-refund-pair pk-tr-refund-pair--col">
           <span class="pk-tr-status pk-tr-status--refund" onclick="event.stopPropagation();PK.popoverFire('flagoverpay','${sale.id}')" style="cursor:pointer" title="Flag for refund">↩ REFUND ₦${_fmtAmount(silentOverpay)}</span>
           <span class="pk-tr-status pk-tr-status--dismiss" onclick="event.stopPropagation();PK.popoverFire('dismissoverpay','${sale.id}')" style="cursor:pointer" title="Applied to previous debt">✓ Applied</span>
         </div>`
      : `<span class="pk-tr-status pk-tr-status--${mCardStatusClass}"
           ${refundDue > 0 ? `onclick="event.stopPropagation();PK.openRefundAction('${sale.id}')" style="cursor:pointer" title="Click to mark as refunded"` : ''}>${mCardStatusLabel}</span>`;

    const mCardIsLoss = prof < 0;
    const profitRow = voided
      ? `<div class="pk-tr-mcard-prof is-voided">—</div>`
      : `<div class="pk-tr-mcard-prof${mCardIsLoss ? ' is-loss' : ''}">${mCardIsLoss ? '−' : '+'}<span class="currency">₦</span>${_fmtAmount(Math.abs(prof))} ${mCardIsLoss ? 'loss' : 'profit'}</div>`;

    const balRow = effectiveOverpay > 0
      ? `<div class="pk-tr-mcard-bal" style="font-size:11px;margin-top:1px;font-variant-numeric:tabular-nums;color:var(--red);">−<span class="currency">₦</span>${_fmtAmount(effectiveOverpay)} to refund</div>`
      : (!voided && bal > 0)
        ? `<div class="pk-tr-mcard-bal" style="font-size:11px;margin-top:1px;font-variant-numeric:tabular-nums;color:${status === 'credit' ? 'var(--red)' : 'var(--a2)'};"><span class="currency">₦</span>${_fmtAmount(bal)} owing</div>`
        : '';

    return `
      <div class="${cls}" data-id="${escapeHtml(sale.id || '')}"${onclickAttr}>
        <div class="pk-tr-mcard-top">
          <div style="min-width:0;">
            ${selMode ? '<span class="pk-tr-mcard-checkbox" aria-hidden="true"></span> ' : ''}
            <span class="pk-tr-mcard-serial">#${serial}</span>
            <span class="pk-tr-mcard-id">${escapeHtml(sale.id || '—')}</span>
            <div class="pk-tr-mcard-cust">${escapeHtml(custName)}</div>
            ${sale.visitorName ? `<div class="pk-tr-mcard-visitor">via ${escapeHtml(sale.visitorName)}</div>` : ''}
            <div class="pk-tr-mcard-meta">${iCount} item${iCount !== 1 ? 's' : ''}<span class="pk-tr-mcard-by"> · by ${escapeHtml(byName)}</span></div>
          </div>
          <div class="pk-tr-mcard-right">
            ${mCardStatusHtml}
            ${_extraNote(sale, voided)}
            <div class="pk-tr-mcard-date">${_fmtDateCompact(sale, true)}</div>
          </div>
        </div>
        <div class="pk-tr-mcard-bottom">
          <div>
            <div class="pk-tr-mcard-amt"><span class="currency">₦</span>${_fmtAmount(rev)}</div>
            ${profitRow}
            ${balRow}
          </div>
          <button class="pk-tr-more" type="button"
            onclick="event.stopPropagation();PK.openTradeRowPopover(event,'${sale.id}')"
            aria-label="Trade actions">⋯</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Render: header summary numbers ──────────────────────────
function _renderHeaderSummary(sales, totalRev, totalProf, totalDisc, totalBal, count) {
  const setEl  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setHtml = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };

  setEl('tStatCount',    count.toLocaleString('en-NG'));
  setHtml('tStatRevenue',  `<span class="currency">₦</span>${_fmtAmount(totalRev)}`);
  setHtml('tStatProfit',   `<span class="currency">₦</span>${_fmtAmount(totalProf)}`);
  setHtml('tStatDiscount', `<span class="currency">₦</span>${_fmtAmount(totalDisc)}`);
  setHtml('tStatBalance',  `<span class="currency">₦</span>${_fmtAmount(totalBal)}`);

  // Outstanding tile coloring
  const outTile = document.getElementById('tStatBalance');
  if (outTile) {
    outTile.classList.remove('pk-tr-tile-val--danger');
    if (totalBal > 0) outTile.classList.add('pk-tr-tile-val--danger');
  }

  // Page header
  setEl('trHeadCount', count.toLocaleString('en-NG'));
  setEl('trHeadTimeLabel', _composeTimeLabel());
  setEl('trHeadRevenue', fmtCompact(totalRev));
  setEl('trHeadProfit',  fmtCompact(totalProf));
  setEl('trHeadOutstanding', fmtCompact(totalBal));

  // Legacy sub label (hidden but kept)
  setEl('tradeTableSub', `${count} trade${count !== 1 ? 's' : ''} · ${TIME_LABELS[_tableFilter] || 'all'}${_tableSearch ? ' · "' + _tableSearch + '"' : ''}`);
}

function _composeTimeLabel() {
  if (_tableFilter === 'custom' && (_tableFromDate || _tableToDate)) {
    return `${_tableFromDate || '…'} → ${_tableToDate || '…'}`;
  }
  return TIME_LABELS[_tableFilter] || 'all time';
}

// ── Render: status chip counts ──────────────────────────────
function _renderChipCounts(chipBase) {
  const counts = { all: chipBase.length, paid: 0, partial: 0, credit: 0, voided: 0 };
  for (const s of chipBase) {
    const st = _saleStatus(s);
    counts[st] = (counts[st] || 0) + 1;
  }
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('trChipAllCount',     counts.all);
  setEl('trChipPaidCount',    counts.paid);
  setEl('trChipPartialCount', counts.partial);
  setEl('trChipCreditCount',  counts.credit);
  setEl('trChipVoidedCount',  counts.voided);

  // Active chip styling
  document.querySelectorAll('.pk-tr-chip').forEach(btn => {
    const st = btn.dataset.status;
    btn.classList.toggle('is-active', st === 'all' ? !_tableStatuses.size : _tableStatuses.has(st));
  });
}

function _renderToolbarUI() {
  // Show/hide custom date inputs (only while time-range = custom)
  const dw = document.getElementById('tfbDates');
  if (dw) dw.style.display = _tableFilter === 'custom' ? '' : 'none';

  // Select toggle pressed state
  const tog = document.getElementById('pkTrSelectToggle');
  if (tog) tog.setAttribute('aria-pressed', _pkTradeSelMode ? 'true' : 'false');

  // Picker-chip labels + active state
  const setChip = (chipId, labelId, value, defaultLabel, label) => {
    const chip = document.getElementById(chipId);
    const lbl  = document.getElementById(labelId);
    if (lbl)  lbl.textContent = label || defaultLabel;
    if (chip) chip.classList.toggle('is-active', !!value);
  };
  setChip(
    'pkTrTimeChip', 'pkTrTimeLabel',
    _tableFilter !== 'all',
    'All time',
    _composeTimeLabel(),
  );

  // Staff: hide chip in staff mode (they only see their own trades)
  const staffChip = document.getElementById('pkTrStaffChip');
  if (staffChip) {
    const isStaff = !!window._staffOwnerUid;
    staffChip.style.display = isStaff ? 'none' : '';
  }
  const staffName = _tableStaffFilter
    ? (_getActiveStaff().find(s => s.username === _tableStaffFilter)?.displayName || _tableStaffFilter)
    : '';
  setChip('pkTrStaffChip', 'pkTrStaffLabel', !!_tableStaffFilter, 'All staff', staffName || 'All staff');

  // Customer
  const cust = _tableCustFilter
    ? (window._pkWholesale || []).find(c => c.id === _tableCustFilter)
    : null;
  setChip('pkTrCustChip', 'pkTrCustLabel', !!_tableCustFilter, 'All', cust?.name || 'All');
}

// ── Empty / loading helpers ─────────────────────────────────
function _emptyFiltered(q) {
  const term = q ? `"${escapeHtml(q)}"` : 'your current filters';
  return `
    <div class="pk-tr-empty">
      <div class="pk-tr-empty-icon" aria-hidden="true">⌕</div>
      <div class="pk-tr-empty-title">No trades match ${term}</div>
      <div class="pk-tr-empty-sub">Try a different search term, or clear filters to see all trades.</div>
      <button class="pk-tr-empty-cta" onclick="PK.clearTradeFilters()">Clear search</button>
    </div>`;
}
function _emptyZero() {
  return `
    <div class="pk-tr-empty">
      <div class="pk-tr-empty-icon" aria-hidden="true">⊕</div>
      <div class="pk-tr-empty-title">No trades yet</div>
      <div class="pk-tr-empty-sub">Start your first sale to track revenue, profit, and customers.</div>
      <button class="pk-tr-empty-cta" onclick="PK.openNewTradeModal()">＋ New Trade</button>
    </div>`;
}

function _renderLoadingState(wrap) {
  const skelRow = (widths) => `
    <tr>${widths.map(w =>
      `<td><span class="pk-tr-skel-line" style="width:${w}%;"></span></td>`
    ).join('')}</tr>`;
  const widthsRow = [80, 70, 30, 70, 55, 45, 50, 60, 65, 30];
  wrap.innerHTML = `
    <div class="pk-tr-desktop-view">
      <table class="pk-tr-table">
        <thead>
          <tr>
            <th>Trade ID</th><th>Customer</th>
            <th class="num">Items</th><th class="num">Amount</th>
            <th class="num col-profit">Profit</th>
            <th class="num">Balance</th>
            <th>Status</th><th class="col-by">By</th><th>Date</th><th class="actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${skelRow(widthsRow)}
          ${skelRow([75, 60, 30, 65, 50, 40, 50, 55, 60, 30])}
          ${skelRow([85, 80, 30, 60, 45, 35, 50, 55, 65, 30])}
          ${skelRow([78, 55, 30, 70, 50, 45, 50, 60, 60, 30])}
          ${skelRow([82, 65, 30, 65, 48, 42, 50, 55, 62, 30])}
        </tbody>
      </table>
    </div>
    <div class="pk-tr-mobile-view">
      ${[1,2,3,4].map(() => `
        <div class="pk-tr-mcard">
          <div class="pk-tr-mcard-top">
            <div style="flex:1;">
              <span class="pk-tr-skel-line" style="width:70%; height:11px;"></span>
              <div style="margin-top:8px;"><span class="pk-tr-skel-line" style="width:55%; height:14px;"></span></div>
              <div style="margin-top:4px;"><span class="pk-tr-skel-line" style="width:40%; height:11px;"></span></div>
            </div>
            <div><span class="pk-tr-skel-line" style="width:60px; height:18px;"></span></div>
          </div>
          <div class="pk-tr-mcard-bottom">
            <span class="pk-tr-skel-line" style="width:90px; height:18px;"></span>
            <span class="pk-tr-skel-line" style="width:28px; height:28px; border-radius:6px;"></span>
          </div>
        </div>`).join('')}
    </div>
  `;
  _clearPagination();
}

// ── Currency formatters ─────────────────────────────────────
function _fmtAmount(n) {
  return Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}
// _fmtCompact imported from utils.js (fmtCompact). K=1K, has B suffix.

// One small line under the status saying where a customer's extra money
// went, so a trade they overpaid on does not just read PAID with the extra
// gone from view. Trades saved before 2026-10-06 have no overpaymentHeld,
// so they get the plain wording.
function _extraNote(sale, voided) {
  const applied = sale.overpaymentApplied || 0;
  if (voided || applied <= 0 || (sale.refundDue || 0) > 0) return '';
  const held = sale.overpaymentHeld;
  const toOld = held == null ? 0 : Math.max(0, applied - held);
  const parts = held == null
    ? [`₦${_fmtAmount(applied)} extra used`]
    : [
        toOld > 0 ? `₦${_fmtAmount(toOld)} paid old debt` : '',
        held > 0 ? `◆ ₦${_fmtAmount(held)} kept for them` : '',
      ].filter(Boolean);
  return `<div class="pk-tr-extra" style="font-size:11px;color:#85B7EB;margin-top:3px;white-space:nowrap;">${parts.join(' · ')}</div>`;
}

function _fmtDateCompact(sale, hideTime) {
  const ts = sale.createdTs;
  const d  = ts ? new Date(ts) : (sale.date ? new Date(sale.date + 'T00:00:00') : null);
  if (!d || isNaN(d)) return sale.date || '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day   = d.getDate();
  const mon   = months[d.getMonth()];
  const year  = d.getFullYear();
  const sameYear = year === new Date().getFullYear();
  if (hideTime) {
    return sameYear ? `${day} ${mon}` : `${day} ${mon} ${year}`;
  }
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  const timeStr = `${h12}:${m} ${ampm}`;
  return sameYear
    ? `${day} ${mon} · ${timeStr}`
    : `${day} ${mon} ${year} · ${timeStr}`;
}

// ── Bulk bar / selection helpers ────────────────────────────
function _refreshBulkBar() {
  const bar = document.getElementById('pkTrBulkBar');
  const cnt = document.getElementById('pkTrBulkCount');
  if (cnt) cnt.textContent = _pkTradeSelIds.size;
  if (bar) {
    if (_pkTradeSelMode && _pkTradeSelIds.size > 0) bar.removeAttribute('hidden');
    else bar.setAttribute('hidden', '');
  }
}

// ── Clear all filters ───────────────────────────────────────
export function clearTradeFilters() {
  const s = document.getElementById('tradeSearchInput');
  if (s) s.value = '';
  _tableSearch = '';
  _tableStatuses.clear();
  _tableFilter = 'all';
  _tableFromDate = '';
  _tableToDate   = '';
  _tableStaffFilter = '';
  _tableCustFilter  = '';
  const dates = document.getElementById('tfbDates');
  if (dates) dates.style.display = 'none';
  _tablePage = 0;
  _closeTradePicker();
  renderTradeTable();
}

// ── Picker-chip popover (Time / Staff / Customer) ──────────
let _pickerOpenKind = null; // 'time' | 'staff' | 'customer' | null

export function openTradePicker(kind, anchorBtn) {
  // Toggle behavior: clicking the same chip twice closes the popover.
  if (_pickerOpenKind === kind) { _closeTradePicker(); return; }

  const pop = document.getElementById('pkTrPickerPop');
  if (!pop) return;
  _pickerOpenKind = kind;

  let html = '';
  if (kind === 'time') {
    html = TIME_OPTIONS.map(opt => {
      if (opt === null) return `<div class="pk-tr-pp-divider"></div>`;
      const [val, label] = opt;
      const active = val === _tableFilter ? 'is-active' : '';
      const goldCls = val === 'custom' ? 'pk-tr-pp-item--gold' : '';
      return `<button class="pk-tr-pp-item ${active} ${goldCls}" type="button"
                onclick="PK.pickTradeTime('${val}')">${label}</button>`;
    }).join('');
  } else if (kind === 'staff') {
    const staff = _getActiveStaff();
    const headerItem = `<button class="pk-tr-pp-item ${_tableStaffFilter ? '' : 'is-active'}" type="button"
        onclick="PK.pickTradeStaff('')">All staff</button>
      <div class="pk-tr-pp-divider"></div>`;
    const searchBox = staff.length > 6
      ? `<div class="pk-tr-pp-search-wrap">
           <input class="pk-tr-pp-search" id="pkTrPickerStaffSearch" type="text" placeholder="Search staff…"
             oninput="PK.filterTradePickerItems(this, '.pk-tr-pp-staff-item');window._toggleSearchClear('pkTrPickerStaffSearch','pkTrPickerStaffSearchClear')">
           <button type="button" class="pk-tr-pp-search-clear" id="pkTrPickerStaffSearchClear"
             onclick="window._clearSearchBox('pkTrPickerStaffSearch',()=>PK.filterTradePickerItems(document.getElementById('pkTrPickerStaffSearch'),'.pk-tr-pp-staff-item'),'pkTrPickerStaffSearchClear')"
             aria-label="Clear search" hidden>✕</button>
         </div>`
      : '';
    const items = staff.length
      ? staff.map(s => {
          const active = s.username === _tableStaffFilter ? 'is-active' : '';
          const safeName = escapeHtml(s.displayName);
          const safeUser = escapeHtml(s.username);
          return `<button class="pk-tr-pp-item pk-tr-pp-staff-item ${active}" type="button"
            data-name="${safeName}" onclick="PK.pickTradeStaff('${safeUser}')">${safeName}</button>`;
        }).join('')
      : `<div class="pk-tr-pp-empty">No active staff</div>`;
    html = searchBox + headerItem + items;
  } else if (kind === 'customer') {
    const custs = (window._pkWholesale || [])
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const headerItem = `<button class="pk-tr-pp-item ${_tableCustFilter ? '' : 'is-active'}" type="button"
        onclick="PK.pickTradeCustomer('')">All customers</button>
      <div class="pk-tr-pp-divider"></div>`;
    const searchBox = custs.length > 6
      ? `<div class="pk-tr-pp-search-wrap">
           <input class="pk-tr-pp-search" id="pkTrPickerCustSearch" type="text" placeholder="Search customers…"
             oninput="PK.filterTradePickerItems(this, '.pk-tr-pp-cust-item');window._toggleSearchClear('pkTrPickerCustSearch','pkTrPickerCustSearchClear')">
           <button type="button" class="pk-tr-pp-search-clear" id="pkTrPickerCustSearchClear"
             onclick="window._clearSearchBox('pkTrPickerCustSearch',()=>PK.filterTradePickerItems(document.getElementById('pkTrPickerCustSearch'),'.pk-tr-pp-cust-item'),'pkTrPickerCustSearchClear')"
             aria-label="Clear search" hidden>✕</button>
         </div>`
      : '';
    const items = custs.length
      ? custs.map(c => {
          const active = c.id === _tableCustFilter ? 'is-active' : '';
          const safeName = escapeHtml(c.name || '—');
          const safeId   = escapeHtml(c.id || '');
          return `<button class="pk-tr-pp-item pk-tr-pp-cust-item ${active}" type="button"
            data-name="${safeName}" onclick="PK.pickTradeCustomer('${safeId}')">${safeName}</button>`;
        }).join('')
      : `<div class="pk-tr-pp-empty">No customers yet</div>`;
    html = searchBox + headerItem + items;
  }
  pop.innerHTML = html;
  pop.removeAttribute('hidden');

  // Position below the anchor chip
  const rect = anchorBtn?.getBoundingClientRect?.();
  if (rect) {
    const popRect = pop.getBoundingClientRect();
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - 8) {
      left = window.innerWidth - 8 - popRect.width;
    }
    if (left < 8) left = 8;
    let top = rect.bottom + 6;
    if (top + popRect.height > window.innerHeight - 8) {
      // Flip above if there's room
      const flipTop = rect.top - popRect.height - 6;
      if (flipTop > 8) top = flipTop;
    }
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
  }
  anchorBtn?.setAttribute('aria-expanded', 'true');

  setTimeout(() => {
    const off = (ev) => {
      if (pop.contains(ev.target)) return;
      if (ev.target.closest?.('.pk-tr-picker-chip') === anchorBtn) return;
      _closeTradePicker();
      document.removeEventListener('click', off, true);
      document.removeEventListener('keydown', kb, true);
    };
    const kb = (ev) => {
      if (ev.key === 'Escape') {
        _closeTradePicker();
        document.removeEventListener('click', off, true);
        document.removeEventListener('keydown', kb, true);
      }
    };
    document.addEventListener('click', off, true);
    document.addEventListener('keydown', kb, true);
    // Focus the search input if present
    pop.querySelector('.pk-tr-pp-search')?.focus();
  }, 0);
}

function _closeTradePicker() {
  const pop = document.getElementById('pkTrPickerPop');
  if (pop) pop.setAttribute('hidden', '');
  document.querySelectorAll('.pk-tr-picker-chip').forEach(c =>
    c.setAttribute('aria-expanded', 'false'),
  );
  _pickerOpenKind = null;
}

export function pickTradeTime(val) {
  if (val === 'custom') {
    // Reveal the date inputs but keep the popover closed; the user
    // picks dates → setTradeTimeRange('custom') is called on change.
    _tableFilter = 'custom';
    _closeTradePicker();
    const dw = document.getElementById('tfbDates');
    if (dw) dw.style.display = '';
    renderTradeTable();
    document.getElementById('tradeFromDate')?.focus();
    return;
  }
  setTradeTimeRange(val);
}

export function pickTradeStaff(username)    { setTradeStaffFilter(username); }
export function pickTradeCustomer(custId)   { setTradeCustomerFilter(custId); }

// Live-filter items inside the picker popover (Staff / Customer)
// based on the search input.
export function filterTradePickerItems(input, itemSelector) {
  const term = (input.value || '').toLowerCase().trim();
  const pop  = document.getElementById('pkTrPickerPop');
  if (!pop) return;
  pop.querySelectorAll(itemSelector).forEach(el => {
    const name = (el.dataset.name || el.textContent || '').toLowerCase();
    el.style.display = (!term || name.includes(term)) ? '' : 'none';
  });
}

// ── Row action popover ──────────────────────────────────────
export function openTradeRowPopover(e, id) {
  e?.stopPropagation();
  e?.preventDefault();
  const pop = document.getElementById('pkTrRowPopover');
  if (!pop) return;
  const sale = (window._pkSales || []).find(s => s.id === id);
  if (!sale) return;
  const voided = !!sale.voided;
  const wrap = document.getElementById('tradeTableWrap');
  const canEdit   = wrap?.dataset.canEdit   === '1';
  const canVoid   = wrap?.dataset.canVoid   === '1';
  const canDelete = wrap?.dataset.canDelete === '1';

  // Per D.3.4b update: inline buttons (Edit / Pay) handle the high-frequency
  // actions, so the ⋯ menu only houses the low-frequency ones — Print, then
  // Void/Unvoid + Delete. "View detail" is dropped (tautology — the row IS
  // the detail). "Record payment" is dropped (Pay is the inline button for
  // PARTIAL/CREDIT rows). "Edit" is dropped from the menu (inline button
  // exists for non-voided rows).
  const items = [];
  items.push(`<button class="pk-tr-pop-item" onclick="PK.popoverFire('print','${id}')"><span class="pk-tr-pop-icon">🖨</span><span>Print receipt</span></button>`);
  // Refund Due — mark refunded if flagged; flag if silent overpay detected
  if (!voided) {
    const _refundDue = sale.refundDue || 0;
    const _hasRefundedPayment = (sale.payments || []).some(p => p.type === 'refund' && !p.removed);
    const _rawOverpayPop = !_refundDue && !_hasRefundedPayment
      ? Math.max(0, Math.round(((sale.amountReceived || 0) - (sale.totalRevenue ?? sale.revenue ?? 0)) * 100) / 100)
      : 0;
    const _silentOverpay = (_rawOverpayPop > 0 && !(sale.overpaymentApplied > 0)) ? _rawOverpayPop : 0;
    if (_refundDue > 0) {
      items.push(`<div class="pk-tr-pop-sep"></div>`);
      items.push(`<button class="pk-tr-pop-item pk-tr-pop-item--refund" onclick="PK.popoverFire('markrefunded','${id}')"><span class="pk-tr-pop-icon">↩</span><span>Mark ₦${_fmtAmount(_refundDue)} refunded</span></button>`);
      items.push(`<div class="pk-tr-pop-sep"></div>`);
    } else if (_silentOverpay > 0) {
      items.push(`<div class="pk-tr-pop-sep"></div>`);
      items.push(`<button class="pk-tr-pop-item pk-tr-pop-item--refund" onclick="PK.popoverFire('flagoverpay','${id}')"><span class="pk-tr-pop-icon">↩</span><span>Flag ₦${_fmtAmount(_silentOverpay)} for refund</span></button>`);
      items.push(`<button class="pk-tr-pop-item" onclick="PK.popoverFire('dismissoverpay','${id}')"><span class="pk-tr-pop-icon">✓</span><span>Dismiss — applied to debt</span></button>`);
      items.push(`<div class="pk-tr-pop-sep"></div>`);
    }
  }
  // Payment record — re-opens the Record-Payment modal so a settled trade
  // can still show who recorded each payment + remove a wrong one. The inline
  // Pay button is gated to partial/credit (MISSION §3.5), so PAID rows would
  // otherwise have no path back to the payment ledger. Shown on any row with
  // payment activity; routes through the existing 'pay' handler.
  const hasPaymentActivity = (sale.amountReceived || 0) > 0
    || (Array.isArray(sale.payments) && sale.payments.length > 0);
  if (!voided && hasPaymentActivity) {
    const payLabel = (sale.balanceOwing || 0) <= 0 ? 'View payments' : 'Payment record';
    items.push(`<button class="pk-tr-pop-item" onclick="PK.popoverFire('pay','${id}')"><span class="pk-tr-pop-icon">💰</span><span>${payLabel}</span></button>`);
  }
  // Only draw the divider when a danger action will actually follow it —
  // otherwise (e.g. cashier, who can't void/delete) it dangles at the bottom.
  if (canVoid || canDelete) items.push(`<div class="pk-tr-pop-sep"></div>`);
  if (voided) {
    if (canVoid) {
      items.push(`<button class="pk-tr-pop-item" onclick="PK.popoverFire('unvoid','${id}')"><span class="pk-tr-pop-icon">↺</span><span>Unvoid trade</span></button>`);
    }
  } else if (canVoid) {
    items.push(`<button class="pk-tr-pop-item pk-tr-pop-item--danger" onclick="PK.popoverFire('void','${id}')"><span class="pk-tr-pop-icon">⊘</span><span>Void trade</span></button>`);
  }
  if (canDelete) {
    items.push(`<button class="pk-tr-pop-item pk-tr-pop-item--danger" onclick="PK.popoverFire('delete','${id}')"><span class="pk-tr-pop-icon">⌫</span><span>Delete trade</span></button>`);
  }
  pop.innerHTML = items.join('');

  // Position next to the click target
  const btn = e?.currentTarget || e?.target;
  const rect = btn?.getBoundingClientRect?.();
  if (rect) {
    pop.removeAttribute('hidden');
    // measure before flipping
    const popRect = pop.getBoundingClientRect();
    let left = rect.right - popRect.width;
    if (left < 8) left = 8;
    if (left + popRect.width > window.innerWidth - 8) {
      left = window.innerWidth - 8 - popRect.width;
    }
    let top = rect.bottom + 6;
    if (top + popRect.height > window.innerHeight - 8) {
      top = rect.top - popRect.height - 6;
    }
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
  }

  // Dismiss on outside click / escape (one-shot)
  setTimeout(() => {
    const off = (ev) => {
      if (pop.contains(ev.target)) return;
      pop.setAttribute('hidden', '');
      document.removeEventListener('click', off, true);
      document.removeEventListener('keydown', kb, true);
    };
    const kb = (ev) => {
      if (ev.key === 'Escape') {
        pop.setAttribute('hidden', '');
        document.removeEventListener('click', off, true);
        document.removeEventListener('keydown', kb, true);
      }
    };
    document.addEventListener('click', off, true);
    document.addEventListener('keydown', kb, true);
  }, 0);
}

export function popoverFire(action, id) {
  const pop = document.getElementById('pkTrRowPopover');
  if (pop) pop.setAttribute('hidden', '');
  switch (action) {
    case 'print':        if (window._showReceiptModal)   window._showReceiptModal(id); break;
    case 'view':         expandTradeRow(id); break;
    case 'pay':          if (window._showPaymentModal)   window._showPaymentModal(id); break;
    case 'edit':         if (window._editTrade)          window._editTrade(id); break;
    case 'void':         if (window._voidTradeTable)     window._voidTradeTable(id); break;
    case 'unvoid':       if (window._unvoidTradeTable)   window._unvoidTradeTable(id); break;
    case 'delete':       if (window._deleteTradeTable)   window._deleteTradeTable(id); break;
    case 'markrefunded':  if (window._markTradeRefunded)   window._markTradeRefunded(id);  break;
    case 'flagoverpay':   if (window._flagTradeOverpay)    window._flagTradeOverpay(id);   break;
    case 'dismissoverpay':if (window._dismissTradeOverpay) window._dismissTradeOverpay(id); break;
  }
}

// Inline-action shortcuts (Pay / Edit buttons next to ⋯). Same handlers
// the popover would fire, just shortened so the row doesn't have to
// open the menu first for the daily-use actions.
export function tradeQuickPay(e, id) {
  e?.stopPropagation();
  if (window._showPaymentModal) window._showPaymentModal(id);
}
export function tradeQuickEdit(e, id) {
  e?.stopPropagation();
  if (window._editTrade) window._editTrade(id);
}

// Clicking the ↩ REFUND badge on a row:
// Clicking the ↩ REFUND badge on a row that already has refundDue set → mark as given.
// Silent-overpay rows now have two separate inline badges (flag / dismiss) and
// never reach this function.
export function openRefundAction(id) {
  const sale = (window._pkSales || []).find(s => s.id === id);
  if (!sale) return;
  if ((sale.refundDue || 0) > 0) {
    if (window._markTradeRefunded) window._markTradeRefunded(id);
  }
}

// ── Bulk operations ─────────────────────────────────────────
export function exportTradesSmart() {
  if (_pkTradeSelMode && _pkTradeSelIds.size > 0) {
    bulkExportTrades();
    return;
  }
  if (typeof window._exportTrades === 'function') {
    window._exportTrades();
  }
}

export function bulkExportTrades() {
  if (!_pkTradeSelIds.size) return;
  const sales = (window._pkSales || []).filter(s => _pkTradeSelIds.has(s.id));
  if (!sales.length) return;
  const esc = csvCell;
  // Bundle 3: cost-blind exporters (manager + cashier) get NO Profit column.
  const hideProfit = costBlindForCurrentRole();
  const headers = ['Trade ID','Date','Customer','Items','Amount (N)','Discount (N)',
    'Profit (N)','Amount Paid (N)','Balance Owing (N)','Payment Status',
    'Created By','Role','Voided','Void Reason','Item Details'];
  const profitIdx = headers.indexOf('Profit (N)');
  if (hideProfit && profitIdx !== -1) headers.splice(profitIdx, 1);
  const rows = sales.map(s => {
    const cust = (window._pkWholesale || []).find(c => c.id === s.custId) || { name: s.customerName || s.custName || 'Walk-in' };
    const items = Array.isArray(s.items)
      ? s.items.map(it => `${it.itemName} x${it.label}`).join(' | ')
      : (s.itemName || '');
    const cells = [
      s.id || '', s.date || '', cust.name,
      Array.isArray(s.items) ? s.items.length : 1,
      s.totalRevenue ?? s.revenue ?? 0,
      s.totalDiscount || 0, s.totalProfit ?? 0,
      s.amountReceived ?? 0, s.balanceOwing || 0,
      s.paymentStatus || (s.voided ? 'voided' : _saleStatus(s)),
      s.performedBy?.displayName || s.performedBy?.username || 'Owner',
      s.performedBy?.role || 'owner',
      s.voided ? 'Yes' : 'No', s.voidReason || '', items,
    ];
    if (hideProfit && profitIdx !== -1) cells.splice(profitIdx, 1);
    return cells.map(esc).join(',');
  });
  const csv = [headers.map(esc).join(','), ...rows].join('\r\n');
  const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const stamp = isoDate(new Date());
  a.href = url;
  a.download = `trades_selected_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  toast(`↧ Exported ${sales.length} trade${sales.length !== 1 ? 's' : ''}`, 'ok');
}

export async function bulkVoidTrades() {
  const ids = Array.from(_pkTradeSelIds);
  if (!ids.length) return;
  const perms = window._staffPerms;
  if (window._staffOwnerUid && !(perms?.canVoid ?? false)) return toast('⚠️ Your role cannot void trades', 'err');
  const reason = prompt(`Void ${ids.length} trade${ids.length !== 1 ? 's' : ''}?\nEnter a reason (required):`);
  if (reason === null) return;
  if (!reason.trim()) return toast('⚠️ Enter a void reason', 'err');
  let ok = 0;
  for (const id of ids) {
    const sale = (window._pkSales || []).find(s => s.id === id);
    if (!sale || sale.voided) continue;
    try {
      const activeUid = resolveUid();
      await _reverseTradeFromBorrowers(sale, activeUid);
      sale.voided     = true;
      sale.voidReason = reason.trim();
      sale.voidedAt   = Date.now();
      sale.voidedBy   = _voidStock(sale, activeUid);
      if (activeUid) voidSale(activeUid, sale);
      logActivity('VOID_TRADE', { tradeId: id, reason: reason.trim(), amount: sale.totalRevenue ?? sale.revenue ?? 0 });
      ok++;
    } catch (err) {
      console.error('Bulk void failed for', id, err);
    }
  }
  _pkTradeSelIds = new Set();
  _pkTradeSelMode = false;
  saveLocal();
  renderTradeTable();
  toast(`🚫 Voided ${ok} trade${ok !== 1 ? 's' : ''}`, 'ok');
}

export async function bulkDeleteTrades() {
  const ids = Array.from(_pkTradeSelIds);
  if (!ids.length) return;
  const perms = window._staffPerms;
  if (window._staffOwnerUid && !(perms?.canDelete ?? false)) return toast('⚠️ Your role cannot delete trades', 'err');
  if (!confirm(`Delete ${ids.length} trade${ids.length !== 1 ? 's' : ''}?\nThis is permanent and reverses any credit-account entries.`)) return;
  const activeUid = resolveUid();
  let ok = 0;
  for (const id of ids) {
    const sale = (window._pkSales || []).find(s => s.id === id);
    if (!sale) continue;
    try {
      await _reverseTradeFromBorrowers(sale, activeUid);
      _deleteStock(sale, activeUid);
      window._pkSales = (window._pkSales || []).filter(s => s.id !== id);
      if (activeUid) await deleteSaleDB(activeUid, id).catch(e => console.error('[bulk-delete]', e));
      logActivity('DELETE_TRADE', { tradeId: id, amount: sale.totalRevenue ?? sale.revenue ?? 0 });
      ok++;
    } catch (err) {
      console.error('Bulk delete failed for', id, err);
    }
  }
  _pkTradeSelIds = new Set();
  _pkTradeSelMode = false;
  saveLocal();
  renderTradeTable();
  toast(`🗑 Deleted ${ok} trade${ok !== 1 ? 's' : ''}`, 'ok');
}

function _clearPagination() {
  document.getElementById('tradePagination')?.remove();
}

// Render the pagination band beneath the trade table.
//
// Used to early-return when totalPages <= 1, which left the founder
// looking at 110 trades with no visible cue that paging existed
// (cashier reported "Trade page unscrollable, no Next button").
// We now ALWAYS render the band when there's at least one trade —
// the Prev/Next buttons stay in their disabled state on single-page
// views so the affordance is visible and the count is always shown.
function _renderPagination(totalPages, totalCount) {
  _clearPagination();
  if (totalCount <= 0) return;
  const wrap = document.getElementById('tradeTableWrap');
  if (!wrap) return;
  const safeTotalPages = Math.max(1, totalPages);
  const prevDisabled = _tablePage <= 0 ? 'disabled' : '';
  const nextDisabled = _tablePage >= safeTotalPages - 1 ? 'disabled' : '';
  const pag = document.createElement('div');
  pag.id = 'tradePagination';
  pag.className = 'pk-tr-pagination';
  pag.innerHTML = `
    <button class="pk-tr-pag-btn" onclick="window._tradeGoPage(${_tablePage - 1})" ${prevDisabled}>‹ Prev</button>
    <span class="pk-tr-pag-info">Page ${_tablePage + 1} of ${safeTotalPages} · ${totalCount.toLocaleString('en-NG')} trade${totalCount !== 1 ? 's' : ''}</span>
    <button class="pk-tr-pag-btn" onclick="window._tradeGoPage(${_tablePage + 1})" ${nextDisabled}>Next ›</button>`;
  wrap.parentNode.insertBefore(pag, wrap.nextSibling);
}

window._tradeGoPage = function(page) {
  _tablePage = page;
  renderTradeTable();
  document.getElementById('tradeTableWrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// D.3.4b — the legacy expandable rows are gone; "view detail" now
// opens the existing receipt modal, which is the same content that
// the old inline expand row used to show (items, totals, status,
// who created/edited/voided, and reasons).
export function expandTradeRow(id) {
  if (typeof window._showReceiptModal === 'function') {
    window._showReceiptModal(id);
    return;
  }
  // Fallback for any legacy expand rows still in the DOM
  const row = document.getElementById('expand-' + id);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  document.querySelectorAll('.trade-tbl-expand').forEach(r => r.style.display = 'none');
  if (!isOpen) row.style.display = '';
}


// ── CSV Export ────────────────────────────────────────────────────────────────
window._exportTrades = function() {
  let sales = [...(window._pkSales || [])];
  const toIso = isoDate;

  if (_tableFilter === 'custom') {
    if (_tableFromDate) sales = sales.filter(s => (s.date || '') >= _tableFromDate);
    if (_tableToDate)   sales = sales.filter(s => (s.date || '') <= _tableToDate);
  } else if (_tableFilter && _tableFilter !== 'all') {
    const bounds = _timeRangeBounds(_tableFilter);
    if (bounds) {
      if (bounds.from) sales = sales.filter(s => (s.date || '') >= bounds.from);
      if (bounds.to)   sales = sales.filter(s => (s.date || '') <= bounds.to);
    }
  }

  // D.3.4b — apply status filter to exports too
  if (_tableStatuses.size) sales = sales.filter(_statusMatch);

  if (_tableCustFilter) sales = sales.filter(s => s.custId === _tableCustFilter);
  if (_tableStaffFilter) {
    sales = sales.filter(s =>
      s.performedBy?.username === _tableStaffFilter ||
      s.performedBy?.displayName === _tableStaffFilter
    );
  }
  if (_tableSearch) {
    sales = sales.filter(s => {
      if ((s.id || '').toLowerCase().includes(_tableSearch)) return true;
      const cust = (window._pkWholesale || []).find(c => c.id === s.custId);
      return (cust?.name || '').toLowerCase().includes(_tableSearch);
    });
  }

  if (!sales.length) { alert('No trades to export with current filters.'); return; }
  sales = sales.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0));

  const esc = csvCell;
  // Bundle 3: cost-blind exporters (manager + cashier) get NO Profit column.
  const hideProfit = costBlindForCurrentRole();
  const headers = ['Trade ID','Date','Customer','Items','Amount (N)','Discount (N)',
    'Profit (N)','Amount Paid (N)','Balance Owing (N)','Payment Status',
    'Created By','Role','Voided','Void Reason','Item Details'];
  const profitIdx = headers.indexOf('Profit (N)');
  if (hideProfit && profitIdx !== -1) headers.splice(profitIdx, 1);

  const rows = sales.map(s => {
    const cust  = (window._pkWholesale || []).find(c => c.id === s.custId) || { name: s.customerName || s.custName || 'Walk-in' };
    const items = Array.isArray(s.items) ? s.items.map(it => `${it.itemName} x${it.label}`).join(' | ') : (s.itemName || '');
    const cells = [
      s.id || '', s.date || '', cust.name,
      Array.isArray(s.items) ? s.items.length : 1,
      s.totalRevenue ?? s.revenue ?? 0,
      s.totalDiscount || 0, s.totalProfit ?? 0,
      s.amountReceived ?? 0, s.balanceOwing || 0,
      s.paymentStatus || (s.voided ? 'voided' : 'paid'),
      s.performedBy?.displayName || s.performedBy?.username || 'Owner',
      s.performedBy?.role || 'owner',
      s.voided ? 'Yes' : 'No', s.voidReason || '', items,
    ];
    if (hideProfit && profitIdx !== -1) cells.splice(profitIdx, 1);
    return cells.map(esc).join(',');
  });

  const csv  = [headers.map(esc).join(','), ...rows].join('\r\n');
  const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const staffName = _tableStaffFilter
    ? (_getActiveStaff().find(s => s.username === _tableStaffFilter)?.displayName || _tableStaffFilter)
    : '';
  const staffLabel = staffName ? '_' + staffName : '';
  const filterLabel = staffLabel || (_tableFilter !== 'all' ? '_' + _tableFilter : '');
  a.href = url; a.download = `trades${filterLabel}_${toIso(new Date())}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);

  const btn = document.querySelector('[onclick*="_exportTrades"]');
  if (btn) { const o = btn.innerHTML; btn.innerHTML = '✅ Exported!'; setTimeout(() => btn.innerHTML = o, 2000); }
};

// ── Reverse borrower entries when a trade is voided or deleted ─
// Strategy: find the net debt this trade created in the borrower
// (total debt entries referencing this tradeId minus payment entries
// referencing this tradeId), then add ONE clean reversal payment
// to zero it out. Simple, race-condition-free, audit-trail safe.
async function _reverseTradeFromBorrowers(sale, activeUid) {
  if (!sale) return;
  const tradeId = sale.id;

  const cust = (window._pkWholesale || []).find(c => c.id === sale.custId);
  if (!cust) return;

  window._pkBorrowers = window._pkBorrowers || [];
  const borrower = findBorrowerByName(window._pkBorrowers, cust.name);
  if (!borrower) return;
  const bIdx = window._pkBorrowers.indexOf(borrower);
  borrower.transactions = borrower.transactions || [];

  // Sum all debt entries that belong to this trade
  const tradeDebt = borrower.transactions
    .filter(t => t.type === 'debt' && (t.name || '').includes(tradeId))
    .reduce((a, t) => a + (t.amount || 0), 0);

  // Sum all payment entries that belong to this trade
  const tradePaid = borrower.transactions
    .filter(t => t.type === 'payment' && (
      (t.name || '').includes(tradeId) || (t.note || '').includes(tradeId)
    ))
    .reduce((a, t) => a + (t.amount || 0), 0);

  // Net still sitting on the borrower from this trade
  const netOwing = Math.round((tradeDebt - tradePaid) * 100) / 100;
  if (netOwing <= 0) return; // already balanced, nothing to reverse

  const actor = getCurrentActor();
  const date  = isoDate(new Date());

  // Add one clean reversal payment to cancel the remaining net
  borrower.transactions.push({
    id:          crypto.randomUUID(),
    type:        'payment',
    name:        `Void/Delete reversal · ${tradeId}`,
    amount:      netOwing,
    note:        `Auto-reversed: trade ${tradeId} was voided or deleted. ₦${netOwing} debt cleared.`,
    date,
    createdTs:   Date.now(),
    performedBy: makePerformedBy(actor),
  });

  borrower.lastActivityTs = Date.now();
  window._pkBorrowers[bIdx] = borrower;

  // Save to Firestore via db.js (Phase C.4) — same dual-path write,
  // but the staff/owner /users/ mirror logic stays in one place.
  if (activeUid) {
    await saveBorrower(activeUid, borrower).catch(e =>
      console.error('Borrower reversal save failed:', e),
    );
  }

  // Refresh borrower UI
  if (typeof window.__PK?.renderBorrowers === 'function') window.__PK.renderBorrowers();
  else if (typeof window.PK?.renderBorrowers === 'function') window.PK.renderBorrowers();
}

// Puts back on the account exactly what voiding took off (the "Void/Delete
// reversal" lines for this trade, less anything already put back). Named with
// the trade id, so voiding again reverses it cleanly. A switched account works
// from the trade itself and needs nothing.
async function _restoreTradeToBorrowers(sale, activeUid) {
  const cust = (window._pkWholesale || []).find(c => c.id === sale.custId);
  const borrower = cust && findBorrowerByName(window._pkBorrowers || [], cust.name);
  if (!borrower || isOneRecord(borrower)) return 0;
  const tx = borrower.transactions || [];
  const sum = (pred) => tx.filter(pred).reduce((a, t) => a + (t.amount || 0), 0);
  const reversed = sum(t => t.type === 'payment' && (t.name || '') === `Void/Delete reversal · ${sale.id}`);
  const restored = sum(t => t.type === 'debt' && (t.name || '') === `Unvoid · ${sale.id}`);
  const amount = Math.round((reversed - restored) * 100) / 100;
  if (amount <= 0) return 0;
  borrower.transactions = [...tx, {
    id: crypto.randomUUID(), type: 'debt', name: `Unvoid · ${sale.id}`, amount,
    note: `Trade ${sale.id} was unvoided, so its debt is back.`,
    date: isoDate(new Date()), createdTs: Date.now(),
    performedBy: makePerformedBy(getCurrentActor()),
  }];
  borrower.lastActivityTs = Date.now();
  if (activeUid) await saveBorrower(activeUid, borrower).catch(e => console.error('Borrower restore save failed:', e));
  window.__PK?.renderBorrowers?.();
  return amount;
}

// ── Unvoid ────────────────────────────────────────────────────
// Reverses a void: clears the voided flag, takes the stock back off the shelf
// and puts back the debt the void removed (_restoreTradeToBorrowers).
window._unvoidTradeTable = async function(id) {
  const perms = window._staffPerms;
  if (window._staffOwnerUid && !(perms?.canVoid ?? false)) return toast('⚠️ Your role cannot unvoid trades', 'err');

  const sale = (window._pkSales || []).find(s => s.id === id);
  if (!sale || !sale.voided) return;

  if (!confirm(
    `Unvoid trade ${id}?\n\n` +
    `This restores the trade to its previous status. Any debt the void ` +
    `took off the customer's account goes back on.`,
  )) return;

  const btn = document.activeElement;
  await withLoading(btn, async () => {
    const activeUid = resolveUid();
    _unvoidStock(sale, activeUid);   // before voidedBy is cleared below
    const back = await _restoreTradeToBorrowers(sale, activeUid);
    sale.voided     = false;
    sale.voidReason = '';
    sale.voidedAt   = null;
    sale.voidedBy   = null;
    sale.unvoidedAt = Date.now();
    sale.unvoidedBy = getCurrentActor();
    if (activeUid) voidSale(activeUid, sale);
    logActivity('UNVOID_TRADE', { tradeId: id, amount: sale.totalRevenue ?? sale.revenue ?? 0 });
    saveLocal();
    renderTradeTable();
    toast(`↺ Trade restored${back ? ` · ${fmt(back)} back on the account` : ''}`, 'ok');
  });
};

// ── Void ──────────────────────────────────────────────────────
window._voidTradeTable = async function(id) {
  const perms = window._staffPerms;
  if (window._staffOwnerUid && !(perms?.canVoid ?? false)) return toast('⚠️ Your role cannot void trades', 'err');

  const reason = prompt('Void this trade?\nEnter a reason (required):');
  if (reason === null) return;
  if (!reason.trim()) return toast('⚠️ Enter a void reason', 'err');

  const sale = (window._pkSales || []).find(s => s.id === id);
  if (!sale) return;

  const btn = document.activeElement;
  await withLoading(btn, async () => {
    const activeUid = resolveUid();

    // Reverse borrower entries BEFORE marking voided so sale data is intact
    await _reverseTradeFromBorrowers(sale, activeUid);

    sale.voided     = true;
    sale.voidReason = reason.trim();
    sale.voidedAt   = Date.now();
    sale.voidedBy   = _voidStock(sale, activeUid);

    if (activeUid) voidSale(activeUid, sale);
    logActivity('VOID_TRADE', { tradeId: id, reason: reason.trim(), amount: sale.totalRevenue ?? sale.revenue ?? 0 });
    saveLocal();
    renderTradeTable();
    toast('🚫 Trade voided · Credit Accounts updated', 'ok');
  });
};

// ── Delete warning modal ──────────────────────────────────────
function _showDeleteWarning(sale, onConfirm) {
  const existing = document.getElementById('_pkDeleteWarning');
  if (existing) existing.remove();

  const custRecord = (window._pkWholesale || []).find(c => c.id === sale.custId);
  const custName   = custRecord?.name || sale.custName || sale.customerName || 'Walk-in';
  const tradeId   = sale.id        || '—';
  const amount    = fmt(sale.totalRevenue ?? sale.revenue ?? 0);
  const date      = sale.date      || '—';
  const itemCount = (sale.items || []).length;

  const el = document.createElement('div');
  el.id = '_pkDeleteWarning';
  el.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,.88);backdrop-filter:blur(10px);
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;
  el.innerHTML = `
    <div style="
      background:var(--s1);
      border:1px solid rgba(255,71,87,.35);
      border-radius:18px;
      max-width:380px;width:100%;
      overflow:hidden;
      animation:ntmSlide .22s cubic-bezier(.34,1.56,.64,1);
    ">
      <!-- Header -->
      <div style="
        background:rgba(255,71,87,.08);
        border-bottom:1px solid rgba(255,71,87,.2);
        padding:18px 20px 14px;
        display:flex;align-items:flex-start;gap:12px;
      ">
        <div style="font-size:1.6rem;line-height:1;flex-shrink:0;">🗑️</div>
        <div>
          <div style="font-family:var(--fh);font-weight:800;font-size:.95rem;color:var(--red);margin-bottom:3px;">
            Delete Trade?
          </div>
          <div style="font-size:.75rem;color:var(--muted);line-height:1.5;">
            This action is <strong style="color:var(--text2);">permanent</strong> and cannot be undone.
          </div>
        </div>
      </div>

      <!-- Trade details -->
      <div style="padding:16px 20px;">
        <div style="
          background:var(--s2);border:1px solid var(--border2);
          border-radius:10px;padding:12px 14px;
          display:flex;flex-direction:column;gap:8px;
          margin-bottom:14px;
        ">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);">Customer</span>
            <span style="font-family:var(--fh);font-weight:700;font-size:.85rem;color:var(--text);">${escapeHtml(custName)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);">Trade ID</span>
            <span style="font-family:var(--fb);font-size:.72rem;color:var(--accent);">${tradeId}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);">Amount</span>
            <span style="font-family:var(--fh);font-weight:800;font-size:.9rem;color:var(--blue2);"><span class="currency">₦</span>${amount}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);">Date</span>
            <span style="font-size:.78rem;color:var(--text2);">${date}</span>
          </div>
          ${itemCount > 0 ? `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);">Items</span>
            <span style="font-size:.78rem;color:var(--text2);">${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
          </div>` : ''}
        </div>

        <div style="
          background:rgba(255,71,87,.06);border:1px solid rgba(255,71,87,.15);
          border-radius:8px;padding:10px 12px;margin-bottom:16px;
          font-size:.74rem;color:var(--muted);line-height:1.6;
        ">
          ⚠️ If this customer has a credit account, their borrower balance will be <strong style="color:var(--text2);">automatically reversed</strong>.
        </div>

        <!-- Buttons -->
        <div style="display:flex;gap:10px;">
          <button id="_pkDelCancel" style="
            flex:1;padding:12px;border-radius:10px;
            border:1px solid var(--border2);background:var(--s2);
            color:var(--text2);font-family:var(--fh);font-weight:700;
            font-size:.82rem;cursor:pointer;transition:all .15s;
          ">Cancel</button>
          <button id="_pkDelConfirm" style="
            flex:1;padding:12px;border-radius:10px;
            border:none;background:var(--red);
            color:#fff;font-family:var(--fh);font-weight:800;
            font-size:.82rem;cursor:pointer;
            box-shadow:0 4px 14px rgba(255,71,87,.3);
            transition:all .15s;
          ">Delete Trade</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(el);

  document.getElementById('_pkDelCancel').onclick  = () => el.remove();
  const confirmBtn = document.getElementById('_pkDelConfirm');
  confirmBtn.onclick = () => { el.remove(); onConfirm(confirmBtn); };
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
}

// ── Delete ────────────────────────────────────────────────────
window._deleteTradeTable = async function(id) {
  const perms = window._staffPerms;
  if (window._staffOwnerUid && !(perms?.canDelete ?? false)) return toast('⚠️ Your role cannot delete trades', 'err');

  const sale      = (window._pkSales || []).find(s => s.id === id);
  const activeUid = resolveUid();

  if (!sale) return toast('⚠️ Trade not found', 'err');

  _showDeleteWarning(sale, async (confirmBtn) => {
    await withLoading(confirmBtn, async () => {
      await _reverseTradeFromBorrowers(sale, activeUid);
      _deleteStock(sale, activeUid);
      window._pkSales = (window._pkSales || []).filter(s => s.id !== id);
      if (activeUid) await deleteSaleDB(activeUid, id).catch(e => { console.error('[trade-table] Failed to delete trade from cloud:', e); toast('⚠️ Trade removed locally but cloud delete failed', 'err'); });
      logActivity('DELETE_TRADE', { tradeId: id, amount: sale?.totalRevenue ?? sale?.revenue ?? 0 });
      saveLocal();
      renderTradeTable();
      toast('🗑 Trade deleted · Credit Accounts updated', 'ok');
    });
  });
};