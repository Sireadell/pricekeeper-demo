// ============================================================
//  inventory-math.js — Shared pure-math helpers for stock
//  calculations. Single source of truth for:
//
//    ppc / ppr / piecesPerUnit  — unit → piece conversion
//    stockPcs                   — safe stockQtyPcs read
//    computeWac                 — Weighted Average Cost blend
//    recalcThreshold            — low-stock threshold recalc
//
//  NOTE: insights-engine.js intentionally has no imports (pure
//  compute module for the test harness) so it maintains its own
//  private copies. All other callers use this module.
// ============================================================

import { lowThresholdFromPct } from './utils.js';

// ── Unit conversion ──────────────────────────────────────────

// Pieces per carton. Checks piecesPerCarton, rowsPerCarton×piecesPerRow,
// then legacy cartonQty. Falls back to 1.
export function ppc(item) {
  if (parseFloat(item.piecesPerCarton) > 0) return parseFloat(item.piecesPerCarton);
  const rows = parseFloat(item.rowsPerCarton), pr = parseFloat(item.piecesPerRow);
  if (rows > 0 && pr > 0) return rows * pr;
  if (parseFloat(item.cartonQty) > 0) return parseFloat(item.cartonQty);
  return 1;
}

// Pieces per row. Returns 1 (not 0) so callers can safely divide.
export function ppr(item) {
  const v = parseFloat(item.piecesPerRow);
  return v > 0 ? v : 1;
}

export function piecesPerUnit(item, unit) {
  if (unit === 'carton') return ppc(item);
  if (unit === 'row')    return ppr(item);
  return 1;
}

// ── Stock quantity ───────────────────────────────────────────

// Returns current stock in pieces. Falls back to stockQty × piecesPerUnit
// for older items that pre-date the stockQtyPcs field.
export function stockPcs(item) {
  const v = parseFloat(item.stockQtyPcs);
  if (Number.isFinite(v)) return v;
  return (parseFloat(item.stockQty) || 0) *
    piecesPerUnit(item, item.stockUnit || item.buyUnit || 'carton');
}

// ── Weighted Average Cost ────────────────────────────────────

// Blends the existing cost basis with a new purchase.
//   item             — item object BEFORE the stock increment
//   addQty           — quantity being added, in `unit` units
//   addPricePerUnit  — buy price for one `unit`
//   unit             — 'carton' | 'row' | 'piece'
//
// Returns { wacPc, wacBuyUnit }, both rounded to 2dp.
//   wacPc:      per-piece WAC (stored as item.buy)
//   wacBuyUnit: WAC in the item's buyUnit (stored as item.buyPrice)
//
// When addPricePerUnit is 0 (free stock) or there is no existing
// cost, falls back to the new buy-price-per-piece (which may also
// be 0) rather than preserving the old price — free stock correctly
// dilutes cost to zero.
export function computeWac(item, addQty, addPricePerUnit, unit) {
  const pu        = piecesPerUnit(item, unit) || 1;
  const buyUnit   = item.buyUnit || unit;
  const buyUnitPu = piecesPerUnit(item, buyUnit) || 1;

  const oldPcs   = stockPcs(item);
  // buyPrice-first, matching _costPerPiece()'s cost-source-of-truth order
  // (trade-modal.js) — `buy` is a DERIVED per-piece cache that can be stale or
  // wrong (e.g. pre-N1-fix row items), so it must not outrank the raw price the
  // inventory form actually collected. (N1 fix)
  const oldBuyPc = (parseFloat(item.buyPrice) || 0) / buyUnitPu ||
    parseFloat(item.buy) || 0;

  const newQtyPcs = addQty * pu;
  const newBuyPc  = addPricePerUnit / pu;

  const wacPc = (addPricePerUnit > 0 && oldPcs > 0 && oldBuyPc > 0)
    ? (oldPcs * oldBuyPc + newQtyPcs * newBuyPc) / (oldPcs + newQtyPcs)
    : (newBuyPc || oldBuyPc);

  return {
    wacPc:      Math.round(wacPc * 100) / 100,
    wacBuyUnit: Math.round(wacPc * buyUnitPu * 100) / 100,
  };
}

// ── Low-stock threshold ──────────────────────────────────────

// Re-derives all three threshold fields from the new piece count.
// Spread the result onto the updated item object:
//   Object.assign(updatedItem, recalcThreshold(updatedItem, updatedItem.stockQtyPcs));
export function recalcThreshold(item, newStockQtyPcs) {
  const stockUnit    = item.stockUnit || item.buyUnit || 'carton';
  const ppcStockUnit = piecesPerUnit(item, stockUnit) || 1;
  const newThreshPcs = lowThresholdFromPct(newStockQtyPcs);
  return {
    lowThresholdPcs:  newThreshPcs,
    lowThreshold:     newThreshPcs / ppcStockUnit,
    lowThresholdUnit: stockUnit,
    low:              newStockQtyPcs <= newThreshPcs,
  };
}
