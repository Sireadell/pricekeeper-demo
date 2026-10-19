// ============================================================
//  reports.js — Today Dashboard (always-visible above sub-tabs)
//  Changes this session:
//  - Profit REMOVED from day-by-day cards (stored profit is
//    unreliable for legacy trades with bad cost data)
//  - Day cards show: date, trade count, revenue only
//  - Today hero shows revenue + trend vs yesterday
//  - KPI cards: This Week | This Month | Best Day
//  - No date filter (that's the Profit tab's job)
//  - Voided trades excluded everywhere
// ============================================================

import { fmt, escapeHtml, isoDate } from './utils.js';

const _toIso = isoDate;

function _validSales() {
  return (window._pkSales || []).filter(s => !s.voided);
}

function _salesForDate(dateStr) {
  return _validSales().filter(s => (s.date || '') === dateStr);
}

function _salesForWeek() {
  const now    = new Date();
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6);
  const cutStr = _toIso(cutoff);
  return _validSales().filter(s => s.date && s.date >= cutStr);
}

function _salesForMonth() {
  const now    = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return _validSales().filter(s => (s.date||'').startsWith(prefix));
}

function _rev(sales) {
  return sales.reduce((a,s) => a + (s.totalRevenue ?? s.revenue ?? 0), 0);
}

function _units(sales) {
  return sales.reduce((a,s) => a + (s.itemCount || 1), 0);
}

function _bestDay() {
  const now    = new Date();
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 29);
  const cutStr = _toIso(cutoff);
  const byDay  = {};
  _validSales().forEach(s => {
    if (!s.date || s.date < cutStr) return;
    byDay[s.date] = (byDay[s.date] || 0) + (s.totalRevenue ?? s.revenue ?? 0);
  });
  if (!Object.keys(byDay).length) return null;
  const bestDate = Object.keys(byDay).sort((a,b) => byDay[b] - byDay[a])[0];
  return { date: bestDate, revenue: byDay[bestDate] };
}

function _trendVsYesterday(todayRev) {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yRev = _rev(_salesForDate(_toIso(yesterday)));
  if (!yRev) return null;
  const pct = ((todayRev - yRev) / yRev * 100).toFixed(0);
  return { pct: parseInt(pct), label: pct >= 0 ? `+${pct}% vs yesterday` : `${pct}% vs yesterday` };
}

function _recentDays() {
  const byDay = {};
  _validSales().forEach(s => {
    if (!s.date) return;
    if (!byDay[s.date]) byDay[s.date] = [];
    byDay[s.date].push(s);
  });
  return Object.keys(byDay)
    .sort((a,b) => b.localeCompare(a))
    .slice(0, 14)
    .map(date => ({ date, sales: byDay[date] }));
}

export function renderReports() {
  const container = document.getElementById('business-dashboard');
  if (!container) return;

  const todayStr   = _toIso(new Date());
  const todaySales = _salesForDate(todayStr);
  const todayRev   = _rev(todaySales);
  const todayUnits = _units(todaySales);
  const weekRev    = _rev(_salesForWeek());
  const monthRev   = _rev(_salesForMonth());
  const trend      = _trendVsYesterday(todayRev);
  const best       = _bestDay();
  const days       = _recentDays();
  const todayLabel = new Date().toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long' });

  container.innerHTML = `
    <!-- Today hero -->
    <div class="today-hero-card">
      <div class="today-hero-left">
        <div class="today-hero-label">Today — ${todayLabel}</div>
        <div class="today-hero-amount">${fmt(todayRev)}</div>
        ${trend
          ? `<div class="today-trend ${trend.pct>=0?'pos':'neg'}">${trend.label}</div>`
          : `<div class="today-trend neutral">No sales yesterday</div>`}
      </div>
      <div class="today-hero-right">
        <div class="today-mini-stat">
          <div class="tms-label">Items sold</div>
          <div class="tms-val">${todayUnits}</div>
        </div>
        <div class="today-mini-stat">
          <div class="tms-label">Trades</div>
          <div class="tms-val">${todaySales.length}</div>
        </div>
      </div>
    </div>

    <!-- KPI row -->
    <div class="summary-kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">This Week</div>
        <div class="kpi-rev">${fmt(weekRev)}</div>
        <div class="kpi-sub">${_units(_salesForWeek())} items</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">This Month</div>
        <div class="kpi-rev">${fmt(monthRev)}</div>
        <div class="kpi-sub">${_units(_salesForMonth())} items sold</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Best Day (30d)</div>
        <div class="kpi-rev">${best ? fmt(best.revenue) : '—'}</div>
        <div class="kpi-sub">${best ? new Date(best.date+'T00:00:00').toLocaleDateString('en-NG',{day:'numeric',month:'short'}) : 'No sales yet'}</div>
      </div>
    </div>

    <!-- Recent days — revenue only, no profit (stored profit unreliable for legacy trades) -->
    ${days.length ? `
      <div class="sec-lbl" style="margin:14px 0 8px;">🕒 Recent days</div>
      ${days.map(day => {
        const dayRev  = _rev(day.sales);
        const isToday = day.date === todayStr;
        const dateObj = new Date(day.date+'T00:00:00');
        const dateLabel = isToday ? 'Today'
          : dateObj.toLocaleDateString('en-NG',{weekday:'short',day:'numeric',month:'short'});

        // Item summary
        const itemMap = {};
        day.sales.forEach(s => {
          (s.items||[]).forEach(it => {
            if (!itemMap[it.itemName]) itemMap[it.itemName] = 0;
            itemMap[it.itemName] += (it.revenue||0);
          });
          if (!Array.isArray(s.items) && s.itemName) {
            if (!itemMap[s.itemName]) itemMap[s.itemName] = 0;
            itemMap[s.itemName] += (s.totalRevenue ?? s.revenue ?? 0);
          }
        });
        const itemLines = Object.entries(itemMap)
          .sort((a,b) => b[1]-a[1])
          .map(([name, rev]) => `
            <div class="ritem-row">
              <span class="rname">${escapeHtml(name)}</span>
              <span>${fmt(rev)}</span>
            </div>`).join('');

        return `
          <div class="report-day${isToday?' open':''}" id="rday-${day.date}">
            <div class="report-day-hdr" onclick="this.parentElement.classList.toggle('open')">
              <div>
                <div class="rdate">${dateLabel}</div>
                <div style="font-size:.65rem;color:var(--muted);margin-top:2px;">${day.sales.length} trade${day.sales.length!==1?'s':''}</div>
              </div>
              <div class="rtotal">${fmt(dayRev)}</div>
            </div>
            <div class="report-day-body">
              ${itemLines||'<div style="font-size:.72rem;color:var(--muted);">No item detail.</div>'}
            </div>
          </div>`;
      }).join('')}
    ` : `
      <div class="empty" style="padding:24px 0;">
        <div class="ico">📊</div>
        <p>No sales yet.<br>Complete a trade to see your dashboard.</p>
      </div>`}
  `;
}

export function clearReportFilter() { renderReports(); }