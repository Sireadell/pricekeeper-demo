// ============================================================
//  insights-engine.js — Profit Insights PURE compute module
//
//  No imports, no DOM, no Firestore, NO WRITES — every function takes
//  plain data arrays and returns plain objects, so the node test harness
//  (scripts/test-insights-engine.mjs) can feed synthetic fixtures and
//  assert exact outputs. UI wrappers live in insights.js.
//
//  HARD RULES (founder spec, 8 Jun 2026):
//  · Pre-2026-06-03 CASHIER-performed sales are EXCLUDED from all PROFIT
//    math (the v1.9 revenue-as-profit pollution). Their REVENUE still
//    counts in trends; their profit never does.
//  · Profit uses the SNAPSHOTTED line.cost / line.profit on sale docs
//    (cost at time of sale), never current item cost.
//  · Voided sales are skipped everywhere.
// ============================================================

// v1.9 shipped 3 June 2026 — cashier sales before this carry profit≈revenue.
// Local-time midnight on purpose: sale.createdTs is device-local too.
export const PROFIT_POLLUTION_CUTOFF_TS = new Date(2026, 5, 3).getTime();   // 2026-06-03 00:00 local

export function saleTs(s) {
  if (s && s.createdTs) return s.createdTs;
  if (s && s.date) {
    const t = new Date(`${s.date}T00:00:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

export function isProfitPolluted(sale) {
  if (((sale && sale.performedBy && sale.performedBy.role) || '') !== 'cashier') return false;
  return saleTs(sale) < PROFIT_POLLUTION_CUTOFF_TS;
}

export function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ISO-8601 week key ("2026-W23") via the nearest-Thursday rule.
export function isoWeekKey(ts) {
  const d = new Date(ts);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;            // Mon=0 … Sun=6
  t.setDate(t.getDate() - day + 3);            // this week's Thursday
  const isoYear = t.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Mon = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7));
  const week = Math.round((t - week1Mon) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// Sale lines, snapshotted at sale time. Falls back to the legacy
// single-item sale shape ({itemId, totalRevenue, …}) if items[] is absent.
function _lines(s) {
  if (Array.isArray(s.items)) return s.items;
  if (s.itemId) {
    return [{
      itemId: s.itemId, itemName: s.itemName || '',
      revenue: s.totalRevenue ?? s.revenue ?? 0,
      cost:    s.totalCost ?? 0,
      profit:  s.totalProfit ?? ((s.totalRevenue ?? s.revenue ?? 0) - (s.totalCost ?? 0)),
    }];
  }
  return [];
}

// Snapshotted line profit, with a defensive fallback to revenue − cost
// for lines written before profit was stored per-line.
function _lineProfit(ln) {
  if (ln.profit != null && !Number.isNaN(parseFloat(ln.profit))) return parseFloat(ln.profit);
  return (parseFloat(ln.revenue) || 0) - (parseFloat(ln.cost) || 0);
}
function _lineRevenue(ln) { return parseFloat(ln.revenue) || 0; }

// ── 1. Top & bottom earners for a month ───────────────────────
// Groups sale lines by itemId, sums snapshotted line profit. Polluted
// sales contribute revenue but never profit (their lines are counted in
// excludedPollutedSales so the UI can disclose the exclusion).
export function topBottomEarners(sales, month) {
  const byItem = new Map();
  let excludedPollutedSales = 0;
  for (const s of sales || []) {
    if (s.voided) continue;
    if (monthKey(saleTs(s)) !== month) continue;
    const polluted = isProfitPolluted(s);
    if (polluted) excludedPollutedSales++;
    for (const ln of _lines(s)) {
      if (!ln.itemId) continue;
      const rec = byItem.get(ln.itemId) || {
        itemId: ln.itemId, itemName: ln.itemName || '',
        profit: 0, revenue: 0, lines: 0, pollutedLines: 0,
      };
      rec.revenue += _lineRevenue(ln);
      if (polluted) rec.pollutedLines++;
      else { rec.profit += _lineProfit(ln); rec.lines++; }
      if (!rec.itemName && ln.itemName) rec.itemName = ln.itemName;
      byItem.set(ln.itemId, rec);
    }
  }
  const ranked = [...byItem.values()].sort((a, b) => b.profit - a.profit);
  return { month, ranked, excludedPollutedSales };
}

// ── 2. Profit leak finder ─────────────────────────────────────
// Scans non-voided, NON-polluted sales for: below-cost lines (profit<0),
// thin margins (0 ≤ margin < thinMarginPct — exactly the threshold is NOT
// flagged), and discount-heavy lines (discount ≥ discountHeavyRatio of the
// pre-discount price). Returns per-item aggregates with reasons + numbers.
export function profitLeaks(sales, opts = {}) {
  const thinPct  = opts.thinMarginPct ?? 10;
  const heavyAt  = opts.discountHeavyRatio ?? 0.20;
  const byItem = new Map();
  for (const s of sales || []) {
    if (s.voided) continue;
    if (isProfitPolluted(s)) continue;          // fake profit → can't judge leaks
    for (const ln of _lines(s)) {
      if (!ln.itemId) continue;
      const revenue  = _lineRevenue(ln);
      const profit   = _lineProfit(ln);
      const discount = parseFloat(ln.lineDiscount ?? ln.itemDiscount) || 0;
      const original = parseFloat(ln.originalRevenue) || (revenue + discount);
      const margin   = revenue > 0 ? (profit / revenue) * 100 : (profit < 0 ? -100 : 0);

      const belowCost     = profit < 0;
      const thinMargin    = !belowCost && revenue > 0 && margin < thinPct;
      const discountHeavy = original > 0 && discount > 0 && (discount / original) >= heavyAt;
      if (!belowCost && !thinMargin && !discountHeavy) continue;

      const rec = byItem.get(ln.itemId) || {
        itemId: ln.itemId, itemName: ln.itemName || '',
        reasons: new Set(),
        belowCostLoss: 0, belowCostLines: 0,
        thinLines: 0, minMarginPct: null,
        discountTotal: 0, discountLines: 0,
        saleIds: new Set(),
      };
      if (belowCost)  { rec.reasons.add('below-cost');     rec.belowCostLoss += -profit; rec.belowCostLines++; }
      if (thinMargin) {
        rec.reasons.add('thin-margin'); rec.thinLines++;
        rec.minMarginPct = rec.minMarginPct == null ? margin : Math.min(rec.minMarginPct, margin);
      }
      if (discountHeavy) { rec.reasons.add('discount-heavy'); rec.discountTotal += discount; rec.discountLines++; }
      if (s.id) rec.saleIds.add(s.id);
      if (!rec.itemName && ln.itemName) rec.itemName = ln.itemName;
      byItem.set(ln.itemId, rec);
    }
  }
  return [...byItem.values()]
    .map(r => ({ ...r, reasons: [...r.reasons], saleIds: [...r.saleIds],
                 minMarginPct: r.minMarginPct == null ? null : Math.round(r.minMarginPct * 100) / 100 }))
    .sort((a, b) => (b.belowCostLoss - a.belowCostLoss)
                 || ((a.minMarginPct ?? 101) - (b.minMarginPct ?? 101))
                 || (b.discountTotal - a.discountTotal));
}

// ── 3. Sales trends per ISO week and per month ────────────────
// Revenue includes EVERY non-voided sale (polluted ones too — their
// revenue is real). Profit excludes polluted sales entirely.
export function salesTrends(sales) {
  const weekly = new Map(), monthly = new Map();
  const bump = (map, key, s, polluted) => {
    const rec = map.get(key) || { key, revenue: 0, profit: 0, salesCount: 0, pollutedExcludedFromProfit: 0 };
    let rev = 0, prof = 0;
    for (const ln of _lines(s)) { rev += _lineRevenue(ln); prof += _lineProfit(ln); }
    if (!_lines(s).length) rev = parseFloat(s.totalRevenue) || 0;
    rec.revenue += rev;
    rec.salesCount++;
    if (polluted) rec.pollutedExcludedFromProfit++;
    else rec.profit += prof;
    map.set(key, rec);
  };
  for (const s of sales || []) {
    if (s.voided) continue;
    const ts = saleTs(s);
    const polluted = isProfitPolluted(s);
    bump(weekly,  isoWeekKey(ts), s, polluted);
    bump(monthly, monthKey(ts),   s, polluted);
  }
  const sortByKey = (a, b) => a.key.localeCompare(b.key);
  return {
    weekly:  [...weekly.values()].sort(sortByKey),
    monthly: [...monthly.values()].sort(sortByKey),
  };
}

// ── 4. Best supplier per item ─────────────────────────────────
// MIRRORS D.9.3 Best Prices (suppliers-view.js _suppliersForItem /
// _bestPriceItems) — same math, made pure: newest price per supplier,
// inactive suppliers skipped, prices normalised to per-piece cost via the
// item's carton/row conversions, cheapest first. Saving is expressed in
// the best row's unit, like D.9.3. Sorted by saving desc for the
// insights view (D.9.3 sorts low-stock first — display choice only).
function _ppc(item) {
  return parseFloat(item.piecesPerCarton)
      || ((parseFloat(item.rowsPerCarton) || 0) * (parseFloat(item.piecesPerRow) || 0))
      || 1;
}
function _ppr(item) { return parseFloat(item.piecesPerRow) || 1; }
function _piecesPerUnit(item, unit) {
  if (unit === 'carton') return _ppc(item);
  if (unit === 'row')    return _ppr(item);
  return 1;
}
function _priceTs(p) {
  return Math.max(p.lastRestockAt || 0, p.observedAt || 0, p.createdAt || 0);
}

// ── per-piece cost / sell resolvers (mirror trade-modal.js) ───
// Canonical cost-per-piece — same priority chain as _costPerPiece in
// trade-modal.js (cartonBuy → buyPrice by buyUnit → buy).
function _costPerPiece(item) {
  if (item.cartonBuy && parseFloat(item.cartonBuy) > 0) {
    const ppc = _ppc(item);
    return ppc > 1 ? parseFloat(item.cartonBuy) / ppc : parseFloat(item.cartonBuy);
  }
  if (item.buyPrice && parseFloat(item.buyPrice) > 0) {
    const ppc = _ppc(item), ppr = _ppr(item);
    if (item.buyUnit === 'carton' && ppc > 1) return parseFloat(item.buyPrice) / ppc;
    if (item.buyUnit === 'row') return ppr > 0 ? parseFloat(item.buyPrice) / ppr : parseFloat(item.buyPrice);
    return parseFloat(item.buyPrice);
  }
  return parseFloat(item.buy) || parseFloat(item.cost) || 0;
}
function _sellPerPiece(item) {
  const s = parseFloat(item.sell);
  if (s > 0) return s;
  const ppc = _ppc(item), ppr = _ppr(item);
  if (parseFloat(item.cartonSell) > 0 && ppc > 1) return parseFloat(item.cartonSell) / ppc;
  if (parseFloat(item.rowSell) > 0 && ppr > 1)    return parseFloat(item.rowSell) / ppr;
  return 0;
}
function _itemBuyUnit(item) {
  return item.buyUnit || ((item.cartonSell || _ppc(item) > 1) ? 'carton' : 'piece');
}
// Units a sale line represents, in PIECES. Previously expressed "in the
// item's BUY unit" (inferred from buyUnit/cartonSell) to match stockQty —
// but stockQty is denominated in item.stockUnit, a separate field the
// inference doesn't see. When they disagree (e.g. stockUnit:'piece' but
// cartonSell set → inferred buy unit 'carton'), comparing sold-in-buy-unit
// against stockQty-in-stockUnit silently mixes units. Pieces is unambiguous
// for both sides — see _qtyInPieces below for the stockQty side. Found via
// CENTRE FRUIT showing ₦998,200 "trapped" for what was really ₦41,592
// (23 pieces miscounted as 23 cartons, a 24x inflation) — 23 Jun 2026.
function _lineUnitsInPieces(line, item) {
  const ppc = _ppc(item) || 1, ppr = _ppr(item) || 1;
  const c = parseFloat(line.cartons) || 0, r = parseFloat(line.rows) || 0, q = parseFloat(line.qty) || 0;
  const v = c * ppc + r * ppr + q;
  return Math.round(v * 1000) / 1000;
}
// stockQty is denominated in item.stockUnit (set explicitly in Inventory),
// NOT the inferred buy unit — always derive pieces from the CURRENT stockQty
// using stockUnit. item.stockQtyPcs looked authoritative (precomputed by
// inventory.js at write-time) but is NOT kept in sync: _decrementStock
// (trade-payment.js) updates stockQty on every sale and never touches
// stockQtyPcs, so it goes stale the moment anything sells after the item was
// last edited. Found via ENEGRO EGGRICH: stockQty 9 cartons (current,
// correctly decremented) but stockQtyPcs 960 (= 20 cartons × 48ppc — stale
// from before recent sales) — trusting stockQtyPcs doubled its trapped value
// (₦40,000 shown vs real ₦18,000). stockUnit only falls back to the inferred
// buy unit for items that predate the stockUnit field entirely — 23 Jun 2026.
function _qtyInPieces(item) {
  const unit = item.stockUnit || _itemBuyUnit(item);
  return (parseFloat(item.stockQty) || 0) * _piecesPerUnit(item, unit);
}

// ── 5. Dead / sluggish stock ──────────────────────────────────
// Tracked items with capital trapped that isn't moving. DEAD if EITHER:
//   (a) no non-voided sale in the last `days` (default 50), age-gated so a
//       brand-new never-sold item isn't flagged before it's had a chance; OR
//   (b) slow-bleeder: sell-through < sellThroughPct (default 10%), where
//       sell-through = unitsSold ÷ (unitsSold + currentStock) (textbook
//       sold ÷ beginning inventory — makes "sold 1, 10 left" = 9.1% flag,
//       "sold 2, 10 left" = 16.7% no).
// Money trapped = stock-in-pieces × per-piece cost (true trapped capital;
// stockQty is in buy units, so it's converted to pieces first). Items with
// no cost, untracked, or stockQty null/0 are skipped — nothing is trapped.
// Suggested clearance: % off the per-piece sell price, capped so the
// suggested price stays STRICTLY ABOVE per-piece cost (never suggest a loss).
// `now` is injectable for deterministic tests. Read-only.
export function deadStock(sales, items, opts = {}) {
  const days      = opts.days ?? 50;
  const stPct     = opts.sellThroughPct ?? 0.10;
  const clrPct    = opts.clearanceDiscountPct ?? 0.20;
  const now       = opts.now ?? Date.now();
  const windowMs  = days * 86400000;
  const windowStart = now - windowMs;

  // Per-item: most-recent non-voided sale ts + units sold within the window.
  const lastSale = new Map();   // itemId → ts
  const soldWin  = new Map();   // itemId → units (pieces)
  for (const s of sales || []) {
    if (s.voided) continue;
    const ts = saleTs(s);
    for (const ln of _lines(s)) {
      if (!ln.itemId) continue;
      const item = (items || []).find(i => i.id === ln.itemId);
      if (lastSale.get(ln.itemId) == null || ts > lastSale.get(ln.itemId)) lastSale.set(ln.itemId, ts);
      if (ts >= windowStart && item) {
        soldWin.set(ln.itemId, (soldWin.get(ln.itemId) || 0) + _lineUnitsInPieces(ln, item));
      }
    }
  }

  const out = [];
  for (const item of items || []) {
    if (item.trackStock !== true) continue;                 // untracked → excluded
    const stockQty = item.stockQty;
    if (stockQty == null || parseFloat(stockQty) <= 0) continue;   // null/0 → nothing trapped
    const costPerPiece = _costPerPiece(item);
    if (!(costPerPiece > 0)) continue;                      // no cost → can't value trapped capital

    const qty       = parseFloat(stockQty);
    const sold       = Math.round((soldWin.get(item.id) || 0) * 1000) / 1000;
    const last       = lastSale.get(item.id) ?? 0;
    // item.createdTs is never actually populated by the add-item flow (it
    // writes item.addedDate, a "YYYY-MM-DD" string) — falling back to it was
    // always falling through to 0, so a never-sold item's age-gate silently
    // became `Infinity >= days`, true on day one. Parse addedDate too,
    // mirroring saleTs()'s date-string handling.
    const addedTs    = item.createdTs || (item.addedDate
      ? (() => { const t = new Date(`${item.addedDate}T00:00:00`).getTime(); return Number.isNaN(t) ? 0 : t; })()
      : 0);
    // A restock means "stock was added on this date" unconditionally (see
    // restock-modal.js rstSave) — without it, a freshly restocked item with
    // a stale lastSale (or none at all) reads as idle since its last sale or
    // creation, ignoring that the shelf was just replenished. Treat the most
    // recent of {last sale, last restock} as the idle clock's reference.
    const restockTs  = item.lastRestockAt || 0;
    const recentTs   = Math.max(last, restockTs);
    const idleFromTs = recentTs > 0 ? recentTs : addedTs;
    const daysIdle   = idleFromTs > 0 ? Math.floor((now - idleFromTs) / 86400000) : Infinity;

    // An item needs a full lookback window of real shelf-time before "slow
    // sell-through" means anything — otherwise a just-added or just-restocked
    // item (current stock just jumped, sales haven't caught up yet) reads as
    // "dead" on day one. Rule A already self-gates via daysIdle (now fixed
    // above); rule B has no time signal of its own, so gate it explicitly on
    // the most recent of {added, restocked}.
    const sinceTs = Math.max(addedTs, restockTs);
    const daysSinceAdded = sinceTs > 0 ? Math.floor((now - sinceTs) / 86400000) : Infinity;

    const qtyPcs = _qtyInPieces(item);
    const sellThrough = (sold + qtyPcs) > 0 ? sold / (sold + qtyPcs) : 0;
    const ruleA = sold === 0 && daysIdle >= days;                              // no sale in window, old enough
    const ruleB = sold > 0  && sellThrough < stPct && daysSinceAdded >= days;  // slow bleeder, given a fair chance
    if (!ruleA && !ruleB) continue;

    const moneyTrapped = Math.round(qtyPcs * costPerPiece);

    // Suggested clearance price — per-piece basis, strictly above cost.
    const sell = _sellPerPiece(item);
    let suggestedSell = null, discountPct = 0;
    if (sell > costPerPiece) {
      const target  = Math.round(sell * (1 - clrPct));
      const floorAboveCost = Math.floor(costPerPiece) + 1;   // always strictly > cost
      suggestedSell = Math.min(sell, Math.max(target, floorAboveCost));
      discountPct   = Math.round(((sell - suggestedSell) / sell) * 100);
    }

    // unitsSoldInWindow is shown bare next to stockQty+buyUnit ("X sold ·
    // Y cartons on hand") with no unit suffix of its own — re-express the
    // pieces-based `sold` back into the displayed unit so the two numbers
    // are comparable on screen. Internal math above already used pieces.
    const displayUnit = item.stockUnit || _itemBuyUnit(item);
    const displayPpu   = _piecesPerUnit(item, displayUnit) || 1;
    const soldDisplay  = Math.round((sold / displayPpu) * 1000) / 1000;

    out.push({
      itemId: item.id, itemName: item.name || '',
      daysIdle: daysIdle === Infinity ? null : daysIdle,
      unitsSoldInWindow: soldDisplay, buyUnit: displayUnit,
      stockQty: qty, moneyTrapped,
      currentSell: Math.round(sell), suggestedSell, discountPct,
      reason: ruleA ? 'idle' : 'slow',
      sellThroughPct: Math.round(sellThrough * 1000) / 10,
    });
  }
  return out.sort((a, b) => b.moneyTrapped - a.moneyTrapped);
}

export function bestSupplierPerItem({ items, suppliers, supplierPrices }) {
  const supById = new Map((suppliers || []).map(s => [s.id, s]));
  const pricesByItem = new Map();
  for (const p of supplierPrices || []) {
    if (!pricesByItem.has(p.itemId)) pricesByItem.set(p.itemId, []);
    pricesByItem.get(p.itemId).push(p);
  }
  const out = [];
  for (const item of items || []) {
    const prices = (pricesByItem.get(item.id) || []).slice().sort((a, b) => _priceTs(b) - _priceTs(a));
    const seen = new Set();
    const rows = [];
    for (const p of prices) {
      if (seen.has(p.supplierId)) continue;            // newest per supplier
      seen.add(p.supplierId);
      const sup = supById.get(p.supplierId);
      if (!sup || sup.active === false) continue;      // can't buy there → skip
      const perUnit = p.perUnit || 'carton';
      const price   = Number(p.price) || 0;
      rows.push({
        supplierId: p.supplierId, supplierName: sup.name || '',
        price, perUnit, norm: price / _piecesPerUnit(item, perUnit), at: _priceTs(p),
      });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => a.norm - b.norm);
    const best = rows[0];
    const next = rows[1] || null;
    const saving = next ? (next.norm - best.norm) * _piecesPerUnit(item, best.perUnit) : 0;
    const savingPct = next && next.norm > 0 ? ((next.norm - best.norm) / next.norm) * 100 : 0;
    out.push({
      itemId: item.id, itemName: item.name || '',
      best, next, saving: Math.round(saving * 100) / 100,
      savingPct: Math.round(savingPct * 100) / 100,
      supplierCount: rows.length,
    });
  }
  return out.sort((a, b) => b.saving - a.saving);
}
