// ============================================================
//  app.js — Session 11
// ============================================================

import { checkOnboarding }            from './onboarding.js';
import { initAuth, handleAuth, authReady } from './auth.js';
import { pushHash, initRouter, currentPath } from './router.js';
import { closeModal, safe, toast }    from './utils.js';
import { normalizeSales } from './sale-derive.js';
import { isStaffMode } from './staff-auth.js';
import { applyTheme } from './business.js';
import { initContacts } from './contacts.js';
import {
  toggleAcc, saveMarkup, calcCarton, livePreview, addItem,
  renderItems, updateSummary, shareItem, openEdit, saveEdit, cancelEdit,
  deleteItem, onSellManualInput, resetSellOverride,
  onRowManualInput, resetRowOverride, onCartonSellInput, changeBuyUnit, clearAddForm,
  onTrackStockToggle, toggleLowStockFilter, setStockFilter, reviewNeedsCost, toggleNeedsCostFilter,
  reviewNeedsStock, toggleNeedsStockFilter,
  openSetStock, cancelSetStock, saveSetStock, ssQtyInput, ssWarnInput,
  clearInventoryFilters, toggleSelectMode, toggleItemSelected,
  bulkExportSelected, bulkDeleteSelected, togglePrivacyMode,
  switchInvSubtab, itemSupplierChanged,
  openInvCardPopover, invPopoverFire,
} from './inventory.js';
import {
  openRestockModal, closeRestockModal, rstRecalc, rstSupplierChanged, rstSave,
} from './restock-modal.js';
import {
  openSupplierModal, closeSupplierModal, saveSupplierRecord,
} from './supplier-modal.js';
import {
  switchSupView, getSupView, editSupplier, deactivateSupplier,
  supToggleShopItem, supSetShopQty, supSelectLowStock,
  supBuildShoppingList, supClearShoppingList,
  supToggleAddSupplier, supSaveSupplierPrice,
  supToggleAdhocForm, supSubmitAdhocItem, supRemoveAdhocItem,
  supSetBudget, supBestSearch, supBpKeydown,
  supCompleteRestock, supCancelRestock, supToggleRestockSkip, supSaveRestocks,
} from './suppliers-view.js';
import {
  initTradeTab, populateTradeCustSelect,
  renderTradeTable, setTradeTableFilter, expandTradeRow,
  openNewTradeModal, closeNewTradeModal, switchNtmTab, ntmSearch,
  ntmAddPcs, ntmAddRows, ntmAddCartons, ntmAddCustom, ntmAddByBarcode, ntmRemove,
  openPaymentModal, toggleCartPanel, renderRecentTrades, toggleRecentTrades,
  openNewTradeForCredit,
} from './trade.js';
import {
  scanItemBarcode, scanTradeBarcode, closeBarcodeScanner,
} from './barcode-scanner.js';
import {
  setTradeStatus, toggleTradeSelectMode, toggleTradeRowSelected,
  clearTradeFilters, openTradeRowPopover, popoverFire,
  exportTradesSmart, bulkExportTrades, bulkVoidTrades, bulkDeleteTrades,
  openTradePicker, pickTradeTime, pickTradeStaff, pickTradeCustomer,
  filterTradePickerItems, setTradeTimeRange, setTradeStaffFilter,
  setTradeCustomerFilter, tradeQuickPay, tradeQuickEdit, openRefundAction,
} from './trade-table.js';
import {
  renderBusiness, renderDashboard, renderSettings, getBizPanel, refreshBorrowers, populateWsMonths, toggleWsStats,
  renderWholesale, deleteSale, deleteTrade, setHistoryFilter as bizSetFilter,
} from './business.js';
import { renderStorefront } from './storefront.js';
import {
  openCustModal, editCustomer, saveCustomerRecord, deleteCustomer,
} from './customers.js';
import {
  renderBorrowers, borrowerSearch, setBorrowerFilter, setBorrowerSort,
  openBorrowerModal, editBorrower, saveBorrower, deleteBorrower,
  openAddDebtModal, openAddPaymentModal, saveBorrowerTx, deleteBorrowerTx, payBackDeposit, settleTradesFromDeposit,
  showBorrowerReceipt, printBorrowerStatement, openNoTradeDebtModal,
} from './borrowers.js';
import { openOneRecordReview, oneRecordPick, oneRecordSwitch } from './one-record.js';   // D.3.8
import { renderProfit } from './profit.js';
import { initUserMenu, toggleUserMenu, userMenuSignOut, refreshThemeMenuLabel } from './user-menu.js';
import * as offlineStore from './offline-store.js';   // D.8.1 — offline foundation
import * as syncEngine   from './sync-engine.js';     // D.8.2a — queue drainer + banner

// Offline file saver (sw.js): keeps a copy of the app on the phone so it
// still opens with no internet.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('[sw] register failed', e));
}

window.__PK = {
  handleAuth, closeModal, toast,
  toggleUserMenu, userMenuSignOut, refreshThemeMenuLabel,
  toggleAcc, saveMarkup, calcCarton, livePreview, addItem, shareItem,
  openEdit, saveEdit, cancelEdit, deleteItem, renderItems, onSellManualInput, onRowManualInput,
  resetSellOverride, resetRowOverride, onCartonSellInput, changeBuyUnit, clearAddForm,
  onTrackStockToggle, toggleLowStockFilter, setStockFilter, reviewNeedsCost, toggleNeedsCostFilter,
  reviewNeedsStock, toggleNeedsStockFilter,
  openSetStock, cancelSetStock, saveSetStock, ssQtyInput, ssWarnInput,
  clearInventoryFilters, toggleSelectMode, toggleItemSelected,
  bulkExportSelected, bulkDeleteSelected, togglePrivacyMode, switchInvSubtab,
  itemSupplierChanged, openInvCardPopover, invPopoverFire,
  openRestockModal, closeRestockModal, rstRecalc, rstSupplierChanged, rstSave,
  openSupplierModal, closeSupplierModal, saveSupplierRecord,
  switchSupView, editSupplier, deactivateSupplier,
  supToggleShopItem, supSetShopQty, supSelectLowStock,
  supBuildShoppingList, supClearShoppingList,
  supToggleAddSupplier, supSaveSupplierPrice,
  supToggleAdhocForm, supSubmitAdhocItem, supRemoveAdhocItem,
  supSetBudget, supBestSearch, supBpKeydown,
  supCompleteRestock, supCancelRestock, supToggleRestockSkip, supSaveRestocks,
  initTradeTab, populateTradeCustSelect,
  renderTradeTable, setTradeTableFilter, expandTradeRow,
  openNewTradeModal, closeNewTradeModal, switchNtmTab, ntmSearch, openNewTradeForCredit,
  ntmAddPcs, ntmAddRows, ntmAddCartons, ntmAddCustom, ntmAddByBarcode, ntmRemove,
  scanItemBarcode, scanTradeBarcode, closeBarcodeScanner,
  openPaymentModal, toggleCartPanel, renderRecentTrades, toggleRecentTrades,
  setTradeStatus, toggleTradeSelectMode, toggleTradeRowSelected,
  clearTradeFilters, openTradeRowPopover, popoverFire,
  exportTradesSmart, bulkExportTrades, bulkVoidTrades, bulkDeleteTrades,
  openTradePicker, pickTradeTime, pickTradeStaff, pickTradeCustomer,
  filterTradePickerItems, setTradeTimeRange, setTradeStaffFilter,
  setTradeCustomerFilter, tradeQuickPay, tradeQuickEdit, openRefundAction,
  setHistoryFilter: bizSetFilter,
  renderBusiness, renderDashboard, refreshBorrowers, populateWsMonths, toggleWsStats,
  renderWholesale, deleteSale, deleteTrade,
  openCustModal, editCustomer, saveCustomerRecord, deleteCustomer,
  renderBorrowers, borrowerSearch, setBorrowerFilter, setBorrowerSort,
  openBorrowerModal, editBorrower, saveBorrower, deleteBorrower,
  openAddDebtModal, openAddPaymentModal, saveBorrowerTx, deleteBorrowerTx, payBackDeposit, settleTradesFromDeposit,
  showBorrowerReceipt, printBorrowerStatement, openNoTradeDebtModal,
  openOneRecordReview, oneRecordPick, oneRecordSwitch,
  renderProfit,
  _setProfitPeriod: () => renderProfit(),
};

function _activateTab(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  if (btn) btn.classList.add('active');
  else document.querySelector(`.tab-btn[data-tab="${name}"]`)?.classList.add('active');
}

window.__switchTab = function(name, btn) {
  _activateTab(name, btn);
  if (name === 'dashboard')  { renderDashboard();  pushHash('dashboard'); }
  if (name === 'trade')      { initTradeTab();      pushHash('trade'); }
  if (name === 'business')   { renderBusiness();    pushHash('business/' + getBizPanel()); }
  if (name === 'settings')   { renderSettings();    pushHash('settings'); }
  if (name === 'storefront') { renderStorefront();  pushHash('storefront'); }
  if (name === 'inventory') {
    const isSup = document.getElementById('invSubSuppliers')?.hidden === false;
    if (isSup) pushHash('inventory/suppliers/' + getSupView());
    else       pushHash('inventory/items');
  }
};

// Navigate to a path derived from location.hash — used by initRouter on
// back/forward and on first load. Never pushes hash itself (routerNavigating
// flag in router.js suppresses pushHash calls from navigation fns).
function _navigateTo(path) {
  const parts = path.split('/');
  const tab   = parts[0] || 'dashboard';
  _activateTab(tab);
  if (tab === 'dashboard')  { renderDashboard(); }
  else if (tab === 'trade') { initTradeTab(); }
  else if (tab === 'settings')   { renderSettings(); }
  else if (tab === 'storefront') { renderStorefront(); }
  else if (tab === 'inventory') {
    const sub = parts[1] || 'items';
    if (sub === 'suppliers') {
      switchInvSubtab('suppliers');
      switchSupView(parts[2] || 'directory');
    } else {
      switchInvSubtab('items');
    }
  } else if (tab === 'business') {
    renderBusiness();
    window.bizNav(parts[1] || 'customers');
  }
}

// Apply a cloud shop profile (name/phone/address) to this device: localStorage
// (offline + receipts), the wordmark, and the page title. Called by the owner's
// profile listener (db.js) and the staff load path (staff-auth.js) so a shop
// name change persists across every device and reaches staff — not just the
// device it was typed on.
window.applyShopProfile = function (profile) {
  if (!profile) return;
  const name = (profile.shopName || '').trim();
  if (name) {
    localStorage.setItem('pkAppName', name);
    document.querySelectorAll('.app-name-label').forEach(el => el.textContent = name);
    document.title = name;
  }
  localStorage.setItem('pkShopProfile', JSON.stringify({
    phone:   profile.phone   || '',
    address: profile.address || '',
  }));
  // If the Settings page is open, refresh its inputs to the synced values.
  const sp = document.getElementById('spName');
  if (sp && name) sp.value = name;
};

window.__switchSubTab = function() {};

// ── Search-box clear (✕) button — shared by inventory/trade/new-trade
// search inputs. The button markup + onclick/oninput call sites were added
// in ea21174 (barcode scanning commit, 21 Jul 2026) but these two functions
// were never written, so the ✕ has never appeared or worked since. Generic
// so any search box can wire into it: call _toggleSearchClear(inputId,
// clearBtnId) on input to show/hide the ✕, and _clearSearchBox(inputId,
// onClear, clearBtnId) from the ✕'s onclick to empty the field and re-run
// whatever the search does with an empty value.
window._toggleSearchClear = function(inputId, clearBtnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(clearBtnId);
  if (!input || !btn) return;
  btn.hidden = !input.value;
};

window._clearSearchBox = function(inputId, onClear, clearBtnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(clearBtnId);
  if (input) input.value = '';
  if (btn) btn.hidden = true;
  if (typeof onClear === 'function') onClear();
  if (input) input.focus();
};

// Trade search's ✕ (index.html #tradeSearchClear) was wired to this exact
// name but it never existed either.
window.clearTradeSearchBox = function() {
  window._clearSearchBox('tradeSearchInput', () => window.tradeTableSearch(''), 'tradeSearchClear');
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
  if (e.key === 'Enter' && !document.querySelector('.overlay.open')) {
    const a = document.activeElement?.id;
    if (['iName','iBuyPrice','iCartonSell','iCartonQty'].includes(a)) addItem();
  }
});

document.querySelectorAll('.overlay').forEach(ov =>
  ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); })
);

function _showSplash() {
  if (document.getElementById('pkSplash')) return;
  const appName = (localStorage.getItem('pkAppName') || 'Price Keeper').toUpperCase();
  const splash  = document.createElement('div');
  splash.id     = 'pkSplash';
  splash.setAttribute('aria-hidden', 'true');
  const wordmark = document.createElement('div');
  wordmark.className   = 'pk-splash-wordmark';
  wordmark.textContent = appName;
  splash.appendChild(wordmark);
  document.body.appendChild(splash);
}

function _hideSplash() {
  const el = document.getElementById('pkSplash');
  if (!el) return;
  el.classList.add('pk-splash-fadeout');
  setTimeout(() => el.remove(), 250);
}

(async function init() {
  _showSplash();

  const sm = localStorage.getItem('pkMarkup');
  if (sm) { const el = document.getElementById('globalMarkup'); if (el) el.value = sm; }

  window._pkItems     = safe('pkItems');
  window._pkWholesale = safe('pkWholesale');
  window._pkSales     = normalizeSales(safe('pkSales'));
  window._pkBorrowers = safe('pkBorrowers');
  window._pkExpenses  = safe('pkExpenses');
  window._pkContacts  = safe('pkContacts');

  initContacts();
  applyTheme();

  const appName = localStorage.getItem('pkAppName');
  if (appName) {
    document.querySelectorAll('.app-name-label').forEach(el => el.textContent = appName);
    document.title = appName;
  }

  // Owner / staff / signed-out dispatch happens inside initAuth's
  // onAuthStateChanged. authReady resolves once the first callback finishes
  // so we don't render owner-mode UI to a returning staff session (BUG-003).
  initAuth();
  initUserMenu();
  await authReady;

  // D.8.1 — open the offline mirror DB after auth, before rendering UI.
  // open() never rejects: on IndexedDB unavailability it logs, sets
  // window._pkOfflineDisabled=true, and resolves null so boot continues.
  try {
    await offlineStore.open();
  } catch (err) {
    console.error('[app] offline-store.open() threw — continuing boot:', err);
    window._pkOfflineDisabled = true;
  }

  // D.8.2a — start the sync engine (online detection + banner + queue
  // drain). Safe even if the offline store is disabled: drain finds an
  // empty queue and the banner just reflects online/offline state.
  try {
    syncEngine.start();
  } catch (err) {
    console.error('[app] syncEngine.start() threw — continuing boot:', err);
  }

  renderItems();
  updateSummary();
  // Route to hash on load (falls back to dashboard), then wire back/forward.
  // Staff sessions override this via applyStaffMode → __switchTab which
  // pushes its own hash, so the router lands wherever staff left off.
  _navigateTo(currentPath());
  initRouter(_navigateTo);
  _hideSplash();

  if (!isStaffMode()) checkOnboarding();
})();