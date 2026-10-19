// ============================================================
//  suppliers-view.js — D.9.3 Suppliers sub-tab views
//
//  Renders the three inner views of the Inventory → Suppliers sub-tab:
//    • Directory    — supplier list (was missing; suppliers added via the
//                     Restock/Add flows never showed up). Owner/admin can
//                     edit + deactivate; manager can add new only.
//    • Best Prices  — one row per item that has logged supplier prices,
//                     cheapest supplier highlighted, next-cheapest + the
//                     per-unit saving shown. Per-row pick + qty feed the
//                     Shopping List.
//    • Shopping List— store cards grouped by best supplier (built by the
//                     "Build shopping list" trigger in Best Prices).
//
//  No pixel mockup existed for D.9.3 — built to the locked Bold Command
//  Center tokens (css/suppliers-d9.css). Pure render layer: reads the
//  in-memory caches owned by suppliers-store.js + window._pkItems, never
//  writes Firestore directly (writes go through the store / supplier-modal).
// ============================================================

import { escapeHtml, toast, now, fmtSpan, daysAgo, unitShort } from './utils.js';
import { getCurrentActor, isCostBlindRole } from './staff-auth.js';
import { currentUser, activeUid } from './auth.js';
import { piecesPerUnit, computeWac, recalcThreshold } from './inventory-math.js';
import {
  getSuppliers, getSupplier, getActiveSuppliers,
  getSupplierPricesForItem, updateSupplier,
  createSupplier, createSupplierPrice,
} from './suppliers-store.js';
import { openSupplierModal } from './supplier-modal.js';
import { saveItem } from './db.js';
import { pushHash } from './router.js';

// ── module state ──────────────────────────────────────────────
let _view = 'directory';                 // 'directory' | 'prices' | 'shopping'
let _bestSearch = '';                    // live filter on Best Prices view
let _bpFocusIdx = -1;                   // keyboard cursor for Best Prices search
let _bpResultIds = [];                  // flat ordered item IDs currently visible
let _bpParsed = null;                   // { query, qty } from power-user syntax e.g. "indomie 5"
const _shopSel = new Map();              // itemId → qty (in best.perUnit)

// D.9.4 — shopping expansion (needs-pricing, quick add-supplier, custom
// items, budget+margin). All scratch/session state, same lifetime as
// _shopSel above — lost on reload, same as the existing picks today.
const _adhocItems = [];                  // [{id, name, qty, est, supplier}]
let _openPopoverFor = null;              // itemId whose quick-add popover is open
let _showAdhocForm = false;
let _shopBudget = null;                  // number | null
let _lastGrandTotal = 0;                 // cached so the budget input can
                                          // patch only its own result box —
                                          // a full renderActiveSupView() on
                                          // every keystroke would rebuild the
                                          // input and steal focus.
let _adhocSeq = 1;

// D.9.5 — market return / restock completion state
let _restockMode = false;
const _restockSkipped = new Set();
const _DRAFT_KEY = 'pkShopListDraft';

// ── localStorage draft helpers ────────────────────────────────
function _saveShopDraft() {
  try {
    localStorage.setItem(_DRAFT_KEY, JSON.stringify({
      picks:   [..._shopSel.entries()],
      adhoc:   _adhocItems.slice(),
      savedAt: Date.now(),
    }));
  } catch (_) {}
}
function _loadShopDraft() {
  try {
    const raw = localStorage.getItem(_DRAFT_KEY);
    if (!raw) return;
    const { picks = [], adhoc = [] } = JSON.parse(raw);
    picks.forEach(([id, qty]) => _shopSel.set(id, qty));
    adhoc.forEach(a => _adhocItems.push(a));
  } catch (_) {}
}
function _clearShopDraft() {
  try { localStorage.removeItem(_DRAFT_KEY); } catch (_) {}
}

// ── permission helpers (mirror supplier-modal.js) ─────────────
function _role()         { return getCurrentActor().role; }
function _canAdd()       { const r = _role(); return r === 'owner' || r === 'admin' || r === 'manager'; }
function _canEdit()      { const r = _role(); return r === 'owner' || r === 'admin'; }

// ── formatting + unit helpers ─────────────────────────────────
function _priceTs(p) { return p.lastRestockAt || p.observedAt || p.createdAt || 0; }

// _money, _daysAgo, _unitShort, _piecesPerUnit → imported from utils.js / inventory-math.js
// Local aliases so existing template strings don't need changing:
const _money     = fmtSpan;
const _daysAgo   = (ts) => daysAgo(ts, 'never');
const _unitShort = unitShort;

// _piecesPerUnit is imported directly from inventory-math.js.
// Alias for call-sites that still use the private name:
const _piecesPerUnit = piecesPerUnit;

// ── data shaping ──────────────────────────────────────────────

// Latest active-supplier price per supplier for an item, normalised to a
// per-piece cost so prices logged in different units compare fairly.
function _suppliersForItem(item) {
  const prices = getSupplierPricesForItem(item.id);   // already newest-first
  const seen = new Set();
  const rows = [];
  for (const p of prices) {
    if (seen.has(p.supplierId)) continue;             // keep newest per supplier
    seen.add(p.supplierId);
    const sup = getSupplier(p.supplierId);
    if (!sup || sup.active === false) continue;       // can't buy there → skip
    const perUnit = p.perUnit || 'carton';
    const price   = Number(p.price) || 0;
    rows.push({
      supplierId: p.supplierId, name: sup.name, location: sup.location, contact: sup.contact,
      price, perUnit, norm: price / _piecesPerUnit(item, perUnit), at: _priceTs(p),
    });
  }
  rows.sort((a, b) => a.norm - b.norm);
  return rows;
}

// Items that have at least one usable supplier price, low-stock first.
function _bestPriceItems() {
  const out = [];
  for (const item of (window._pkItems || [])) {
    const rows = _suppliersForItem(item);
    if (!rows.length) continue;
    const best = rows[0];
    const next = rows[1] || null;
    // saving expressed in best.perUnit (so it reads in the unit you buy in)
    const savings = next ? (next.norm - best.norm) * _piecesPerUnit(item, best.perUnit) : 0;
    out.push({ item, rows, best, next, savings, low: !!item.low });
  }
  out.sort((a, b) => (b.low - a.low) || (a.item.name || '').localeCompare(b.item.name || ''));
  return out;
}

// D.9.4 — items with zero supplier prices logged. Deliberately not
// filtered by trackStock: an untracked item is still something the founder
// might want to shop for, so it must be pickable here too.
function _itemsNeedingPricing() {
  return (window._pkItems || []).filter(item => !_suppliersForItem(item).length);
}

// Default buy price for an item in its native buy unit, used as the price
// popover placeholder so the founder doesn't start from a blank field.
function _itemDefaultBuyPrice(item) {
  const unit = item.buyUnit || 'carton';
  if (unit === 'carton') {
    const stored = Number(item.cartonBuy) || 0;
    if (stored) return stored;
    const perPc = Number(item.buy) || 0;
    const ppc   = _ppc(item);
    return (perPc && ppc > 1) ? Math.round(perPc * ppc) : perPc;
  }
  if (unit === 'row') {
    const stored = Number(item.rowBuy) || 0;
    if (stored) return stored;
    const perPc = Number(item.buy) || 0;
    const ppr   = _ppr(item);
    return (perPc && ppr > 1) ? Math.round(perPc * ppr) : perPc;
  }
  return Number(item.buy) || 0;
}

// Per-supplier price-doc stats for the directory cards.
function _supplierStats(supplierId) {
  const prices = (window._pkSupplierPrices || []).filter(p => p.supplierId === supplierId);
  const items = new Set(prices.map(p => p.itemId));
  let last = 0;
  for (const p of prices) last = Math.max(last, _priceTs(p));
  return { itemCount: items.size, last };
}

export function getSupView() { return _view; }

// ── public: view switching + render ───────────────────────────
export function switchSupView(which) {
  // Bundle 3: cost-blind roles only ever see Directory — Best Prices and
  // Shopping List are buy-side cost views. Buttons are CSS-hidden; this also
  // blocks any programmatic switch.
  if (isCostBlindRole(_role())) which = 'directory';
  const next = (which === 'prices' || which === 'shopping') ? which : 'directory';
  if (next !== 'prices') _bestSearch = '';
  _view = next;
  renderActiveSupView();
  pushHash('inventory/suppliers/' + next);
}

export function renderActiveSupView() {
  const panel = document.getElementById('invSubSuppliers');
  if (!panel || panel.hidden) return;        // only render when visible
  if (_role() === 'cashier') return;          // gated out entirely
  // Bundle 3: cost-blind (manager) never renders Best Prices / Shopping List.
  if (isCostBlindRole(_role()) && _view !== 'directory') _view = 'directory';

  // segmented control state + counts
  const segCounts = {
    directory: getSuppliers().length,
    prices:    _bestPriceItems().length,
    shopping:  _shopSel.size + _adhocItems.length,
  };
  document.querySelectorAll('.pk-sup-seg-btn').forEach(btn => {
    const v = btn.dataset.supview;
    btn.classList.toggle('active', v === _view);
    btn.setAttribute('aria-selected', String(v === _view));
    const c = btn.querySelector('.pk-sup-seg-count');
    if (c) c.textContent = segCounts[v] != null ? segCounts[v] : '';
  });

  const body = document.getElementById('supViewBody');
  if (!body) return;
  if (_view === 'directory')      body.innerHTML = _renderDirectory();
  else if (_view === 'prices')    body.innerHTML = _renderBestPrices();
  else                            body.innerHTML = _renderShopping();

  // D.3.5: let inventory.js sync the context-header meta + inner-help
  // one-liner to the active inner view. Guarded; no-op if not wired.
  try { window._pkOnSupViewRender && window._pkOnSupViewRender(_view); } catch (_) {}
}

// ── Directory view ────────────────────────────────────────────
function _renderDirectory() {
  const suppliers = getSuppliers()
    .slice()
    .sort((a, b) => (b.active !== false) - (a.active !== false)
                 || (a.name || '').localeCompare(b.name || ''));

  const addBtn = _canAdd()
    ? `<button class="pk-sup-btn pk-sup-btn--primary" onclick="PK.openSupplierModal()"><span aria-hidden="true">＋</span> New supplier</button>`
    : '';

  if (!suppliers.length) {
    return `
      <div class="pk-sup-vhead">
        <div class="pk-sup-vtitle">Suppliers</div>
        <div class="pk-sup-vactions">${addBtn}</div>
      </div>
      <div class="pk-sup-empty">
        <div class="pk-sup-empty-icon" aria-hidden="true">★</div>
        <div class="pk-sup-empty-title">No suppliers yet</div>
        <div class="pk-sup-empty-sub">Add one with <b>New supplier</b>, or capture a supplier while you <b>Restock</b> an item.</div>
      </div>`;
  }

  const cards = suppliers.map(s => _renderSupplierCard(s)).join('');
  return `
    <div class="pk-sup-vhead">
      <div class="pk-sup-vtitle">Suppliers <span class="pk-sup-vcount">· ${suppliers.length}</span></div>
      <div class="pk-sup-vactions">${addBtn}</div>
    </div>
    <div class="pk-sup-dir-grid">${cards}</div>`;
}

function _renderSupplierCard(s) {
  const inactive = s.active === false;
  const stats = _supplierStats(s.id);
  const metaBits = [s.location, s.contact].filter(Boolean).map(escapeHtml).join(' · ');
  const meta = metaBits ? `<div class="pk-sup-card-meta">${metaBits}</div>` : '';
  const note = s.notes ? `<div class="pk-sup-card-note">${escapeHtml(s.notes)}</div>` : '';
  const actions = _canEdit() ? `
    <div class="pk-sup-card-actions">
      <button class="pk-sup-iconbtn" title="Edit supplier" aria-label="Edit supplier" onclick="PK.editSupplier('${escapeHtml(s.id)}')">✎</button>
      <button class="pk-sup-iconbtn pk-sup-iconbtn--off" title="${inactive ? 'Reactivate' : 'Deactivate'}" aria-label="${inactive ? 'Reactivate' : 'Deactivate'} supplier" onclick="PK.deactivateSupplier('${escapeHtml(s.id)}')">${inactive ? '↻' : '⊘'}</button>
    </div>` : '';
  const inactivePill = inactive ? `<span class="pk-sup-card-inactive-pill">inactive</span>` : '';
  const priced = stats.itemCount === 1 ? '1 item priced' : `${stats.itemCount} items priced`;

  return `
    <div class="pk-sup-card${inactive ? ' is-inactive' : ''}">
      <div class="pk-sup-card-top">
        <div class="pk-sup-card-name"><span class="pk-sup-star" aria-hidden="true">★</span>${escapeHtml(s.name || '(unnamed)')}${inactivePill}</div>
        ${actions}
      </div>
      ${meta}
      ${note}
      <div class="pk-sup-card-foot">${priced} · last ${_daysAgo(stats.last)}</div>
    </div>`;
}

// ── Best Prices view ──────────────────────────────────────────
function _filteredBestPriceItems() {
  const rows = _bestPriceItems();
  if (!_bestSearch) return rows;
  const q = _bestSearch;
  return rows.filter(r =>
    (r.item.name || '').toLowerCase().includes(q) ||
    (r.best.name || '').toLowerCase().includes(q) ||
    (r.item.cat  || '').toLowerCase().includes(q)
  );
}

function _renderBestPrices() {
  const allRows = _bestPriceItems();
  const rows    = _filteredBestPriceItems();
  const needs   = _itemsNeedingPricing();
  const pickedCount = _shopSel.size + _adhocItems.length;
  const buildBtn = `<button class="pk-sup-btn pk-sup-btn--primary" ${pickedCount ? '' : 'disabled'} onclick="PK.supBuildShoppingList()"><span aria-hidden="true">🛒</span> Build shopping list${pickedCount ? ` (${pickedCount})` : ''}</button>`;
  const clearBtn = pickedCount ? `<button class="pk-sup-btn pk-sup-btn--ghost" onclick="PK.supClearShoppingList()" title="Clear all picks">✕ Clear</button>` : '';
  const lowCount = allRows.filter(r => r.low).length;
  const lowBtn = lowCount
    ? `<button class="pk-sup-btn pk-sup-btn--warn" onclick="PK.supSelectLowStock()"><span aria-hidden="true">⚠</span> Pick low-stock (${lowCount})</button>`
    : '';
  const adhocBtn = `<button class="pk-sup-btn" onclick="PK.supToggleAdhocForm()"><span aria-hidden="true">⊕</span> Add custom item</button>`;

  if (!allRows.length && !needs.length) {
    return `
      <div class="pk-sup-vhead">
        <div class="pk-sup-vtitle">Best prices</div>
        <div class="pk-sup-vactions">${adhocBtn}</div>
      </div>
      ${_renderAdhocForm()}
      <div class="pk-sup-empty">
        <div class="pk-sup-empty-icon" aria-hidden="true">＄</div>
        <div class="pk-sup-empty-title">No supplier prices logged yet</div>
        <div class="pk-sup-empty-sub">Use the <b>Restock</b> button on an item to record where you buy it and at what price. Prices show up here to compare.</div>
      </div>
      ${_renderAdhocSection()}
      ${_supDatalist()}`;
  }

  const countText = _bestSearch
    ? `· ${rows.length} of ${allRows.length}`
    : `· ${allRows.length} item${allRows.length !== 1 ? 's' : ''}`;

  const noMatch = _bestSearch && !rows.length
    ? `<div class="pk-sup-search-empty">No items match "<b>${escapeHtml(_bestSearch)}</b>"</div>`
    : '';

  const listHtml = rows.map(r => _renderBestPriceRow(r)).join('');

  return `
    <div class="pk-sup-vhead">
      <div class="pk-sup-vtitle">Best prices <span class="pk-sup-vcount" id="supBpCount">${countText}</span></div>
      <div class="pk-sup-vactions">${adhocBtn}${lowBtn}${clearBtn}${buildBtn}</div>
    </div>
    <div class="pk-sup-search-wrap">
      <svg class="pk-sup-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" class="pk-sup-search-input${_bpParsed ? ' power' : ''}" id="supBpSearch"
        placeholder="Name or 'green arrow 5'…" autocomplete="off" spellcheck="false"
        value="${escapeHtml(_bestSearch)}"
        oninput="PK.supBestSearch(this.value);window._toggleSearchClear('supBpSearch','supBpSearchClear')"
        onkeydown="PK.supBpKeydown(event)">
      <button type="button" class="pk-sup-search-clear" id="supBpSearchClear"
        onclick="window._clearSearchBox('supBpSearch',()=>PK.supBestSearch(''),'supBpSearchClear')"
        aria-label="Clear search" ${_bestSearch ? '' : 'hidden'}>✕</button>
    </div>
    <div id="supBpHint"></div>
    ${_renderAdhocForm()}
    <div class="pk-sup-bp-list" id="supBpList">${noMatch}${listHtml}</div>
    <div id="supNeedsList">${_renderNeedsPricing(_bestSearch)}</div>
    ${_renderAdhocSection()}
    ${_supDatalist()}`;
}

function _renderBestPriceRow(r) {
  const { item, best, next, savings } = r;
  const id = item.id;
  const picked = _shopSel.has(id);
  const qty = picked ? _shopSel.get(id) : 1;
  const us = _unitShort(best.perUnit);
  const popoverOpen = _openPopoverFor === id;

  const catPill = item.cat ? `<span class="pk-sup-cat-pill">${escapeHtml(item.cat)}</span>` : '';
  const lowPill = r.low ? `<span class="pk-sup-low-pill">⚠ low</span>` : '';
  const alt = next
    ? `<div class="pk-sup-bp-alt">also ${escapeHtml(next.name)} ${_money(next.price)}/${_unitShort(next.perUnit)}${savings > 0 ? ` · <span class="pk-sup-save">save ${_money(savings)}/${us}</span>` : ''}</div>`
    : '';

  return `
    <div class="pk-sup-bp-row${picked ? ' is-picked' : ''}${popoverOpen ? ' popover-open' : ''}" data-item-id="${escapeHtml(id)}">
      <input type="checkbox" class="pk-sup-bp-check" ${picked ? 'checked' : ''}
        aria-label="Add ${escapeHtml(item.name || '')} to shopping list"
        onchange="PK.supToggleShopItem('${escapeHtml(id)}', this.checked)">
      <div class="pk-sup-bp-main">
        <div class="pk-sup-bp-name">${escapeHtml(item.name || '')}${catPill}${lowPill}</div>
        <div class="pk-sup-bp-best">Best: <b>${escapeHtml(best.name)}</b> · <span class="pk-sup-best-price">${_money(best.price)}/${us}</span></div>
        ${alt}
      </div>
      ${popoverOpen ? _renderQuickAddPopover(item) : ''}
      <button class="pk-sup-addsup-btn" title="Add another supplier price" aria-label="Add another supplier price for ${escapeHtml(item.name || '')}" onclick="PK.supToggleAddSupplier('${escapeHtml(id)}')">⊕</button>
      <div class="pk-sup-bp-qty">
        <span class="pk-sup-qty-lab">qty</span>
        <input type="number" min="0" step="1" class="pk-sup-qty-inp" value="${qty}"
          aria-label="Quantity for ${escapeHtml(item.name || '')}"
          onchange="PK.supSetShopQty('${escapeHtml(id)}', this.value)">
        <span class="pk-sup-qty-unit">${us}</span>
      </div>
    </div>`;
}

// D.9.4 — items with no supplier price yet. Surfaced so they're not
// invisible to the founder just because nobody's logged a price; one tap
// opens the same quick-add popover used on priced rows.
function _renderNeedsPricing(query) {
  const q = (query || '').toLowerCase().trim();
  let needs = _itemsNeedingPricing();
  if (q) needs = needs.filter(item => (item.name || '').toLowerCase().includes(q) || (item.cat || '').toLowerCase().includes(q));
  if (!needs.length) return '';
  const rows = needs.map(item => {
    const popoverOpen = _openPopoverFor === item.id;
    const catPill = item.cat ? `<span class="pk-sup-cat-pill">${escapeHtml(item.cat)}</span>` : '';
    const lowPill = item.low ? `<span class="pk-sup-low-pill">⚠ low</span>` : '';
    return `
      <div class="pk-sup-needs-row${popoverOpen ? ' popover-open' : ''}" data-item-id="${escapeHtml(item.id)}">
        <div class="pk-sup-needs-main">
          <div class="pk-sup-bp-name">${escapeHtml(item.name || '')}${catPill}${lowPill}</div>
          <div class="pk-sup-needs-hint">No supplier logged yet — add one to track where you restock.</div>
        </div>
        ${popoverOpen ? _renderQuickAddPopover(item) : ''}
        <button class="pk-sup-btn pk-sup-btn--primary" onclick="PK.supToggleAddSupplier('${escapeHtml(item.id)}')">⊕ Add supplier</button>
      </div>`;
  }).join('');
  return `
    <div class="pk-sup-section-eyebrow">Needs supplier <span class="cnt">· ${needs.length} item${needs.length !== 1 ? 's' : ''} with no supplier logged yet</span></div>
    <div class="pk-sup-bp-list">${rows}</div>`;
}

// D.9.4 — quick add-supplier popover, shared by priced rows and
// needs-pricing rows. Supplier is free-text (datalist-assisted); an
// unrecognised name creates a new supplier on save rather than forcing a
// trip through the Directory first.
function _renderQuickAddPopover(item) {
  const us = _unitShort(item.buyUnit || 'carton');
  const defaultPrice = _itemDefaultBuyPrice(item);
  const pricePlaceholder = defaultPrice ? String(Math.round(defaultPrice)) : 'e.g. 42000';
  return `
    <div class="pk-sup-popover">
      <div class="pk-sup-popover-row">
        <div><span class="pk-sup-popover-lab">Supplier</span>
          <input id="popSup-${escapeHtml(item.id)}" list="supDatalist" placeholder="type or pick existing">
        </div>
        <div><span class="pk-sup-popover-lab">Price per ${us} (₦)</span>
          <input id="popPrice-${escapeHtml(item.id)}" type="number" min="0" placeholder="${escapeHtml(pricePlaceholder)}">
        </div>
        <div class="pk-sup-popover-actions">
          <button class="pk-sup-btn" onclick="PK.supToggleAddSupplier('${escapeHtml(item.id)}')">Cancel</button>
          <button class="pk-sup-btn pk-sup-btn--primary" onclick="PK.supSaveSupplierPrice('${escapeHtml(item.id)}')">Save</button>
        </div>
      </div>
    </div>`;
}

function _supDatalist() {
  return `<datalist id="supDatalist">${getActiveSuppliers().map(s => `<option value="${escapeHtml(s.name)}">`).join('')}</datalist>`;
}

// D.9.4 — free-text custom item, not tied to any inventory SKU. Scratch
// state only, same lifetime as the shopping picks above.
function _renderAdhocForm() {
  if (!_showAdhocForm) return '';
  return `
    <div class="pk-sup-adhoc-form">
      <div class="field"><label>Item name</label><input id="adhocName" placeholder="e.g. Packing tape"></div>
      <div class="field"><label>Qty</label><input id="adhocQty" type="number" min="1" value="1"></div>
      <div class="field"><label>Est. price (₦)</label><input id="adhocEst" type="number" min="0" placeholder="e.g. 1500"></div>
      <div class="field"><label>Supplier (optional)</label><input id="adhocSupplier" list="supDatalist" placeholder="leave blank if unsure"></div>
      <button class="pk-sup-btn pk-sup-btn--primary" onclick="PK.supSubmitAdhocItem()">Add</button>
    </div>`;
}

function _renderAdhocSection() {
  if (!_adhocItems.length) return '';
  const rows = _adhocItems.map(a => `
    <div class="pk-sup-adhoc-row">
      <div class="pk-sup-needs-main">
        <div class="pk-sup-bp-name">${escapeHtml(a.name)}<span class="pk-sup-adhoc-tag">custom</span></div>
        <div class="pk-sup-needs-hint">${a.qty} × ${_money(a.est)}${a.supplier ? ' · ' + escapeHtml(a.supplier) : ' · no supplier set'}</div>
      </div>
      <button class="pk-sup-adhoc-rm" title="Remove" aria-label="Remove ${escapeHtml(a.name)}" onclick="PK.supRemoveAdhocItem('${a.id}')">×</button>
    </div>`).join('');
  return `
    <div class="pk-sup-section-eyebrow">Custom items <span class="cnt">· not tracked in inventory</span></div>
    <div class="pk-sup-bp-list">${rows}</div>`;
}

// ── Shopping List view ────────────────────────────────────────
function _renderShopping() {
  if (!_shopSel.size && !_adhocItems.length) {
    return `
      <div class="pk-sup-vhead">
        <div class="pk-sup-vtitle">Shopping list</div>
      </div>
      <div class="pk-sup-empty">
        <div class="pk-sup-empty-icon" aria-hidden="true">🛒</div>
        <div class="pk-sup-empty-title">Shopping list is empty</div>
        <div class="pk-sup-empty-sub">Go to <b>Best Prices</b>, tick the items you need or add a custom item, then tap <b>Build shopping list</b>.</div>
      </div>`;
  }

  if (_restockMode) return _renderRestockCompletion();

  // group selected items by their current best supplier; custom items
  // group by their typed supplier name, or "Unassigned" if left blank
  const groups = new Map();   // supplierId|"adhoc:name" → { name, lines:[], subtotal }
  let grand = 0, missing = 0, totalMargin = 0, marginableTotal = 0;

  for (const [itemId, qty] of _shopSel.entries()) {
    const item = (window._pkItems || []).find(i => i.id === itemId);
    if (!item) { missing++; continue; }
    const rows = _suppliersForItem(item);
    if (!rows.length) { missing++; continue; }   // supplier deactivated since pick
    const best = rows[0];
    const q = Number(qty) || 0;
    const lineTotal = q * best.price;
    grand += lineTotal;

    // D.9.4 — resale margin in the same unit as the buy price, since
    // mixing units (e.g. carton buy vs piece sell) would be meaningless.
    const sellPerUnit = best.perUnit === 'carton' ? item.cartonSell
                       : best.perUnit === 'row'    ? item.rowSell
                       : item.sell;
    let marginText = '—', marginCls = 'muted';
    if (sellPerUnit) {
      totalMargin += (sellPerUnit - best.price) * q;
      marginableTotal += lineTotal;
      marginCls = (sellPerUnit - best.price) >= 0 ? 'pos' : 'neg';
      marginText = `${_money(sellPerUnit - best.price)}/${_unitShort(best.perUnit)} · ${(((sellPerUnit - best.price) / sellPerUnit) * 100).toFixed(1)}%`;
    }

    if (!groups.has(best.supplierId)) groups.set(best.supplierId, { name: best.name, lines: [], subtotal: 0 });
    const g = groups.get(best.supplierId);
    g.lines.push({ name: item.name, calc: `${q} ${_unitShort(best.perUnit)} × ${_money(best.price)}`, total: lineTotal, marginText, marginCls });
    g.subtotal += lineTotal;
  }

  const unassigned = [];
  for (const a of _adhocItems) {
    const q = Number(a.qty) || 0;
    const lineTotal = q * (Number(a.est) || 0);
    grand += lineTotal;
    const line = { name: a.name, calc: `${q} × ${_money(a.est)}`, total: lineTotal, marginText: '—', marginCls: 'muted', tag: true };
    if (a.supplier) {
      const key = 'adhoc:' + a.supplier.toLowerCase();
      if (!groups.has(key)) groups.set(key, { name: a.supplier, lines: [], subtotal: 0 });
      const g = groups.get(key);
      g.lines.push(line); g.subtotal += lineTotal;
    } else {
      unassigned.push(line);
    }
  }

  _lastGrandTotal = grand;

  const unassignedCard = unassigned.length ? `
    <div class="pk-sup-store is-unassigned">
      <div class="pk-sup-store-head"><span class="pk-sup-store-name">Unassigned / pick up anywhere</span></div>
      <div class="pk-sup-store-lines">${unassigned.map(l => _renderShopLine(l)).join('')}</div>
      <div class="pk-sup-store-sub"><span>Subtotal</span><b>${_money(unassigned.reduce((s, l) => s + l.total, 0))}</b></div>
    </div>` : '';

  const cards = [...groups.values()].map(g => `
    <div class="pk-sup-store">
      <div class="pk-sup-store-head"><span class="pk-sup-store-name"><span class="pk-sup-star" aria-hidden="true">★</span>${escapeHtml(g.name || '(unknown supplier)')}</span></div>
      <div class="pk-sup-store-lines">${g.lines.map(l => _renderShopLine(l)).join('')}</div>
      <div class="pk-sup-store-sub"><span>Subtotal</span><b>${_money(g.subtotal)}</b></div>
    </div>`).join('');

  const missingNote = missing
    ? `<div class="pk-sup-empty-sub" style="text-align:left;margin-top:4px;">${missing} item${missing !== 1 ? 's' : ''} skipped — supplier no longer available.</div>`
    : '';
  const marginPct = marginableTotal ? (totalMargin / marginableTotal * 100) : 0;
  const groupCount = groups.size + (unassigned.length ? 1 : 0);

  return `
    <div class="pk-sup-vhead">
      <div class="pk-sup-vtitle">Shopping list <span class="pk-sup-vcount">· ${groupCount} supplier${groupCount !== 1 ? 's' : ''}</span></div>
      <div class="pk-sup-vactions">
        <button class="pk-sup-btn" onclick="PK.switchSupView('prices')">‹ Edit picks</button>
        <button class="pk-sup-btn pk-sup-btn--primary" onclick="PK.supCompleteRestock()">✓ Back from market</button>
        <button class="pk-sup-btn pk-sup-btn--warn" onclick="PK.supClearShoppingList()">Clear</button>
      </div>
    </div>
    <div class="pk-sup-budget-box">
      <div class="field"><label>Cash available today (₦)</label><input type="number" min="0" placeholder="e.g. 100000" value="${_shopBudget == null ? '' : _shopBudget}" oninput="PK.supSetBudget(this.value)"></div>
      ${_renderBudgetResult()}
    </div>
    <div class="pk-sup-shop-list">${unassignedCard}${cards}</div>
    <div class="pk-sup-shop-total"><span>Estimated total</span><b>${_money(grand)}</b></div>
    <div class="pk-sup-margin-summary"><span>Expected resale margin on tracked items</span><b>${_money(totalMargin)} (${marginPct.toFixed(1)}%)</b></div>
    ${missingNote}`;
}

// D.9.5 — "Back from market" restock completion form
function _renderRestockCompletion() {
  const allItems = window._pkItems || [];
  const rows = [..._shopSel.entries()].map(([itemId, plannedQty]) => {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return '';
    const bestRows = _suppliersForItem(item);
    const best     = bestRows[0];
    const unit     = item.buyUnit || 'carton';
    const us       = _unitShort(unit);
    const isSkip   = _restockSkipped.has(itemId);
    const buyDef   = best ? best.price : (_itemDefaultBuyPrice(item) || '');
    const dis      = isSkip ? ' disabled' : '';
    const rowSell  = Number(item.rowSell)    || 0;
    const ctnSell  = Number(item.cartonSell) || 0;
    const rowSellField = rowSell > 0 ? `
          <div class="pk-sup-rcp-field">
            <span class="pk-sup-rcp-lab">Sell / row (₦)</span>
            <input id="rstCp-${escapeHtml(itemId)}-sell-row" type="number" min="0"
              class="pk-sup-rcp-inp" placeholder="${rowSell}"${dis}>
          </div>` : '';
    const ctnSellField = ctnSell > 0 ? `
          <div class="pk-sup-rcp-field">
            <span class="pk-sup-rcp-lab">Sell / ctn (₦)</span>
            <input id="rstCp-${escapeHtml(itemId)}-sell-ctn" type="number" min="0"
              class="pk-sup-rcp-inp" placeholder="${ctnSell}"${dis}>
          </div>` : '';
    return `
      <div class="pk-sup-rcp-row${isSkip ? ' is-skipped' : ''}" id="rstCp-${escapeHtml(itemId)}-row">
        <label class="pk-sup-rcp-skip-wrap" title="Skip this item">
          <input type="checkbox" class="pk-sup-rcp-skip" ${isSkip ? 'checked' : ''}
            onchange="PK.supToggleRestockSkip('${escapeHtml(itemId)}')">
          <span class="pk-sup-rcp-skip-lab">Skip</span>
        </label>
        <div class="pk-sup-rcp-info">
          <div class="pk-sup-rcp-name">${escapeHtml(item.name || '')}</div>
          <div class="pk-sup-rcp-sub">${best ? escapeHtml(best.name) : 'No supplier'} · planned ${plannedQty} ${us}</div>
        </div>
        <div class="pk-sup-rcp-fields">
          <div class="pk-sup-rcp-field">
            <span class="pk-sup-rcp-lab">Received (${us})</span>
            <input id="rstCp-${escapeHtml(itemId)}-qty" type="number" min="0" step="1"
              class="pk-sup-rcp-inp" value="${plannedQty}"${dis}>
          </div>
          <div class="pk-sup-rcp-field">
            <span class="pk-sup-rcp-lab">Buy / ${us} (₦)</span>
            <input id="rstCp-${escapeHtml(itemId)}-buy" type="number" min="0"
              class="pk-sup-rcp-inp" placeholder="${buyDef}"${dis}>
          </div>
          <div class="pk-sup-rcp-field">
            <span class="pk-sup-rcp-lab">Sell / pc (₦)</span>
            <input id="rstCp-${escapeHtml(itemId)}-sell" type="number" min="0"
              class="pk-sup-rcp-inp" placeholder="${item.sell || ''}"${dis}>
          </div>
          ${rowSellField}${ctnSellField}
        </div>
      </div>`;
  }).join('');

  const adhocSection = _adhocItems.length ? `
    <div class="pk-sup-section-eyebrow">Custom items <span class="cnt">· no stock record — for reference only</span></div>
    <div class="pk-sup-rcp-adhoc">
      ${_adhocItems.map(a => `<div class="pk-sup-rcp-adhoc-row">${escapeHtml(a.name)} · ${a.qty} × ${_money(a.est)}${a.supplier ? ' · ' + escapeHtml(a.supplier) : ''}</div>`).join('')}
    </div>` : '';

  const saveN = [..._shopSel.keys()].filter(id => !_restockSkipped.has(id)).length;

  return `
    <div class="pk-sup-vhead">
      <div class="pk-sup-vtitle">Complete restock <span class="pk-sup-vcount">· ${_shopSel.size} item${_shopSel.size !== 1 ? 's' : ''}</span></div>
      <div class="pk-sup-vactions">
        <button class="pk-sup-btn" onclick="PK.supCancelRestock()">‹ Back to list</button>
      </div>
    </div>
    <div class="pk-sup-rcp-hint">Leave a price blank to keep the current value. Prices update globally — no need to edit items individually.</div>
    <div class="pk-sup-rcp-list">${rows}</div>
    ${adhocSection}
    <div class="pk-sup-rcp-footer">
      <button class="pk-sup-btn pk-sup-btn--primary pk-sup-rcp-save" onclick="PK.supSaveRestocks()">
        ✓ Save restocks${saveN ? ` (${saveN})` : ''}
      </button>
    </div>`;
}

function _renderShopLine(l) {
  return `
    <div class="pk-sup-store-line">
      <span class="pk-sup-li-name">${escapeHtml(l.name || '')}${l.tag ? ' <span class="pk-sup-adhoc-tag">custom</span>' : ''}</span>
      <span class="pk-sup-li-calc">${l.calc}</span>
      <span class="pk-sup-li-margin ${l.marginCls}">${l.marginText}</span>
      <span class="pk-sup-li-total">${_money(l.total)}</span>
    </div>`;
}

// D.9.4 — patches only the result box, not the whole view. A full
// renderActiveSupView() on every keystroke would recreate the input and
// steal focus after each digit typed.
function _renderBudgetResult() {
  if (_shopBudget == null) {
    return `<div class="pk-sup-budget-result empty" id="supBudgetResult">Enter what cash you have to see if this list fits before you go.</div>`;
  }
  const remaining = _shopBudget - _lastGrandTotal;
  return remaining >= 0
    ? `<div class="pk-sup-budget-result ok" id="supBudgetResult">✓ Within budget — <b>${_money(remaining)}</b> left after this trip.</div>`
    : `<div class="pk-sup-budget-result over" id="supBudgetResult">⚠ Over budget by <b>${_money(-remaining)}</b> — drop or trim some lines.</div>`;
}

// ── public: directory actions ─────────────────────────────────
export function editSupplier(id) {
  if (!_canEdit()) { toast('⛔ Only the owner or an admin can edit suppliers', 'err'); return; }
  const s = getSupplier(id);
  if (!s) { toast('⚠️ Supplier not found', 'err'); return; }
  openSupplierModal({ supplier: s, onCreated: () => renderActiveSupView() });
}

export async function deactivateSupplier(id) {
  if (!_canEdit()) { toast('⛔ Only the owner or an admin can change suppliers', 'err'); return; }
  const s = getSupplier(id);
  if (!s) { toast('⚠️ Supplier not found', 'err'); return; }
  const goingOff = s.active !== false;
  const verb = goingOff ? 'Deactivate' : 'Reactivate';
  if (!window.confirm(`${verb} "${s.name}"?${goingOff ? ' It will be hidden from supplier pickers.' : ''}`)) return;
  try {
    await updateSupplier(id, { active: !goingOff });
    toast(goingOff ? `✅ "${escapeHtml(s.name)}" deactivated` : `✅ "${escapeHtml(s.name)}" reactivated`, 'ok');
    renderActiveSupView();
  } catch (e) {
    console.error('[suppliers-view] deactivate failed:', e);
    toast('⚠️ Could not update supplier. Try again.', 'err');
  }
}

// ── public: shopping-list selection ───────────────────────────
export function supToggleShopItem(itemId, checked) {
  if (checked) { if (!_shopSel.has(itemId)) _shopSel.set(itemId, 1); }
  else _shopSel.delete(itemId);
  _saveShopDraft();
  if (_view === 'prices') renderActiveSupView();
}

export function supSetShopQty(itemId, val) {
  const q = Math.max(0, parseFloat(val) || 0);
  if (q <= 0) { _shopSel.delete(itemId); _saveShopDraft(); if (_view === 'prices') renderActiveSupView(); return; }
  _shopSel.set(itemId, q);
  _saveShopDraft();
}

export function supSelectLowStock() {
  for (const r of _bestPriceItems()) {
    if (r.low && !_shopSel.has(r.item.id)) _shopSel.set(r.item.id, 1);
  }
  renderActiveSupView();
}

export function supBuildShoppingList() {
  if (!_shopSel.size && !_adhocItems.length) { toast('⚠️ Select at least one item or add a custom line first', 'err'); return; }
  switchSupView('shopping');
}

export function supClearShoppingList() {
  _shopSel.clear();
  _adhocItems.length = 0;
  _restockMode = false;
  _restockSkipped.clear();
  _clearShopDraft();
  renderActiveSupView();
}

// ── public: D.9.4 quick add-supplier popover ──────────────────
export function supToggleAddSupplier(itemId) {
  _openPopoverFor = (_openPopoverFor === itemId) ? null : itemId;
  renderActiveSupView();
}

export async function supSaveSupplierPrice(itemId) {
  const supEl   = document.getElementById('popSup-' + itemId);
  const priceEl = document.getElementById('popPrice-' + itemId);
  const name  = (supEl?.value || '').trim();
  const item = (window._pkItems || []).find(i => i.id === itemId);
  if (!item) { toast('⚠️ Item not found', 'err'); return; }
  const typed = parseFloat(priceEl?.value);
  const price = typed > 0 ? typed : _itemDefaultBuyPrice(item);
  if (!name) { toast('⚠️ Enter a supplier name', 'err'); return; }
  if (!price || price <= 0) { toast('⚠️ Enter a valid price', 'err'); return; }
  try {
    let supplier = getActiveSuppliers().find(s => (s.name || '').toLowerCase() === name.toLowerCase());
    if (!supplier) supplier = await createSupplier({ name });
    await createSupplierPrice({ itemId, supplierId: supplier.id, price, perUnit: item.buyUnit || 'carton' });
    _openPopoverFor = null;
    toast(`✅ ${escapeHtml(supplier.name)} price saved for "${escapeHtml(item.name || '')}"`, 'ok');
    renderActiveSupView();
  } catch (e) {
    console.error('[suppliers-view] quick add-supplier failed:', e);
    toast('⚠️ Could not save price. Try again.', 'err');
  }
}

// ── public: D.9.4 custom (ad-hoc) shopping items ──────────────
export function supToggleAdhocForm() {
  _showAdhocForm = !_showAdhocForm;
  renderActiveSupView();
}

export function supSubmitAdhocItem() {
  const name     = (document.getElementById('adhocName')?.value || '').trim();
  const qty      = parseFloat(document.getElementById('adhocQty')?.value) || 1;
  const est      = parseFloat(document.getElementById('adhocEst')?.value) || 0;
  const supplier = (document.getElementById('adhocSupplier')?.value || '').trim();
  if (!name) { toast('⚠️ Enter an item name', 'err'); return; }
  if (!est || est <= 0) { toast('⚠️ Enter an estimated price', 'err'); return; }
  _adhocItems.push({ id: 'adhoc-' + (_adhocSeq++), name, qty, est, supplier });
  _showAdhocForm = false;
  _saveShopDraft();
  renderActiveSupView();
}

export function supRemoveAdhocItem(id) {
  const idx = _adhocItems.findIndex(a => a.id === id);
  if (idx >= 0) _adhocItems.splice(idx, 1);
  _saveShopDraft();
  renderActiveSupView();
}

// ── public: D.9.4 budget check ─────────────────────────────────
export function supSetBudget(val) {
  _shopBudget = parseFloat(val);
  if (isNaN(_shopBudget)) _shopBudget = null;
  const el = document.getElementById('supBudgetResult');
  if (el) el.outerHTML = _renderBudgetResult();
}

// ── public: Best Prices search ────────────────────────────────
function _bpParseSearch(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const tokens = s.split(/\s+/);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1];
  if (!/^\d*\.?\d+$/.test(last)) return null;
  const qty = Math.max(1, parseFloat(last));
  const query = tokens.slice(0, tokens.length - 1).join(' ').trim();
  if (!query) return null;
  return { query, qty };
}

export function supBestSearch(val) {
  _bpParsed = _bpParseSearch(val);
  _bestSearch = (_bpParsed ? _bpParsed.query : (val || '')).toLowerCase().trim();
  _bpFocusIdx = -1;
  // Partial re-render to keep focus in the search input.
  const filtered = _filteredBestPriceItems();
  const allRows  = _bestPriceItems();
  const list     = document.getElementById('supBpList');
  const count    = document.getElementById('supBpCount');
  const needsEl  = document.getElementById('supNeedsList');
  const hintEl   = document.getElementById('supBpHint');
  const inp      = document.getElementById('supBpSearch');
  if (inp) inp.classList.toggle('power', !!_bpParsed);
  if (list) {
    const noMatch = _bestSearch && !filtered.length
      ? `<div class="pk-sup-search-empty">No items match "<b>${escapeHtml(_bpParsed ? _bpParsed.query : val)}</b>"</div>`
      : '';
    list.innerHTML = noMatch + filtered.map(r => _renderBestPriceRow(r)).join('');
  }
  if (needsEl) needsEl.innerHTML = _renderNeedsPricing(_bestSearch);
  if (hintEl) {
    if (_bpParsed && filtered.length) {
      const target = _bpResultIds[_bpFocusIdx] ?? filtered[0]?.item?.id;
      const targetItem = (window._pkItems || []).find(i => i.id === target) || filtered[0]?.item;
      const us = _unitShort(targetItem?.buyUnit || 'carton');
      hintEl.innerHTML = `<div class="pk-sup-bp-hint">↵ Add <b>${_bpParsed.qty} ${us}</b> of <b>${escapeHtml(targetItem?.name || '')}</b> to shopping list</div>`;
    } else {
      hintEl.innerHTML = '';
    }
  }
  if (count) {
    count.textContent = _bestSearch
      ? `· ${filtered.length} of ${allRows.length}`
      : `· ${allRows.length} item${allRows.length !== 1 ? 's' : ''}`;
  }
  // Rebuild flat result id list for keyboard nav (priced rows first, then needs rows).
  _bpResultIds = [
    ...filtered.map(r => r.item.id),
    ...(needsEl ? Array.from(needsEl.querySelectorAll('[data-item-id]')).map(el => el.dataset.itemId) : []),
  ];
}

function _bpMoveFocus(d) {
  const n = _bpResultIds.length;
  if (!n) return;
  _bpFocusIdx = _bpFocusIdx === -1
    ? (d > 0 ? 0 : n - 1)
    : Math.max(0, Math.min(n - 1, _bpFocusIdx + d));
  document.querySelectorAll('#supBpList [data-item-id], #supNeedsList [data-item-id]')
    .forEach((el, i) => el.classList.toggle('bp-focused', i === _bpFocusIdx));
  const allEls = document.querySelectorAll('#supBpList [data-item-id], #supNeedsList [data-item-id]');
  allEls[_bpFocusIdx]?.scrollIntoView({ block: 'nearest' });
  // Update hint to show which item will be targeted
  const hintEl = document.getElementById('supBpHint');
  if (hintEl && _bpParsed) {
    const itemId = _bpResultIds[_bpFocusIdx];
    const item = (window._pkItems || []).find(i => i.id === itemId);
    if (item) {
      const us = _unitShort(item.buyUnit || 'carton');
      hintEl.innerHTML = `<div class="pk-sup-bp-hint">↵ Add <b>${_bpParsed.qty} ${us}</b> of <b>${escapeHtml(item.name || '')}</b> to shopping list</div>`;
    }
  }
}

export function supBpKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); _bpMoveFocus(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _bpMoveFocus(-1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const itemId = _bpResultIds[_bpFocusIdx] ?? _bpResultIds[0];
    if (!itemId) return;
    const qty = _bpParsed ? _bpParsed.qty : (_shopSel.get(itemId) || 1);
    if (_shopSel.has(itemId) && !_bpParsed) {
      // No qty parsed + already picked → untick
      supToggleShopItem(itemId, false);
    } else {
      _shopSel.set(itemId, qty);
      _saveShopDraft();
      if (_view === 'prices') renderActiveSupView();
    }
    // Clear search so user can hunt next item immediately.
    _bpParsed = null;
    const inp = document.getElementById('supBpSearch');
    if (inp) { inp.value = ''; supBestSearch(''); inp.focus(); }
  }
}

// ── public: D.9.5 market return / restock completion ──────────
export function supCompleteRestock() {
  _restockMode = true;
  _restockSkipped.clear();
  renderActiveSupView();
}

export function supCancelRestock() {
  _restockMode = false;
  _restockSkipped.clear();
  renderActiveSupView();
}

export function supToggleRestockSkip(itemId) {
  if (_restockSkipped.has(itemId)) _restockSkipped.delete(itemId);
  else _restockSkipped.add(itemId);
  // Patch this row + save-button count — no full re-render needed
  const row = document.getElementById(`rstCp-${itemId}-row`);
  if (row) {
    const isSkip = _restockSkipped.has(itemId);
    row.classList.toggle('is-skipped', isSkip);
    row.querySelectorAll('.pk-sup-rcp-inp').forEach(inp => { inp.disabled = isSkip; });
  }
  const saveN = [..._shopSel.keys()].filter(id => !_restockSkipped.has(id)).length;
  const saveBtn = document.querySelector('.pk-sup-rcp-save');
  if (saveBtn) saveBtn.textContent = `✓ Save restocks${saveN ? ` (${saveN})` : ''}`;
}

export async function supSaveRestocks() {
  const uid = activeUid();
  if (!uid) { toast('⚠️ Not signed in — restock was not saved. Refresh and log in first', 'err'); return; }

  const allItems = window._pkItems || [];
  const itemSaves = [];
  const priceLogs = [];

  for (const [itemId] of _shopSel.entries()) {
    if (_restockSkipped.has(itemId)) continue;

    const item = allItems.find(i => i.id === itemId);
    if (!item) continue;

    const qtyReceived = Math.max(0, parseFloat(document.getElementById(`rstCp-${itemId}-qty`)?.value) || 0);
    if (qtyReceived <= 0) continue;

    const unit = item.buyUnit || 'carton';
    const ppu  = _piecesPerUnit(item, unit);

    const bestRows  = _suppliersForItem(item);
    // N8 fix: bestRows[0].price is priced in bestRows[0].perUnit, which can
    // differ from this item's buyUnit (`unit`). Use the already-normalised
    // per-piece `.norm` and convert into `unit` so a per-piece quote applied
    // to a per-carton item (or vice versa) doesn't over/understate cost.
    const bestPrice = bestRows[0] ? bestRows[0].norm * ppu : (_itemDefaultBuyPrice(item) || 0);

    const rawBuy     = parseFloat(document.getElementById(`rstCp-${itemId}-buy`)?.value)      || 0;
    const rawSell    = parseFloat(document.getElementById(`rstCp-${itemId}-sell`)?.value)     || 0;
    const rawRowSell = parseFloat(document.getElementById(`rstCp-${itemId}-sell-row`)?.value) || 0;
    const rawCtnSell = parseFloat(document.getElementById(`rstCp-${itemId}-sell-ctn`)?.value) || 0;

    const appliedBuy     = rawBuy     > 0 ? rawBuy     : bestPrice;
    const appliedSell    = rawSell    > 0 ? rawSell    : (item.sell    || 0);
    const appliedRowSell = rawRowSell > 0 ? rawRowSell : (item.rowSell    || 0);
    const appliedCtnSell = rawCtnSell > 0 ? rawCtnSell : (item.cartonSell || 0);

    // N8 fix: qtyReceived is in `unit`, but stockQty/stockQtyPcs are in the
    // item's stockUnit (which can differ from buyUnit) — go through pieces
    // first, same pattern as restock-modal.js's single-item flow. Also stop
    // discarding the existing stockQty when stockQtyPcs is missing/unset.
    const stockUnit  = item.stockUnit || item.buyUnit || 'carton';
    const addedPcs   = qtyReceived * ppu;
    const curQty     = Number(item.stockQty) || 0;
    const newStockQty    = curQty + addedPcs / _piecesPerUnit(item, stockUnit);
    // Pieces follow the real count; the stored pieces copy can be stale on older items.
    const newStockQtyPcs = newStockQty * _piecesPerUnit(item, stockUnit);

    // WAC — uses item state BEFORE stock increment as old-qty baseline
    const { wacPc, wacBuyUnit } = computeWac(item, qtyReceived, appliedBuy, unit);

    const partialUpdated = {
      ...item,
      stockQty:      newStockQty,
      stockQtyPcs:   newStockQtyPcs,
      trackStock:    true,
      buy:           wacPc,
      buyPrice:      wacBuyUnit,
      sell:          appliedSell,
      rowSell:       appliedRowSell,
      cartonSell:    appliedCtnSell,
      lastRestockAt: Date.now(),
      updatedTs:     Date.now(),
      history:       [{ buy: wacPc, sell: appliedSell, date: now() },
                      ...(Array.isArray(item.history) ? item.history : [])].slice(0, 5),
    };
    const updated = { ...partialUpdated, ...recalcThreshold(partialUpdated, newStockQtyPcs) };

    itemSaves.push(saveItem(uid, updated));

    // Log new supplier price if buy price changed from what was recorded
    if (rawBuy > 0 && bestRows[0] && Math.abs(rawBuy - bestRows[0].price) > 0.01) {
      priceLogs.push(createSupplierPrice({
        itemId:     item.id,
        supplierId: bestRows[0].supplierId,
        price:      rawBuy,
        perUnit:    unit,
        observedAt: Date.now(),
        isPurchase: true,
      }));
    }
  }

  if (!itemSaves.length) {
    toast('⚠️ No items to save — enter a quantity for at least one item', 'err');
    return;
  }

  try {
    await Promise.all([...itemSaves, ...priceLogs]);
    const n = itemSaves.length;
    toast(`✅ ${n} item${n !== 1 ? 's' : ''} restocked`, 'ok');
    _clearShopDraft();
    _shopSel.clear();
    _adhocItems.length = 0;
    _restockMode = false;
    _restockSkipped.clear();
    switchSupView('prices');
  } catch (e) {
    console.error('[suppliers-view] supSaveRestocks failed:', e);
    toast('⚠️ Could not save restocks. Try again.', 'err');
  }
}

// ── live refresh when supplier / price data changes ───────────
window.addEventListener('pkSuppliersChanged', () => {
  const panel = document.getElementById('invSubSuppliers');
  if (panel && !panel.hidden) renderActiveSupView();
});

// Restore any in-progress shopping list from the previous session
_loadShopDraft();

// Expose for DevTools / non-module callers.
window.suppliersView = {
  switchSupView, renderActiveSupView, editSupplier, deactivateSupplier,
  supToggleShopItem, supSetShopQty, supSelectLowStock, supBuildShoppingList, supClearShoppingList,
  supToggleAddSupplier, supSaveSupplierPrice,
  supToggleAdhocForm, supSubmitAdhocItem, supRemoveAdhocItem,
  supSetBudget, supBestSearch, supBpKeydown,
  supCompleteRestock, supCancelRestock, supToggleRestockSkip, supSaveRestocks,
};
