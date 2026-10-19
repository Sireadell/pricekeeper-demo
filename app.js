// ============================================================
//  app.js — Fixed Version (Matches your current index.html)
// ============================================================

import { initAuth, handleAuth, updateSyncBar } from './auth.js';
import { closeModal } from './utils.js';
import {
  toggleAcc, saveMarkup, calcCarton, livePreview,
  addItem, renderItems, updateSummary,
  toggleHist, shareItem, openEdit, saveEdit, deleteItem
} from './inventory.js';
import { renderReports, clearReportFilter } from './reports.js';
import {
  populateWsMonths, renderWholesale,
  openCustModal, editCustomer, saveCustomerRecord, deleteCustomer,
  openSaleModal, calcSaleProfit, saveSaleRecord, deleteSale
} from './wholesale.js';

// Optional: Borrower imports (comment out if borrowers.js is causing errors)
import {
  renderBorrowers,
  openBorrowerModal, editBorrower, saveBorrower, deleteBorrower,
  openAddDebtModal, openAddPaymentModal, saveBorrowerTx, deleteBorrowerTx
} from './borrowers.js';

// ── Global PK namespace ───────────────────────────────────────────────────────
window.PK = {
  handleAuth,
  toggleAcc,
  saveMarkup,
  calcCarton,
  livePreview,
  addItem,
  toggleHist,
  shareItem,
  openEdit,
  saveEdit,
  deleteItem,
  renderItems,
  updateSummary,
  renderReports,
  clearReportFilter,
  openCustModal,
  editCustomer,
  saveCustomerRecord,
  deleteCustomer,
  openSaleModal,
  calcSaleProfit,
  saveSaleRecord,
  deleteSale,
  // Borrower functions
  renderBorrowers,
  openBorrowerModal,
  editBorrower,
  saveBorrower,
  deleteBorrower,
  openAddDebtModal,
  openAddPaymentModal,
  saveBorrowerTx,
  deleteBorrowerTx,
  closeModal,
};

// ── Tab switching (matches your current index.html) ─────────────────────────
window.switchTab = function(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  if (btn) btn.classList.add('active');

  if (name === 'reports')   renderReports();
  if (name === 'wholesale') { populateWsMonths(); renderWholesale(); }
};

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
  }
  if (e.key === 'Enter' && !document.querySelector('.overlay.open')) {
    const active = document.activeElement?.id;
    if (['iName', 'iBuy', 'iSell', 'iQty'].includes(active)) addItem();
  }
});

// ── Click outside modal to close ─────────────────────────────────────────────
document.querySelectorAll('.overlay').forEach(ov =>
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.classList.remove('open');
  })
);

// ── Boot ──────────────────────────────────────────────────────────────────────
(function init() {
  const savedMarkup = localStorage.getItem('pkMarkup');
  if (savedMarkup) {
    const el = document.getElementById('globalMarkup');
    if (el) el.value = savedMarkup;
    const disp = document.getElementById('markupDisplay');
    if (disp) disp.textContent = savedMarkup + '%';
  }

  window._pkItems     = JSON.parse(localStorage.getItem('pkItems')     || '[]');
  window._pkWholesale = JSON.parse(localStorage.getItem('pkWholesale') || '[]');
  window._pkSales     = JSON.parse(localStorage.getItem('pkSales')     || '[]');
  window._pkBorrowers = JSON.parse(localStorage.getItem('pkBorrowers') || '[]');

  renderItems();
  updateSummary();
  populateWsMonths();

  initAuth();
})();