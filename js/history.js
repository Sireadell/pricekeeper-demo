// ============================================================
//  history.js — Business Tab: Trade History
//  Fixes this session:
//  1. Uses totalRevenue ?? revenue, totalProfit ?? profit
//  2. Voided trades excluded from stats + filtered in display
//  3. Dynamic imports inside deleteSale removed (race condition)
//  4. deleteSale replaced with void pattern (hard delete kept
//     as secondary option with confirm)
//  5. Valid/Voided/All filter dropdown
// ============================================================

import { fmt, fmtSpan, today, saveLocal, toast, escapeHtml, withLoading } from './utils.js';
import { currentUser }                   from './auth.js';
import { removeSale, voidSale }          from './db.js';
import { renderReports }                 from './reports.js';
import { renderRecentTrades }            from './trade.js';

let _historyFilter = 'valid'; // 'valid' | 'voided' | 'all'

// ── Month dropdown ────────────────────────────────────────────────────────────
export function populateWsMonths() {
  const sel = document.getElementById('wsMonth');
  if (!sel) return;
  const months = new Set();
  months.add(today().slice(0,7));
  (window._pkSales||[]).forEach(s => { if (s.date) months.add(s.date.slice(0,7)); });
  const cur = sel.value;
  sel.innerHTML = [...months].sort().reverse().map(m => {
    const [y,mo] = m.split('-');
    const label  = new Date(y, parseInt(mo)-1, 1).toLocaleDateString('en-NG',{month:'long',year:'numeric'});
    return `<option value="${m}" ${m===cur?'selected':''}>${label}</option>`;
  }).join('');
}

// ── Toggle stats panel ────────────────────────────────────────────────────────
export function toggleWsStats() {
  const panel = document.getElementById('wsStatsPanel');
  const btn   = document.getElementById('wsStatsToggleBtn');
  if (!panel) return;
  panel.classList.toggle('open');
  if (btn) btn.textContent = panel.classList.contains('open') ? '👁 Hide stats' : '👁 Show stats';
}

// ── History filter ────────────────────────────────────────────────────────────
export function setHistoryFilter(f) {
  _historyFilter = f;
  renderWholesale();
}

// ── Render Trade History ──────────────────────────────────────────────────────
export function renderWholesale() {
  const month = document.getElementById('wsMonth')?.value || today().slice(0,7);

  // All sales in selected month
  let monthSales = (window._pkSales||[]).filter(s => (s.date||'').startsWith(month));

  // Stats always use non-voided trades only
  const validSales = monthSales.filter(s => !s.voided);
  const monthRevenue = validSales.reduce((a,s) => a + (s.totalRevenue ?? s.revenue ?? 0), 0);
  const monthProfit  = validSales.reduce((a,s) => a + (s.totalProfit  ?? s.profit  ?? 0), 0);
  const monthCost    = validSales.reduce((a,s) => a + (s.totalCost    ?? 0), 0);
  const monthUnits   = validSales.reduce((a,s) => a + (s.itemCount || 1), 0);

  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  set('wsRevenue',   fmt(monthRevenue));
  set('wsTotal',     fmt(monthProfit));
  set('wsCost',      fmt(monthCost));
  set('wsUnitsSold', monthUnits);

  // Apply display filter
  if (_historyFilter === 'valid')  monthSales = monthSales.filter(s => !s.voided);
  if (_historyFilter === 'voided') monthSales = monthSales.filter(s =>  s.voided);

  const container = document.getElementById('recentTradesBody');
  if (!container) return;

  // Filter bar
  const filterBar = `
    <div class="trade-filter-bar">
      <select class="trade-filter-select" onchange="PK.setHistoryFilter(this.value)">
        <option value="valid"  ${_historyFilter==='valid' ?'selected':''}>✅ Valid trades</option>
        <option value="voided" ${_historyFilter==='voided'?'selected':''}>🚫 Voided trades</option>
        <option value="all"    ${_historyFilter==='all'   ?'selected':''}>📋 All trades</option>
      </select>
    </div>`;

  if (!monthSales.length) {
    container.innerHTML = filterBar + `<div class="empty" style="padding:24px 0;"><div class="ico">🧾</div><p>No ${_historyFilter==='valid'?'valid':_historyFilter==='voided'?'voided':''} trades this month.</p></div>`;
    return;
  }

  // Sort newest first
  const sorted = [...monthSales].sort((a,b) => (b.createdTs||0)-(a.createdTs||0));

  container.innerHTML = filterBar + sorted.map(sale => {
    const customer  = (window._pkWholesale||[]).find(c => c.id === sale.custId) || { name: sale.customerName || sale.custName || 'Walk-in' };
    const isBundled = Array.isArray(sale.items);
    const revenue   = sale.totalRevenue ?? sale.revenue ?? 0;
    const discount  = sale.totalDiscount || 0;
    const isVoided  = !!sale.voided;
    const cardId    = `trade-card-${sale.id}`;

    let itemLines = '';
    if (isBundled) {
      itemLines = sale.items.map((it,i) => {
        const disc = (it.originalRevenue||it.revenue) - it.revenue;
        return `<div class="recent-item-line">
          <span class="rsl-sn">${i+1}.</span>
          <span class="rsl-name">${escapeHtml(it.itemName)}</span>
          <span class="rsl-qty">${escapeHtml(it.label)}</span>
          <span class="rsl-amt">${fmt(it.revenue)}</span>
          ${disc>0?`<span class="rsl-disc">-${fmt(disc)}</span>`:'<span></span>'}
        </div>`;
      }).join('');
    } else {
      const qtyText = `${sale.cartons?sale.cartons+' ctn':''} ${sale.qty?sale.qty+' pcs':''}`.trim();
      itemLines = `<div class="recent-item-line">
        <span class="rsl-sn">1.</span><span class="rsl-name">${escapeHtml(sale.itemName||'—')}</span>
        <span class="rsl-qty">${qtyText}</span><span class="rsl-amt">${fmt(revenue)}</span><span></span>
      </div>`;
    }

    const itemCount  = isBundled ? sale.items.length : 1;
    const tradeLabel = sale.id || sale.createdTs?.toString().slice(-6) || '—';

    return `
      <div class="recent-sale-card${isVoided?' voided':''}" id="${cardId}">
        <div class="recent-sale-header" onclick="window.toggleTradeCard('${cardId}')">
          <div class="rsh-left">
            <div class="recent-trade-id"># ${tradeLabel}${isVoided?` <span class="void-badge">VOIDED</span>`:''}</div>
            <div class="recent-customer">🤝 ${escapeHtml(customer.name)}</div>
            <div class="recent-date">${sale.date||'—'} · ${itemCount} item${itemCount!==1?'s':''}</div>
            ${isVoided&&sale.voidReason?`<div class="void-reason">Reason: ${escapeHtml(sale.voidReason)}</div>`:''}
          </div>
          <div class="rsh-right">
            <div class="recent-total" style="${isVoided?'text-decoration:line-through;opacity:.4;':''}">${fmt(revenue)}</div>
            ${discount>0?`<div class="recent-disc-tag">-${fmt(discount)} off</div>`:''}
            <span class="trade-card-chevron">▼</span>
          </div>
        </div>
        <div class="recent-sale-body">
          <div class="recent-items">${itemLines}</div>
          ${discount>0?`<div class="recent-discount-row"><span>Discount</span><span>-${fmtSpan(discount)}</span></div>`:''}
          <div class="recent-actions">
            <button class="recent-btn print"    onclick="window.printReceipt('${sale.id}')">🖨️ Print</button>
            <button class="recent-btn download"  onclick="window.downloadReceipt('${sale.id}')">⬇️ Save</button>
            ${!isVoided
              ? `<button class="recent-btn void-btn"   onclick="window.confirmVoidTrade('${sale.id}')">🚫 Void</button>
                 <button class="recent-btn delete-btn" onclick="PK.deleteSale('${sale.id}')">🗑 Delete</button>`
              : `<span style="font-size:.7rem;color:var(--muted);align-self:center;">Voided ${sale.voidedAt?new Date(sale.voidedAt).toLocaleDateString('en-NG',{day:'numeric',month:'short'}):''}</span>`}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Void trade ────────────────────────────────────────────────────────────────
window.confirmVoidTrade = window.confirmVoidTrade || function(saleId) {
  const reason = prompt('Void this trade?\nEnter a reason (required):');
  if (reason === null) return;
  if (!reason.trim()) return toast('⚠️ Please enter a void reason', 'err');
  const sale = (window._pkSales||[]).find(s=>s.id===saleId);
  if (!sale) return;
  sale.voided     = true;
  sale.voidReason = reason.trim();
  sale.voidedAt   = Date.now();
  if (currentUser) voidSale(currentUser.uid, sale);
  saveLocal();
  renderWholesale();
  toast('🚫 Trade voided', 'ok');
};

// ── Delete sale ───────────────────────────────────────────────────────────────
// Hard delete — kept for testing. Uses static imports, no dynamic import race.
export async function deleteSale(id) {
  if (!confirm('⚠️ Permanently delete this trade?\nThis cannot be undone.')) return;
  const btn = document.querySelector(`#trade-card-${id} .recent-btn.delete-btn`);
  await withLoading(btn, async () => {
    window._pkSales = (window._pkSales||[]).filter(s=>s.id!==id);
    if (currentUser) await removeSale(currentUser.uid, id);
    saveLocal();
    renderWholesale();
    renderReports();
    renderRecentTrades();
    toast('🗑 Trade deleted', 'ok');
  });
}