// ============================================================
//  inventory.js
//  Fix this session: updateSummary() restores sumMonthRevenue
//  and sumMonthProfit — voided trades excluded from calc.
//  All other changes from sessions 2+3 retained.
// ============================================================

import { fmt, pct, uid, now, today,
         openModal, closeModal, toast, escapeHtml, askConfirm,
         saveLocal, getMarkup, setBtnLoading, itemNeedsCost, itemNeedsStock,
         lowStockPct, lowThresholdFromPct, isoDate, csvCell, CSV_BOM } from './utils.js';
import { currentUser, activeUid }               from './auth.js';
import { saveItem, removeItem, addTombstone }  from './db.js';
import { logActivity, assertPermission, getCurrentActor, costBlindForCurrentRole } from './staff-auth.js';
import { ensureSupplierListeners, getActiveSuppliers,
         getLastRestockInfo, createSupplierPrice } from './suppliers-store.js';
import { renderActiveSupView } from './suppliers-view.js';
import { pushHash } from './router.js';
let _sellManualOverride = false;
let _rowManualOverride  = false;
let currentBuyUnit      = 'carton';
// Bundle 3 (Stage 6): owner/admin-only "needs cost" inventory filter, toggled
// by the Dashboard alert card (reviewNeedsCost) and its toolbar chip.
let _needsCostFilter    = false;
// v1.0 stock-tracking: "needs stock setup" filter (attention card line 1) +
// the open inline Set-stock editor (one at a time, by item id).
let _needsStockFilter   = false;
let _setStockItemId     = null;
// Stock-state filter (single-select): 'all' | 'ok' (in stock) | 'low' | 'out' |
// 'untracked'. Drives the In stock/Low/Out/Untracked toolbar chips. Replaces the
// old 3-state #lowStockFilter cycling button. Values match _itemStockState().
let _stockFilter        = 'all';
let _ssWarnManual       = false;
window._inventoryPage = 0;
const ITEMS_PER_PAGE = 30;

// v1.0 stock-tracking: new items default to tracking ON. Applied from JS at
// boot (not only the `checked` attribute in index.html) so the default holds
// even when a service worker serves stale HTML — the bug that made the first
// add of every session save untracked. Never touches edit mode.
function _applyAddFormStockDefault() {
  if (window._pkEditingId) return;
  const t = document.getElementById('iTrackStock');
  if (t) t.checked = true;
  const w = document.getElementById('stockQtyFields');
  if (w) w.style.display = '';
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _applyAddFormStockDefault, { once: true });
} else {
  _applyAddFormStockDefault();
}

// D.3.3 state
window._pkInventoryReady   = window._pkInventoryReady   || false;
window._pkInventorySelMode = window._pkInventorySelMode || false;
window._pkInventorySelIds  = window._pkInventorySelIds  || new Set();
// Default sort follows mockup: Name (A–Z)
window._pkInventorySort    = window._pkInventorySort    || 'name';

// 1.2s after first paint, force ready=true so skeleton never gets stuck.
// renderItems() flips this earlier as soon as real data arrives.
setTimeout(() => {
  if (!window._pkInventoryReady) {
    window._pkInventoryReady = true;
    if (typeof renderItems === 'function') {
      try { renderItems(); } catch (_) {}
    }
  }
}, 1200);


function updateActiveRadio() {
  document.querySelectorAll('.buy-unit-btn').forEach(btn => {
    btn.classList.toggle('active', btn.querySelector('input:checked') !== null);
  });
}

const PREVIEW_LABELS = {
  carton: { topCost:'Carton Cost',topSell:'Carton Sell',topProfit:'Carton Profit',topPcs:'Total Pieces',unitCost:'Cost / Piece',unitSell:'Sell / Piece',unitProfit:'Profit / Piece',margin:'Margin %',rowCost:'Cost / Row',rowSell:'Sell / Row',rowProfit:'Profit / Row' },
  row:    { topCost:'Row Cost',topSell:'Row Sell',topProfit:'Row Profit',topPcs:'Pieces in Row',unitCost:'Cost / Piece',unitSell:'Sell / Piece',unitProfit:'Profit / Piece',margin:'Margin %',rowCost:'Cost / Row',rowSell:'Sell / Row',rowProfit:'Profit / Row' },
  piece:  { topCost:'Piece Cost',topSell:'Piece Sell',topProfit:'Piece Profit',topPcs:'—',unitCost:'Cost / Piece',unitSell:'Sell / Piece',unitProfit:'Profit / Piece',margin:'Margin %',rowCost:'Cost / Row',rowSell:'Sell / Row',rowProfit:'Profit / Row' },
};

function updatePreviewLabels() {
  const labels = PREVIEW_LABELS[currentBuyUnit] || PREVIEW_LABELS.carton;
  const setLbl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setLbl('lbl-cpCartonCost',labels.topCost); setLbl('lbl-cpCartonSell2',labels.topSell);
  setLbl('lbl-cpCartonProfit2',labels.topProfit); setLbl('lbl-cpPiecesTotal',labels.topPcs);
  setLbl('lbl-cpPieceCost',labels.unitCost); setLbl('lbl-cpPieceSell2',labels.unitSell);
  setLbl('lbl-cpPieceProfit',labels.unitProfit); setLbl('lbl-cpPieceMargin',labels.margin);
  setLbl('lbl-cpRowCost',labels.rowCost); setLbl('lbl-cpRowSell',labels.rowSell);
  setLbl('lbl-cpRowProfit',labels.rowProfit);
}

function _applyModeVisibility(mode) {
  const buyLabel      = document.getElementById('buyPriceLabel');
  const cartonSellFld = document.getElementById('cartonSellField');
  const cartonFields  = document.getElementById('cartonFields');
  const rowSellCont   = document.getElementById('rowSellContainer');
  const rowSpecFlds   = document.getElementById('rowSpecificFields');
  if (mode === 'carton') {
    if (buyLabel)      buyLabel.textContent        = 'Carton Buy Price (₦) *';
    if (cartonSellFld) cartonSellFld.style.display = '';
    if (cartonFields)  cartonFields.style.display  = '';
    if (rowSellCont)   rowSellCont.style.display   = '';
    if (rowSpecFlds)   rowSpecFlds.style.display   = 'none';
  } else if (mode === 'row') {
    if (buyLabel)      buyLabel.textContent        = 'Buy Price per Row (₦) *';
    if (cartonSellFld) cartonSellFld.style.display = 'none';
    if (cartonFields)  cartonFields.style.display  = 'none';
    if (rowSellCont)   rowSellCont.style.display   = '';
    if (rowSpecFlds)   rowSpecFlds.style.display   = '';
  } else if (mode === 'piece') {
    if (buyLabel)      buyLabel.textContent        = 'Buy Price per Piece (₦) *';
    if (cartonSellFld) cartonSellFld.style.display = 'none';
    if (cartonFields)  cartonFields.style.display  = 'none';
    if (rowSellCont)   rowSellCont.style.display   = 'none';
    if (rowSpecFlds)   rowSpecFlds.style.display   = 'none';
  }
}


// ── Add Item Drawer ───────────────────────────────────────────
window.openAddItemDrawer = function(editMode = false) {
  const overlay = document.getElementById('addItemOverlay');
  const modal   = document.getElementById('addItemDrawer');
  if (!overlay || !modal) return;
  overlay.style.display = 'flex';
  modal.classList.remove('pk-ai-in'); void modal.offsetWidth; modal.classList.add('pk-ai-in'); // replay enter anim
  document.body.style.overflow = 'hidden';
  syncStockUnitOptions();              // stock count-unit follows the buy unit
  if (!editMode) {
    document.getElementById('drawerTitle').textContent = '＋ Add New Item';
    document.getElementById('drawerSaveBtn').textContent = '＋ Save to Inventory';
    document.getElementById('drawerSaveBtn').onclick = () => PK.addItem();
    populateItemSupplierSection(false, null);   // D.9.2 add-mode supplier section
  }
};

window.closeAddItemDrawer = function() {
  const overlay = document.getElementById('addItemOverlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  document.body.style.overflow = '';
};

// Smart threshold hint — converts threshold to pieces and shows context
window._updateThresholdHint = function() {
  const hint      = document.getElementById('thresholdHint');
  const stockQty  = parseFloat(document.getElementById('iStockQty')?.value) || 0;
  const stockUnit = document.getElementById('iStockUnit')?.value || 'carton';
  const threshold = parseFloat(document.getElementById('iLowThreshold')?.value) || 0;
  const threshUnit = document.getElementById('iLowThresholdUnit')?.value || 'carton';
  if (!hint) return;

  // Get piece conversion factors
  const ppc = (() => {
    const direct = parseFloat(document.getElementById('iCartonQty')?.value) || 0;
    const rows   = parseFloat(document.getElementById('iRowsPerCarton')?.value) || 0;
    const ppr    = parseFloat(document.getElementById('iPiecesPerRow')?.value) ||
                   parseFloat(document.getElementById('iPiecesPerRowRowMode')?.value) || 0;
    return direct || (rows && ppr ? rows * ppr : 0) || 1;
  })();
  const ppr = parseFloat(document.getElementById('iPiecesPerRow')?.value) ||
              parseFloat(document.getElementById('iPiecesPerRowRowMode')?.value) || 1;

  const toPcs = (val, unit) => {
    if (unit === 'carton') return val * ppc;
    if (unit === 'row')    return val * ppr;
    return val;
  };

  // Blank threshold → show the auto reorder point derived from the default %
  // of the stock total, so the owner sees what they'll get without typing one.
  const stockUnsetEarly = (document.getElementById('iStockQty')?.value ?? '').trim() === '';
  if (!threshold) {
    if (stockUnsetEarly) { hint.style.display = 'none'; return; }
    const pct = lowStockPct();
    const autoPcs = lowThresholdFromPct(toPcs(stockQty, stockUnit), pct);
    hint.style.display = '';
    hint.innerHTML = `Auto: alerts at <b>${pct}%</b> of stock — about <b>${Math.round(autoPcs).toLocaleString()} pcs</b>. Type a number to override.`;
    return;
  }

  const threshPcs = toPcs(threshold, threshUnit);
  const stockPcs  = toPcs(stockQty, stockUnit);
  const safe      = stockPcs > threshPcs;

  const threshLabel = `${threshold} ${threshUnit}${threshold !== 1 ? 's' : ''}${ppc > 1 ? ` (= ${Math.round(threshPcs).toLocaleString()} pcs)` : ''}`;
  const stockLabel  = `${stockQty} ${stockUnit}${stockQty !== 1 ? 's' : ''}`;

  // v1.0 stock-tracking: empty qty = stock UNSET — don't tell the user
  // "you have 0 which is already low"; the warning arms once stock is set.
  const stockUnset = (document.getElementById('iStockQty')?.value ?? '').trim() === '';
  if (stockUnset) {
    hint.style.display = '';
    hint.innerHTML = `
      💡 You will get a warning once stock goes below <strong style="color:var(--accent);">${threshLabel}</strong>.
      Stock isn't set yet — the warning starts working once you set it.`;
    return;
  }

  hint.style.display = '';
  hint.innerHTML = `
    💡 You will get a warning once stock goes below <strong style="color:var(--accent);">${threshLabel}</strong>.
    You currently have <strong style="color:${safe ? 'var(--green)' : 'var(--red)'};">${stockLabel}</strong>
    ${safe ? '<span style="color:var(--green);">which is enough ✓</span>' : '<span style="color:var(--red);">which is already low ⚠</span>'}
  `;
};

export function toggleAcc(id) { document.getElementById(id)?.classList.toggle('open'); }
export function saveMarkup()  { localStorage.setItem('pkMarkup', getMarkup()); }

export function changeBuyUnit() {
  currentBuyUnit = document.querySelector('input[name="buyUnit"]:checked')?.value || 'carton';
  _sellManualOverride = false; _rowManualOverride = false;
  // N1 fix: also clear the carton-mode divisor fields (iCartonQty/iRowsPerCarton/
  // iPiecesPerRow) so switching buy-unit mode can't leave a stale piecesPerCarton
  // value around to corrupt a later save.
  ['iBuyPrice','iCartonSell','iRowSell','iSell','iPiecesPerRowRowMode','iCartonQty','iRowsPerCarton','iPiecesPerRow'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  _applyModeVisibility(currentBuyUnit); updateActiveRadio(); updatePreviewLabels();
  syncStockUnitOptions();
  const preview = document.getElementById('cartonPreview'); if (preview) preview.style.display = 'none';
  calcCarton();
}

// Stock can be counted in any unit the packaging contains, defaulting to the
// buy unit: carton → Cartons/Rows/Pieces; row → Rows/Pieces; piece → Pieces.
// Keeps a still-valid prior choice; otherwise snaps to the buy unit.
function syncStockUnitOptions() {
  const sel = document.getElementById('iStockUnit');
  if (!sel) return;
  const sets = {
    carton: [['carton','Cartons'],['row','Rows'],['piece','Pieces']],
    row:    [['row','Rows'],['piece','Pieces']],
    piece:  [['piece','Pieces']],
  };
  const opts = sets[currentBuyUnit] || sets.carton;
  const prev = sel.value;
  sel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = opts.some(o => o[0] === prev) ? prev : opts[0][0];
  window._syncThresholdUnit();
}
// The "warn below" threshold is counted in the same unit as stock.
window._syncThresholdUnit = function() {
  const su = document.getElementById('iStockUnit')?.value || 'carton';
  const tu = document.getElementById('iLowThresholdUnit');
  if (tu) tu.value = su;
};

// ─────────────────────────────────────────────────────────────
// calcCarton — SELL-PRICE-WINS (Option A). The typed sell price is
// the source of truth; markup % is a derived read-only display.
//
// Dependency direction: Carton sell → Row sell → Piece sell.
//   rowSell   = cartonSell / rowsPerCarton   (auto, override wins)
//   pieceSell = rowSell    / piecesPerRow    (auto, override wins)
// Editing a higher level recalculates the lower levels (clearing
// their overrides — handled in the input handlers). Editing a lower
// level overrides locally without touching the higher level.
//
// Row buy-unit: rowSell is primary → derives pieceSell.
// Piece buy-unit: pieceSell is primary (nothing to derive).
// ─────────────────────────────────────────────────────────────
export function calcCarton() {
  try {
    const buyVal  = parseFloat(document.getElementById('iBuyPrice')?.value) || 0;
    const preview = document.getElementById('cartonPreview');

    // ── structural quantities ──
    const directPcs = parseFloat(document.getElementById('iCartonQty')?.value)     || 0;
    const rowsCtn   = parseFloat(document.getElementById('iRowsPerCarton')?.value) || 0;
    let pieceRow = 0;
    if (currentBuyUnit === 'carton')   pieceRow = parseFloat(document.getElementById('iPiecesPerRow')?.value) || 0;
    else if (currentBuyUnit === 'row') pieceRow = parseFloat(document.getElementById('iPiecesPerRowRowMode')?.value) || 0;
    let piecesPerCarton = directPcs || (rowsCtn && pieceRow ? rowsCtn * pieceRow : 1);
    if (piecesPerCarton < 1) piecesPerCarton = 1;

    // ── cost basis per unit (derived from the buy price of the selected unit) ──
    let cartonBuy = 0, rowBuy = 0, pieceBuy = 0;
    if (currentBuyUnit === 'carton') {
      cartonBuy = buyVal;
      pieceBuy  = buyVal / piecesPerCarton;
      rowBuy    = pieceRow ? pieceBuy * pieceRow : (rowsCtn ? buyVal / rowsCtn : 0);
    } else if (currentBuyUnit === 'row') {
      rowBuy   = buyVal;
      pieceBuy = pieceRow ? buyVal / pieceRow : buyVal;
    } else { // piece
      pieceBuy = buyVal;
    }

    // ── sell prices: SELL-PRICE-WINS ──
    const cartonSellEl = document.getElementById('iCartonSell');
    const rowSellEl    = document.getElementById('iRowSell');
    const pieceSellEl  = document.getElementById('iSell');

    const cartonSell = parseFloat(cartonSellEl?.value) || 0;
    let rowSell = 0, pieceSell = 0;

    if (currentBuyUnit === 'carton') {
      // Row derives from carton sell unless the user overrode it
      if (_rowManualOverride) {
        rowSell = parseFloat(rowSellEl?.value) || 0;
      } else {
        rowSell = (rowsCtn > 0 && cartonSell > 0) ? cartonSell / rowsCtn : 0;
        if (rowSellEl) rowSellEl.value = rowSell > 0 ? rowSell.toFixed(2) : '';
      }
      // Piece derives STRAIGHT from the carton sell (÷ pieces-per-carton), not
      // via row — so editing Row never changes Piece. Under Carton, Row and
      // Piece are independent: only the carton sell cascades to both. Override
      // (a manually-typed piece sell) still wins.
      if (_sellManualOverride) {
        pieceSell = parseFloat(pieceSellEl?.value) || 0;
      } else {
        pieceSell = (cartonSell > 0 && piecesPerCarton > 0) ? cartonSell / piecesPerCarton : 0;
        if (pieceSellEl) pieceSellEl.value = pieceSell > 0 ? pieceSell.toFixed(2) : '';
      }
    } else if (currentBuyUnit === 'row') {
      rowSell = parseFloat(rowSellEl?.value) || 0;            // primary input in row mode
      if (_sellManualOverride) {
        pieceSell = parseFloat(pieceSellEl?.value) || 0;
      } else {
        pieceSell = (pieceRow > 0 && rowSell > 0) ? rowSell / pieceRow : 0;
        if (pieceSellEl) pieceSellEl.value = pieceSell > 0 ? pieceSell.toFixed(2) : '';
      }
    } else { // piece
      pieceSell = parseFloat(pieceSellEl?.value) || 0;        // primary input in piece mode
    }

    // ── derived markup % (effective markup of the primary-unit sell vs buy) ──
    let primarySell = 0, primaryBuy = 0;
    if (currentBuyUnit === 'carton')   { primarySell = cartonSell; primaryBuy = cartonBuy; }
    else if (currentBuyUnit === 'row') { primarySell = rowSell;    primaryBuy = rowBuy; }
    else                               { primarySell = pieceSell;  primaryBuy = pieceBuy; }
    _updateMarkupDisplay(primarySell, primaryBuy);

    // ── D.3.5 profit preview · per-unit Buy → Sell = margin% ──
    // Chosen buy unit = the typed input; other units derive read-only.
    const ctnAvail = currentBuyUnit === 'carton';
    const rowAvail = currentBuyUnit === 'row'
      ? pieceRow > 0
      : (currentBuyUnit === 'carton' && rowsCtn > 0 && pieceRow > 0);
    _ppRow('Pcs', 'ppRowPcs', pieceBuy,  pieceSell,  true,     currentBuyUnit === 'piece');
    _ppRow('Row', 'ppRowRow', rowBuy,    rowSell,    rowAvail, currentBuyUnit === 'row');
    _ppRow('Ctn', 'ppRowCtn', cartonBuy, cartonSell, ctnAvail, currentBuyUnit === 'carton');
    livePreview();
  } catch(err) { console.error('calcCarton error:', err); }
}

// Render the derived effective markup into the read-only display.
// Gold when ≥ 0, red when negative (sell < buy), muted dash when
// either side is missing. Color comes from CSS classes — never set
// inline styles from JS (CLAUDE.md).
function _updateMarkupDisplay(sell, buy) {
  const el = document.getElementById('markupDisplay');
  if (!el) return;
  el.classList.remove('is-negative', 'is-empty');
  if (!buy || !sell) { el.textContent = '—'; el.classList.add('is-empty'); return; }
  const mk = ((sell - buy) / buy) * 100;
  el.textContent = mk.toFixed(1) + '%';
  if (mk < 0) el.classList.add('is-negative');
}

// ── D.3.5 Profit Preview (drawer) · per-unit Buy → Sell = margin% ──
// Proportional model: the chosen buy unit is the typed input; the other
// units are derived read-only here. No schema change.
function _ppSet(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
function _ppMargin(elId, buy, sell, available) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.remove('pos', 'neg', 'dash');
  if (!available || !(buy > 0) || !(sell > 0)) { el.textContent = '—'; el.classList.add('dash'); return; }
  const profit = sell - buy;
  const m = (profit / buy) * 100;
  // Profit AMOUNT is the headline; margin% is a muted suffix (was %-only).
  el.innerHTML = `${profit >= 0 ? '+' : '−'}<span class="currency">₦</span>${_fmtMoneyNoPrefix(Math.abs(profit))}`
    + ` <span class="pk-inv-pp-pct">${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1)}%</span>`;
  el.classList.add(profit >= 0 ? 'pos' : 'neg');
}
function _ppRow(prefix, rowId, buy, sell, available, isDefault) {
  const row = document.getElementById(rowId);
  if (row) row.classList.toggle('is-default', !!isDefault);
  // Hide rows for units this item's packaging doesn't have (e.g. CTN/ROW for a
  // piece-bought item) so the pricing block stays compact.
  if (row) row.classList.toggle('pk-pp-off', !available);
  _ppSet(`pp${prefix}Buy`,  available && buy  > 0 ? _fmtMoneyNoPrefix(buy)  : '—');
  _ppSet(`pp${prefix}Sell`, available && sell > 0 ? _fmtMoneyNoPrefix(sell) : '—');
  _ppMargin(`pp${prefix}Margin`, buy, sell, available);
}

export function livePreview() {
  const buyVal = parseFloat(document.getElementById('iBuyPrice')?.value) || 0;
  const iSell  = parseFloat(document.getElementById('iSell')?.value)     || 0;
  const p      = document.getElementById('preview');
  if (!p) return;
  if (!buyVal) { p.innerHTML = '<span>Enter buy + sell prices to see profit preview...</span>'; return; }

  const rowsCtn   = parseFloat(document.getElementById('iRowsPerCarton')?.value)  || 0;
  const directPcs = parseFloat(document.getElementById('iCartonQty')?.value)      || 0;
  const pieceRow  = currentBuyUnit === 'row'
    ? parseFloat(document.getElementById('iPiecesPerRowRowMode')?.value) || 0
    : parseFloat(document.getElementById('iPiecesPerRow')?.value)        || 0;

  // ── resolve cost-per-piece correctly per buy unit ──
  let cpp = 0;
  if (currentBuyUnit === 'piece') {
    cpp = buyVal;
  } else if (currentBuyUnit === 'row') {
    cpp = pieceRow > 0 ? buyVal / pieceRow : buyVal;
  } else {
    // carton
    const pcs = directPcs || (rowsCtn && pieceRow ? rowsCtn * pieceRow : 0);
    cpp = pcs > 0 ? buyVal / pcs : buyVal;
  }

  const spp = iSell || 0;

  // ── top-level profit (carton/row/piece unit profit) ──
  let topBuy = buyVal, topSell = 0;
  if (currentBuyUnit === 'piece') {
    topSell = spp;
  } else if (currentBuyUnit === 'row') {
    const rowSellEl = parseFloat(document.getElementById('iRowSell')?.value) || 0;
    topSell = rowSellEl || (spp * (pieceRow || 1));
  } else {
    // carton
    const cSell = parseFloat(document.getElementById('iCartonSell')?.value) || 0;
    topSell = cSell;
  }

  const pc  = topSell ? topSell - topBuy : 0;
  const pp  = cpp && spp ? spp - cpp : 0;
  const m   = cpp && spp ? pct(cpp, spp) : '0';
  const sgn = pp >= 0 ? '+' : '';

  p.innerHTML = `
    <span>Profit: <strong class="${pc >= 0 ? 'pos' : 'neg'}">${pc >= 0 ? '+' : ''}${fmt(pc)}</strong></span>
    ${cpp ? `<span>Per piece: <strong class="${pp >= 0 ? 'pos' : 'neg'}">${sgn}${fmt(pp)}</strong></span>` : ''}
    ${m !== '0' ? `<span style="color:var(--muted)">Margin: <strong class="${pp >= 0 ? 'pos' : 'neg'}">${sgn}${m}%</strong></span>` : ''}`;
}
// Carton sell is the source of truth. Editing it re-derives row + piece
// sell, discarding any local row/piece overrides (dependency flows down).
export function onCartonSellInput()  { _rowManualOverride = false; _sellManualOverride = false; calcCarton(); }

// Piece sell override — typed value wins, doesn't affect carton/row.
// Clearing the field drops the override so it re-derives from row sell.
export function onSellManualInput()  {
  const v = document.getElementById('iSell')?.value.trim();
  _sellManualOverride = !!(v && parseFloat(v) > 0);
  calcCarton();
}

// Row sell override — typed value wins and is independent of Piece (and never
// touches carton sell). Clearing the field drops the override so Row re-derives
// from carton. Does NOT reset the piece override — Row and Piece stand alone.
export function onRowManualInput()   {
  const v = document.getElementById('iRowSell')?.value.trim();
  _rowManualOverride  = !!(v && parseFloat(v) > 0);
  calcCarton();
}
export function resetSellOverride()  { _sellManualOverride = false; }
export function resetRowOverride()   { _rowManualOverride  = false; }

export function clearAddForm() {
  // Reset stock unit selects
  const su = document.getElementById('iStockUnit');
  if (su) su.value = 'carton';
  const ltu = document.getElementById('iLowThresholdUnit');
  if (ltu) ltu.value = 'carton';
  const hint = document.getElementById('thresholdHint');
  if (hint) hint.style.display = 'none';

  // Reset edit mode if active
  window._pkEditingId = null;
  const banner = document.getElementById('editModeBanner');
  if (banner) banner.style.display = 'none';

  const addBtn = document.querySelector('.btn-add');
  if (addBtn) {
    addBtn.textContent = '＋ Save to Inventory';
    addBtn.style.background = '';
  }

  ['iName','iBuyPrice','iCartonSell','iRowSell','iSell','iCartonQty',
   'iRowsPerCarton','iPiecesPerRow','iPiecesPerRowRowMode','iQty','iNote','iBarcode']
    .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const catEl=document.getElementById('iCat'); if(catEl) catEl.value='';
  const lowEl=document.getElementById('iLow'); if(lowEl) lowEl.checked=false;
  // v1.0 stock-tracking: NEW items default to tracking ON (checkbox checked,
  // fields visible, qty left empty → saves as stockQty:null = "unset").
  // Unchecking is an explicit opt-out and saves trackStock:false as before.
  const trackEl=document.getElementById('iTrackStock'); if(trackEl) trackEl.checked=true;
  const sqEl=document.getElementById('iStockQty'); if(sqEl) sqEl.value='';
  const ltEl=document.getElementById('iLowThreshold'); if(ltEl) ltEl.value='';
  const sqWrap=document.getElementById('stockQtyFields'); if(sqWrap) sqWrap.style.display='';
  const radio=document.querySelector('input[name="buyUnit"][value="carton"]'); if(radio) radio.checked=true;
  currentBuyUnit='carton'; resetSellOverride(); resetRowOverride();
  updateActiveRadio(); updatePreviewLabels(); _applyModeVisibility('carton');
  const cp=document.getElementById('cartonPreview'); if(cp) cp.style.display='none';
  const pv=document.getElementById('preview'); if(pv) pv.innerHTML='<span>Enter buy + sell prices to see profit preview...</span>';
  _updateMarkupDisplay(0, 0);
  try { calcCarton(); } catch (_) {}   // D.3.5: reset the Profit Preview to —
  const supSel = document.getElementById('iSupplier'); if (supSel) supSel.value = '';
  _updateItemSupplierNote();   // cleared selection → re-hide the quote note
  document.getElementById('iName')?.focus();
}

export async function addItem() {
  if (!assertPermission('addItem')) return;
  // Bundle 3 (Stage 5): cost-blind roles (manager) add/edit with SELL + QTY
  // only — the buy field is hidden, so skip buy validation and save null buy.
  const costBlind = costBlindForCurrentRole();
  const btn      = document.querySelector('.btn-add');
  const name     = document.getElementById('iName')?.value.trim();
  const buyPrice = parseFloat(document.getElementById('iBuyPrice')?.value);
  const cSell    = parseFloat(document.getElementById('iCartonSell')?.value);
  const sellPiece= parseFloat(document.getElementById('iSell')?.value);
  if (!name)                              return toast('⚠️ Enter an item name', 'err');
  if (!costBlind && (isNaN(buyPrice) || buyPrice <= 0)) return toast('⚠️ Buy Price must be greater than 0', 'err');
  if (currentBuyUnit==='carton' && (isNaN(cSell) || cSell <= 0)) return toast('⚠️ Carton Sell Price must be greater than 0', 'err');
  if (isNaN(sellPiece) || sellPiece <= 0) return toast('⚠️ Sell Price per Piece must be greater than 0', 'err');

    // If in edit mode, run update instead
  if (window._pkEditingId) {
    await _updateItem(window._pkEditingId);
    return;
  }

  setBtnLoading(btn, true);
  try {
    const cat      = document.getElementById('iCat')?.value || '';
    const qty      = document.getElementById('iQty')?.value || '';
    const rowsCtn  = document.getElementById('iRowsPerCarton')?.value || '';
    const pieceRow = currentBuyUnit==='row'
      ? document.getElementById('iPiecesPerRowRowMode')?.value||''
      : document.getElementById('iPiecesPerRow')?.value||'';
    const rowSell  = parseFloat(document.getElementById('iRowSell')?.value)||0;
    const directPcs= parseFloat(document.getElementById('iCartonQty')?.value)||0;
    const note         = document.getElementById('iNote')?.value.trim()||'';
    const trackStock   = document.getElementById('iTrackStock')?.checked||false;
    // v1.0 stock-tracking: empty qty on a tracked item = UNSET (null), which is
    // distinct from an explicit "0" (sold out). null items show on the owner's
    // "need stock setup" reminder; 0 items are genuinely out of stock.
    const _rawStockQty = (document.getElementById('iStockQty')?.value ?? '').trim();
    const stockQty     = trackStock ? (_rawStockQty === '' ? null : Math.max(0, parseFloat(_rawStockQty) || 0)) : null;
    const stockUnit        = trackStock ? (document.getElementById('iStockUnit')?.value||'carton') : null;
    // Convert quantities to pieces for consistent comparison
    const _ppc2 = (() => { const d=parseFloat(document.getElementById('iCartonQty')?.value)||0; const r=parseFloat(document.getElementById('iRowsPerCarton')?.value)||0; const p=parseFloat(document.getElementById('iPiecesPerRow')?.value)||0; return d||(r&&p?r*p:0)||1; })();
    const _ppr2 = parseFloat(document.getElementById('iPiecesPerRow')?.value)||parseFloat(document.getElementById('iPiecesPerRowRowMode')?.value)||1;
    const _toPcs2 = (v,u) => u==='carton'?v*_ppc2:u==='row'?v*_ppr2:v;
    const stockQtyPcs      = trackStock && stockQty != null ? _toPcs2(stockQty, stockUnit||'carton') : null;
    // Low threshold: an explicit value the owner typed wins; otherwise derive
    // the reorder point from the default % of the stock total (no more fixed
    // "5 carton" default). Blank + unset stock leaves it null until restock.
    const _ltRaw     = (document.getElementById('iLowThreshold')?.value ?? '').trim();
    const _ltUnitSel = trackStock ? (document.getElementById('iLowThresholdUnit')?.value||'carton') : null;
    let lowThreshold, lowThresholdUnit, lowThresholdPcs;
    if (!trackStock) {
      lowThreshold = null; lowThresholdUnit = null; lowThresholdPcs = null;
    } else if (_ltRaw !== '') {
      lowThreshold = Math.max(0, parseFloat(_ltRaw) || 0);
      lowThresholdUnit = _ltUnitSel || 'carton';
      lowThresholdPcs = _toPcs2(lowThreshold, lowThresholdUnit);
    } else if (stockQtyPcs != null) {
      lowThresholdPcs  = lowThresholdFromPct(stockQtyPcs);
      lowThresholdUnit = stockUnit || 'carton';
      lowThreshold     = lowThresholdPcs / (_toPcs2(1, lowThresholdUnit) || 1);
    } else {
      lowThreshold = null; lowThresholdUnit = _ltUnitSel; lowThresholdPcs = null;
    }
    const low              = trackStock ? (stockQtyPcs != null && lowThresholdPcs != null ? stockQtyPcs <= lowThresholdPcs : false) : (document.getElementById('iLow')?.checked||false);
    let piecesPerCarton = directPcs||(rowsCtn&&pieceRow ? parseFloat(rowsCtn)*parseFloat(pieceRow) : 1);
    if (piecesPerCarton<1) piecesPerCarton=1;
    // Row buy-unit derives per-piece cost from piecesPerRow, NOT piecesPerCarton
    // (which is usually 1 in row mode, since the carton fields are hidden) —
    // otherwise the full row price gets stored as the per-piece cost. (N1 fix)
    const _ppr3 = parseFloat(pieceRow) || 1;
    const exactBuy = costBlind ? null : (
      currentBuyUnit==='piece' ? buyPrice :
      currentBuyUnit==='row'   ? buyPrice/_ppr3 :
      buyPrice/piecesPerCarton
    );
    window._pkItems = window._pkItems||[];
    const existing = window._pkItems.findIndex(i=>(i.name||'').toLowerCase()===name.toLowerCase());
    const barcode = document.getElementById('iBarcode')?.value.trim() || null;
    const baseData = { name, buyUnit:currentBuyUnit, buy:exactBuy, sell:sellPiece, cat, qty, buyPrice: costBlind ? null : buyPrice,
      cartonSell:currentBuyUnit==='carton'?cSell:0,
      rowSell:(currentBuyUnit==='row'||currentBuyUnit==='carton')?rowSell:0,
      piecesPerCarton, rowsPerCarton:rowsCtn, piecesPerRow:pieceRow, note, barcode,
      trackStock, stockQty, stockUnit, lowThreshold, lowThresholdUnit, lowThresholdPcs, low, updatedAt:now(), updatedTs:Date.now() };
    // D.9.2: optional supplier capture. If chosen, denormalize onto the
    // item and (after save) log the buy price as this supplier's quote.
    const supId = _itemSupplierSelectedId();
    if (supId) { baseData.defaultSupplierId = supId; baseData.lastSupplierPriceAt = Date.now(); }
    let savedId = null;
    if (existing>=0) {
      const old=window._pkItems[existing];
      const hist=old.history||[];
      hist.unshift({buy:old.buy,sell:old.sell,date:old.updatedAt});
      if(hist.length>5) hist.pop();
      const updated={...old,...baseData,history:hist};
      window._pkItems[existing]=updated;
      savedId=updated.id;
const _uid4 = activeUid(); if(_uid4) await saveItem(_uid4, updated);
    logActivity('EDIT_ITEM', { itemName: updated.name });toast('✅ '+name+' updated!','ok');
    } else {
      const item={id:uid(),...baseData,addedDate:today(),history:[]};
      window._pkItems.unshift(item);
      savedId=item.id;
     const _uid2 = activeUid(); if(_uid2) await saveItem(_uid2, item);
      logActivity('ADD_ITEM', { itemName: item.name, buyPrice: item.buyPrice, sellPrice: item.sell });     toast('✅ '+name+' added!','ok');
      window.closeAddItemDrawer();
    }
    // D.9.2: log the initial supplier price (isPurchase, qty = initial stock).
    // Cost-blind roles have no buy price, so never log a (null) supplier quote.
    if (supId && savedId && !costBlind) {
      try {
        await createSupplierPrice({
          itemId: savedId, supplierId: supId, price: buyPrice, perUnit: currentBuyUnit,
          qtyAdded: trackStock ? (stockQty || 0) : 0, isPurchase: true,
        });
      } catch (e) {
        console.error('[d9.2] add-item supplier price log failed:', e);
        toast('⚠️ Item saved, but supplier price could not be logged', 'err');
      }
    }
    saveLocal(); renderItems(); updateSummary(); clearAddForm();
    window.__pkRepublishStorefront?.();   // keep public storefront current
  } finally { setBtnLoading(btn,false); }
}

async function _updateItem(id) {
  // Bundle 3 (Stage 5): cost-blind roles (manager) edit SELL + QTY only —
  // skip the buy validation and PRESERVE the owner-set buy (never wipe it).
  const costBlind = costBlindForCurrentRole();
  const btn = document.querySelector('.btn-add');
  const name      = document.getElementById('iName')?.value.trim();
  const buyPrice  = parseFloat(document.getElementById('iBuyPrice')?.value) || 0;
  const cSell     = parseFloat(document.getElementById('iCartonSell')?.value) || 0;
  const sellPiece = parseFloat(document.getElementById('iSell')?.value) || 0;

  if (!name)      return toast('⚠️ Enter an item name', 'err');
  if (!costBlind && !buyPrice)  return toast('⚠️ Enter Buy Price', 'err');
  if (!sellPiece) return toast('⚠️ Enter Sell Price per Piece', 'err');

  setBtnLoading(btn, true);
  try {
    const idx = (window._pkItems || []).findIndex(i => i.id === id);
    if (idx < 0) return toast('⚠️ Item not found', 'err');

    const old = window._pkItems[idx];
    const cat     = document.getElementById('iCat')?.value || '';
    const qty     = document.getElementById('iQty')?.value || '';
    const rowsCtn = document.getElementById('iRowsPerCarton')?.value || '';
    const pieceRow = currentBuyUnit === 'row'
      ? document.getElementById('iPiecesPerRowRowMode')?.value || ''
      : document.getElementById('iPiecesPerRow')?.value || '';
    const rowSell   = parseFloat(document.getElementById('iRowSell')?.value) || 0;
    const directPcs = parseFloat(document.getElementById('iCartonQty')?.value) || 0;
    const note      = document.getElementById('iNote')?.value.trim() || '';
    const trackStock   = document.getElementById('iTrackStock')?.checked || false;
    // v1.0 stock-tracking: empty qty = UNSET (null), distinct from explicit 0.
    // null must NOT be compared as a number (null <= 5 coerces true) → low:false.
    const _rawStockQty = (document.getElementById('iStockQty')?.value ?? '').trim();
    const stockQty     = trackStock ? (_rawStockQty === '' ? null : Math.max(0, parseFloat(_rawStockQty) || 0)) : null;
    const stockUnit    = trackStock ? (document.getElementById('iStockUnit')?.value || old.stockUnit || 'carton') : null;
    // pieces conversion (mirror the add path) so the threshold compares in pieces
    const _ppc2 = directPcs || (rowsCtn && pieceRow ? parseFloat(rowsCtn) * parseFloat(pieceRow) : 0) || parseFloat(old.piecesPerCarton) || 1;
    const _ppr2 = parseFloat(pieceRow) || parseFloat(old.piecesPerRow) || 1;
    const _toPcs2 = (v, u) => u === 'carton' ? v * _ppc2 : u === 'row' ? v * _ppr2 : v;
    const stockQtyPcs = trackStock && stockQty != null ? _toPcs2(stockQty, stockUnit || 'carton') : null;
    // Low threshold: explicit typed value wins (the field is pre-filled on edit,
    // so an existing threshold is preserved); blank derives from the default %
    // of the stock total instead of the old fixed "5 carton".
    const _ltRaw     = (document.getElementById('iLowThreshold')?.value ?? '').trim();
    const _ltUnitSel = trackStock ? (document.getElementById('iLowThresholdUnit')?.value || 'carton') : null;
    let lowThreshold, lowThresholdUnit, lowThresholdPcs;
    if (!trackStock) {
      lowThreshold = null; lowThresholdUnit = null; lowThresholdPcs = null;
    } else if (_ltRaw !== '') {
      lowThreshold = Math.max(0, parseFloat(_ltRaw) || 0);
      lowThresholdUnit = _ltUnitSel || 'carton';
      lowThresholdPcs = _toPcs2(lowThreshold, lowThresholdUnit);
    } else if (stockQtyPcs != null) {
      lowThresholdPcs  = lowThresholdFromPct(stockQtyPcs);
      lowThresholdUnit = stockUnit || 'carton';
      lowThreshold     = lowThresholdPcs / (_toPcs2(1, lowThresholdUnit) || 1);
    } else {
      lowThreshold = null; lowThresholdUnit = _ltUnitSel; lowThresholdPcs = null;
    }
    const low          = trackStock ? (stockQtyPcs != null && lowThresholdPcs != null ? stockQtyPcs <= lowThresholdPcs : false) : (document.getElementById('iLow')?.checked || false);

    let piecesPerCarton = directPcs || (rowsCtn && pieceRow ? parseFloat(rowsCtn) * parseFloat(pieceRow) : 1);
    if (piecesPerCarton < 1) piecesPerCarton = 1;

    // Row buy-unit derives per-piece cost from piecesPerRow, NOT piecesPerCarton
    // — see addItem() for why. (N1 fix)
    const _ppr3b = parseFloat(pieceRow) || 1;
    const exactBuy = costBlind ? (old.buy ?? null) : (
      currentBuyUnit === 'piece' ? buyPrice :
      currentBuyUnit === 'row'   ? buyPrice / _ppr3b :
      buyPrice / piecesPerCarton
    );

    // Price history
    const hist = old.history || [];
    if (old.buy !== exactBuy || old.sell !== sellPiece) {
      hist.unshift({ buy: old.buy, sell: old.sell, date: old.updatedAt });
      if (hist.length > 5) hist.pop();
    }

    const updated = {
      ...old,
      name,
      buyUnit: currentBuyUnit,
      buy: exactBuy,
      sell: sellPiece,
      cat,
      qty,
      buyPrice: costBlind ? (old.buyPrice ?? null) : buyPrice,
      cartonSell: currentBuyUnit === 'carton' ? cSell : 0,
      rowSell: (currentBuyUnit === 'row' || currentBuyUnit === 'carton') ? rowSell : 0,
      piecesPerCarton,
      rowsPerCarton: rowsCtn,
      piecesPerRow: pieceRow,
      note,
      trackStock, stockQty, stockUnit, stockQtyPcs,
      lowThreshold, lowThresholdUnit, lowThresholdPcs,
      low,
      updatedAt: now(),
      updatedTs: Date.now(),
      history: hist
    };

    // D.9.2: change default supplier from the drawer (no price doc — a
    // price change is the Restock flow). Picking the placeholder keeps the
    // existing default rather than clearing it accidentally.
    const supId = _itemSupplierSelectedId();
    updated.defaultSupplierId = supId || old.defaultSupplierId || null;
    updated.barcode = document.getElementById('iBarcode')?.value.trim() || null;

    window._pkItems[idx] = updated;
const _uid3 = activeUid(); if(_uid3) await saveItem(_uid3, updated);

    saveLocal();
    renderItems();
    updateSummary();
    toast(`✅ ${name} updated successfully`, 'ok');

    // Exit edit mode
    window._pkEditingId = null;
    const banner = document.getElementById('editModeBanner');
    if (banner) banner.style.display = 'none';
    const addBtn = document.querySelector('.btn-add');
    if (addBtn) {
      addBtn.textContent = '＋ Save to Inventory';
      addBtn.style.background = '';
    }
    clearAddForm();

  } finally {
    setBtnLoading(btn, false);
  }
}


export function getStockSummary() {
  const items = window._pkItems || [];
  let lowCount = 0, outCount = 0;
  for (const it of items) {
    if (it.restockFlag === 'out') { outCount++; continue; }
    if (it.restockFlag === 'low') { lowCount++; continue; }
    // stockQty:null = tracked but UNSET — not out, not low (v1.0 stock-tracking)
    if (!it.trackStock || it.stockQty == null) continue;
    const qty = parseFloat(it.stockQty) || 0;
    if (qty === 0)      outCount++;
    else if (it.low)    lowCount++;
  }
  return { lowCount, outCount };
}

function _itemStockState(item) {
  // Manual restock-flag (kebab menu) wins regardless of tracking — it's a
  // personal reminder, not a recount, so it applies even to untracked
  // items. Separate field from `low`/`stockQty` on purpose: those get
  // silently recomputed by _decrementStock on every sale (trade-payment.js),
  // which would otherwise clobber a manual flag without the owner doing
  // anything. See css/inventory-d33.css .pk-inv-stock--flagged.
  if (item.restockFlag === 'out') return 'out';
  if (item.restockFlag === 'low') return 'low';
  if (!item.trackStock) return 'untracked';
  // stockQty:null = tracked but UNSET — renders like untracked (no OUT badge);
  // only an explicit 0 is sold-out (v1.0 stock-tracking).
  if (item.stockQty == null) return 'untracked';
  const qty = parseFloat(item.stockQty) || 0;
  if (qty === 0) return 'out';
  if (item.low)  return 'low';
  return 'ok';
}

// ─────────────────────────────────────────────────────────────
// stockLabel — dominant unit + remainder formatting. Kept as a
// stable export because trade/wholesale code reads it too.
// ─────────────────────────────────────────────────────────────
export function stockLabel(item) {
  if (!item || !item.trackStock || item.stockQty == null) return null;
  const qty      = parseFloat(item.stockQty) || 0;
  // stockQty is denominated in item.stockUnit (set explicitly when the item
  // is added/edited) — NOT item.buyUnit, which can be unset or describe a
  // different unit (e.g. CENTRE FRUIT: stockUnit:'piece' but no buyUnit set,
  // so this used to default to 'carton' and label 23 real pieces "23 ctn").
  // Same root cause as the insights-engine.js / trade-payment.js fixes —
  // 23 Jun 2026.
  const buyUnit  = item.stockUnit || item.buyUnit || 'carton';
  const _ppc     = parseFloat(item.piecesPerCarton) || (parseFloat(item.rowsPerCarton||1) * parseFloat(item.piecesPerRow||1)) || 1;
  const _ppr     = parseFloat(item.piecesPerRow) || 1;
  if (buyUnit === 'carton' && _ppc > 1) {
    const whole  = Math.floor(qty);
    const remPcs = Math.round((qty - whole) * _ppc);
    if (whole > 0 && remPcs > 0) return `${whole} ctn, ${remPcs} pcs`;
    if (whole > 0)               return `${whole} ctn`;
    return `${remPcs} pcs`;
  }
  if (buyUnit === 'row' && _ppr > 1) {
    const whole  = Math.floor(qty);
    const remPcs = Math.round((qty - whole) * _ppr);
    if (whole > 0 && remPcs > 0) return `${whole} row, ${remPcs} pcs`;
    if (whole > 0)               return `${whole} rows`;
    return `${remPcs} pcs`;
  }
  return `${Math.round(qty)} pcs`;
}

// Short stock chip text for the card head (matches mockup phrasing)
function _shortStockChipText(item) {
  if (item.restockFlag === 'out') return '📌 Out (flagged)';
  if (item.restockFlag === 'low') return '📌 Low (flagged)';
  // null = unset → no chip (NOT "⛔ Out" — that's an explicit 0 only)
  if (!item.trackStock || item.stockQty == null) return null;
  const qty = parseFloat(item.stockQty) || 0;
  if (qty === 0) return '⛔ Out';
  const lbl = stockLabel(item) || `${Math.round(qty)} pcs`;
  return (item.low ? '⚠ ' : '✓ ') + lbl;
}

// Velocity bucket from last-sale timestamp (ms). Returns
// { bucket: 'selling'|'slow'|'dead'|'never', title: string }.
function _velocityFor(lastTs) {
  if (!lastTs) return { bucket: 'never', title: 'Never sold' };
  const ageDays = (Date.now() - lastTs) / 86400000;
  const rel = ageDays < 1
    ? 'today'
    : (ageDays < 2 ? 'yesterday' : `${Math.round(ageDays)} days ago`);
  if (ageDays <= 7)  return { bucket: 'selling', title: `Last sold ${rel}` };
  if (ageDays <= 30) return { bucket: 'slow',    title: `Last sold ${rel}` };
  return { bucket: 'dead', title: `Last sold ${rel}` };
}

// Build {itemId → maxCreatedTs} index from _pkSales once per render
function _buildLastSoldIndex() {
  const idx = Object.create(null);
  const sales = window._pkSales || [];
  for (const s of sales) {
    if (s.voided) continue;
    const ts = s.createdTs || (s.date ? new Date(s.date + 'T00:00:00').getTime() : 0);
    if (!ts) continue;
    if (Array.isArray(s.items)) {
      for (const it of s.items) {
        const id = it.itemId;
        if (!id) continue;
        if (!idx[id] || idx[id] < ts) idx[id] = ts;
      }
    } else if (s.itemId) {
      if (!idx[s.itemId] || idx[s.itemId] < ts) idx[s.itemId] = ts;
    }
  }
  return idx;
}

// Update the "All N" chip count and the segmented-switcher counts.
// Cheap; called from renderItems + updateSummary.
export function updateInventoryHeader() {
  const items = window._pkItems || [];
  // The Items metric strip (stock value · low · out) was removed from the
  // slim bar per founder directive, so its computation is gone too. The
  // Low/Out filter-chip counts are set elsewhere; this just feeds counts.
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pkInvAllCount', items.length.toLocaleString('en-NG'));
  // D.3.5 segmented switcher counts (the old "N items in stock" header is gone)
  set('invSegItemsCount', items.length.toLocaleString('en-NG'));
  set('invSegSuppliersCount', (window._pkSuppliers || []).length);
}

// Sort _pkItems-derived list per current sort key
// Stock in pieces, worked out from the real count (the stored pieces copy can be stale).
function _stockPcsOf(it) {
  const q = parseFloat(it.stockQty) || 0;
  const unit = it.stockUnit || it.buyUnit || 'carton';
  const ppr = parseFloat(it.piecesPerRow) || 1;
  const ppc = parseFloat(it.piecesPerCarton) || ((parseFloat(it.rowsPerCarton) || 0) * ppr) || 1;
  return unit === 'carton' ? q * ppc : unit === 'row' ? q * ppr : q;
}

function _invSortFiltered(arr, lastSoldIdx) {
  const sort = window._pkInventorySort || 'name';
  const cmp = {
    'name':       (a, b) => (a.name || '').localeCompare(b.name || ''),
    'stock-asc':  (a, b) => {
      // null stock = no info → sorts with untracked (Infinity), not with sold-out 0
      const av = (a.trackStock && a.stockQty != null) ? _stockPcsOf(a) : Infinity;
      const bv = (b.trackStock && b.stockQty != null) ? _stockPcsOf(b) : Infinity;
      return av - bv;
    },
    'price-desc': (a, b) => (parseFloat(b.sell) || 0) - (parseFloat(a.sell) || 0),
    'recent':     (a, b) => (b.updatedTs || 0) - (a.updatedTs || 0),
    'last-sold':  (a, b) => (lastSoldIdx[b.id] || 0) - (lastSoldIdx[a.id] || 0),
  }[sort] || ((a, b) => 0);
  return arr.slice().sort(cmp);
}

// ─────────────────────────────────────────────────────────────
// renderItems — D.3.3 redesign. Same filter/pagination contract.
// ─────────────────────────────────────────────────────────────
export function renderItems() {
  const list = document.getElementById('itemsList');
  if (!list) return;

  window._pkItems = window._pkItems || [];
  // D.9.1: bootstrap supplier listeners + role-gate the Suppliers UI from
  // here, since renderItems runs on every entry path (owner, staff login,
  // staff reload) and staff-auth.js is off-limits this phase. Both are
  // idempotent/cheap.
  try { ensureSupplierListeners(); } catch (_) {}
  try { applySupplierRoleGating(); } catch (_) {}
  updateInventoryHeader();

  const q  = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const cf = document.getElementById('catFilter')?.value || '';
  // Stock-state filter source of truth is the module-level _stockFilter
  // (set by setStockFilter / dashboard jumps), not a DOM dataset.

  // Update category chip visual to reflect select state
  _refreshCatChip();
  _refreshStockChips();
  _refreshSelectToolbarUI();
  _refreshNeedsCostChip();
  _refreshNeedsStockChip();

  // Loading skeleton while initial Firestore subscription resolves
  if (!window._pkInventoryReady && window._pkItems.length === 0) {
    list.innerHTML = _renderInventorySkeleton();
    return;
  }
  // Flip the ready flag as soon as we actually have data
  if (window._pkItems.length > 0) window._pkInventoryReady = true;

  const lastSoldIdx = _buildLastSoldIndex();

  let filtered = window._pkItems;
  if (q)  filtered = filtered.filter(i =>
    (i.name || '').toLowerCase().includes(q) ||
    (i.cat  || '').toLowerCase().includes(q)
  );
  if (cf) filtered = filtered.filter(i => i.cat === cf);
  // Stock-state filter: 'ok' (in stock) · 'low' · 'out' · 'untracked' — each an
  // exact _itemStockState() match. 'all' = no stock filter. Visible to all roles.
  if (_stockFilter !== 'all') filtered = filtered.filter(i => _itemStockState(i) === _stockFilter);
  // Bundle 3 (Stage 6): owner/admin "needs cost" filter (cost-blind never sets it).
  if (_needsCostFilter && !costBlindForCurrentRole()) filtered = filtered.filter(itemNeedsCost);
  // v1.0 stock-tracking: owner/admin "needs stock setup" filter.
  if (_needsStockFilter && !costBlindForCurrentRole()) filtered = filtered.filter(itemNeedsStock);

  filtered = _invSortFiltered(filtered, lastSoldIdx);

  const total = filtered.length;
  const pages = Math.ceil(total / ITEMS_PER_PAGE) || 1;
  if (window._inventoryPage >= pages) window._inventoryPage = 0;
  const start = window._inventoryPage * ITEMS_PER_PAGE;
  const paged = filtered.slice(start, start + ITEMS_PER_PAGE);

  // Legacy hidden count node (kept for older code paths if any)
  const countEl = document.getElementById('listCount');
  if (countEl) countEl.textContent = total + ' item' + (total !== 1 ? 's' : '');

  // Empty states
  if (!filtered.length) {
    if (!window._pkItems.length) {
      list.innerHTML = _renderInventoryEmptyZero();
    } else {
      list.innerHTML = _renderInventoryEmptyFiltered(q);
    }
    return;
  }

  const selMode = !!window._pkInventorySelMode;
  list.classList.toggle('is-select-mode', selMode);

  const cards = paged.map(item => _renderItemCard(item, lastSoldIdx, selMode)).join('');

  const pagination = pages > 1 ? `
    <div class="pk-inv-pager" style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 0 0;">
      <button onclick="window._pkPrevPage()" ${window._inventoryPage === 0 ? 'disabled' : ''} class="pk-inv-btn">‹ Prev</button>
      <span style="font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;">
        Page ${window._inventoryPage + 1} of ${pages} · ${total} items
      </span>
      <button onclick="window._pkNextPage()" ${window._inventoryPage >= pages - 1 ? 'disabled' : ''} class="pk-inv-btn">Next ›</button>
    </div>` : '';

  list.innerHTML = cards + pagination;
}

// ── D.3.5 Per-unit buy / sell / margin for the expand table ──
// Proportional model: cost-per-piece (cpp) derives every unit's buy.
// Prefers legacy item.cartonBuy when present (the cost code already
// treats it as the source of truth), else the per-piece `buy`.
function _itemUnitPrices(item) {
  const ppr = parseFloat(item.piecesPerRow) || 0;
  const ppc = (parseFloat(item.piecesPerCarton)
    || (parseFloat(item.rowsPerCarton) * ppr)) || 0;
  let cpp = 0;
  if (item.cartonBuy && parseFloat(item.cartonBuy) > 0 && ppc > 0) cpp = parseFloat(item.cartonBuy) / ppc;
  else cpp = parseFloat(item.buy) || 0;
  const mk = (buy, sell) => (buy > 0 && sell > 0) ? ((sell - buy) / buy) * 100 : null;
  const pieceSell  = parseFloat(item.sell) || 0;
  const rowSell    = parseFloat(item.rowSell) || 0;
  const cartonSell = parseFloat(item.cartonSell) || 0;
  return {
    ppc, ppr,
    pcs: { buy: cpp,                sell: pieceSell,  margin: mk(cpp, pieceSell),            configured: pieceSell  > 0 },
    row: { buy: ppr > 0 ? cpp * ppr : 0, sell: rowSell,    margin: mk(cpp * ppr, rowSell),    configured: rowSell    > 0 && ppr > 0 },
    ctn: { buy: ppc > 0 ? cpp * ppc : 0, sell: cartonSell, margin: mk(cpp * ppc, cartonSell), configured: cartonSell > 0 && ppc > 0 },
  };
}

const _N = '<span class="currency">₦</span>';
// Margin cell — tagged pk-inv-cost-only so Privacy mode removes the whole
// Margin column (header + cells collapse), matching the Trade-table pattern.
function _marginCell(m) {
  if (m == null) return '<td class="num dash pk-inv-cost-only">—</td>';
  const cls = m >= 0 ? 'margin-pos' : 'margin-neg';
  return `<td class="num pk-inv-cost-only"><span class="${cls}">${m >= 0 ? '+' : ''}${m.toFixed(1)}%</span></td>`;
}
function _unitHint(hint, isDef) {
  return hint ? ` <span class="pk-inv-qhint${isDef ? ' gold' : ''}">(${hint})</span>` : '';
}
// Owner/admin: full Buy + Sell + Margin table. Buy + Margin columns carry
// pk-inv-cost-only → Privacy mode hides them entirely (no dots/masking),
// leaving Unit + Sell. Manager/cashier never get this table (DOM-removed).
function _priceTableFull(up, defMode) {
  const row = (key, label, hint, isDef) => {
    const u = up[key];
    const unitCell = `<td class="unit">${label}${_unitHint(hint, isDef)}</td>`;
    if (!u.configured) {
      return `<tr${isDef ? ' class="default-row"' : ''}>${unitCell}<td class="num dash pk-inv-cost-only">—</td><td class="num dash">not set</td><td class="num dash pk-inv-cost-only">—</td></tr>`;
    }
    // Legacy items can have a sell but no buy on record → dash the buy cell.
    const buyCell = u.buy > 0
      ? `<td class="num buy-col pk-inv-cost-only">${_N}${_fmtMoneyNoPrefix(u.buy)}</td>`
      : `<td class="num dash pk-inv-cost-only">—</td>`;
    return `<tr${isDef ? ' class="default-row"' : ''}>${unitCell}`
      + buyCell
      + `<td class="num sell-col">${_N}${_fmtMoneyNoPrefix(u.sell)}</td>`
      + _marginCell(u.margin) + `</tr>`;
  };
  return `<table class="pk-inv-ptable"><thead><tr><th>Unit</th><th class="num pk-inv-cost-only">Buy</th><th class="num">Sell</th><th class="num pk-inv-cost-only">Margin</th></tr></thead><tbody>`
    + row('pcs', 'PCS', '', defMode === 'piece')
    + row('row', 'ROW', up.ppr ? `${up.ppr} pcs` : '', defMode === 'row')
    + row('ctn', 'CTN', up.ppc ? `${up.ppc} pcs` : '', defMode === 'carton')
    + `</tbody></table>`;
}
// Manager/cashier: Sell-only. Buy + margin columns are NEVER emitted
// into the DOM (security: not just CSS-hidden — actually absent).
function _priceTableSellOnly(up, defMode) {
  const row = (key, label, hint, isDef) => {
    const u = up[key];
    const unitCell = `<td class="unit">${label}${_unitHint(hint, isDef)}</td>`;
    if (!u.configured) return `<tr${isDef ? ' class="default-row"' : ''}>${unitCell}<td class="num dash">not set</td></tr>`;
    return `<tr${isDef ? ' class="default-row"' : ''}>${unitCell}<td class="num sellonly">${_N}${_fmtMoneyNoPrefix(u.sell)}</td></tr>`;
  };
  return `<table class="pk-inv-ptable"><thead><tr><th>Unit</th><th class="num">Sell price</th></tr></thead><tbody>`
    + row('pcs', 'PCS', '', defMode === 'piece')
    + row('row', 'ROW', up.ppr ? `${up.ppr} pcs` : '', defMode === 'row')
    + row('ctn', 'CTN', up.ppc ? `${up.ppc} pcs` : '', defMode === 'carton')
    + `</tbody></table>`;
}
function _cardActions(id, role) {
  const esc = 'event.stopPropagation();';
  const share = `<button class="pk-inv-cbtn" onclick="${esc}PK.shareItem('${id}')"><span aria-hidden="true">⤴</span> Share${role === 'cashier' ? ' price' : ''}</button>`;
  const edit  = `<button class="pk-inv-cbtn" onclick="${esc}PK.openEdit('${id}')"><span aria-hidden="true">✎</span> Edit</button>`;
  const restk = `<button class="pk-inv-cbtn restock" onclick="${esc}PK.openRestockModal('${id}')"><span aria-hidden="true">⟲</span> Restock</button>`;
  const del   = `<button class="pk-inv-cbtn danger" onclick="${esc}PK.deleteItem('${id}')"><span aria-hidden="true">⌫</span> Delete</button>`;
  // Kebab — quick restock-flag menu (Mark low/out, personal reminder).
  // Same gating as Restock: an operational concern, not a cashier task.
  const more  = `<button class="pk-inv-more" type="button" onclick="${esc}PK.openInvCardPopover(event,'${id}')" aria-label="Item actions">⋯</button>`;
  if (role === 'owner' || role === 'admin') return share + edit + restk + del + more;
  if (role === 'manager') return share + restk + more;
  return share;   // cashier
}
function _permNote(role) {
  if (role === 'manager') return `<div class="pk-inv-permnote">Buy prices and margins are owner-only. Manager can see sell prices and log restocks.</div>`;
  if (role === 'cashier') return `<div class="pk-inv-permnote">Prices shown for reference. To make a sale, use the <b>Trade</b> tab.</div>`;
  return '';
}

// ── Item action popover — quick restock-flag menu (one shared element,
// repositioned per click). Mirrors trade-table.js's openTradeRowPopover.
export function openInvCardPopover(e, id) {
  e?.stopPropagation();
  e?.preventDefault();
  const pop = document.getElementById('pkInvCardPopover');
  if (!pop) return;
  const item = (window._pkItems || []).find(i => i.id === id);
  if (!item) return;

  const items = [];
  if (item.restockFlag !== 'low') {
    items.push(`<button class="pk-inv-pop-item" onclick="PK.invPopoverFire('flag-low','${id}')"><span class="pk-inv-pop-icon">⚠</span><span>Mark low stock</span></button>`);
  }
  if (item.restockFlag !== 'out') {
    items.push(`<button class="pk-inv-pop-item" onclick="PK.invPopoverFire('flag-out','${id}')"><span class="pk-inv-pop-icon">⛔</span><span>Mark out of stock</span></button>`);
  }
  if (item.restockFlag) {
    items.push(`<div class="pk-inv-pop-sep"></div>`);
    items.push(`<button class="pk-inv-pop-item" onclick="PK.invPopoverFire('flag-clear','${id}')"><span class="pk-inv-pop-icon">↺</span><span>Clear flag</span></button>`);
  }
  pop.innerHTML = items.join('');

  // Position next to the click target
  const btn  = e?.currentTarget || e?.target;
  const rect = btn?.getBoundingClientRect?.();
  if (rect) {
    pop.removeAttribute('hidden');
    const popRect = pop.getBoundingClientRect();
    let left = rect.right - popRect.width;
    if (left < 8) left = 8;
    if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - 8 - popRect.width;
    let top = rect.bottom + 6;
    if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - 6;
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

export function invPopoverFire(action, id) {
  const pop = document.getElementById('pkInvCardPopover');
  if (pop) pop.setAttribute('hidden', '');
  if (action === 'flag-low')   return _setRestockFlag(id, 'low');
  if (action === 'flag-out')   return _setRestockFlag(id, 'out');
  if (action === 'flag-clear') return _setRestockFlag(id, null);
}

// Personal restock reminder — deliberately independent of trackStock/
// stockQty/low (see _itemStockState comment). Never read by storefront.js,
// so it's internal-only and never shown to real customers.
async function _setRestockFlag(id, flag) {
  const idx = (window._pkItems || []).findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = window._pkItems[idx];
  const updated = { ...item, restockFlag: flag, updatedTs: Date.now() };
  window._pkItems[idx] = updated;
  saveLocal();
  const auid = activeUid();
  if (auid) {
    try { await saveItem(auid, updated); } catch (e) { console.error('[restock-flag] save failed:', e); }
  }
  renderItems();
  updateSummary();
  toast(
    flag === 'low'  ? `⚠ Flagged low — ${item.name || 'item'}` :
    flag === 'out'  ? `⛔ Flagged out — ${item.name || 'item'}` :
                       `↺ Flag cleared — ${item.name || 'item'}`,
    'ok'
  );
}

// ── Sell-tiers block (always-open card) ──────────────────────
// Sell prices only — never buy or margin, for any role. Piece is the
// base tier (always shown, gold). Row shows ONLY when the item has a
// row unit defined (gold). Carton shows only when configured (white).
// No zero/empty rows — an unconfigured tier is omitted entirely.
function _sellTierRow(label, hint, value, gold) {
  const sub = hint ? ` <span class="pk-inv-tsub">(${hint})</span>` : '';
  const cls = gold ? 'pk-inv-tval--gold' : 'pk-inv-tval--white';
  return `<div class="pk-inv-trow"><span class="pk-inv-tlbl">${label}${sub}</span>`
       + `<span class="pk-inv-tval ${cls}">${_N}${_fmtMoneyNoPrefix(value)}</span></div>`;
}
function _sellTiers(up) {
  let html = _sellTierRow('Sell / Piece', '', up.pcs.sell, true);
  if (up.row.configured) html += _sellTierRow('Sell / Row', up.ppr ? `${up.ppr} pcs` : '', up.row.sell, true);
  if (up.ctn.configured) html += _sellTierRow('Sell / Carton', up.ppc ? `${up.ppc} pcs` : '', up.ctn.sell, false);
  return html;
}

// ── One card · always-open, sell-only tiers (D.3.5) ───────────
// No tap-to-expand: the card renders fully open and tapping it does
// nothing (the action buttons are the only interactive elements). In
// select mode the whole card toggles selection instead. Buy/margin
// never appear on the card for any role — sell prices only.
function _renderItemCard(item, lastSoldIdx, selMode) {
  const role      = getCurrentActor().role;

  const up        = _itemUnitPrices(item);
  const mode      = item.buyUnit || 'carton';
  const modeLabel = mode === 'carton' ? 'Carton' : mode === 'row' ? 'Row' : 'Piece';

  const stockState = _itemStockState(item);
  const stockTxt   = _shortStockChipText(item);
  const stockChip  = item.restockFlag
    ? `<span class="pk-inv-stock pk-inv-stock--${stockState} pk-inv-stock--flagged">${escapeHtml(stockTxt || '')}</span>`
    : item.trackStock
      ? `<span class="pk-inv-stock pk-inv-stock--${stockState}">${escapeHtml(stockTxt || '')}</span>`
      : `<span class="pk-inv-stock pk-inv-stock--untracked">∞ untracked</span>`;

  const catRow = item.cat ? `<div class="pk-inv-ccat">${escapeHtml(item.cat)}</div>` : '';

  const isSelected = window._pkInventorySelIds?.has(item.id);
  const classes = ['pk-inv-card', stockState === 'out' ? 'is-out' : '', isSelected ? 'is-selected' : '']
    .filter(Boolean).join(' ');

  // Normal mode: tapping the card does nothing. Select mode: the whole
  // card toggles selection. Action buttons call event.stopPropagation()
  // in their inline onclick, so they still fire without toggling.
  const cardOnClick = selMode ? ` onclick="PK.toggleItemSelected(event,'${item.id}')"` : '';

  const tiers   = _sellTiers(up);
  // Bundle 3 (Stage 6): owner/admin see a "NO COST YET" tag + Set cost button
  // on costless items (manager-added, no buy price). Never for cost-blind roles.
  const noCost  = (role === 'owner' || role === 'admin') && itemNeedsCost(item);
  const noCostTag  = noCost ? `<span class="pk-inv-nocost">NO COST YET</span>` : '';
  const setCostBtn = noCost ? `<button class="pk-inv-cbtn pk-inv-cbtn--setcost" onclick="event.stopPropagation();PK.openEdit('${item.id}')"><span aria-hidden="true">＋</span> Set cost</button>` : '';
  // v1.0 stock-tracking: owner/admin see a "NO STOCK SET" tag + Set stock
  // button on tracked items whose stock was never set (stockQty null).
  // Same gating + visual family as the needs-cost tag. Never for cost-blind.
  const noStock = (role === 'owner' || role === 'admin') && itemNeedsStock(item);
  const noStockTag  = noStock ? `<span class="pk-inv-nocost">NO STOCK SET</span>` : '';
  const setStockBtn = noStock ? `<button class="pk-inv-cbtn pk-inv-cbtn--setcost" onclick="event.stopPropagation();PK.openSetStock('${item.id}')"><span aria-hidden="true">▤</span> Set stock</button>` : '';
  const actions = setCostBtn + setStockBtn + _cardActions(item.id, role);
  const stockEditor = (noStock && _setStockItemId === item.id) ? _renderSetStockEditor(item) : '';

  return `
    <div class="${classes}" data-id="${escapeHtml(item.id || '')}"${cardOnClick}>
      <span class="pk-inv-checkbox" aria-hidden="true"></span>
      <div class="pk-inv-chead">
        <div class="pk-inv-chead-info">
          ${noCostTag}${noStockTag}<span class="pk-inv-cname">${escapeHtml(item.name || '')}</span>
          ${catRow}
        </div>
        ${stockChip}
      </div>
      <span class="pk-inv-cunit"><span class="pk-inv-cunit-dot" aria-hidden="true"></span>${modeLabel}</span>
      <div class="pk-inv-cdiv"></div>
      <div class="pk-inv-tiers">${tiers}</div>
      <div class="pk-inv-cdiv"></div>
      <div class="pk-inv-cactions">${actions}</div>
      ${stockEditor}
    </div>`;
}

// ── v1.0 stock-tracking: inline Set-stock editor (one open at a time) ──
// Renders inside the item card. Unit defaults to the item's buy unit;
// warn-below auto-fills to 10% of stock (rounded, min 1) until the user
// edits it manually (clearing the field re-arms auto). Markup only —
// styles live in css/inventory-d33.css per project convention.
function _renderSetStockEditor(item) {
  const unit = (item.buyUnit === 'row' || item.buyUnit === 'piece') ? item.buyUnit : 'carton';
  const opt  = u => `<option value="${u}"${u === unit ? ' selected' : ''}>${u.charAt(0).toUpperCase() + u.slice(1)}s</option>`;
  return `
    <div class="pk-ss-editor" onclick="event.stopPropagation()">
      <div class="pk-ss-field">
        <label class="pk-ss-lbl">Current stock</label>
        <input type="number" id="ssQty" min="0" inputmode="decimal" placeholder="e.g. 22" oninput="PK.ssQtyInput()">
      </div>
      <div class="pk-ss-field pk-ss-field--unit">
        <label class="pk-ss-lbl">Unit</label>
        <select id="ssUnit">${opt('carton')}${opt('row')}${opt('piece')}</select>
      </div>
      <div class="pk-ss-field">
        <label class="pk-ss-lbl">Warn me below</label>
        <input type="number" id="ssWarn" min="1" inputmode="numeric" oninput="PK.ssWarnInput()">
        <div class="pk-ss-hint" id="ssWarnHint"><span class="pk-ss-auto">Auto</span> · 10% of stock</div>
      </div>
      <div class="pk-ss-actions">
        <button class="pk-ss-save" type="button" onclick="PK.saveSetStock('${item.id}')">Save</button>
        <button class="pk-ss-cancel" type="button" onclick="PK.cancelSetStock()">Cancel</button>
      </div>
    </div>`;
}

// Money formatter that returns just the digits (the ₦ is rendered
// outside so it can use the Noto Sans glyph fallback).
function _fmtMoneyNoPrefix(n) {
  return Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

function _renderInventorySkeleton() {
  const card = (titleW, metaW, rows) => `
    <div class="pk-inv-skel">
      <div class="pk-inv-skel-line pk-inv-skel-title" style="width:${titleW}%;"></div>
      <div class="pk-inv-skel-line pk-inv-skel-meta"  style="width:${metaW}%;"></div>
      ${rows.map(w => `<div class="pk-inv-skel-line pk-inv-skel-row" style="width:${w}%;"></div>`).join('')}
      <div class="pk-inv-skel-line pk-inv-skel-actions"></div>
    </div>`;
  return [
    card(60, 40, [70, 55, 80]),
    card(75, 32, [60, 50]),
    card(50, 28, [75, 65, 78]),
    card(65, 38, [55]),
    card(55, 30, [70, 58]),
    card(70, 35, [62, 80]),
  ].join('');
}

function _renderInventoryEmptyZero() {
  return `
    <div class="pk-inv-empty">
      <div class="pk-inv-empty-icon" aria-hidden="true">🛒</div>
      <div class="pk-inv-empty-title">No items yet</div>
      <div class="pk-inv-empty-sub">Add your first item to start tracking stock and sales.</div>
      <button class="pk-inv-empty-cta" onclick="window.openAddItemDrawer()">＋ Add Item</button>
    </div>`;
}

function _renderInventoryEmptyFiltered(q) {
  const term = q ? `"${escapeHtml(q)}"` : 'your current filters';
  return `
    <div class="pk-inv-empty">
      <div class="pk-inv-empty-icon" aria-hidden="true">⌕</div>
      <div class="pk-inv-empty-title">No items match ${term}</div>
      <div class="pk-inv-empty-sub">Try a different search term, or clear filters to see all items.</div>
      <button class="pk-inv-empty-cta" onclick="PK.clearInventoryFilters()">Clear search</button>
    </div>`;
}

// Reflect the catFilter <select> state on the chip
function _refreshCatChip() {
  const sel = document.getElementById('catFilter');
  const chip = document.getElementById('pkInvCatChip');
  const lbl = document.getElementById('pkInvCatLabel');
  const allChip = document.getElementById('pkInvAllChip');
  if (!chip || !lbl) return;
  const v = sel ? sel.value : '';
  if (v) {
    chip.classList.add('active');
    lbl.textContent = v;
    allChip?.classList.remove('active');
  } else {
    chip.classList.remove('active');
    lbl.textContent = 'Category';
    // "All" is active only when no category + no search (best-effort UX)
    const q = document.getElementById('searchInput')?.value || '';
    if (!q) allChip?.classList.add('active'); else allChip?.classList.remove('active');
  }
}

function _refreshSelectToolbarUI() {
  const tog = document.getElementById('pkInvSelectToggle');
  const bar = document.getElementById('pkInvBulkBar');
  const cnt = document.getElementById('pkInvBulkCount');
  const grid = document.getElementById('itemsList');
  const on = !!window._pkInventorySelMode;
  if (tog) tog.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (grid) grid.classList.toggle('is-select-mode', on);
  const sz = window._pkInventorySelIds?.size || 0;
  if (cnt) cnt.textContent = sz;
  if (bar) {
    if (on && sz > 0) bar.removeAttribute('hidden');
    else bar.setAttribute('hidden', '');
  }
}

window._pkNextPage = function() {
  window._inventoryPage++;
  if (window.__PK?.renderItems) window.__PK.renderItems();
  else if (typeof renderItems === 'function') renderItems();
  document.getElementById('itemsList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window._pkPrevPage = function() {
  window._inventoryPage = Math.max(0, window._inventoryPage - 1);
  if (window.__PK?.renderItems) window.__PK.renderItems();
  else if (typeof renderItems === 'function') renderItems();
  document.getElementById('itemsList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ── updateSummary — RESTORED sumMonthRevenue + sumMonthProfit ─────────────────
// Voided trades excluded. Date parsing handles both string dates and timestamps.
export function updateSummary() {
  const items = window._pkItems || [];
  const set   = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sumItems', items.length);
  set('sumLow',   items.filter(i => i.low).length);

  const now_  = new Date();
  const month = now_.getMonth();
  const year  = now_.getFullYear();

  const monthSales = (window._pkSales || []).filter(s => {
    if (s.voided) return false;
    // Handle both "2025-01-15" date strings and numeric timestamps
    const d = s.date
      ? new Date(s.date + 'T00:00:00')   // force local midnight parse
      : (s.createdTs ? new Date(s.createdTs) : null);
    if (!d || isNaN(d)) return false;
    return d.getMonth() === month && d.getFullYear() === year;
  });

  const monthRevenue = monthSales.reduce((a, s) => a + (s.totalRevenue ?? s.revenue ?? 0), 0);
  const monthProfit  = monthSales.reduce((a, s) => a + (s.totalProfit  ?? s.profit  ?? 0), 0);

  set('sumMonthRevenue', fmt(monthRevenue));
  set('sumMonthProfit',  fmt(monthProfit));

  // Keep the D.3.3 inventory header counts in sync after any state change.
  try { updateInventoryHeader(); } catch (_) {}
}

export function shareItem(id) {
  const item=(window._pkItems||[]).find(i=>i.id===id);
  if(!item) return;
  const ppc=(item.rowsPerCarton&&item.piecesPerRow)?parseFloat(item.rowsPerCarton)*parseFloat(item.piecesPerRow):null;
  const text=[`📦 ${item.name}`,`🏷 Sell price: ${fmt(item.sell)} / piece`,
    item.rowSell?`↔️ Row${ppc?' ('+item.piecesPerRow+' pcs)':''}: ${fmt(item.rowSell)}`:'',
    item.cartonSell?`📦 Carton${ppc?' ('+ppc+' pcs)':''}: ${fmt(item.cartonSell)}`:'',
    item.qty?`📊 Stock: ${item.qty}`:'', item.note?`📌 ${item.note}`:'', `— via PriceKeeper`
  ].filter(Boolean).join('\n');
  if(navigator.share) navigator.share({title:item.name,text});
  else navigator.clipboard.writeText(text).then(()=>toast('📋 Copied!','ok'));
}
export function openEdit(id) {
  window.openAddItemDrawer(true);
  const drawerTitle = document.getElementById('drawerTitle');
  const drawerBtn   = document.getElementById('drawerSaveBtn');

  const item = (window._pkItems || []).find(i => i.id === id);
  if (!item) return;

  // Open accordion if closed
  const acc = document.getElementById('addAccordion');
  if (acc && !acc.classList.contains('open')) acc.classList.add('open');

  // Scroll to form
  acc?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Set edit mode
  window._pkEditingId = id;

  // Set buy unit mode
  const buyUnit = item.buyUnit || 'carton';
  const radio = document.querySelector(`input[name="buyUnit"][value="${buyUnit}"]`);
  if (radio) radio.checked = true;
  currentBuyUnit = buyUnit;
  _applyModeVisibility(buyUnit);
  updateActiveRadio();
  updatePreviewLabels();

  // Stock count-unit options follow the buy unit; restore the item's saved unit.
  syncStockUnitOptions();
  if (item.stockUnit) {
    const su = document.getElementById('iStockUnit');
    if (su) {
      if (![...su.options].some(o => o.value === item.stockUnit)) {
        su.insertAdjacentHTML('beforeend', `<option value="${item.stockUnit}">${item.stockUnit}</option>`);
      }
      su.value = item.stockUnit;
    }
  }
  const _tu = document.getElementById('iLowThresholdUnit');
  if (_tu) _tu.value = item.lowThresholdUnit || item.stockUnit || _tu.value;

  // Fill form fields
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ''; };
  set('iName',        item.name);
  set('iBuyPrice',    item.buyPrice || (item.buy * (parseFloat(item.piecesPerCarton) || 1)));
  set('iCartonSell',  item.cartonSell);
  set('iCartonQty',   item.piecesPerCarton);
  set('iRowsPerCarton', item.rowsPerCarton);
  set('iPiecesPerRow',  item.piecesPerRow);
  set('iPiecesPerRowRowMode', item.piecesPerRow);
  set('iRowSell',     item.rowSell);
  set('iSell',        item.sell);
  set('iQty',         item.qty);
  set('iNote',        item.note);
  set('iCat',         item.cat);
  set('iBarcode',     item.barcode);

  const lowEl = document.getElementById('iLow');
  if (lowEl) lowEl.checked = !!item.low;

  // Stock tracking fields
  const trackEl = document.getElementById('iTrackStock');
  if (trackEl) trackEl.checked = !!item.trackStock;
  const sqWrap = document.getElementById('stockQtyFields');
  if (sqWrap) sqWrap.style.display = item.trackStock ? '' : 'none';
  set('iStockQty',     item.stockQty ?? '');
  set('iLowThreshold', item.lowThreshold ?? '');

  // Show edit banner
  let banner = document.getElementById('editModeBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'editModeBanner';
    const accordionBody = document.querySelector('#addAccordion .accordion-body');
    if (accordionBody) accordionBody.insertBefore(banner, accordionBody.firstChild);
  }
  banner.innerHTML = `
    <div style="background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);
                border-radius:9px;padding:10px 14px;margin-bottom:14px;
                display:flex;align-items:center;justify-content:space-between;">
      <span style="font-family:var(--fh);font-weight:700;font-size:.78rem;color:var(--accent);">
        ✏️ Editing: ${item.name}
      </span>
      <button onclick="PK.cancelEdit()"
        style="background:none;border:1px solid var(--border2);border-radius:6px;
               padding:4px 12px;font-family:var(--fh);font-weight:700;font-size:.75rem;
               color:var(--muted);cursor:pointer;">
        Cancel Edit
      </button>
    </div>`;
  banner.style.display = '';

  // Change button text
  const addBtn = document.querySelector('.btn-add');
  if (addBtn) {
    addBtn.textContent = '✓ Update Item';
    addBtn.style.background = 'var(--accent)';
  }

  // Mark overrides so calcCarton doesn't wipe the saved sell prices
  if (item.sell)    _sellManualOverride = true;
  if (item.rowSell) _rowManualOverride  = true;

  // Recalculate preview
  calcCarton();

  // D.9.2 edit-mode supplier section (default supplier + last paid info)
  populateItemSupplierSection(true, item);
}
export function cancelEdit() {
  window._pkEditingId = null;
  const banner = document.getElementById('editModeBanner');
  if (banner) banner.style.display = 'none';

  const addBtn = document.querySelector('.btn-add');
  if (addBtn) {
    addBtn.textContent = '＋ Save to Inventory';
    addBtn.style.background = '';
  }

  clearAddForm();
}

export async function saveEdit() {
  if (!assertPermission('editItem')) return;
  const btn =document.querySelector('#editOverlay .btn-save');
  const id  =document.getElementById('eId')?.value;
  let   buy =parseFloat(document.getElementById('eBuy')?.value);
  const sell=parseFloat(document.getElementById('eSell')?.value);
  if(!sell) return toast('⚠️ Enter valid Sell price','err');
  const idx=(window._pkItems||[]).findIndex(i=>i.id===id);
  if(idx<0) return;
  setBtnLoading(btn,true);
  try{
    const old=window._pkItems[idx];
    const cBuy=parseFloat(document.getElementById('eCartonBuy')?.value)||0;
    if(cBuy) buy=cBuy/(parseFloat(old.piecesPerCarton)||1);
    const hist=old.history||[]; hist.unshift({buy:old.buy,sell:old.sell,date:old.updatedAt});
    if(hist.length>5) hist.pop();
    // Fossil-cartonBuy fix: this legacy overlay used to stamp a raw `cartonBuy`
    // string, which the sale cost resolver then trusted over the real price.
    // Never write cartonBuy again. Keep buyPrice (the source of truth) in sync
    // from the edited per-piece buy + the item's buyUnit so cost stays correct.
    const _buE=old.buyUnit||'carton';
    const _ppcE=parseFloat(old.piecesPerCarton)||1;
    const _pprE=parseFloat(old.piecesPerRow)||1;
    const buyPrice=_buE==='carton'?buy*_ppcE:_buE==='row'?buy*_pprE:buy;
    const updated={...old,buy,sell,buyPrice,
      qty:document.getElementById('eQty')?.value||'',
      cartonSell:document.getElementById('eCartonSell')?.value||'',
      rowsPerCarton:document.getElementById('eRowsPerCarton')?.value||'',
      piecesPerRow:document.getElementById('ePiecesPerRow')?.value||'',
      note:document.getElementById('eNote')?.value.trim()||'',
      low:document.getElementById('eLow')?.checked||false,
      updatedAt:now(),updatedTs:Date.now(),history:hist};
    window._pkItems[idx]=updated;const _uid1 = activeUid(); if(_uid1) await saveItem(_uid1, updated);
      logActivity('EDIT_ITEM', { itemName: updated.name });  saveLocal();renderItems();updateSummary();closeModal('editOverlay');toast('✅ Updated!','ok');window.__pkRepublishStorefront?.();
  } finally{setBtnLoading(btn,false);}
}

export async function deleteItem(id) {
  if (!assertPermission('deleteItem')) return;
  const item=(window._pkItems||[]).find(i=>i.id===id);
  if(!item||!(await askConfirm('Delete "'+item.name+'"?'))) return;
  window._pkItems=window._pkItems.filter(i=>i.id!==id);  const _uid5 = activeUid();
  if(_uid5){ await removeItem(_uid5, id); await addTombstone(_uid5, id); }
  logActivity('DELETE_ITEM', { itemId: id });  saveLocal();renderItems();updateSummary();toast('🗑 Deleted','ok');window.__pkRepublishStorefront?.();
}

document.addEventListener('DOMContentLoaded',()=>{ 
  updateActiveRadio(); updatePreviewLabels(); _applyModeVisibility('carton');
 const name = localStorage.getItem('pkAppName') || 'PriceKeeper';
  document.querySelectorAll('.app-name-label').forEach(el => el.textContent = name);
  document.title = name;
 });

 window.shareWhatsAppPriceList = function() {
  const appName = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const items   = window._pkItems || [];
  if (!items.length) return toast('⚠️ No items to share', 'err');

  const q  = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const cf = document.getElementById('catFilter')?.value || '';

  let filtered = items;
  if (q)  filtered = filtered.filter(i => (i.name||'').toLowerCase().includes(q));
  if (cf) filtered = filtered.filter(i => i.cat === cf);

  // Group by category
  const grouped = {};
  filtered.forEach(item => {
    const cat = item.cat || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  let text = `*${appName} Price List*\n`;
  text += `_${new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}_\n\n`;

  Object.entries(grouped).forEach(([cat, catItems]) => {
    text += `*${cat.toUpperCase()}*\n`;
    catItems.forEach(item => {
      text += `• ${item.name}`;
      if (item.sell)       text += ` — ₦${Number(item.sell).toLocaleString('en-NG', { maximumFractionDigits: 0 })}/pc`;
      if (item.rowSell)    text += ` · ₦${Number(item.rowSell).toLocaleString('en-NG', { maximumFractionDigits: 0 })}/row`;
      if (item.cartonSell) text += ` · ₦${Number(item.cartonSell).toLocaleString('en-NG', { maximumFractionDigits: 0 })}/ctn`;
      text += '\n';
    });
    text += '\n';
  });

  text += `_Prices valid today. Contact us to order._`;

  const encoded = encodeURIComponent(text);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
};

// ── Phase 2: toggle "Track Stock" show/hide qty+threshold fields ──────────────
export function onTrackStockToggle() {
  // Populate unit options based on current buy unit config
  const buyUnit = document.querySelector('input[name="buyUnit"]:checked')?.value || 'carton';
  const hasPpr  = parseFloat(document.getElementById('iPiecesPerRow')?.value || document.getElementById('iPiecesPerRowRowMode')?.value) > 0;
  const hasPpc  = parseFloat(document.getElementById('iCartonQty')?.value) > 0 ||
                  (parseFloat(document.getElementById('iRowsPerCarton')?.value) > 0 && hasPpr);
  ['iStockUnit','iLowThresholdUnit'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    if (hasPpc || buyUnit === 'carton') sel.innerHTML += '<option value="carton">Cartons</option>';
    if (hasPpr || buyUnit === 'row')    sel.innerHTML += '<option value="row">Rows</option>';
    sel.innerHTML += '<option value="piece">Pieces</option>';
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  });

  const checked = document.getElementById('iTrackStock')?.checked;
  const wrap    = document.getElementById('stockQtyFields');
  if (wrap) wrap.style.display = checked ? '' : 'none';
}

// ── Stock-state filter chips (In stock · Low · Out · Untracked) ───────────────
// Single-select. Clicking the active chip clears back to All. Selecting a stock
// state clears the owner-only needs-cost/needs-stock filters (different dimension,
// kept mutually exclusive for predictable counts — mirrors how those two already
// clear each other).
export function setStockFilter(state) {
  const valid = ['ok', 'low', 'out', 'untracked'];
  if (!valid.includes(state)) state = 'all';
  _stockFilter = (_stockFilter === state) ? 'all' : state;
  if (_stockFilter !== 'all') { _needsCostFilter = false; _needsStockFilter = false; }
  window._inventoryPage = 0;
  renderItems();
}

// Back-compat alias for any stray caller of the old cycling button handler.
export function toggleLowStockFilter() { setStockFilter('low'); }

window._pkJumpToLowStock = function() {
  const { lowCount, outCount } = getStockSummary();
  if (typeof window.switchTab === 'function') {
    window.switchTab('inventory');
  } else {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-inventory')?.classList.add('active');
  }
  if (lowCount + outCount > 0) {
    // Jump lands on LOW when any exist, else OUT.
    _stockFilter = lowCount > 0 ? 'low' : 'out';
    _needsCostFilter = false;
    _needsStockFilter = false;
    window._inventoryPage = 0;
    setTimeout(() => renderItems(), 0);
  }
};

// Count items per stock state in one pass, then sync the chip counts + active
// states. Counts are global (whole shop), independent of the category/search box.
function _refreshStockChips() {
  const items = window._pkItems || [];
  let ok = 0, low = 0, out = 0, untracked = 0;
  for (const it of items) {
    switch (_itemStockState(it)) {
      case 'ok':        ok++; break;
      case 'low':       low++; break;
      case 'out':       out++; break;
      case 'untracked': untracked++; break;
    }
  }
  const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n.toLocaleString('en-NG'); };
  setCount('pkInvInStockCount', ok);
  setCount('pkInvLowCount', low);
  setCount('pkInvOutCount', out);
  setCount('pkInvUntrackedCount', untracked);

  const setActive = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('active', on); };
  setActive('pkInvInStockChip',   _stockFilter === 'ok');
  setActive('pkInvLowChip',       _stockFilter === 'low');
  setActive('pkInvOutChip',       _stockFilter === 'out');
  setActive('pkInvUntrackedChip', _stockFilter === 'untracked');

  // "All" is active only when nothing is filtering: no stock state, no attention
  // filters, no category, no search. (Overrides _refreshCatChip's best-effort set.)
  const cat = document.getElementById('catFilter')?.value || '';
  const q   = document.getElementById('searchInput')?.value || '';
  const allClear = _stockFilter === 'all' && !_needsCostFilter && !_needsStockFilter && !cat && !q;
  setActive('pkInvAllChip', allClear);
}

// ── Phase 2: WhatsApp restock / shopping list ─────────────────────────────────
window.shareWhatsAppRestockList = function() {
  const appName = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const items   = window._pkItems || [];
  const lowItems = items.filter(i => i.low);
  if (!lowItems.length) {
    import('./utils.js').then(m => m.toast('✅ No low-stock items — you\'re fully stocked!', 'ok'));
    return;
  }

  // Group by category
  const grouped = {};
  lowItems.forEach(item => {
    const cat = item.cat || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  let text = `*${appName} — Restock List 🛒*\n`;
  text += `_${new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}_\n\n`;

  Object.entries(grouped).forEach(([cat, catItems]) => {
    text += `*${cat.toUpperCase()}*\n`;
    catItems.forEach(item => {
      text += `• ${item.name}`;
      if (item.trackStock && item.stockQty != null) text += ` (${item.stockQty} left`;
      if (item.trackStock && item.lowThreshold != null) text += `, restock at ${item.lowThreshold})`;
      else if (item.trackStock && item.stockQty != null) text += ')';
      text += '\n';
    });
    text += '\n';
  });

  text += `_${lowItems.length} item${lowItems.length !== 1 ? 's' : ''} need restocking._`;

  const encoded = encodeURIComponent(text);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
};

// ────────────────────────────────────────────────────────────
// D.3.3 — Select mode, bulk actions, filter clear, privacy
// ────────────────────────────────────────────────────────────

export function clearInventoryFilters() {
  const s = document.getElementById('searchInput');
  if (s) s.value = '';
  const c = document.getElementById('catFilter');
  if (c) c.value = '';
  _stockFilter = 'all';
  _needsCostFilter = false;
  _needsStockFilter = false;
  _setStockItemId = null;
  window._inventoryPage = 0;
  renderItems();
}

// ── Bundle 3 · Stage 6: needs-cost review + filter (owner/admin only) ──
// Opened from the Dashboard amber alert card. Switches to Inventory → Items and
// filters to costless items. Cost-blind roles never reach this (no card/chip).
export function reviewNeedsCost() {
  _needsCostFilter = true;
  _needsStockFilter = false;   // the two attention filters are mutually exclusive
  _stockFilter = 'all';
  const s = document.getElementById('searchInput');     if (s) s.value = '';
  const c = document.getElementById('catFilter');       if (c) c.value = '';
  window._inventoryPage = 0;
  if (typeof window.switchTab === 'function') window.switchTab('inventory');
  try { switchInvSubtab('items'); } catch (_) {}
  renderItems();
}

// Toolbar chip toggle (owner/admin). Turning it off returns to the full list.
export function toggleNeedsCostFilter() {
  _needsCostFilter = !_needsCostFilter;
  if (_needsCostFilter) _needsStockFilter = false;
  window._inventoryPage = 0;
  renderItems();
}

// ── v1.0 stock-tracking: needs-stock review + filter (owner/admin only) ──
// Line 1 of the Dashboard attention card. Mirrors reviewNeedsCost exactly:
// switches to Inventory → Items filtered to tracked items with stock unset.
export function reviewNeedsStock() {
  _needsStockFilter = true;
  _needsCostFilter = false;
  _stockFilter = 'all';
  const s = document.getElementById('searchInput');     if (s) s.value = '';
  const c = document.getElementById('catFilter');       if (c) c.value = '';
  window._inventoryPage = 0;
  if (typeof window.switchTab === 'function') window.switchTab('inventory');
  try { switchInvSubtab('items'); } catch (_) {}
  renderItems();
}

export function toggleNeedsStockFilter() {
  _needsStockFilter = !_needsStockFilter;
  if (_needsStockFilter) _needsCostFilter = false;
  window._inventoryPage = 0;
  renderItems();
}

// "Needs stock · N" chip — mirror of _refreshNeedsCostChip.
function _refreshNeedsStockChip() {
  const chip = document.getElementById('pkNeedsStockChip');
  if (!chip) return;
  const role  = getCurrentActor().role;
  const owner = role === 'owner' || role === 'admin';
  const n = owner ? (window._pkItems || []).filter(itemNeedsStock).length : 0;
  if (!owner || n === 0) {
    chip.style.display = 'none';
    _needsStockFilter = false;
    return;
  }
  chip.style.display = '';
  chip.classList.toggle('active', _needsStockFilter);
  const c = document.getElementById('pkNeedsStockChipCount');
  if (c) c.textContent = n;
}

// ── v1.0 stock-tracking: inline Set-stock editor handlers ──
export function openSetStock(id) {
  _setStockItemId = id;
  _ssWarnManual = false;
  renderItems();
  setTimeout(() => document.getElementById('ssQty')?.focus(), 0);
}

export function cancelSetStock() {
  _setStockItemId = null;
  renderItems();
}

// Warn-below auto = 10% of stock (rounded, min 1), live until the user edits
// the warn field manually; clearing the warn field re-arms auto.
export function ssQtyInput() {
  if (_ssWarnManual) return;
  const q = parseFloat(document.getElementById('ssQty')?.value) || 0;
  const w = document.getElementById('ssWarn');
  if (w) w.value = Math.max(1, Math.round(q * 0.1));
}

export function ssWarnInput() {
  const w = document.getElementById('ssWarn');
  const hint = document.getElementById('ssWarnHint');
  if (!w) return;
  if ((w.value ?? '').trim() === '') {
    _ssWarnManual = false;
    ssQtyInput();
    if (hint) hint.innerHTML = '<span class="pk-ss-auto">Auto</span> · 10% of stock';
    return;
  }
  _ssWarnManual = true;
  if (hint) hint.innerHTML = '<span class="pk-ss-manual">Manual</span> · clear to go back to auto';
}

export async function saveSetStock(id) {
  const idx = (window._pkItems || []).findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = window._pkItems[idx];

  const raw = (document.getElementById('ssQty')?.value ?? '').trim();
  if (raw === '') return toast('⚠️ Enter the current stock count (0 if none on hand)', 'err');
  const qty  = Math.max(0, parseFloat(raw) || 0);   // explicit 0 = sold out, allowed
  const unit = document.getElementById('ssUnit')?.value || item.buyUnit || 'carton';
  const wRaw = (document.getElementById('ssWarn')?.value ?? '').trim();
  const warn = wRaw === '' ? Math.max(1, Math.round(qty * lowStockPct() / 100)) : Math.max(1, parseFloat(wRaw) || 1);

  // Piece conversions — same derivation the add path uses (_toPcs2).
  const ppc = parseFloat(item.piecesPerCarton)
           || ((parseFloat(item.rowsPerCarton) || 0) * (parseFloat(item.piecesPerRow) || 0)) || 1;
  const ppr = parseFloat(item.piecesPerRow) || 1;
  const toPcs = (v, u) => u === 'carton' ? v * ppc : u === 'row' ? v * ppr : v;
  const stockQtyPcs     = toPcs(qty, unit);
  const lowThresholdPcs = toPcs(warn, unit);

  const updated = {
    ...item,
    trackStock: true,
    stockQty: qty, stockUnit: unit, stockQtyPcs,
    lowThreshold: warn, lowThresholdUnit: unit, lowThresholdPcs,
    low: stockQtyPcs <= lowThresholdPcs,
    updatedTs: Date.now(),
  };

  window._pkItems[idx] = updated;
  saveLocal();
  _setStockItemId = null;
  const auid = activeUid();
  if (auid) {
    // saveItem rides the write gateway (queues offline) and toasts on real failure.
    try { await saveItem(auid, updated); } catch (e) { console.error('[set-stock] save failed:', e); }
  }
  renderItems();
  updateSummary();
  toast(`✓ Stock set — ${item.name || 'item'}`, 'ok');   // toast renders via textContent — no escaping
}

// Show the "Needs cost · N" chip only for owner/admin when costless items
// exist, and reflect the active filter state. Called early from renderItems.
// If the count hits 0 (all backfilled), clear the filter so the list reopens.
function _refreshNeedsCostChip() {
  const chip = document.getElementById('pkNeedsCostChip');
  if (!chip) return;
  const role  = getCurrentActor().role;
  const owner = role === 'owner' || role === 'admin';
  const n = owner ? (window._pkItems || []).filter(itemNeedsCost).length : 0;
  if (!owner || n === 0) {
    chip.style.display = 'none';
    _needsCostFilter = false;
    return;
  }
  chip.style.display = '';
  chip.classList.toggle('active', _needsCostFilter);
  const c = document.getElementById('pkNeedsCostChipCount');
  if (c) c.textContent = n;
}

// ────────────────────────────────────────────────────────────
// D.9.1 — Inventory sub-tabs (Items | Suppliers) + role gating
// ────────────────────────────────────────────────────────────

// D.3.5 inner-help one-liners per supplier view.
const _SUP_HELP = {
  directory: 'Your stores · click any supplier to see all prices from them',
  prices:    'Cheapest source per item · log restocks to populate this',
  shopping:  "Pick items to restock · we'll split your list by cheapest store",
};

// Suppliers context-header meta (count + quotes). Cheap; called on
// switch-in and from the suppliers-view render hook.
function _updateSupplierMeta() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('invSupCountMeta',  (window._pkSuppliers || []).length);
  set('invSupQuotesMeta', (window._pkSupplierPrices || []).length);
}

// Hook called by suppliers-view.js renderActiveSupView() after it sets
// its active view — keeps the inner-help line + meta in sync with the
// active inner tab (incl. programmatic switches like Build shopping list).
window._pkOnSupViewRender = function(view) {
  const help = document.getElementById('invInnerHelp');
  if (help && _SUP_HELP[view]) help.textContent = _SUP_HELP[view];
  _updateSupplierMeta();
};

// D.3.5: drive the segmented switcher (Items | Suppliers) + the two
// context headers. Replaces the old underline subtabs.
export function switchInvSubtab(which) {
  const items = document.getElementById('invSubItems');
  const sups  = document.getElementById('invSubSuppliers');
  const segI  = document.getElementById('invSegItems');
  const segS  = document.getElementById('invSegSuppliers');
  const mS    = document.getElementById('invMetricsSuppliers');
  const actI  = document.getElementById('invActionsItems');
  const isSup = which === 'suppliers' && !!segS;   // can't switch to a removed (cashier) tab
  if (items) items.hidden = isSup;
  if (sups)  sups.hidden  = !isSup;
  // Items tab has no metric strip; only the Suppliers strip toggles.
  if (mS)    mS.hidden    = !isSup;
  if (actI)  actI.hidden  = isSup;   // Items-only actions; Suppliers actions live in-body
  if (segI)  { segI.classList.toggle('active', !isSup); segI.setAttribute('aria-selected', String(!isSup)); }
  if (segS)  { segS.classList.toggle('active',  isSup); segS.setAttribute('aria-selected', String(isSup)); }
  // D.9.3: render the Suppliers views once the panel is visible — it
  // renders nothing while hidden. _pkOnSupViewRender updates meta+help.
  if (isSup) { try { _updateSupplierMeta(); } catch (_) {} try { renderActiveSupView(); } catch (_) {} }
  // Push hash: items is a leaf; suppliers hash is set by switchSupView.
  if (!isSup) pushHash('inventory/items');
}

// Cashier: remove the Suppliers switcher pill, its panel, AND its
// context header from the DOM (not just CSS-hidden) and force Items.
// Owner / Admin / Manager: keep them. Per-action gating lives in
// suppliers-view.js + supplier-modal.js. Safe to call repeatedly.
export function applySupplierRoleGating() {
  const role = getCurrentActor().role;
  if (role === 'cashier') {
    document.getElementById('invSegSuppliers')?.remove();
    document.getElementById('invSubSuppliers')?.remove();
    document.getElementById('invMetricsSuppliers')?.remove();
    const items = document.getElementById('invSubItems');
    if (items) items.hidden = false;
  }
}

// ────────────────────────────────────────────────────────────
// D.9.2 — supplier section in the Add / Edit item drawer
// ────────────────────────────────────────────────────────────
let _supSectionState = { editMode: false, item: null };
const _SUP_UNIT_SHORT = { carton: 'ctn', row: 'row', piece: 'pc' };

// Selected supplier id, or '' for none / placeholder / "＋ New supplier".
function _itemSupplierSelectedId() {
  const v = document.getElementById('iSupplier')?.value || '';
  return (v && v !== '__new__') ? v : '';
}

function _supDaysAgo(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

// Mode + populate the drawer's supplier section.
//   editMode=false → Add ("· NEW", optional, buy-price-as-quote hint)
//   editMode=true  → Edit ("DEFAULT SUPPLIER", shows last paid + Restock hint)
// Cashier → remove the section from the DOM entirely (not just hidden).
export function populateItemSupplierSection(editMode, item) {
  const section = document.getElementById('itemSupplierSection');
  if (!section) return;
  if (getCurrentActor().role === 'cashier') { section.remove(); return; }
  _supSectionState = { editMode: !!editMode, item: item || null };

  const eyebrow = document.getElementById('itemSupplierEyebrow');
  const label   = document.getElementById('itemSupplierLabel');
  const info    = document.getElementById('itemSupplierInfo');
  if (eyebrow) eyebrow.textContent = editMode ? '⊞ Default supplier' : '⊞ Where you bought it · New';
  if (label)   label.textContent   = editMode ? 'Currently buying from' : 'Supplier (optional)';

  _refreshItemSupplierOptions(editMode ? (item?.defaultSupplierId || '') : '');

  if (info) {
    if (editMode) {
      const last = item ? getLastRestockInfo(item.id) : null;
      info.innerHTML = last
        ? `Last restock ${_supDaysAgo(last.at)} at <b>${escapeHtml(last.supplierName)}</b> for `
          + `<b style="color:var(--green);"><span class="currency">₦</span>${Number(last.price).toLocaleString('en-NG')}</b>/`
          + `${_SUP_UNIT_SHORT[last.perUnit] || last.perUnit}. To log a price change properly, use the `
          + `<b>Restock</b> button — it has the proper change-detection logic.`
        : `No supplier price logged yet. Use the <b>Restock</b> button to record where you buy this and at what price.`;
    } else {
      info.innerHTML = `Saved as this supplier's quote.`;
    }
  }
}

// The add-mode quote note is only relevant once a supplier is actually
// chosen, so hide it while the dropdown sits on the placeholder. Edit mode
// shows restock-history info that's useful regardless of selection, so it
// stays visible there.
function _updateItemSupplierNote() {
  const info = document.getElementById('itemSupplierInfo');
  if (!info) return;
  if (_supSectionState.editMode) { info.style.display = ''; return; }
  info.style.display = _itemSupplierSelectedId() ? '' : 'none';
}

function _refreshItemSupplierOptions(selectedId) {
  const sel = document.getElementById('iSupplier');
  if (!sel) return;
  const placeholder = _supSectionState.editMode ? '— Select supplier —' : '— Select supplier (optional) —';
  let html = `<option value="">${placeholder}</option>`;
  html += getActiveSuppliers().map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  html += '<option value="__new__">＋ New supplier…</option>';
  sel.innerHTML = html;
  if (selectedId && [...sel.options].some(o => o.value === selectedId)) sel.value = selectedId;
  else sel.value = '';
  _updateItemSupplierNote();   // selection just changed → sync the note's visibility
}

// "＋ New supplier…" picked → open the supplier modal, then reselect.
export function itemSupplierChanged() {
  const sel = document.getElementById('iSupplier');
  if (sel && sel.value === '__new__') {
    sel.value = '';
    if (typeof window.openSupplierModal === 'function') {
      window.openSupplierModal({ onCreated: (sup) => { _refreshItemSupplierOptions(sup.id); } });
    }
  }
  _updateItemSupplierNote();   // show/hide the quote note for the new selection
}

export function toggleSelectMode() {
  window._pkInventorySelMode = !window._pkInventorySelMode;
  if (!window._pkInventorySelMode) {
    // Exiting select mode deselects everything
    window._pkInventorySelIds = new Set();
  }
  renderItems();
}

export function toggleItemSelected(e, id) {
  if (e) {
    // Don't toggle when the click came from one of the action buttons
    const t = e.target;
    if (t && (t.closest('.pk-inv-iconbtn'))) return;
    e.stopPropagation();
  }
  window._pkInventorySelIds = window._pkInventorySelIds || new Set();
  if (window._pkInventorySelIds.has(id)) window._pkInventorySelIds.delete(id);
  else                                   window._pkInventorySelIds.add(id);
  renderItems();
}

export async function bulkDeleteSelected() {
  if (!assertPermission('deleteItem')) return;
  const ids = Array.from(window._pkInventorySelIds || []);
  if (!ids.length) return;
  if (!(await askConfirm(`Delete ${ids.length} item${ids.length !== 1 ? 's' : ''}?`))) return;
  const _uid = activeUid();
  for (const id of ids) {
    window._pkItems = (window._pkItems || []).filter(i => i.id !== id);
    if (_uid) {
      try { await removeItem(_uid, id); await addTombstone(_uid, id); } catch (e) { console.error(e); }
    }
    try { logActivity('DELETE_ITEM', { itemId: id }); } catch (_) {}
  }
  window._pkInventorySelIds = new Set();
  window._pkInventorySelMode = false;
  saveLocal();
  renderItems();
  updateSummary();
  toast(`🗑 Deleted ${ids.length} item${ids.length !== 1 ? 's' : ''}`, 'ok');
}

export function bulkExportSelected() {
  const ids = window._pkInventorySelIds || new Set();
  if (!ids.size) return;
  const items = (window._pkItems || []).filter(i => ids.has(i.id));
  // CSV export — id, name, category, mode, buy, sell, rowSell, cartonSell,
  // pieces-per-carton, stockQty, stockUnit, low, note.
  const headers = [
    'id', 'name', 'category', 'mode',
    'buy_per_piece', 'sell_per_piece', 'sell_per_row', 'sell_per_carton',
    'pieces_per_carton', 'stock_qty', 'stock_unit', 'low', 'note',
  ];
  const csvLines = [headers.join(',')];
  for (const it of items) {
    const ppc = parseFloat(it.piecesPerCarton)
      || (parseFloat(it.rowsPerCarton || 0) * parseFloat(it.piecesPerRow || 0))
      || '';
    const row = [
      it.id || '',
      it.name || '',
      it.cat  || '',
      it.buyUnit || 'carton',
      _csvNum(it.buy),
      _csvNum(it.sell),
      _csvNum(it.rowSell),
      _csvNum(it.cartonSell),
      ppc,
      it.trackStock ? (it.stockQty ?? '') : '',
      it.trackStock ? (it.stockUnit || '') : '',
      it.low ? '1' : '0',
      it.note || '',
    ].map(_csvCell).join(',');
    csvLines.push(row);
  }
  const csv = csvLines.join('\n');
  const stamp = isoDate(new Date());
  const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pricekeeper-inventory-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  toast(`↧ Exported ${items.length} item${items.length !== 1 ? 's' : ''}`, 'ok');
}

function _csvCell(v) {
  return csvCell(v);
}
function _csvNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(n) : '';
}

// ── Privacy mode ─────────────────────────────────────────────
// Toggle hides costs + margins inside the Add/Edit drawer. Persisted
// as localStorage.pkPrivacyMode = '1' | '0'. Default off.
export function togglePrivacyMode(forceVal) {
  const cur = localStorage.getItem('pkPrivacyMode') === '1';
  const next = (typeof forceVal === 'boolean') ? forceVal : !cur;
  localStorage.setItem('pkPrivacyMode', next ? '1' : '0');
  _applyPrivacyModeUI(next);
}

function _applyPrivacyModeUI(on) {
  document.body.classList.toggle('pk-privacy-on', !!on);
  const btn = document.getElementById('pkPrivacyToggle');
  if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// Apply persisted privacy mode on first script eval
(function _initPrivacyMode() {
  try {
    const on = localStorage.getItem('pkPrivacyMode') === '1';
    if (on) _applyPrivacyModeUI(true);
    // Re-apply after DOM ready in case the toggle DOM exists late.
    document.addEventListener('DOMContentLoaded', () => _applyPrivacyModeUI(on));
  } catch (_) {}
})();