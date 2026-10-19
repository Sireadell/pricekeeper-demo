// ============================================================
//  restock-modal.js — D.9.1 Restock drawer
//
//  Replaces the old "edit item → bump qty" hack. Adds stock AND captures
//  supplier + price in one flow, with smart pre-fill and "log only on
//  change" discipline (mockup scenarios 1 & 2):
//
//    • Pre-fill supplier = item's last-used supplier; price = last paid.
//    • Same supplier + same price + same unit → refresh the existing
//      supplierPrice timestamp (green box, no new doc).
//    • Different supplier OR price → create a new supplierPrice doc
//      (amber box when the price changed, with the delta).
//
//  Stock is incremented (never replaced) when the item tracks stock.
//  Item writes use the existing saveItem() path; supplier-price writes
//  go via gwWrite inside suppliers-store.js.
// ============================================================

import { toast, setBtnLoading, escapeHtml, now, fmtSpan, daysAgo, unitShort,
         getAppSetting, setAppSetting, today } from './utils.js';
import { saveItem } from './db.js';
import { currentUser, activeUid } from './auth.js';
import { getCurrentActor } from './staff-auth.js';
import { piecesPerUnit, ppc, ppr, stockPcs, computeWac, recalcThreshold } from './inventory-math.js';
import {
  getActiveSuppliers, getLatestPriceForItem, getLastRestockInfo,
  createSupplierPrice, refreshSupplierPriceTimestamp,
} from './suppliers-store.js';
import { openSupplierModal } from './supplier-modal.js';

let _itemId   = null;
let _baseline = null;   // getLastRestockInfo() snapshot at open

function _item()      { return (window._pkItems || []).find(i => i.id === _itemId) || null; }
function _canRestock(){ return getCurrentActor().role !== 'cashier'; }
function _num(id)     { return parseFloat(document.getElementById(id)?.value) || 0; }

function _sellForUnit(item, unit) {
  if (unit === 'carton') return parseFloat(item.cartonSell) || 0;
  if (unit === 'row')    return parseFloat(item.rowSell)    || 0;
  return parseFloat(item.sell) || 0;
}

// ── open / close ──────────────────────────────────────────────
export function openRestockModal(itemId) {
  if (!_canRestock()) { toast('⛔ You do not have access to restock', 'err'); return; }
  const item = (window._pkItems || []).find(i => i.id === itemId);
  if (!item) { toast('⚠️ Item not found', 'err'); return; }
  _itemId   = itemId;
  _baseline = getLastRestockInfo(itemId);

  const t = document.getElementById('rstTitle');
  if (t) t.textContent = `Restock · ${item.name || 'Item'}`;

  const unitSel = document.getElementById('rstUnit');
  if (unitSel) {
    const opts = [];
    const ppcCount = ppc(item), pprCount = ppr(item);
    if ((item.buyUnit === 'carton') || ppcCount > 1) opts.push(`<option value="carton">CTN${ppcCount > 1 ? ` (${ppcCount} pcs)` : ''}</option>`);
    if ((item.buyUnit === 'row') || pprCount > 1)    opts.push(`<option value="row">ROW${pprCount > 1 ? ` (${pprCount} pcs)` : ''}</option>`);
    opts.push('<option value="piece">PCS</option>');
    unitSel.innerHTML = opts.join('');
    const def = item.trackStock ? (item.stockUnit || item.buyUnit || 'carton') : (item.buyUnit || 'carton');
    if ([...unitSel.options].some(o => o.value === def)) unitSel.value = def;
  }

  populateRestockSuppliers();
  const lastSupplierId = item.defaultSupplierId || _baseline?.supplierId || '';
  const supSel = document.getElementById('rstSupplier');
  if (supSel && lastSupplierId && [...supSel.options].some(o => o.value === lastSupplierId)) {
    supSel.value = lastSupplierId;
  }
  const supBadge = document.getElementById('rstSupplierBadge');
  if (supBadge) supBadge.style.display = lastSupplierId ? '' : 'none';

  const qtyEl = document.getElementById('rstQty'); if (qtyEl) qtyEl.value = 1;
  const dateEl = document.getElementById('rstDate'); if (dateEl) dateEl.value = today();

  const priceEl   = document.getElementById('rstPrice');
  const priceBadge = document.getElementById('rstPriceBadge');
  if (priceEl) {
    if (_baseline && _baseline.price) {
      priceEl.value = _baseline.price;
      if (priceBadge) {
        priceBadge.textContent = `last ${Number(_baseline.price).toLocaleString('en-NG')}`;
        priceBadge.style.display = '';
      }
    } else {
      priceEl.value = '';
      if (priceBadge) priceBadge.style.display = 'none';
    }
  }

  const stockBox = document.getElementById('rstStockPreview');
  if (stockBox) stockBox.style.display = '';

  rstRecalc();

  const overlay = document.getElementById('restockOverlay');
  const drawer  = document.getElementById('restockDrawer');
  if (overlay) overlay.style.display = 'flex';
  if (drawer) requestAnimationFrame(() => { drawer.style.transform = 'translateX(0)'; });
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('rstQty')?.focus(), 90);
}

export function closeRestockModal() {
  const overlay = document.getElementById('restockOverlay');
  const drawer  = document.getElementById('restockDrawer');
  if (drawer) drawer.style.transform = 'translateX(100%)';
  setTimeout(() => { if (overlay) { overlay.style.display = 'none'; overlay.style.zIndex = ''; } document.body.style.overflow = ''; window.dispatchEvent(new Event('pkRestockClosed')); }, 260);
  _itemId = null; _baseline = null;
}

// Populate / refresh the supplier dropdown. Keeps the current selection.
export function populateRestockSuppliers() {
  const sel = document.getElementById('rstSupplier');
  if (!sel) return;
  const cur = sel.value;
  const suppliers = getActiveSuppliers();
  let html = '';
  if (!suppliers.length) html += '<option value="">— no suppliers yet —</option>';
  html += suppliers.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  html += '<option value="__new__" style="color:var(--accent);">＋ New supplier…</option>';
  sel.innerHTML = html;
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

// ── WAC preview (display only) ────────────────────────────────
// Returns display values for the WAC info line, or null when there
// is no existing stock/cost to blend (suppresses the preview box).
function _wacResult(item, unit, newQty, newPricePerUnit) {
  const oldPcs   = stockPcs(item);
  const buyUnit  = item.buyUnit || unit;
  const oldBuyPc = parseFloat(item.buy) ||
    (parseFloat(item.buyPrice) || 0) / (piecesPerUnit(item, buyUnit) || 1);
  if (oldPcs <= 0 || oldBuyPc <= 0) return null;
  const { wacBuyUnit } = computeWac(item, newQty, newPricePerUnit, unit);
  const stockUnit     = item.stockUnit || buyUnit;
  const oldQtyDisplay = _fmtQty(oldPcs / (piecesPerUnit(item, stockUnit) || 1));
  return { wacInBuyUnit: wacBuyUnit, oldQtyDisplay, stockUnit };
}

function _wacDismissed() { return getAppSetting('wacBoxDismissed', false); }
window._pkDismissWac = function(checked) {
  setAppSetting('wacBoxDismissed', !!checked);
  rstRecalc();
};

function _wacInfoLine(item, unit, qty, price) {
  if (qty <= 0 || price <= 0 || _wacDismissed()) return '';
  const w = _wacResult(item, unit, qty, price);
  if (!w) return '';
  const buyUnit = item.buyUnit || unit;
  return `<span class="rst-wac">`
    + `↔ <b>Cost after restock (WAC): ${fmtSpan(Math.round(w.wacInBuyUnit))}/${unitShort(buyUnit)}</b>`
    + ` — blending ${w.oldQtyDisplay} ${unitShort(w.stockUnit)} old stock with ${_fmtQty(qty)} ${unitShort(unit)} new`
    + `<label class="rst-wac-dismiss"><input type="checkbox" onchange="window._pkDismissWac(this.checked)"> don't show this again</label>`
    + `</span>`;
}

// ── live recompute (qty / unit / supplier / price / date) ─────
export function rstRecalc() {
  const item = _item();
  if (!item) return;
  const unit  = document.getElementById('rstUnit')?.value || 'carton';
  const qty   = _num('rstQty');
  const price = _num('rstPrice');
  const supId = document.getElementById('rstSupplier')?.value || '';
  const us    = unitShort(unit);

  const priceUnit = document.getElementById('rstPriceUnit');
  if (priceUnit) priceUnit.textContent = us;

  {
    const box = document.getElementById('rstStockPreview');
    if (box) {
      const cur = item.trackStock ? (parseFloat(item.stockQty) || 0) : 0;
      const stockUnit = item.stockUnit || item.buyUnit || 'carton';
      const addedPcs = qty * piecesPerUnit(item, unit);
      const addedInStockUnit = addedPcs / piecesPerUnit(item, stockUnit);
      const next = cur + addedInStockUnit;
      const su = unitShort(stockUnit);
      const lead = item.trackStock ? '' : 'Will start tracking · ';
      box.innerHTML = `<b>${lead}New stock:</b> <code>${_fmtQty(cur)} → ${_fmtQty(next)} ${su}</code>`;
    }
  }

  const sameSupplier = _baseline && supId && supId === _baseline.supplierId;
  const sameUnit     = _baseline && unit === (_baseline.perUnit || 'carton');
  const samePrice    = _baseline && price > 0 && Number(price) === Number(_baseline.price);
  const isSame       = !!(sameSupplier && sameUnit && samePrice);

  const priceEl = document.getElementById('rstPrice');
  const box     = document.getElementById('rstChangeBox');
  const saveBtn = document.getElementById('rstSaveBtn');
  const total   = qty * price;

  if (priceEl) { priceEl.classList.remove('rst-price-warn'); }

  if (isSame) {
    if (box) {
      box.className = 'rst-infobox rst-infobox--success';
      box.innerHTML = `<b>✓ Same price as last time.</b> Last restock ${daysAgo(_baseline.at)} at `
        + `${escapeHtml(_baseline.supplierName)} for ${fmtSpan(_baseline.price)}/${unitShort(_baseline.perUnit)}. `
        + `We'll just refresh the timestamp — no new price log.`;
      box.style.display = '';
    }
    if (saveBtn) saveBtn.innerHTML = qty > 0
      ? `⬇ Add ${_fmtQty(qty)} ${us} · ${fmtSpan(total)} total`
      : `⬇ Restock`;
  } else if (_baseline && price > 0 && !samePrice && sameSupplier) {
    if (priceEl) priceEl.classList.add('rst-price-warn');
    if (box) {
      const delta = price - Number(_baseline.price);
      const pctv  = Number(_baseline.price) ? (delta / Number(_baseline.price)) * 100 : 0;
      const sign  = delta >= 0 ? '+' : '−';
      box.className = 'rst-infobox rst-infobox--warn';
      box.innerHTML = `<b>⚠ Price changed.</b> Last paid ${fmtSpan(_baseline.price)} (${daysAgo(_baseline.at)}). `
        + `New: <b>${fmtSpan(price)}</b> · <code>${sign}${fmtSpan(Math.abs(delta))} / ${sign}${Math.abs(pctv).toFixed(1)}%</code>. `
        + `Saving will log a new price entry.`
        + _wacInfoLine(item, unit, qty, price);
      box.style.display = '';
    }
    if (saveBtn) saveBtn.innerHTML = `⬇ Add stock & log new price`;
  } else {
    if (box) {
      box.className = 'rst-infobox';
      box.innerHTML = (supId
        ? `New price will be logged for this supplier.`
        : `Pick a supplier to log where you bought it (optional — stock still updates).`)
        + _wacInfoLine(item, unit, qty, price);
      box.style.display = '';
    }
    if (saveBtn) saveBtn.innerHTML = (supId && price > 0)
      ? `⬇ Add stock & log new price`
      : (qty > 0 ? `⬇ Add ${_fmtQty(qty)} ${us}${total > 0 ? ` · ${fmtSpan(total)} total` : ''}` : `⬇ Restock`);
  }

  _renderProfitPreview(item, unit, price, isSame);
}

function _fmtQty(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

function _renderProfitPreview(item, unit, buy, isSame) {
  const el = document.getElementById('rstProfitPreview');
  if (!el) return;
  const sell = _sellForUnit(item, unit);
  const us   = unitShort(unit);
  if (!sell || !buy) {
    el.className = 'rst-profit';
    el.textContent = 'Enter price to see margin…';
    return;
  }
  const margin = sell - buy;
  const pctv   = buy ? (margin / buy) * 100 : 0;
  el.className = 'rst-profit has-data';
  const buyLabel = (!isSame && _baseline && Number(buy) !== Number(_baseline.price)) ? 'new buy' : 'buy';
  let html = `Sell ${fmtSpan(sell)}/${us} · ${buyLabel} ${fmtSpan(buy)}/${us} · margin `
    + `<b${margin < 0 ? ' class="rst-neg"' : ''}>${fmtSpan(margin)} (${pctv.toFixed(1)}%)</b>`;
  if (_baseline && _baseline.price && Number(buy) !== Number(_baseline.price)) {
    const prevMargin = sell - Number(_baseline.price);
    const prevPct = Number(_baseline.price) ? (prevMargin / Number(_baseline.price)) * 100 : 0;
    html += ` · was ${prevPct.toFixed(1)}%`;
  }
  el.innerHTML = html;
}

// "＋ New supplier…" picked in the dropdown
export function rstSupplierChanged() {
  const sel = document.getElementById('rstSupplier');
  if (sel && sel.value === '__new__') {
    sel.value = '';
    openSupplierModal({
      onCreated: (supplier) => {
        populateRestockSuppliers();
        const s = document.getElementById('rstSupplier');
        if (s) s.value = supplier.id;
        rstRecalc();
      },
    });
    return;
  }
  rstRecalc();
}

// ── save ──────────────────────────────────────────────────────
export async function rstSave() {
  if (!_canRestock()) { toast('⛔ You do not have access to restock', 'err'); return; }
  const item = _item();
  if (!item) { toast('⚠️ Item not found', 'err'); return; }

  const unit  = document.getElementById('rstUnit')?.value || 'carton';
  const qty   = _num('rstQty');
  const price = _num('rstPrice');
  const supId = document.getElementById('rstSupplier')?.value || '';
  const dateStr = document.getElementById('rstDate')?.value || '';
  const observedAt = dateStr ? new Date(dateStr + 'T00:00:00').getTime() : Date.now();

  if (qty <= 0) return toast('⚠️ Enter a quantity greater than 0', 'err');

  // A carton price typed against "piece" blows up the item's cost and every
  // later sale shows a big loss. Ask before saving a price that looks wrong.
  if (price > 0) {
    const newPc  = price / (piecesPerUnit(item, unit) || 1);
    const sellPc = parseFloat(item.sell) || 0;
    const oldPc  = (parseFloat(item.buyPrice) || 0) / (piecesPerUnit(item, item.buyUnit || unit) || 1) || parseFloat(item.buy) || 0;
    if ((sellPc > 0 && newPc > sellPc * 3) || (oldPc > 0 && newPc > oldPc * 5)) {
      const ok = confirm(
        `You entered ₦${price.toLocaleString()} for each ${unitShort(unit)}.\n\n` +
        `That makes one piece cost ₦${Math.round(newPc).toLocaleString()}` +
        (sellPc > 0 ? `, but you sell one piece for ₦${sellPc.toLocaleString()}.` : '.') +
        `\n\nCheck the unit (piece, row or carton) next to the price.\n\nOK to save anyway · Cancel to fix it`);
      if (!ok) return;
    }
  }

  const btn = document.getElementById('rstSaveBtn');
  if (btn && btn.disabled) return;
  setBtnLoading(btn, true);

  try {
    const uid = activeUid();

    // 1) stock increment (never replace). Restocking ALWAYS turns stock
    //    tracking on. stockQty is in the item's buyUnit; the restocked `unit`
    //    may differ and is converted via piecesPerUnit.
    let updatedItem = { ...item };
    if (!updatedItem.trackStock) {
      updatedItem.trackStock  = true;
      updatedItem.stockUnit   = updatedItem.stockUnit || updatedItem.buyUnit || 'carton';
      updatedItem.stockQty    = 0;
      updatedItem.stockQtyPcs = 0;
    }
    {
      const stockUnit = updatedItem.stockUnit || updatedItem.buyUnit || 'carton';
      const addedPcs  = qty * piecesPerUnit(item, unit);
      const curQty    = parseFloat(updatedItem.stockQty) || 0;
      updatedItem.stockQty    = curQty + addedPcs / piecesPerUnit(item, stockUnit);
      // Pieces always follow the real count; the stored pieces copy can be stale on older items.
      updatedItem.stockQtyPcs = updatedItem.stockQty * piecesPerUnit(item, stockUnit);
      Object.assign(updatedItem, recalcThreshold(updatedItem, updatedItem.stockQtyPcs));
    }

    // 1.5) WAC — blends item cost BEFORE stock increment with new purchase
    if (price > 0) {
      const { wacPc, wacBuyUnit } = computeWac(item, qty, price, unit);
      updatedItem.buy      = wacPc;
      updatedItem.buyPrice = wacBuyUnit;
    }

    // 2) supplier price: log-on-change
    let logged = 'none';
    if (supId && price > 0) {
      const sameSupplier = _baseline && supId === _baseline.supplierId;
      const sameUnit     = _baseline && unit === (_baseline.perUnit || 'carton');
      const samePrice    = _baseline && Number(price) === Number(_baseline.price);
      if (sameSupplier && sameUnit && samePrice) {
        await refreshSupplierPriceTimestamp(_baseline.priceId, { qtyAdded: qty });
        logged = 'refresh';
      } else {
        await createSupplierPrice({
          itemId: item.id, supplierId: supId, price, perUnit: unit,
          observedAt, qtyAdded: qty, isPurchase: true,
        });
        logged = 'new';
      }
      updatedItem.defaultSupplierId   = supId;
      updatedItem.lastSupplierPriceAt = Date.now();
    }

    // 3) persist. A hand-set "low"/"out" reminder has done its job once the
    // goods are in; left on, it kept the item showing as out of stock.
    updatedItem.restockFlag   = null;
    updatedItem.lastRestockAt = Date.now();
    updatedItem.updatedAt     = now();
    updatedItem.updatedTs     = Date.now();
    const idx = (window._pkItems || []).findIndex(i => i.id === item.id);
    if (idx >= 0) window._pkItems[idx] = updatedItem;
    if (uid) await saveItem(uid, updatedItem);

    try { (await import('./inventory.js')).renderItems(); } catch (_) {}
    try { (await import('./inventory.js')).updateSummary(); } catch (_) {}

    const msg = logged === 'new'     ? `✅ Restocked · new price logged`
              : logged === 'refresh' ? `✅ Restocked · price unchanged`
              : `✅ Restocked`;
    toast(msg, 'ok');
    closeRestockModal();
  } catch (e) {
    console.error('[restock] save failed:', e);
    toast('⚠️ Could not save restock. Try again.', 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}
