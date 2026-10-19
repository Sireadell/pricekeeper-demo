// ============================================================
//  insights.js — Profit Insights UI (owner/admin only)
//
//  Renders the Business → Insights panel from the PURE engine in
//  insights-engine.js (tested by scripts/test-insights-engine.mjs).
//  This module is render-only: it reads window._pk* state, calls the
//  engine, and writes innerHTML. It never writes data anywhere.
//
//  Gating: cost-blind roles (manager/cashier) never see the Insights
//  nav item (filtered in business.js _buildShell) AND this renderer
//  bails defensively if reached. Styles live in css/business.css.
// ============================================================

import { fmtSpan, escapeHtml } from './utils.js';
import { costBlindForCurrentRole } from './staff-auth.js';
import {
  topBottomEarners, profitLeaks, salesTrends, bestSupplierPerItem, deadStock,
  monthKey, saleTs, isProfitPolluted,
} from './insights-engine.js';

let _insMonth = null;   // 'YYYY-MM' — defaults to the current month

const _naira = (n) => fmtSpan(Math.abs(Math.round(n)));
const _signedNaira = (n) => (n < 0 ? `−${_naira(n)}` : _naira(n));

function _monthsInData(sales) {
  const set = new Set();
  for (const s of sales || []) { if (!s.voided) set.add(monthKey(saleTs(s))); }
  return [...set].sort().reverse();
}
function _monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

window._insSetMonth = function (key) { _insMonth = key; renderInsights(); };

export function renderInsights() {
  const area = document.getElementById('sub-insights');
  if (!area) return;
  if (costBlindForCurrentRole()) { area.innerHTML = ''; return; }   // defensive — nav already hides it

  const sales  = window._pkSales || [];
  const items  = window._pkItems || [];
  const months = _monthsInData(sales);
  if (!_insMonth || !months.includes(_insMonth)) _insMonth = months[0] || monthKey(Date.now());

  const earners = topBottomEarners(sales, _insMonth);
  const leaks   = profitLeaks(sales);
  const trends  = salesTrends(sales);
  const best    = bestSupplierPerItem({
    items, suppliers: window._pkSuppliers || [], supplierPrices: window._pkSupplierPrices || [],
  });
  const dead    = deadStock(sales, items);
  const pollutedTotal = sales.filter(s => !s.voided && isProfitPolluted(s)).length;

  area.innerHTML = `
    <div class="pk-ins">
      <div class="pk-ins-head">
        <div>
          <div class="pk-ins-eyebrow">Profit Insights</div>
          <div class="pk-ins-title">Where the money is made — and leaked</div>
        </div>
        <select class="pk-ins-month" onchange="window._insSetMonth(this.value)" aria-label="Month">
          ${months.map(m => `<option value="${m}"${m === _insMonth ? ' selected' : ''}>${_monthLabel(m)}</option>`).join('')}
        </select>
      </div>
      ${pollutedTotal > 0 ? `<div class="pk-ins-note">Profit figures exclude ${pollutedTotal} cashier-recorded sale${pollutedTotal !== 1 ? 's' : ''} from before 3 Jun 2026 (unreliable profit data). Revenue still includes them.</div>` : ''}
      ${_secEarners(earners)}
      ${_secLeaks(leaks)}
      ${_secDeadStock(dead)}
      ${_secTrends(trends)}
      ${_secBestSupplier(best)}
    </div>`;
}

// ── Top & Bottom Earners ──────────────────────────────────────
function _secEarners(e) {
  const active = e.ranked.filter(r => r.lines > 0);
  if (!active.length) {
    return _section('Top & Bottom earners', `<div class="pk-ins-empty">No profit-countable sales in ${_monthLabel(e.month)}.</div>`);
  }
  const top = active.slice(0, 5);
  const bottom = active.length > 5 ? active.slice(-5).reverse() : [];
  const row = (r, i) => `
    <div class="pk-ins-row">
      <span class="pk-ins-rank">${i + 1}</span>
      <span class="pk-ins-name">${escapeHtml(r.itemName || r.itemId)}</span>
      <span class="pk-ins-sub">rev ${_naira(r.revenue)}</span>
      <span class="pk-ins-amt ${r.profit < 0 ? 'pk-ins-amt--neg' : ''}">${_signedNaira(r.profit)}</span>
    </div>`;
  return _section(`Top & Bottom earners · ${_monthLabel(e.month)}`, `
    <div class="pk-ins-cols">
      <div>
        <div class="pk-ins-collbl">Top by profit</div>
        ${top.map(row).join('')}
      </div>
      <div>
        <div class="pk-ins-collbl">Bottom by profit</div>
        ${bottom.length ? bottom.map(row).join('') : `<div class="pk-ins-empty">Fewer than 6 items sold — see Top.</div>`}
      </div>
    </div>`);
}

// ── Profit Leak Finder ────────────────────────────────────────
const _LEAK_CHIP = {
  'below-cost':     { cls: 'pk-ins-chip--danger', label: 'BELOW COST' },
  'thin-margin':    { cls: 'pk-ins-chip--warn',   label: 'THIN MARGIN' },
  'discount-heavy': { cls: 'pk-ins-chip--info',   label: 'DISCOUNT-HEAVY' },
};
function _secLeaks(leaks) {
  if (!leaks.length) return _section('Profit leak finder', `<div class="pk-ins-empty">✓ No leaks found — nothing sold below cost, under 10% margin, or heavily discounted.</div>`);
  const rows = leaks.slice(0, 12).map(l => {
    const chips = l.reasons.map(r => `<span class="pk-ins-chip ${_LEAK_CHIP[r].cls}">${_LEAK_CHIP[r].label}</span>`).join('');
    const bits = [];
    if (l.belowCostLines) bits.push(`lost ${_naira(l.belowCostLoss)} on ${l.belowCostLines} sale line${l.belowCostLines !== 1 ? 's' : ''}`);
    if (l.thinLines)      bits.push(`margin down to ${l.minMarginPct}% on ${l.thinLines} line${l.thinLines !== 1 ? 's' : ''}`);
    if (l.discountLines)  bits.push(`${_naira(l.discountTotal)} given in discounts (${l.discountLines} line${l.discountLines !== 1 ? 's' : ''})`);
    return `
      <div class="pk-ins-row pk-ins-row--leak">
        <div class="pk-ins-leakmain">
          <div>${chips}<span class="pk-ins-name">${escapeHtml(l.itemName || l.itemId)}</span></div>
          <div class="pk-ins-sub">${bits.join(' · ')}</div>
        </div>
      </div>`;
  }).join('');
  const more = leaks.length > 12 ? `<div class="pk-ins-sub" style="margin-top:8px;">+ ${leaks.length - 12} more items</div>` : '';
  return _section(`Profit leak finder · ${leaks.length} item${leaks.length !== 1 ? 's' : ''}`, rows + more);
}

// ── Sales Trends ──────────────────────────────────────────────
function _secTrends(t) {
  const weeks = t.weekly.slice(-8);
  if (!weeks.length) return _section('Sales trends', `<div class="pk-ins-empty">No sales recorded yet.</div>`);
  const maxRev = Math.max(...weeks.map(w => w.revenue), 1);
  const bars = weeks.map(w => `
    <div class="pk-ins-trow">
      <span class="pk-ins-tkey">${w.key.replace(/^\d{4}-/, '')}</span>
      <div class="pk-ins-tbars">
        <div class="pk-ins-bar pk-ins-bar--rev" style="width:${Math.max(2, Math.round((w.revenue / maxRev) * 100))}%"></div>
        <div class="pk-ins-bar pk-ins-bar--prof" style="width:${Math.max(w.profit > 0 ? 2 : 0, Math.round((Math.max(w.profit, 0) / maxRev) * 100))}%"></div>
      </div>
      <span class="pk-ins-tnums">${_naira(w.revenue)} <em>· ${_signedNaira(w.profit)}</em></span>
    </div>`).join('');
  const monthRows = t.monthly.map(m => `
    <div class="pk-ins-row">
      <span class="pk-ins-name">${_monthLabel(m.key)}</span>
      <span class="pk-ins-sub">${m.salesCount} sales</span>
      <span class="pk-ins-amt">${_naira(m.revenue)}</span>
      <span class="pk-ins-amt pk-ins-amt--prof">${_signedNaira(m.profit)}</span>
    </div>`).join('');
  return _section('Sales trends', `
    <div class="pk-ins-collbl">Weekly — <span class="pk-ins-leg pk-ins-leg--rev">revenue</span> vs <span class="pk-ins-leg pk-ins-leg--prof">profit</span></div>
    ${bars}
    <div class="pk-ins-collbl" style="margin-top:14px;">Monthly</div>
    ${monthRows}`);
}

// ── Dead / sluggish stock ─────────────────────────────────────
function _secDeadStock(dead) {
  if (!dead.length) return _section('Dead stock', `<div class="pk-ins-empty">✓ Nothing trapped — no idle or slow-moving tracked stock.</div>`);
  const totalTrapped = dead.reduce((a, d) => a + d.moneyTrapped, 0);
  const rows = dead.slice(0, 15).map(d => {
    const idle = d.daysIdle == null ? 'never sold' : `${d.daysIdle}d idle`;
    const chip = d.reason === 'idle'
      ? `<span class="pk-ins-chip pk-ins-chip--danger">IDLE</span>`
      : `<span class="pk-ins-chip pk-ins-chip--warn">SLOW · ${d.sellThroughPct}%</span>`;
    const clearance = d.suggestedSell != null
      ? `<span class="pk-ins-amt pk-ins-amt--prof">clear @ ${_naira(d.suggestedSell)} <em>(−${d.discountPct}%)</em></span>`
      : `<span class="pk-ins-sub">at/below cost — can't clear at profit</span>`;
    return `
      <div class="pk-ins-row pk-ins-row--leak">
        <div class="pk-ins-leakmain">
          <div>${chip}<span class="pk-ins-name">${escapeHtml(d.itemName || d.itemId)}</span></div>
          <div class="pk-ins-sub">${idle} · ${d.unitsSoldInWindow} sold in 50d · ${d.stockQty} ${d.buyUnit}${d.stockQty !== 1 ? 's' : ''} on hand · was ${_naira(d.currentSell)}</div>
        </div>
        <div class="pk-ins-deadright">
          <span class="pk-ins-amt pk-ins-amt--neg">${_naira(d.moneyTrapped)} trapped</span>
          ${clearance}
        </div>
      </div>`;
  }).join('');
  const more = dead.length > 15 ? `<div class="pk-ins-sub" style="margin-top:8px;">+ ${dead.length - 15} more items</div>` : '';
  return _section(`Dead stock · ${_naira(totalTrapped)} trapped across ${dead.length} item${dead.length !== 1 ? 's' : ''}`, rows + more);
}

// ── Best-supplier picks ───────────────────────────────────────
function _secBestSupplier(best) {
  if (!best.length) return _section('Best-supplier picks', `<div class="pk-ins-empty">No supplier prices logged yet — log prices via Restock to compare sources.</div>`);
  const rows = best.slice(0, 10).map(b => `
    <div class="pk-ins-row">
      <span class="pk-ins-name">${escapeHtml(b.itemName || b.itemId)}</span>
      <span class="pk-ins-sub">${escapeHtml(b.best.supplierName)} · ${_naira(b.best.price)}/${b.best.perUnit}</span>
      <span class="pk-ins-amt pk-ins-amt--prof">${b.next ? `save ${_naira(b.saving)}/${b.best.perUnit} (${b.savingPct}%)` : 'only source'}</span>
    </div>`).join('');
  const more = best.length > 10 ? `<div class="pk-ins-sub" style="margin-top:8px;">+ ${best.length - 10} more items</div>` : '';
  return _section('Best-supplier picks', rows + more);
}

function _section(title, body) {
  return `
    <div class="pk-ins-section">
      <div class="pk-ins-seclbl">${title}</div>
      ${body}
    </div>`;
}
