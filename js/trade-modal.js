// ============================================================
//  trade-modal.js — D.3.4a Phase 2
//  New Trade modal · Bold Command Center rebuild.
//  Contract: docs/mockups/D.3.4a-direction-1-FINAL.html
//
//  Model: ONE cart line per (item + mode). Each line is single-mode,
//  so it maps cleanly onto the legacy write-path fields
//  (cartons/rows/qty/originalRevenue/revenue/cost/itemDiscount) that
//  trade-payment.js + _decrementStock consume unchanged.
//
//  Phase 1 (commit 062c5ad) discount permission wiring preserved:
//  getDiscountPolicy() gates the per-line discount editor; the
//  defensive re-check still lives at the save edge in trade-payment.js.
// ============================================================

import { fmt, fmtSpan, today, now, toast, escapeHtml, findBorrowerByName, uid } from './utils.js';
import { saveItem } from './db.js';
import { activeUid } from './auth.js';
import { logActivity } from './staff-auth.js';
import { borrowerBalance, accountStanding } from './borrowers.js';
import { getDiscountPolicy, getCurrentActor } from './staff-auth.js';

// ── State ─────────────────────────────────────────────────────
let _cart           = [];
let _tradeSearch    = '';
let _ntmTab         = 'items';
let _editingTradeId = null;
let _discountPolicy = { canDiscount: true, maxDiscount: null };
let _parsed         = null;   // power-user { query, qty, mode } or null
let _resultsCache   = [];     // items currently shown in results
let _focusIdx       = -1;     // keyboard-focused result index (-1 = nothing selected)
let _pulseKey       = null;   // `${itemId}|${mode}` to pulse after cart render
let _resMode        = {};     // per-result selected mode (itemId → 'pcs'|'row'|'ctn'); reset each results render
let _custOpts       = [];     // customer picker options [{id,name,label}] — custom scrollable dropdown
let _inlinePayOpen   = false; // D.3.4a — "Pay now, on this page" panel expanded?
let _inlinePayAmount = null;  // amount typed there, kept across cart-foot re-renders

const MOBILE_BP = 760;
// D.3.6: owner-only custom items live here for the trade being built, not
// in Inventory. Same shape as an inventory item (sell / buyPrice in pieces,
// no stock tracking) so every price, cost and cart helper works unchanged.
const _customItems = new Map();
let _customFormOpen = false;
const byId = id => (window._pkItems || []).find(i => i.id === id) || _customItems.get(id);
function _makeCustomItem(id, name, price, cost) {
  const item = { id, name, sell: price, buyPrice: cost, buyUnit: 'piece', piecesPerCarton: 1, trackStock: false, custom: true };
  _customItems.set(id, item);
  return item;
}

export function getCart()            { return _cart; }
export function getEditingTradeId()  { return _editingTradeId; }
export function clearCart()          { _cart = []; _editingTradeId = null; }

// Indices of cart lines whose discount breaches the actor's policy.
export function getCartOverLimitLines() {
  const { canDiscount, maxDiscount } = _discountPolicy;
  if (!canDiscount) {
    return _cart.reduce((a, r, i) => ((r.itemDiscount || 0) > 0 ? [...a, i] : a), []);
  }
  if (maxDiscount === null) return [];
  return _cart.reduce((a, r, i) => ((r.itemDiscount || 0) > maxDiscount ? [...a, i] : a), []);
}

// ── Price / cost helpers (stable exports — used elsewhere) ────
export function _ppc(item) {
  if (item.piecesPerCarton && parseFloat(item.piecesPerCarton) > 0) return parseFloat(item.piecesPerCarton);
  if (item.rowsPerCarton && item.piecesPerRow) return parseFloat(item.rowsPerCarton) * parseFloat(item.piecesPerRow);
  if (item.cartonQty && parseFloat(item.cartonQty) > 0) return parseFloat(item.cartonQty);
  return 1;
}
export function _ppr(item) {
  return item.piecesPerRow && parseFloat(item.piecesPerRow) > 0 ? parseFloat(item.piecesPerRow) : 0;
}
export function _rowSellPrice(item) {
  if (item.rowSell && parseFloat(item.rowSell) > 0) return parseFloat(item.rowSell);
  const ppr = _ppr(item);
  return ppr > 0 ? (item.sell || 0) * ppr : 0;
}
// Cost source of truth = buyPrice (+ buyUnit + piecesPer*) and the per-piece
// `buy`, i.e. the fields the inventory form actually writes. Legacy `cartonBuy`
// is a LAST-RESORT fallback only — used solely when neither buyPrice nor buy
// exists (truly-legacy items). It is never preferred, so a stale/fossil
// cartonBuy left behind by the old quick-edit overlay can no longer override
// the real price at sale time and inflate profit. (Fossil-cartonBuy bug.)
export function _costPerPiece(item) {
  if (item.buyPrice && parseFloat(item.buyPrice) > 0) {
    const ppc = _ppc(item); const ppr = _ppr(item);
    if (item.buyUnit === 'carton' && ppc > 1) return parseFloat(item.buyPrice) / ppc;
    if (item.buyUnit === 'row') return ppr > 0 ? parseFloat(item.buyPrice) / ppr : parseFloat(item.buyPrice);
    return parseFloat(item.buyPrice);
  }
  if (item.buy && parseFloat(item.buy) > 0) return parseFloat(item.buy);
  if (item.cartonBuy && parseFloat(item.cartonBuy) > 0) {
    const ppc = _ppc(item);
    return ppc > 1 ? parseFloat(item.cartonBuy) / ppc : parseFloat(item.cartonBuy);
  }
  return item.buy || 0;
}
export function _costPerRow(item) {
  if (item.buyUnit === 'row' && item.buyPrice) return parseFloat(item.buyPrice);
  const ppr = _ppr(item);
  return ppr > 0 ? _costPerPiece(item) * ppr : 0;
}
export function _costPerCarton(item) {
  // buyUnit carton → buyPrice IS the carton cost; otherwise derive from the
  // per-piece source of truth. Legacy cartonBuy only as a last resort.
  if (item.buyPrice && parseFloat(item.buyPrice) > 0) {
    if (item.buyUnit === 'carton') return parseFloat(item.buyPrice);
    return _costPerPiece(item) * _ppc(item);
  }
  if (item.buy && parseFloat(item.buy) > 0) return _costPerPiece(item) * _ppc(item);
  if (item.cartonBuy && parseFloat(item.cartonBuy) > 0) return parseFloat(item.cartonBuy);
  return _costPerPiece(item) * _ppc(item);
}

// ── Mode helpers ──────────────────────────────────────────────
function _availableModes(item) {
  const ppc   = _ppc(item);
  const ppr   = _ppr(item);
  const cSell = item.cartonSell ? parseFloat(item.cartonSell) : 0;
  const rSell = _rowSellPrice(item);
  return {
    pcs: (item.sell || 0) > 0 || (cSell <= 0 && rSell <= 0),
    row: ppr > 0 && rSell > 0,
    ctn: cSell > 0 && ppc > 1,
  };
}
function _defaultMode(item) {
  const av = _availableModes(item);
  const bu = item.buyUnit === 'carton' ? 'ctn' : item.buyUnit === 'row' ? 'row' : 'pcs';
  if (av[bu]) return bu;
  if (av.ctn) return 'ctn';
  if (av.row) return 'row';
  return 'pcs';
}
function _unitPieces(item, mode) {
  if (mode === 'ctn') return _ppc(item);
  if (mode === 'row') return _ppr(item) || 1;
  return 1;
}
function _unitPrice(item, mode) {
  if (mode === 'ctn') return item.cartonSell ? parseFloat(item.cartonSell) : (item.sell || 0) * _ppc(item);
  if (mode === 'row') return _rowSellPrice(item);
  return item.sell || 0;
}
function _unitCost(item, mode) {
  if (mode === 'ctn') return _costPerCarton(item);
  if (mode === 'row') return _costPerRow(item);
  return _costPerPiece(item);
}
function _lineModeQty(line) {
  return line.mode === 'pcs' ? (line.qty || 0)
       : line.mode === 'row' ? (line.rows || 0)
       : (line.cartons || 0);
}
function _lineTotalPcs(line, item) {
  if (!item) return 0;
  return (line.qty || 0) + (line.rows || 0) * (_ppr(item) || 1) + (line.cartons || 0) * _ppc(item);
}

// ── Stock helpers ─────────────────────────────────────────────
function _stockPieces(item) {
  if (!item || !item.trackStock || item.stockQty == null) return null;
  // Always recompute from the live stockQty. The denormalized stockQtyPcs
  // cache is NOT decremented on sale (and the cashier item-update rule
  // whitelists only stockQty/qty/low/updatedTs), so trusting it showed
  // frozen stock in the modal while inventory showed the real figure.
  const qty  = parseFloat(item.stockQty) || 0;
  const unit = item.stockUnit || item.buyUnit || 'carton';
  return unit === 'carton' ? qty * _ppc(item) : unit === 'row' ? qty * (_ppr(item) || 1) : qty;
}
function _lowPieces(item) {
  if (!item || !item.trackStock) return null;
  const p = parseFloat(item.lowThresholdPcs);
  if (Number.isFinite(p)) return p;
  const lt = parseFloat(item.lowThreshold);
  if (!Number.isFinite(lt)) return null;
  const unit = item.lowThresholdUnit || item.stockUnit || item.buyUnit || 'carton';
  return unit === 'carton' ? lt * _ppc(item) : unit === 'row' ? lt * (_ppr(item) || 1) : lt;
}
function _stockState(item) {
  if (!item || !item.trackStock || item.stockQty == null) return 'untracked';
  const pcs = _stockPieces(item);
  if (pcs == null) return 'untracked';
  if (pcs <= 0) return 'out';
  const low = _lowPieces(item);
  if (item.low === true) return 'low';
  if (low != null && pcs <= low) return 'low';
  return 'ok';
}
function _fmtCount(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
function _unitWord(mode, count) {
  if (mode === 'ctn') return 'ctn';
  if (mode === 'row') return count === 1 ? 'row' : 'rows';
  return 'pcs';
}
// Stock chip for a search result — shows the largest configured unit.
function _resultStockChip(item) {
  const st = _stockState(item);
  if (st === 'untracked') return `<span class="nt2-stock-chip untracked">∞ untracked</span>`;
  if (st === 'out')       return `<span class="nt2-stock-chip out">⛔ 0 pcs</span>`;
  const pcs  = _stockPieces(item);
  const icon = st === 'low' ? '⚠' : '✓';
  const av   = _availableModes(item);
  let mode;
  if (av.ctn) mode = 'ctn'; else if (av.row) mode = 'row'; else mode = 'pcs';
  return _stockChipBody(st, icon, pcs, item, mode, '');
}
// Stock chip for a cart line — mode-aware.
function _cartStockChip(item, mode) {
  if (item.custom) return `<span class="nt2-stock-chip custom cart">Custom</span>`;
  const st = _stockState(item);
  if (st === 'untracked') return `<span class="nt2-stock-chip untracked cart">∞ untracked</span>`;
  if (st === 'out')       return `<span class="nt2-stock-chip out cart">⛔ 0 pcs</span>`;
  const pcs  = _stockPieces(item);
  const icon = st === 'low' ? '⚠' : '✓';
  return _stockChipBody(st, icon, pcs, item, mode, ' cart');
}
function _stockChipBody(st, icon, pcs, item, mode, extraCls) {
  if (mode === 'pcs') {
    return `<span class="nt2-stock-chip ${st}${extraCls}">${icon} ${fmt(Math.round(pcs)).slice(1)} pcs</span>`;
  }
  const up  = _unitPieces(item, mode);
  const cnt = _fmtCount(pcs / up);
  const word = mode === 'ctn' ? 'ctn' : (cnt === '1' ? 'row' : 'rows');
  return `<span class="nt2-stock-chip ${st}${extraCls}">${icon} ${cnt} ${word}<span class="pcs"> · ${fmt(Math.round(pcs)).slice(1)} pcs</span></span>`;
}
// "Give customer" callout for fractional qty — shown only when modeQty is
// not a whole number. Tries to express the total pieces as whole rows first
// (cleaner to hand over), then falls back to pcs.
function _giveCalloutHtml(modeQty, totalPcs, item, mode) {
  if (Number.isInteger(modeQty) || modeQty <= 0 || !item) return '';
  const ppr = _ppr(item);
  let primary, alt = '';
  if (mode !== 'pcs' && ppr > 0) {
    const rows = totalPcs / ppr;
    if (Number.isInteger(Math.round(rows * 100) / 100)) {
      const r = Math.round(rows * 100) / 100;
      primary = `${_fmtCount(r)} ${r === 1 ? 'row' : 'rows'}`;
      alt = `${fmt(Math.round(totalPcs)).slice(1)} pcs`;
    }
  }
  if (!primary) {
    primary = `${fmt(Math.round(totalPcs)).slice(1)} pcs`;
  }
  const altHtml = alt
    ? `<span class="gc-sep">·</span><span class="gc-alt">${alt}</span>`
    : '';
  return `<div class="nt2-give-callout">
    <span class="gc-label">Give customer</span>
    <span class="gc-arrow">→</span>
    <span class="gc-primary">${primary}</span>
    ${altHtml}
  </div>`;
}

// After-sale projection string + oversell flag.
function _projection(item, mode, soldPcs) {
  if (_stockState(item) === 'untracked') {
    return { html: `<span class="untracked">· stock not tracked</span>`, oversell: false };
  }
  const pcs     = _stockPieces(item);
  const projPcs = pcs - soldPcs;
  if (projPcs < 0) return { html: `<span class="proj danger">· CANNOT OVERSELL</span>`, oversell: true };
  let projStr;
  if (mode === 'pcs') projStr = `${fmt(Math.round(projPcs)).slice(1)} pcs`;
  else {
    const up  = _unitPieces(item, mode);
    const cnt = _fmtCount(projPcs / up);
    projStr = `${cnt} ${mode === 'ctn' ? 'ctn' : (cnt === '1' ? 'row' : 'rows')}`;
  }
  const low = _lowPieces(item);
  if (low != null && projPcs <= low) {
    return { html: `<span class="proj warn">· stock after sale: ${projStr} (running low — restock soon)</span>`, oversell: false };
  }
  return { html: `<span class="proj">· stock after sale: ${projStr} (still ok)</span>`, oversell: false };
}

// ── Customer select (preserved from prior modal) ──────────────
// Customer picker. The visible control is a CUSTOM scrollable + searchable
// dropdown (see _renderCustList / the #ntmCustDd markup), because a native
// <select>'s popup height/scroll can't be controlled via CSS and the customer
// list runs off-screen. The selected id still lives on a hidden #ntmCustSelect
// input, so every reader (trade-payment.js, openEdit) keeps its .value contract.
export function populateTradeCustSelect(autoSelectId) {
  const list   = document.getElementById('ntmCustList');
  const hidden = document.getElementById('ntmCustSelect');
  if (!list || !hidden) return;   // dropdown not mounted (modal closed)
  const showDebtWarning = (() => {
    try { return JSON.parse(localStorage.getItem('pkSettings') || '{}').showDebtWarning !== false; }
    catch { return true; }
  })();
  _custOpts = (window._pkWholesale || []).map(c => {
    // D.3.5: the same lookup now answers both directions. An account can owe
    // the shop, or the shop can be holding money for it, never both, so the
    // two labels below can never collide.
    let debt = 0, deposit = 0;
    const acct = window._pkContactsActive
      ? (window._pkContacts || []).find(x => x.id === c.id)
      : findBorrowerByName(window._pkBorrowers, c.name);
    if (acct) {
      const st = accountStanding(acct);
      debt = st.balance;
      deposit = st.deposit;
    }
    // Deposit shows regardless of the debt-warning setting: that setting is
    // about nagging over a debt, and money the shop is holding is not a nag,
    // it is something the cashier needs before starting the trade.
    const label = deposit > 0
      ? `${c.name} · has ${fmt(deposit)} with you`
      : showDebtWarning && debt > 0
        ? `⚠️ ${c.name} · owes ${fmt(debt)}`
        : `${c.name}${c.contact ? ' · ' + c.contact : ''}`;
    return { id: c.id, name: c.name, label };
  });
  // Preserve the current pick across passive refreshes; only override when an
  // explicit auto-select id is passed (e.g. after adding a new customer).
  const keepId = autoSelectId != null && autoSelectId !== '' ? autoSelectId : hidden.value;
  _renderCustList('');
  _setTradeCust(keepId || '');
}

// Render the (optionally filtered) option rows into the scrollable list.
function _renderCustList(query) {
  const list = document.getElementById('ntmCustList');
  if (!list) return;
  const q   = (query || '').trim().toLowerCase();
  const sel = document.getElementById('ntmCustSelect')?.value || '';
  const rows = [];
  if (!q) rows.push(`<div class="nt2-cust-opt placeholder${sel === '' ? ' selected' : ''}" onclick="window._ntmCustPick('')">— Select customer —</div>`);
  const matches = _custOpts.filter(o => !q || o.name.toLowerCase().includes(q));
  matches.forEach(o => {
    rows.push(`<div class="nt2-cust-opt${o.id === sel ? ' selected' : ''}" onclick="window._ntmCustPick('${o.id}')">${escapeHtml(o.label)}</div>`);
  });
  if (q && !matches.length) rows.push(`<div class="nt2-cust-empty">No customer matches “${escapeHtml(query)}”</div>`);
  list.innerHTML = rows.join('');
}

// Set the selected customer: hidden value (the contract) + trigger label.
function _setTradeCust(id) {
  const hidden = document.getElementById('ntmCustSelect');
  const lbl    = document.getElementById('ntmCustLabel');
  if (!hidden || !lbl) return;
  hidden.value = id || '';
  const opt = _custOpts.find(o => o.id === id);
  lbl.textContent = opt ? opt.label : '— Select customer —';
  lbl.classList.toggle('placeholder', !opt);
}

window._ntmCustToggle = function() {
  const dd = document.getElementById('ntmCustDd');
  if (!dd) return;
  const willOpen = !dd.classList.contains('open');
  dd.classList.toggle('open', willOpen);
  if (!willOpen) return;
  _renderCustList('');
  const s = document.getElementById('ntmCustSearch');
  if (s) { s.value = ''; s.focus(); }
  document.querySelector('#ntmCustList .nt2-cust-opt.selected')?.scrollIntoView({ block: 'nearest' });
};
window._ntmCustFilter = function(q) { _renderCustList(q); };
window._ntmCustPick = function(id) {
  _setTradeCust(id);
  document.getElementById('ntmCustDd')?.classList.remove('open');
};

// ── Inline "＋ New Customer" (preserved) ──────────────────────
window._ntmAddNewCustomer = function() {
  const name = prompt('New customer name:');
  if (!name || !name.trim()) return;
  if (name.trim().length > 60) return toast('⚠️ Customer name must be 60 characters or less', 'err');
  const duplicate = findBorrowerByName(window._pkWholesale, name);
  if (duplicate) {
    toast(`⚠️ "${duplicate.name}" already exists — selecting them now`, 'err');
    populateTradeCustSelect(duplicate.id);
    return;
  }
  const contact = prompt('Phone / contact (optional):') || '';
  const newCust = { id: 'c_' + crypto.randomUUID().slice(0, 12), name: name.trim(), contact: contact.trim() };
  window._pkWholesale = window._pkWholesale || [];
  window._pkWholesale.push(newCust);
  import('./utils.js').then(({ saveLocal }) => saveLocal())
    .catch(err => { console.error('[trade-modal] Failed to save locally:', err); toast('⚠️ Customer added but local save failed', 'err'); });
  import('./auth.js').then(({ currentUser }) => {
    if (currentUser) {
      import('./db.js').then(({ saveCustomer }) => {
        saveCustomer(currentUser.uid, newCust).catch(err => {
          console.error('[trade-modal] Failed to save customer to cloud:', err); toast('⚠️ Customer added locally but cloud sync failed', 'err'); });
      }).catch(err => { console.error('[trade-modal] Failed to load db.js:', err); toast('⚠️ Cloud sync unavailable', 'err'); });
    }
  }).catch(err => { console.error('[trade-modal] Failed to load auth.js:', err); toast('⚠️ Cloud sync unavailable', 'err'); });
  populateTradeCustSelect(newCust.id);
  window.bizRefreshActivePanel?.();
  toast(`✅ ${newCust.name} added`, 'ok');
};

// ── Open / close ──────────────────────────────────────────────
export function openNewTradeModal() {
  _cart = []; _tradeSearch = ''; _ntmTab = 'items'; _editingTradeId = null;
  _parsed = null; _focusIdx = -1; _pulseKey = null;
  _inlinePayOpen = false; _inlinePayAmount = null;
  _openModal(null);
}

// D.3.7 · "Add Debt" on a customer's account: New Trade with that customer
// already picked and the pay-now box open at ₦0, so Complete saves it as a
// credit trade. The cashier can still change the amount if they paid part.
export function openNewTradeForCredit(custId) {
  openNewTradeModal();
  _inlinePayOpen = true; _inlinePayAmount = '0';
  populateTradeCustSelect(custId);
  _renderNtmCart();
}

export function openEditTradeModal(saleId) {
  const sale = (window._pkSales || []).find(s => s.id === saleId);
  if (!sale) return toast('⚠️ Trade not found', 'err');
  _editingTradeId = saleId; _tradeSearch = ''; _ntmTab = 'items';
  _parsed = null; _focusIdx = -1; _pulseKey = null;

  _cart = (sale.items || []).map(it => {
    const cartons = it.cartons || 0, rows = it.rows || 0, qty = it.qty || 0;
    if (it.custom && !byId(it.itemId)) {
      const n = qty || 1;
      _makeCustomItem(it.itemId, it.itemName, it.pieceSell || 0, (it.cost || 0) / n);
    }
    const mode = cartons > 0 ? 'ctn' : rows > 0 ? 'row' : 'pcs';
    const disc = it.lineDiscount ?? it.itemDiscount ?? 0;   // MISSION v1.4 backward-read
    return {
      itemId: it.itemId, itemName: it.itemName,
      mode, cartons, rows, qty, label: it.label || '',
      pieceSell: it.pieceSell || 0, cartonSell: it.cartonSell || 0, rowSell: it.rowSell || 0,
      originalRevenue: it.originalRevenue ?? it.revenue ?? 0,
      revenue: it.revenue ?? 0, cost: it.cost || 0, profit: it.profit || 0,
      itemDiscount: disc, lineDiscount: disc, _discOpen: disc > 0, _editing: false,
      discEach: it.discEach || 0, _discMode: (it.discEach > 0 || !disc) ? 'each' : 'total',
      ...(it.custom ? { custom: true } : {}),
    };
  });
  _openModal(sale);
}

function _openModal(existingSale) {
  _discountPolicy = getDiscountPolicy();
  let modal = document.getElementById('newTradeModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'newTradeModal'; document.body.appendChild(modal); }
  modal.innerHTML = _buildModal(existingSale);
  modal.style.display = 'flex';
  document.body.classList.add('nt2-modal-open');   // full-page takeover (hide app chrome)
  populateTradeCustSelect();

  const dateEl = document.getElementById('ntmDate');
  if (dateEl) dateEl.value = existingSale?.date || today();
  if (existingSale) {
    _setTradeCust(existingSale.custId || '');
    const arEl = document.getElementById('ntmAmountReceived');
    if (arEl && existingSale.amountReceived != null) arEl.value = existingSale.amountReceived;
    _setStatusBadge(existingSale.amountReceived || 0, existingSale.totalRevenue || 0);
  }
  _renderNtmItems();
  _renderParseHint();
  _renderQuick();
  _renderNtmCart();
  document.getElementById('ntmSearch')?.focus();
}

function _buildModal(existingSale) {
  const isEdit    = !!existingSale;
  const titleSub  = isEdit ? `Edit · ${existingSale.id}` : 'New Trade';
  const titleMain = isEdit ? 'Edit trade' : 'Ring up a sale';

  return `
  <div class="nt2-overlay" id="nt2Overlay">
    <div class="nt2-modal">
      <div class="nt2-head">
        <div class="nt2-title"><span class="eye">${escapeHtml(titleSub)}</span>${titleMain}</div>
        <button class="nt2-close" onclick="PK.closeNewTradeModal()">✕</button>
      </div>
      <div class="nt2-tabs">
        <button class="nt2-tab active" id="nt2TabItems" onclick="PK.switchNtmTab('items')">Items</button>
        <button class="nt2-tab" id="nt2TabCart" onclick="PK.switchNtmTab('cart')">Cart<span class="nt2-tab-badge" id="nt2CartBadge" style="display:none;">0</span></button>
      </div>
      <div class="nt2-body">
        <div class="nt2-row">
          <div class="nt2-left" id="nt2Left">
            <div class="nt2-meta-row">
              <div class="nt2-field">
                <span class="nt2-lab">Customer</span>
                <div class="nt2-cust-wrap">
                  <div class="nt2-cust-dd" id="ntmCustDd">
                    <input type="hidden" id="ntmCustSelect" value="">
                    <button type="button" class="nt2-cust-trigger" onclick="window._ntmCustToggle()" aria-haspopup="listbox">
                      <span class="lbl placeholder" id="ntmCustLabel">— Select customer —</span>
                      <span class="caret">▼</span>
                    </button>
                    <div class="nt2-cust-panel">
                      <div class="nt2-cust-searchwrap">
                        <input type="text" class="nt2-cust-search" id="ntmCustSearch" placeholder="Search customer…"
                          autocomplete="off" spellcheck="false"
                          oninput="window._ntmCustFilter(this.value);window._toggleSearchClear('ntmCustSearch','ntmCustSearchClear')">
                        <button type="button" class="nt2-cust-search-clear" id="ntmCustSearchClear"
                          onclick="window._clearSearchBox('ntmCustSearch',()=>window._ntmCustFilter(''),'ntmCustSearchClear')"
                          aria-label="Clear search" hidden>✕</button>
                      </div>
                      <div class="nt2-cust-list" id="ntmCustList" role="listbox"></div>
                    </div>
                  </div>
                  <button class="nt2-newcust" onclick="window._ntmAddNewCustomer()" title="Add new customer">＋ New</button>
                </div>
              </div>
              <div class="nt2-field">
                <span class="nt2-lab">Date</span>
                <input type="date" id="ntmDate" class="nt2-inp">
              </div>
            </div>
            <div class="nt2-field">
              <span class="nt2-lab">Who's collecting (optional)</span>
              <input type="text" id="ntmVisitor" class="nt2-inp" placeholder="e.g. Umar, sent by Aliyu…" maxlength="40" value="${escapeHtml(existingSale?.visitorName || '')}">
            </div>
            ${isEdit ? `
            <div class="nt2-edit-row">
              <div class="nt2-field">
                <span class="nt2-lab">Amount received (<span class="currency">₦</span>)</span>
                <input type="number" id="ntmAmountReceived" class="nt2-inp" placeholder="0" min="0" oninput="window._nt2RecalcEditStatus()">
              </div>
              <div class="nt2-field">
                <span class="nt2-lab">Payment status · auto</span>
                <div class="nt2-status-badge paid" id="ntmPaymentStatusBadge">✓ Paid</div>
              </div>
            </div>` : ''}
            <div class="nt2-field">
              <span class="nt2-lab">Search items</span>
              <div class="nt2-search-block" style="display:flex;gap:8px;align-items:center;">
                <div style="position:relative;flex:1;display:flex;align-items:center;">
                  <svg class="nt2-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" id="ntmSearch" class="nt2-search-input" placeholder="Type item name… or 'indomie 2 row'"
                    autocomplete="off" spellcheck="false" oninput="PK.ntmSearch(this.value);window._toggleSearchClear('ntmSearch','ntmSearchClear')">
                  <button type="button" class="nt2-search-clear" id="ntmSearchClear"
                    onclick="window._clearSearchBox('ntmSearch',()=>PK.ntmSearch(''),'ntmSearchClear')"
                    aria-label="Clear search" hidden>✕</button>
                </div>
                <button type="button" class="bcs-scan-btn" onclick="PK.scanTradeBarcode()" aria-label="Scan barcode">📷</button>
              </div>
            </div>
            <div id="nt2ParseHint"></div>
            <div class="nt2-results" id="ntmItemList"></div>
            <div class="nt2-quick" id="nt2Quick"></div>
          </div>
          <div class="nt2-cart-panel" id="nt2Right">
            <div class="nt2-cart-head">
              <span id="nt2CartHeadL">Cart</span>
              <span class="ct" id="nt2CartHeadR">0 items</span>
            </div>
            <div class="nt2-cart-list" id="ntmCartRows">
              <div class="nt2-cart-empty"><span class="ic">🛒</span><div>Set qty on any row, then ＋Add</div></div>
            </div>
            <div class="nt2-cart-foot" id="nt2CartFoot" style="display:none;"></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

export function closeNewTradeModal() {
  const modal = document.getElementById('newTradeModal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('nt2-modal-open');   // restore app chrome
  _cart = []; _editingTradeId = null; _parsed = null; _resMode = {};
  _inlinePayOpen = false; _inlinePayAmount = null;
}

// ── Mobile tab switching ──────────────────────────────────────
export function switchNtmTab(tab) {
  _ntmTab = tab;
  const left = document.getElementById('nt2Left'), right = document.getElementById('nt2Right');
  const tItems = document.getElementById('nt2TabItems'), tCart = document.getElementById('nt2TabCart');
  const isMobile = window.innerWidth <= MOBILE_BP;
  if (!isMobile) {
    if (left)  left.style.display  = '';
    if (right) right.style.display = '';
    tItems?.classList.add('active'); tCart?.classList.remove('active');
    return;
  }
  if (tab === 'items') {
    if (left)  left.style.display  = 'flex';
    if (right) right.style.display = 'none';
    tItems?.classList.add('active'); tCart?.classList.remove('active');
  } else {
    if (left)  left.style.display  = 'none';
    if (right) right.style.display = 'flex';
    tCart?.classList.add('active'); tItems?.classList.remove('active');
  }
}
window.addEventListener('resize', () => {
  const left = document.getElementById('nt2Left'), right = document.getElementById('nt2Right');
  if (!left || !right) return;
  if (window.innerWidth > MOBILE_BP) { left.style.display = ''; right.style.display = ''; }
});

// ── Search + power-user parse ─────────────────────────────────
const _MODE_WORDS = {
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs',
  row: 'row', rows: 'row',
  ctn: 'ctn', ctns: 'ctn', carton: 'ctn', cartons: 'ctn',
};
function _parseSearch(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const tokens = s.split(/\s+/);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1].toLowerCase();
  const prev = (tokens[tokens.length - 2] || '').toLowerCase();
  let qty = null, mode = null, used = 0;
  if (_MODE_WORDS[last] && /^\d*\.?\d+$/.test(prev)) { mode = _MODE_WORDS[last]; qty = parseFloat(prev); used = 2; }
  else if (/^\d*\.?\d+$/.test(last)) { qty = parseFloat(last); used = 1; }
  if (qty === null) return null;
  const query = tokens.slice(0, tokens.length - used).join(' ').trim();
  if (!query) return null;
  return { query, qty: _normQty(qty, 1), mode };
}

export function ntmSearch(val) {
  _parsed = _parseSearch(val);
  _tradeSearch = (_parsed ? _parsed.query : val).toLowerCase().trim();
  _focusIdx = -1;
  const inp = document.getElementById('ntmSearch');
  if (inp) inp.classList.toggle('power', !!_parsed);
  _renderNtmItems();
  _renderParseHint();
}

function _renderParseHint() {
  const el = document.getElementById('nt2ParseHint');
  if (!el) return;
  if (!_parsed || !_resultsCache.length) { el.innerHTML = ''; return; }
  const item = _resultsCache[_focusIdx] || _resultsCache[0];
  let mode = _parsed.mode || _defaultMode(item);
  if (!_availableModes(item)[mode]) mode = _defaultMode(item);
  const price = _unitPrice(item, mode) * _parsed.qty;
  el.innerHTML = `
    <div class="nt2-parse-hint">
      <span>Detected:</span>
      <span class="nt2-chip-inline">${escapeHtml(item.name)}</span><span style="color:var(--muted);">·</span>
      <span class="nt2-chip-inline">${_parsed.qty} ${mode.toUpperCase()}</span><span style="color:var(--muted);">·</span>
      <span>${fmtSpan(price)}</span>
      <span class="spacer">↵ to add</span>
    </div>`;
}

// ── Results render ────────────────────────────────────────────
function _renderNtmItems() {
  const list = document.getElementById('ntmItemList');
  if (!list) return;
  _resMode = {};   // fresh render → each row starts at its default mode
  const q = _tradeSearch;
  let items = window._pkItems || [];
  if (q) items = items.filter(i => (i.name || '').toLowerCase().includes(q));
  _resultsCache = items;
  if (_focusIdx >= items.length) _focusIdx = -1;
  const custom = _customRowHtml();
  if (!items.length) { list.innerHTML = `<div class="nt2-empty">No items found</div>` + custom; return; }
  list.innerHTML = items.map((item, i) => _resultRowHtml(item, i)).join('') + custom;
}

// D.3.6 (docs/mockups/D.3.6-custom-item.html): owner only. Sell something
// that is not in Inventory: name, price and quantity straight into the cart.
function _customRowHtml() {
  if (window._staffOwnerUid) return '';
  const raw = (document.getElementById('ntmSearch')?.value || '').trim();
  if (!raw && !_customFormOpen) return '';
  if (!_customFormOpen) {
    return `<div class="nt2-custom-row" onclick="window._nt2CustomOpen()">＋ Add “${escapeHtml(raw)}” as a custom item <span class="tag">OWNER</span></div>`;
  }
  return `
  <div class="nt2-custom-form" onclick="event.stopPropagation()">
    <label class="full">Item name<input id="nt2CustName" value="${escapeHtml(raw)}" autocomplete="off"></label>
    <label>Price each (₦)<input id="nt2CustPrice" inputmode="decimal" placeholder="0"></label>
    <label>Quantity<input id="nt2CustQty" inputmode="decimal" value="1"></label>
    <label class="full">Cost each (₦), optional<input id="nt2CustCost" inputmode="decimal" placeholder="Leave empty if you don't know"></label>
    <label class="inv"><input type="checkbox" id="nt2CustInv" onchange="window._nt2CustInvHint(this.checked)"> Also add to Inventory</label>
    <div class="hint" id="nt2CustHint">Not added to Inventory. No stock is taken off.</div>
    <div class="actions">
      <button class="btn" onclick="window._nt2CustomCancel()">Cancel</button>
      <button class="btn go" id="nt2CustAdd" onclick="window._nt2CustomAdd()">＋ Add to cart</button>
    </div>
  </div>`;
}
window._nt2CustomOpen = function() {
  if (window._staffOwnerUid) return;
  _customFormOpen = true;
  _renderNtmItems();
  document.getElementById('nt2CustPrice')?.focus();
};
window._nt2CustInvHint = function(on) {
  const h = document.getElementById('nt2CustHint');
  if (h) h.textContent = on
    ? 'Saved to Inventory at this price, stock not counted yet. Set stock and units there any time.'
    : 'Not added to Inventory. No stock is taken off.';
};
window._nt2CustomCancel = function() {
  _customFormOpen = false;
  _renderNtmItems();
};
window._nt2CustomAdd = function() {
  if (window._staffOwnerUid) return;
  const name  = (document.getElementById('nt2CustName')?.value || '').trim();
  const num   = id => parseFloat(String(document.getElementById(id)?.value || '').replace(/,/g, ''));
  const price = num('nt2CustPrice');
  const qty   = _normQty(document.getElementById('nt2CustQty')?.value, 1);
  const costIn = num('nt2CustCost');
  if (!name) return toast('⚠️ Type the item name', 'err');
  if (!(price > 0)) return toast('⚠️ Type the price', 'err');
  // No cost given: count it as no profit, so reports never show profit
  // that was not really made.
  const cost = costIn >= 0 ? costIn : price;
  if (document.getElementById('nt2CustInv')?.checked) {
    _customFormOpen = false;
    return _addCustomToInventory(name, price, costIn >= 0 ? costIn : null, qty);
  }
  const item = _makeCustomItem('custom_' + uid(), name, price, cost);
  _customFormOpen = false;
  _addToCart(item.id, 'pcs', qty);
};

// Tick box "Also add to Inventory": a normal piece-priced item, stock not
// counted yet (the owner sets stock and units in Inventory later). A same-
// named item already there is reused rather than duplicated. Unknown cost
// is saved the way Inventory saves it (buyPrice null).
async function _addCustomToInventory(name, price, cost, qty) {
  window._pkItems = window._pkItems || [];
  let item = window._pkItems.find(i => (i.name || '').trim().toLowerCase() === name.toLowerCase());
  if (item) {
    toast(`ℹ️ ${item.name} is already in Inventory, using it`, 'ok');
  } else {
    item = {
      id: uid(), name, buyUnit: 'piece', buy: cost ?? 0, sell: price, cat: '', qty: '',
      buyPrice: cost, cartonSell: 0, rowSell: 0, piecesPerCarton: '', rowsPerCarton: '', piecesPerRow: '',
      note: 'Added from a trade', barcode: null,
      trackStock: false, stockQty: null, stockUnit: 'piece',
      lowThreshold: null, lowThresholdUnit: 'piece', lowThresholdPcs: null, low: false,
      updatedAt: now(), updatedTs: Date.now(), addedDate: today(), history: [],
    };
    window._pkItems.unshift(item);
    const u = activeUid();
    if (u) {
      try { await saveItem(u, item); }
      catch (e) { console.error('[trade-modal] custom → inventory save failed', e); toast('⚠️ Saved on this phone, Inventory sync failed', 'err'); }
    }
    logActivity('ADD_ITEM', { itemName: item.name, buyPrice: item.buyPrice, sellPrice: item.sell, from: 'trade' });
    toast(`✅ ${name} added to Inventory`, 'ok');
  }
  _addToCart(item.id, _availableModes(item).pcs ? 'pcs' : _defaultMode(item), qty);
  window.PK?.renderItems?.();
}

function _priceChip(mode, pcname, price, isDefault) {
  return `<span class="nt2-r-price-chip${isDefault ? ' default' : ''}" data-mode="${mode}"><span class="pcname">${pcname}</span>${fmtSpan(price)}</span>`;
}

function _resultRowHtml(item, i) {
  const st      = _stockState(item);
  const focused = i === _focusIdx;
  if (st === 'out') {
    return `
    <div class="nt2-result out-of-stock${focused ? ' focus' : ''}" data-i="${i}" onclick="window._nt2ResClick(${i})">
      <div class="nt2-r-info">
        <div class="nt2-r-name-row">
          <span class="nt2-r-name">${escapeHtml(item.name)}</span>
          ${_resultStockChip(item)}
          <span class="nt2-out-label">Out of stock</span>
        </div>
        <div class="nt2-r-meta">${item.cat ? `<span class="nt2-r-cat">${escapeHtml(item.cat)}</span>` : ''}</div>
      </div>
      <div class="nt2-r-actions">
        ${getCurrentActor().role !== 'cashier' ? `<button class="nt2-add-btn nt2-restock-btn" onclick="event.stopPropagation();window._nt2Restock(${i})">⟲ Restock</button>` : ''}
        <button class="nt2-add-btn disabled">＋ Add</button>
      </div>
    </div>`;
  }
  const av    = _availableModes(item);
  const dmode = _defaultMode(item);
  const usingParsed = !!_parsed && focused;
  // Selected mode for THIS row: explicit click wins, else parsed (focused
  // only), else item default. Must resolve to an available mode.
  let selMode = _resMode[item.id];
  if (!selMode) selMode = usingParsed ? (_parsed.mode || dmode) : dmode;
  if (!av[selMode]) selMode = dmode;
  const addQty = usingParsed ? _parsed.qty : 1;

  // Bigger PCS/ROW/CTN pills — mode name on top, price hint beneath, all
  // in one button (the old small pills + separate price-chips row are
  // combined). Every available mode stays clickable; disabled (mode not
  // configured) shows "—". Cart-line pills are a different component.
  const bigPills = ['pcs', 'row', 'ctn'].map(m => {
    const active = selMode === m, avail = !!av[m];
    const cls = active ? 'active' : avail ? '' : 'disabled';
    const onclick = avail ? `onclick="event.stopPropagation();window._nt2ResMode(${i},'${m}')"` : '';
    let priceHtml = '—';
    if (avail) {
      const p = _unitPrice(item, m);
      priceHtml = p > 0 ? `${fmtSpan(p)}` : '—';
    }
    return `<button class="nt2-r-pill ${cls}" data-mode="${m}" ${onclick}>`
      + `<span class="nt2-r-pill-name">${m.toUpperCase()}</span>`
      + `<span class="price-on-pill">${priceHtml}</span></button>`;
  }).join('');

  return `
  <div class="nt2-result${focused ? ' focus' : ''}" data-i="${i}" onclick="window._nt2ResClick(${i})">
    <div class="nt2-r-info">
      <div class="nt2-r-name-row">
        <span class="nt2-r-name">${escapeHtml(item.name)}</span>
        ${_resultStockChip(item)}
      </div>
      ${item.cat ? `<div class="nt2-r-meta"><span class="nt2-r-cat">${escapeHtml(item.cat)}</span></div>` : ''}
      <div class="nt2-r-pills">${bigPills}</div>
    </div>
    <div class="nt2-r-actions">
      <input class="nt2-qty-input" id="nt2-resqty-${i}" value="${addQty}" inputmode="decimal" onclick="event.stopPropagation()" />
      <button class="nt2-add-btn" onclick="event.stopPropagation();window._nt2ResAdd(${i})">＋ Add</button>
    </div>
  </div>`;
}

window._nt2ResStep = function(i, d) {
  const inp = document.getElementById('nt2-resqty-' + i);
  if (!inp) return;
  inp.value = _normQty((parseFloat(inp.value) || 0) + d, _MIN_QTY);
};
// Out-of-stock row: record the delivery without leaving the trade.
window._nt2Restock = async function(i) {
  const item = _resultsCache[i];
  if (!item) return;
  const R = await import('./restock-modal.js');
  R.openRestockModal(item.id);
  const ov = document.getElementById('restockOverlay');
  if (ov) ov.style.zIndex = '1100';
};
window.addEventListener('pkRestockClosed', () => {
  if (document.getElementById('newTradeModal')?.style.display !== 'none') _renderNtmItems();
});
window._nt2ResClick = function(i) {
  _focusIdx = i;
  document.querySelectorAll('#ntmItemList .nt2-result').forEach((r, idx) => r.classList.toggle('focus', idx === i));
};
// Mode pre-selection on a search row — targeted update so the qty stepper
// value is preserved. The chosen mode is remembered (in _resMode) and used
// when +Add fires, so the item lands in the cart at the chosen mode.
window._nt2ResMode = function(i, mode) {
  const item = _resultsCache[i];
  if (!item || !_availableModes(item)[mode]) return;
  _resMode[item.id] = mode;
  const row = document.querySelectorAll('#ntmItemList .nt2-result')[i];
  if (!row) return;
  row.querySelectorAll('.nt2-r-pills .nt2-r-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
};
window._nt2ResAdd = function(i) {
  const item = _resultsCache[i];
  if (!item) return;
  if (_stockState(item) === 'out' && !_editOwnPcs(item)) { toast('⚠️ Cannot add — out of stock', 'err'); return; }
  let mode = _resMode[item.id];
  if (!mode) mode = (_parsed && i === _focusIdx) ? (_parsed.mode || _defaultMode(item)) : _defaultMode(item);
  if (!_availableModes(item)[mode]) mode = _defaultMode(item);
  const qty = _normQty(document.getElementById('nt2-resqty-' + i)?.value, 1);
  _addToCart(item.id, mode, qty);
};

// ── Quick picks (top sellers) ─────────────────────────────────
function _topSellers(n) {
  const counts = Object.create(null);
  for (const s of (window._pkSales || [])) {
    if (s.voided) continue;
    for (const it of (s.items || [])) if (it.itemId) counts[it.itemId] = (counts[it.itemId] || 0) + 1;
  }
  const items  = window._pkItems || [];
  const ranked = items.filter(i => counts[i.id]).sort((a, b) => counts[b.id] - counts[a.id]);
  return (ranked.length ? ranked : items).slice(0, n);
}
function _renderQuick() {
  const el = document.getElementById('nt2Quick');
  if (!el) return;
  const top = _topSellers(4);
  if (!top.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="nt2-quick-label">Quick · top sellers</span>` +
    top.map(it => `<button class="nt2-quick-chip" onclick="window._nt2Quick('${it.id}')">${escapeHtml(it.name)}<span class="pn">${fmtSpan(_unitPrice(it, _defaultMode(it)))}</span></button>`).join('');
}
window._nt2Quick = function(id) {
  const it = byId(id);
  if (!it) return;
  if (_stockState(it) === 'out' && !_editOwnPcs(it)) { toast('⚠️ Cannot add — out of stock', 'err'); return; }
  _addToCart(id, _defaultMode(it), 1);
};

// Fractional cart quantities (1.5 / 0.5 / 0.25 carton, etc.) are
// supported — restored after the D.3.4a rewrite had forced integers via
// parseInt/Math.floor. The sale-write + stock-decrement path already
// handles fractional cartons/rows/qty (it did before the rewrite), so
// this is purely the modal's input layer.
const _MIN_QTY = 0.01;
function _normQty(v, fallback = 1) {
  let q = parseFloat(v);
  if (!Number.isFinite(q)) return fallback;
  q = Math.round(q * 100) / 100;   // 2dp → .25/.5/1.5 exact, no float noise
  return q > 0 ? q : fallback;
}

// ── Add to cart (dedupe by item + mode) ───────────────────────
function _recomputeLine(line, item, modeQty) {
  const mode  = line.mode;
  const price = _unitPrice(item, mode);
  const cost  = _unitCost(item, mode);
  line.qty     = mode === 'pcs' ? modeQty : 0;
  line.rows    = mode === 'row' ? modeQty : 0;
  line.cartons = mode === 'ctn' ? modeQty : 0;
  line.pieceSell  = item.sell || 0;
  line.rowSell    = _rowSellPrice(item);
  line.cartonSell = item.cartonSell ? parseFloat(item.cartonSell) : (_availableModes(item).ctn ? _unitPrice(item, 'ctn') : 0);
  line.originalRevenue = price * modeQty;
  // D.3.4a: an Each discount follows the quantity in the line's unit.
  const want = line._discMode === 'each' ? (line.discEach || 0) * modeQty : (line.itemDiscount || 0);
  const disc = Math.max(0, Math.min(Math.round(want * 100) / 100, line.originalRevenue));
  line.itemDiscount = disc;
  line.lineDiscount = disc;
  line.revenue = Math.max(0, line.originalRevenue - disc);
  line.cost    = cost * modeQty;
  line.profit  = line.revenue - line.cost;
  line.label   = _buildLabel(line);
}

function _addToCart(itemId, mode, modeQty) {
  const item = byId(itemId);
  if (!item) return;
  if (_stockState(item) === 'out' && !_editOwnPcs(item)) { toast('⚠️ Cannot add — out of stock', 'err'); return; }
  if (!_availableModes(item)[mode]) mode = _defaultMode(item);
  modeQty = _normQty(modeQty, 1);   // allow fractions (1.5 / 0.5 / 0.25)

  const idx = _cart.findIndex(r => r.itemId === itemId && r.mode === mode);
  if (idx >= 0) {
    _recomputeLine(_cart[idx], item, _lineModeQty(_cart[idx]) + modeQty);
  } else {
    const line = { itemId, itemName: item.name, mode, itemDiscount: 0, lineDiscount: 0, _discOpen: false, _editing: false, discEach: 0, _discMode: 'each', ...(item.custom ? { custom: true } : {}) };
    _recomputeLine(line, item, modeQty);
    _cart.push(line);
  }
  _cart.forEach(r => { r._editing = (r.itemId === itemId && r.mode === mode); });
  _pulseKey = itemId + '|' + mode;

  // POS flow: clear search, ready for next item (per FINAL "Add next item…").
  _parsed = null; _tradeSearch = '';
  const inp = document.getElementById('ntmSearch');
  if (inp) { inp.value = ''; inp.classList.remove('power'); }
  _focusIdx = -1;
  _renderNtmItems();
  _renderParseHint();
  _renderNtmCart();
  inp?.focus();
}

function _buildLabel(r) {
  const parts = [];
  if (r.cartons > 0) parts.push(`${r.cartons} ctn`);
  if (r.rows    > 0) parts.push(`${r.rows} row${r.rows !== 1 ? 's' : ''}`);
  if (r.qty     > 0) parts.push(`${r.qty} pc${r.qty !== 1 ? 's' : ''}`);
  return parts.join(' + ') || '—';
}

// Legacy add wrappers (kept for app.js PK proxy + any old callers).
export function ntmAddPcs(itemId, qty)        { _addToCart(itemId, 'pcs', qty); }
export function ntmAddRows(itemId, rows)      { _addToCart(itemId, 'row', rows); }
export function ntmAddCartons(itemId, cartons){ _addToCart(itemId, 'ctn', cartons); }
// Barcode scan → straight into the cart, 1 piece at a time (barcode-scanner.js).
export function ntmAddByBarcode(itemId)       { _addToCart(itemId, 'pcs', 1); }
export function ntmAddCustom(itemId) {
  const item = byId(itemId);
  if (!item) return;
  _addToCart(itemId, _defaultMode(item), 1);
}

export function ntmRemove(idx) {
  _cart.splice(idx, 1);
  _renderNtmCart();
}

// ── Discount editor handlers (Phase 1 gating preserved) ───────
function _discHintHtml(disc, overDisc) {
  const { maxDiscount } = _discountPolicy;
  if (maxDiscount === null) return 'no limit';
  if (overDisc) return `limit <b>${fmtSpan(maxDiscount)}</b> · over by ${fmtSpan(disc - maxDiscount)}`;
  return `limit <b>${fmtSpan(maxDiscount)}</b> · ${fmtSpan(Math.max(0, maxDiscount - disc))} left`;
}
function _lineOverDisc(line) {
  const { canDiscount, maxDiscount } = _discountPolicy;
  const d = line.itemDiscount || 0;
  return (!canDiscount && d > 0) || (canDiscount && maxDiscount !== null && d > maxDiscount);
}
function _discAlertMsg() {
  const { canDiscount, maxDiscount } = _discountPolicy;
  if (!canDiscount) return `⚠ Discounts are not permitted for your role. Remove the discount to proceed.`;
  return `⚠ Exceeds your discount limit (${fmtSpan(maxDiscount)}). Reduce to within limit, or ask Owner to approve.`;
}

window._nt2ToggleDisc = function(idx) {
  const l = _cart[idx];
  if (!l) return;
  if (!_discountPolicy.canDiscount) { toast('⚠️ Discounts not permitted for your role', 'err'); return; }
  l._discOpen = !l._discOpen;
  _renderNtmCart();
  if (l._discOpen) document.getElementById('nt2-disc-' + idx)?.focus();
};
window._nt2ClearDisc = function(idx) {
  const l = _cart[idx]; const item = byId(l?.itemId);
  if (!l || !item) return;
  l.itemDiscount = 0; l.discEach = 0; l._discOpen = false;
  _recomputeLine(l, item, _lineModeQty(l));
  _renderNtmCart();
};
window._nt2DiscInput = function(idx, val) {
  const l = _cart[idx]; const item = byId(l?.itemId);
  if (!l) return;
  const orig = l.originalRevenue || 0;
  const typed = Math.max(0, parseFloat(val) || 0);
  let disc = typed;
  if (l._discMode === 'each') { l.discEach = typed; disc = Math.round(typed * _lineModeQty(l) * 100) / 100; }
  disc = Math.min(disc, orig);
  l.itemDiscount = disc; l.lineDiscount = disc;
  l.revenue = Math.max(0, orig - disc);
  l.profit  = l.revenue - (l.cost || 0);
  _refreshLineChrome(idx, item);
  _refreshFoot();
};
// Back-compat global used by older code paths.
window._ntmSetItemDiscount = function(idx, val) { window._nt2DiscInput(idx, val); };
// Total / Each switch. The number in the box keeps its value and changes
// meaning, because the switch is usually flipped before typing and the
// "× qty = ₦" readout shows the result straight away.
window._nt2DiscMode = function(idx, mode) {
  const l = _cart[idx]; const item = byId(l?.itemId);
  if (!l || !item || l._discMode === mode) return;
  const typed = Math.max(0, parseFloat(document.getElementById('nt2-disc-' + idx)?.value) || 0);
  l._discMode = mode;
  l.discEach  = mode === 'each' ? typed : 0;
  l.itemDiscount = typed;
  _recomputeLine(l, item, _lineModeQty(l));
  _renderNtmCart();
  document.getElementById('nt2-disc-' + idx)?.focus();
};

// Targeted DOM update so the discount input keeps focus while typing.
function _refreshLineChrome(idx, item) {
  const lineEl = document.querySelectorAll('#ntmCartRows .nt2-cart-line')[idx];
  if (!lineEl) return;
  const l        = _cart[idx];
  const disc     = l.itemDiscount || 0;
  const orig     = l.originalRevenue || 0;
  const overDisc = _lineOverDisc(l);

  const priceEl = lineEl.querySelector('.cl-price');
  if (priceEl) {
    priceEl.classList.toggle('over', overDisc);
    priceEl.innerHTML = (disc > 0 ? `<span class="strike">${fmtSpan(orig)}</span>` : '')
      + `${fmtSpan(l.revenue)}`;
  }
  const tog = lineEl.querySelector('.nt2-disc-toggle');
  if (tog) {
    tog.classList.toggle('active', disc > 0 && !overDisc);
    tog.classList.toggle('over', overDisc);
    tog.innerHTML = `⌒ Disc${disc > 0 ? ` ${fmtSpan(disc)}` : ''}`;
  }
  const ed = lineEl.querySelector('.nt2-disc-editor');
  if (ed) {
    ed.classList.toggle('cap-warning', overDisc);
    const hint = ed.querySelector('.max-hint');
    if (hint) hint.innerHTML = _discHintHtml(disc, overDisc);
    const math = ed.querySelector('.disc-math');
    if (math) math.innerHTML = _discMathHtml(l);
  }
  // Alert: oversell takes priority over discount-limit.
  const item2     = item || byId(l.itemId);
  const overStock = _lineOverStock(l, item2);
  let alertHtml = null;
  if (overStock) alertHtml = _oversellMsg(l, item2);
  else if (overDisc) alertHtml = _discAlertMsg();
  _setLineAlert(lineEl, alertHtml);
}
function _setLineAlert(lineEl, html) {
  let el = lineEl.querySelector('.nt2-line-alert');
  if (!html) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'nt2-line-alert'; lineEl.appendChild(el); }
  el.innerHTML = html;
}

// ── Mode + qty handlers ───────────────────────────────────────
window._nt2SetMode = function(idx, mode) {
  const l = _cart[idx]; const item = byId(l?.itemId);
  if (!l || !item) return;
  if (!_availableModes(item)[mode] || l.mode === mode) return;
  const curQty = _lineModeQty(l);
  l.mode = mode;
  _recomputeLine(l, item, curQty);
  _renderNtmCart();
};
window._nt2CartStep = function(idx, d) {
  const l = _cart[idx]; const item = byId(l?.itemId);
  if (!l || !item) return;
  _recomputeLine(l, item, _normQty(_lineModeQty(l) + d, _MIN_QTY));
  _renderNtmCart();
};
window._nt2SetCartQty = function(idx, val) {
  const l = _cart[idx]; const item = byId(l?.itemId);
  if (!l || !item) return;
  _recomputeLine(l, item, _normQty(val, 1));
  _renderNtmCart();
};

// ── Oversell (new trades only — edit stock already decremented) ─
// Pieces of this item already taken by the cart's OTHER lines (same item sold
// in a second unit, e.g. 1 ctn on one line and 5 pcs on another).
function _otherLinesPcs(line, item) {
  return _cart.reduce((t, r) => r !== line && r.itemId === line.itemId ? t + _lineTotalPcs(r, item) : t, 0);
}
// When editing, the trade's own pieces already left the shelf and come back
// on save, so they count as available.
function _editOwnPcs(item) {
  if (!_editingTradeId || !item) return 0;
  const sale = (window._pkSales || []).find(s => s.id === _editingTradeId);
  if (!sale || sale.voided || !Array.isArray(sale.items)) return 0;
  return sale.items.reduce((t, r) => r?.itemId === item.id ? t + _lineTotalPcs(r, item) : t, 0);
}
function _lineOverStock(line, item) {
  const sp = _stockPieces(item);
  if (sp == null) return false;
  return _lineTotalPcs(line, item) + _otherLinesPcs(line, item) > sp + _editOwnPcs(item) + 1e-9;
}
function _oversellMsg(line, item) {
  const sp = Math.max(0, (_stockPieces(item) || 0) + _editOwnPcs(item) - _otherLinesPcs(line, item));
  const avail = Math.floor(sp / _unitPieces(item, line.mode));
  const word  = _unitWord(line.mode, avail);
  return `⚠ Qty exceeds stock. Only ${avail} ${word} available. Reduce qty to ${avail} or below to proceed.`;
}
function _blockedReason() {
  for (const r of _cart) { const it = byId(r.itemId); if (_lineOverStock(r, it)) return 'stock'; }
  for (const r of _cart) { if (_lineOverDisc(r)) return 'disc'; }
  return null;
}

// ── Cart render ───────────────────────────────────────────────
export function _renderNtmCart() {
  const rows = document.getElementById('ntmCartRows');
  const foot = document.getElementById('nt2CartFoot');
  if (!rows) return;
  const { canDiscount } = _discountPolicy;
  const n = _cart.length;

  // Head + badge
  const totalPcs = _cart.reduce((a, r) => a + _lineTotalPcs(r, byId(r.itemId)), 0);
  const headL = document.getElementById('nt2CartHeadL');
  const headR = document.getElementById('nt2CartHeadR');
  if (headL) headL.textContent = n ? `Cart · ${n} item${n !== 1 ? 's' : ''}` : 'Cart';
  if (headR) headR.textContent = n ? `${fmt(totalPcs).slice(1)} pcs` : '0 items';
  const badge = document.getElementById('nt2CartBadge');
  if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none'; }

  if (!n) {
    rows.innerHTML = `<div class="nt2-cart-empty"><span class="ic">🛒</span><div>Set qty on any row, then ＋Add</div></div>`;
    if (foot) { foot.style.display = 'none'; foot.innerHTML = ''; }
    _refreshEditStatusBadge();
    return;
  }

  rows.innerHTML = _cart.map((line, idx) => _cartLineHtml(line, idx, byId(line.itemId), canDiscount)).join('');
  if (foot) { foot.style.display = ''; foot.innerHTML = _footHtml(); }
  _refreshEditStatusBadge();

  // Auto-scroll + pulse on the just-touched line.
  if (_pulseKey) {
    const pidx = _cart.findIndex(r => (r.itemId + '|' + r.mode) === _pulseKey);
    const el = pidx >= 0 ? rows.querySelectorAll('.nt2-cart-line')[pidx] : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 650);
    }
    _pulseKey = null;
  }
}

function _discMathHtml(line) {
  const q = _lineModeQty(line);
  return `× ${fmt(q).slice(1)} = <b>${fmtSpan(line.itemDiscount || 0)}</b>`;
}

function _cartLineHtml(line, idx, item, canDiscount) {
  const mode     = line.mode;
  const modeQty  = _lineModeQty(line);
  const disc     = line.itemDiscount || 0;
  const orig     = line.originalRevenue || 0;
  const finalRev = line.revenue;
  const overDisc = _lineOverDisc(line);
  const overStock = _lineOverStock(line, item);
  const av = item ? _availableModes(item) : { pcs: true, row: false, ctn: false };

  const stockChip = item ? _cartStockChip(item, mode) : '';
  const totalPcs  = _lineTotalPcs(line, item);
  const proj      = item ? _projection(item, mode, totalPcs) : { html: '', oversell: false };

  // price
  const priceInner = (disc > 0 ? `<span class="strike">${fmtSpan(orig)}</span>` : '')
    + `${fmtSpan(finalRev)}`;

  // mode pills
  const pills = ['pcs', 'row', 'ctn'].map(m => {
    const active = mode === m;
    const avail  = !!av[m];
    const cls = active ? 'active' : avail ? '' : 'disabled';
    const onclick = (avail && !active) ? `onclick="window._nt2SetMode(${idx},'${m}')"` : '';
    return `<button class="nt2-mode-pill ${cls}" ${onclick}>${m.toUpperCase()}</button>`;
  }).join('');

  // discount toggle
  const togCls   = !canDiscount ? 'disabled' : overDisc ? 'over' : (disc > 0 ? 'active' : '');
  const togAttrs = canDiscount ? `onclick="window._nt2ToggleDisc(${idx})"` : `title="Not permitted by your role"`;
  const togLabel = `⌒ Disc${disc > 0 ? ` ${fmtSpan(disc)}` : ''}`;

  // discount editor
  const discEditor = (line._discOpen && canDiscount) ? `
    <div class="nt2-disc-editor ${overDisc ? 'cap-warning' : ''}">
      <span class="disc-seg">
        <button class="${line._discMode !== 'each' ? 'on' : ''}" onclick="window._nt2DiscMode(${idx},'total')">Total</button>
        <button class="${line._discMode === 'each' ? 'on' : ''}" onclick="window._nt2DiscMode(${idx},'each')">Each</button>
      </span>
      <input id="nt2-disc-${idx}" value="${(line._discMode === 'each' ? line.discEach : disc) || ''}" inputmode="decimal" placeholder="0"
        oninput="window._nt2DiscInput(${idx}, this.value)" />
      ${line._discMode === 'each' ? `<span class="disc-math">${_discMathHtml(line)}</span>` : ''}
      <span class="max-hint">${_discHintHtml(disc, overDisc)}</span>
      <button class="clear-disc" onclick="window._nt2ClearDisc(${idx})" title="Clear discount">✕</button>
    </div>` : '';

  // unit info
  let unitInfo = '';
  if (item) {
    const word = totalPcs === 1 ? 'piece' : 'pieces';
    unitInfo = `= <b>${fmt(totalPcs).slice(1)} ${word}</b> · ${fmtSpan(item.sell || 0)} each ${proj.html}`;
  }

  // give-customer callout (fractional qty only)
  const giveCallout = _giveCalloutHtml(modeQty, totalPcs, item, mode);

  // alert
  let alertHtml = '';
  if (overStock) alertHtml = `<div class="nt2-line-alert">${_oversellMsg(line, item)}</div>`;
  else if (overDisc) alertHtml = `<div class="nt2-line-alert">${_discAlertMsg()}</div>`;

  const lineCls = ['nt2-cart-line'];
  if (line._editing && !overStock) lineCls.push('editing');
  if (overStock) lineCls.push('over-stock');

  return `
  <div class="${lineCls.join(' ')}" data-key="${escapeHtml(line.itemId + '|' + mode)}">
    <div class="cl-top">
      <div class="cl-name-row">
        <span class="cl-name">${escapeHtml(line.itemName)}</span>
        ${stockChip}
      </div>
      <div class="cl-price ${(overDisc || overStock) ? 'over' : ''}">${priceInner}</div>
    </div>
    <div class="cl-bottom">
      <div class="nt2-mode-pills">${pills}</div>
      <div class="nt2-qty">
        <button onclick="window._nt2CartStep(${idx},-1)">−</button>
        <input value="${modeQty}" inputmode="decimal" onchange="window._nt2SetCartQty(${idx}, this.value)" />
        <button onclick="window._nt2CartStep(${idx},1)">+</button>
      </div>
      <button class="nt2-disc-toggle ${togCls}" ${togAttrs}>${togLabel}</button>
      <button class="cl-rm" onclick="PK.ntmRemove(${idx})" title="Remove">⌫</button>
    </div>
    <div class="cl-unit-info">${unitInfo}</div>
    ${giveCallout}
    ${discEditor}
    ${alertHtml}
  </div>`;
}

function _footHtml() {
  const subtotal  = _cart.reduce((a, r) => a + (r.originalRevenue || 0), 0);
  const totalDisc = _cart.reduce((a, r) => a + (r.itemDiscount || 0), 0);
  const total     = subtotal - totalDisc;
  const totalPcs  = _cart.reduce((a, r) => a + _lineTotalPcs(r, byId(r.itemId)), 0);
  const blocked   = _blockedReason();
  const label = blocked
    ? (blocked === 'stock' ? '⛔ Cannot complete — qty exceeds stock' : '⛔ Cannot complete — discount over limit')
    : `Complete · ${fmtSpan(total)}`;

  // D.3.4a — optional inline payment, new-trade only (edit mode has its
  // own amount/status fields up in the meta row already).
  let inlinePayHtml = '';
  if (!_editingTradeId) {
    const received = parseFloat(_inlinePayAmount) || 0;
    const { status, label: statusLabel, balance } = _statusFromAmount(received, total);
    inlinePayHtml = `
    <button class="nt2-pay-toggle" onclick="window._nt2TogglePayInline()">
      <span>💳 Pay now, on this page</span><span class="car">${_inlinePayOpen ? '▲ collapse' : '▼ expand'}</span>
    </button>
    <div class="nt2-pay-inline${_inlinePayOpen ? ' open' : ''}" id="nt2PayInline">
      <div class="nt2-pay-quick-row">
        <button onclick="window._nt2PayInlineSet(${total},${total})">Exact</button>
        <button onclick="window._nt2PayInlineSet(0,${total})">Full Credit</button>
      </div>
      <div class="nt2-pay-grid">
        <div class="nt2-field">
          <span class="nt2-lab">Amount received (<span class="currency">₦</span>)</span>
          <input type="number" id="nt2PayInlineAmount" class="nt2-inp" placeholder="0" min="0"
            value="${_inlinePayAmount != null ? escapeHtml(String(_inlinePayAmount)) : ''}"
            oninput="window._nt2PayInlineInput(${total})">
        </div>
        <div class="nt2-field">
          <span class="nt2-lab">Status · auto</span>
          <div class="nt2-status-badge ${status}" id="nt2PayInlineBadge">${statusLabel}</div>
        </div>
      </div>
      <div class="nt2-pay-balance" id="nt2PayInlineBalance" style="display:${balance > 0 ? '' : 'none'};">Balance owing: ${fmtSpan(balance)} — auto-recorded as debt</div>
    </div>`;
  }

  return `
    <div class="subtotal-line"><span>Subtotal</span><span class="val">${fmtSpan(subtotal)}</span></div>
    ${totalDisc > 0 ? `<div class="subtotal-line disc"><span>− Line discounts</span><span class="val">− ${fmtSpan(totalDisc)}</span></div>` : ''}
    <div class="total-divider"></div>
    <div class="total-line"><span class="total-lab">Total · ${fmt(totalPcs).slice(1)} pcs</span><span class="total-val">${fmtSpan(total)}</span></div>
    ${inlinePayHtml}
    <button class="nt2-complete-btn" ${blocked ? 'disabled' : ''} onclick="PK.openPaymentModal()">${label}</button>`;
}

function _refreshFoot() {
  const foot = document.getElementById('nt2CartFoot');
  if (foot && _cart.length) foot.innerHTML = _footHtml();
  _refreshEditStatusBadge();
}
export function _ntmUpdateTotal() { _refreshFoot(); }

// ── Edit-trade payment status — auto-detected from amount, same rule as
// new trades (_pmConfirm in trade-payment.js), instead of the old manual
// dropdown. Recomputed on every cart change and every keystroke in the
// amount field, so it can never drift from what was actually typed.
function _statusFromAmount(received, total) {
  const balance = Math.max(0, total - received);
  const status  = balance <= 0 ? 'paid' : received <= 0 ? 'credit' : 'partial';
  const label   = status === 'paid' ? '✓ Paid' : status === 'credit' ? '⌒ Credit' : '½ Partial';
  return { status, label, balance };
}
function _setStatusBadge(received, total) {
  const badge = document.getElementById('ntmPaymentStatusBadge');
  if (!badge) return;
  const { status, label } = _statusFromAmount(received, total);
  badge.className = 'nt2-status-badge ' + status;
  badge.textContent = label;
}
function _refreshEditStatusBadge() {
  const arEl = document.getElementById('ntmAmountReceived');
  if (!arEl) return;   // not in edit mode
  const total = _cart.reduce((a, r) => a + (r.revenue || 0), 0);
  _setStatusBadge(parseFloat(arEl.value) || 0, total);
}

// ── Inline "Pay now, on this page" panel (cart-foot, new trades only) —
// alternative to the popup opened by Complete. Collapsed by default;
// state survives cart-foot re-renders via the module vars above so
// nudging a qty stepper mid-entry doesn't wipe what was typed.
window._nt2TogglePayInline = function() {
  _inlinePayOpen = !_inlinePayOpen;
  _refreshFoot();
};
window._nt2PayInlineInput = function(total) {
  const el = document.getElementById('nt2PayInlineAmount');
  _inlinePayAmount = el ? el.value : null;
  _refreshInlinePayBadge(total);
};
window._nt2PayInlineSet = function(v, total) {
  _inlinePayAmount = String(v);
  const el = document.getElementById('nt2PayInlineAmount');
  if (el) el.value = v;
  _refreshInlinePayBadge(total);
};
function _refreshInlinePayBadge(total) {
  const el = document.getElementById('nt2PayInlineAmount');
  const received = parseFloat(el?.value) || 0;
  const { status, label, balance } = _statusFromAmount(received, total);
  const badge = document.getElementById('nt2PayInlineBadge');
  if (badge) { badge.className = 'nt2-status-badge ' + status; badge.textContent = label; }
  const balRow = document.getElementById('nt2PayInlineBalance');
  if (balRow) {
    balRow.style.display = balance > 0 ? '' : 'none';
    balRow.innerHTML = `Balance owing: ${fmtSpan(balance)} — auto-recorded as debt`;
  }
}
window._nt2RecalcEditStatus = _refreshEditStatusBadge;

// ── Keyboard ──────────────────────────────────────────────────
function _moveFocus(d) {
  const n = _resultsCache.length;
  if (!n) return;
  _focusIdx = _focusIdx === -1
    ? (d > 0 ? 0 : n - 1)
    : (_focusIdx + d + n) % n;
  const els = document.querySelectorAll('#ntmItemList .nt2-result');
  els.forEach((r, i) => r.classList.toggle('focus', i === _focusIdx));
  els[_focusIdx]?.scrollIntoView({ block: 'nearest' });
}
function _addFocused() {
  const item = _resultsCache[_focusIdx];
  if (!item) return;
  if (_stockState(item) === 'out' && !_editOwnPcs(item)) { toast('⚠️ Cannot add — out of stock', 'err'); return; }
  window._nt2ResAdd(_focusIdx);
}
function _attemptComplete() {
  if (!_cart.length) return;
  const blocked = _blockedReason();
  if (blocked) { toast(blocked === 'stock' ? '⛔ Qty exceeds stock — reduce to proceed' : '⛔ Discount over limit — reduce to proceed', 'err'); return; }
  window.PK?.openPaymentModal?.();
}
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('newTradeModal');
  if (!modal || modal.style.display === 'none') return;
  if (e.key === 'Escape') {
    // Close an open customer dropdown first; only then close the modal.
    const dd = document.getElementById('ntmCustDd');
    if (dd?.classList.contains('open')) { dd.classList.remove('open'); return; }
    closeNewTradeModal(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); _attemptComplete(); return; }
  const inSearch = e.target?.id === 'ntmSearch';
  const tag = (e.target?.tagName || '').toLowerCase();
  if (!inSearch && tag === 'input') return;   // don't hijack qty/discount typing
  if (e.key === 'ArrowDown')      { e.preventDefault(); _moveFocus(1); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); _moveFocus(-1); }
  else if (e.key === 'Enter')     { e.preventDefault(); _addFocused(); }
});
// Click outside the customer dropdown closes it. The trigger/options live
// inside #ntmCustDd, so their own clicks don't trip this (contains check).
document.addEventListener('click', (e) => {
  const dd = document.getElementById('ntmCustDd');
  if (dd?.classList.contains('open') && !dd.contains(e.target)) dd.classList.remove('open');
});
