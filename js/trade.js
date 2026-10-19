// ============================================================
//  trade.js — Orchestrator (Session 12)
//  Imports from sub-modules and re-exports everything that
//  app.js / PK proxy / window globals need.
// ============================================================

import { toast }                                       from './utils.js';
import { renderTradeTable }                            from './trade-table.js';
import { populateTradeCustSelect, openEditTradeModal } from './trade-modal.js';
import { injectPaymentStyles }                         from './trade-payment.js';

// Activate receipt/print window globals
import './trade-receipt.js';

// ── Re-exports for PK proxy / app.js ─────────────────────────
export { renderTradeTable, expandTradeRow, setTradeTableFilter, tradeTableSearch }
  from './trade-table.js';

export {
  openNewTradeModal, openEditTradeModal, openNewTradeForCredit,
  closeNewTradeModal, switchNtmTab,
  ntmSearch, ntmAddPcs, ntmAddRows, ntmAddCartons, ntmAddCustom,
  ntmAddByBarcode,
  ntmRemove, populateTradeCustSelect,
  _ntmUpdateTotal,
} from './trade-modal.js';

export { openPaymentModal } from './trade-payment.js';

// ── Init (called by app.js when Trade tab is first opened) ───
// The picker-chip flow (D.3.4b UPDATE) builds its option lists inside
// the popover at open-time from window._pkStaff / _pkStaffCache /
// _pkWholesale, so we no longer need to pre-populate any <select>
// elements here.
export function initTradeTab() {
  renderTradeTable();
  populateTradeCustSelect();
  injectPaymentStyles();
  // Lazy-fetch the staff list once for the Staff picker chip. Owner
  // mode only — staff sessions don't see the picker at all.
  _ensureStaffCacheLoaded();
}

async function _ensureStaffCacheLoaded() {
  if (window._staffOwnerUid) return;
  if (Array.isArray(window._pkStaff) && window._pkStaff.length) return;
  if (Array.isArray(window._pkStaffCache) && window._pkStaffCache.length) {
    window._pkStaff = window._pkStaffCache;
    return;
  }
  try {
    const { collection, getDocs } = await import('./firebase.js');
    const { db } = await import('./firebase.js');
    const uid = (await import('./auth.js')).currentUser?.uid;
    if (!uid) return;
    const snap = await getDocs(collection(db, 'users', uid, 'staff'));
    window._pkStaff = snap.docs.map(d => d.data());
    window.__PK?.renderTradeTable?.();
  } catch (e) {
    console.warn('[trade] staff cache load failed', e);
  }
}
// ── Edit trade — window global used inside table row HTML ─────
// TODO: surface edit history in edit modal — D.3.4b polish carry-forward.
//       When the trade has sale.editedAt / sale.editHistory, show a
//       small banner at the top of the edit modal: "This trade was
//       edited on {date} by {user}. Previous values shown below."
window._editTrade = function(saleId) {
  // BUG-011: was checking window._staffRole === 'admin' — that variable is
  // never assigned anywhere in the codebase, so this always evaluated false
  // and blocked every staff member regardless of role or the owner's Edit
  // permission toggle. Now reads the same effective-permission source the
  // Edit button's own visibility already uses (trade-table.js canEdit).
  const isStaff = !!window._staffOwnerUid;
  const canEdit = !isStaff || (window._staffPerms?.canEdit ?? false);
  if (!canEdit) return toast('⚠️ Your role cannot edit trades', 'err');
  openEditTradeModal(saleId);
};

// ── renderRecentTrades alias (used elsewhere in app) ──────────
export { renderTradeTable as renderRecentTrades } from './trade-table.js';
window.renderRecentTrades = renderTradeTable;

// ── Legacy no-op exports (kept so old callers don't break) ────
export function toggleRecentTrades() {}
export function toggleCartPanel()    {}
export function tradeSearch()        {}
export function renderTradeItems()   {}
export function toggleItemChips()    {}
export function addChip()            {}
export function addCustomCartons()   {}
export function addRows()            {}
export function addCustomRows()      {}
export function addPcs()             {}
export function removeCartRow()      {}
export function applyDiscount()      {}
export function setHistoryFilter()   {}
export function saveTrade()          {}
window.toggleRecentTrades = () => {};

// ============================================================
window._refreshTrades = function(btn) {
  // Spin the icon
  const icon = btn.querySelector('svg');
  if (icon) {
    icon.style.transition = 'transform 0.6s ease';
    icon.style.transform  = 'rotate(360deg)';
    setTimeout(() => {
      icon.style.transition = 'none';
      icon.style.transform  = 'rotate(0deg)';
    }, 650);
  }
  btn.disabled = true;

  // If staff, re-fetch live from Firestore via refetchOwnerDataForStaff()
  // which applies the same cost-strip pipeline as the snapshot listener.
  // Doing a raw getDocs here previously skipped that strip and let a
  // cashier's refresh leak totalProfit / totalCost back into _pkSales —
  // exposing profit via inspect-element (TASK 1 role-leak).
  const ownerUid = window._staffOwnerUid;
  if (ownerUid) {
    import('./staff-auth.js').then(({ refetchOwnerDataForStaff }) =>
      refetchOwnerDataForStaff(ownerUid)
    ).then(() => {
      PK.renderTradeTable();
      btn.disabled = false;
    }).catch(err => {
      console.error('[trade] refresh failed', err);
      btn.disabled = false;
    });
  } else {
    // Owner already has live onSnapshot — just re-render
    PK.renderTradeTable();
    btn.disabled = false;
  }
};