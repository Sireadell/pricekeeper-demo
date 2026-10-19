// ============================================================
//  business.js — Session 10
//  Changes:
//  1. Modern sidebar — icon+label, active glow, notification dot
//  2. Settings ALL wired: defaultValidOnly, defaultOwingOnly,
//     showBorrowerDays, showDebtWarning (trade tab), showCost,
//     showLowStockAlert, showProfit
//  3. Top items count = unique trades (not line appearances)
//  4. Progress bar removed from top items
//  5. Unified contacts: case-insensitive name match + debt badge
//     visible in Customers from any spelling variation
//  6. Inventory overflow fix (mobile page display rule)
//  7. Debt warning in Trade tab customer select wired via setting
// ============================================================

import { fmt, fmtSpan, uid, today, isoDate, saveLocal, toast, withLoading, findBorrowerByName, escapeHtml, itemNeedsCost, itemNeedsStock, fmtCompact, getAppSetting, setAppSetting } from './utils.js';
import { logActivity, getCurrentActor, getEffectiveSessionPerms, costBlindForCurrentRole, canPayBackDeposit } from './staff-auth.js';
import { currentUser, activeUid }        from './auth.js';
import { voidSale, saveShopProfile }     from './db.js';
import { borrowerBalance, accountStanding, unpaidTradesFor } from './borrowers.js';
import { isOneRecord, bucketLines } from './ledger.js';          // D.3.8
import { needsSwitchOver } from './one-record.js';                // D.3.8
import { _ppc, _ppr, _costPerPiece }      from './trade-modal.js';
import { db } from './firebase.js';
import { renderInsights }                 from './insights.js';   // Profit Insights panel (owner/admin)
import { pushHash } from './router.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _activePanel    = 'customers'; // Trades sub-tab removed — main Trade page covers it
let _borrowerFilter = 'owing';
let _borrowerSearch = '';
let _borrowerSort   = 'balance';
let _borrTxPage     = 0;
let _settingsTab    = 'general';

// ── Phase D.3.2 dashboard state ──────────────────────────────
let _overviewPeriod     = 'today';     // 'today' | 'week' | 'month' | 'custom'
let _overviewCustomFrom = '';
let _overviewCustomTo   = '';
let _connState          = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'live';
let _connWatcherWired   = false;
const TX_PAGE_SIZE  = 15;

// ── Settings — thin aliases over shared utils ─────────────────────────────────
const _s     = getAppSetting;
const _saveS = (k, v) => setAppSetting(k, v);

// ── Utilities ─────────────────────────────────────────────────────────────────
const _toIso  = isoDate;
const _vSales = ()=>(window._pkSales||[]).filter(s=>!s.voided);
const _rev    = a=>a.reduce((t,s)=>t+(s.totalRevenue??s.revenue??0),0);
const _units  = a=>a.reduce((t,s)=>t+(s.itemCount||1),0);

function _saleDate(d)  { return _vSales().filter(s=>(s.date||'')===d); }
function _saleWeek()   { const cut=new Date();cut.setDate(cut.getDate()-6);return _vSales().filter(s=>s.date&&s.date>=_toIso(cut)); }
function _saleMonth()  { const n=new Date();return _vSales().filter(s=>(s.date||'').startsWith(`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`)); }
function _bestDay() {
  const cut=new Date();cut.setDate(cut.getDate()-29);const by={};
  _vSales().forEach(s=>{if(!s.date||s.date<_toIso(cut))return;by[s.date]=(by[s.date]||0)+(s.totalRevenue??s.revenue??0);});
  if(!Object.keys(by).length)return null;
  const d=Object.keys(by).sort((a,b)=>by[b]-by[a])[0];return{date:d,revenue:by[d]};
}
function _trend(r) {
  const y=new Date();y.setDate(y.getDate()-1);
  const yr=_rev(_saleDate(_toIso(y)));
  if(!yr)return null;
  const p=((r-yr)/yr*100).toFixed(0);
  return{pct:parseInt(p),label:`${p>=0?'+':''}${p}% vs yesterday`};
}

// ── Phase D.3.2 dashboard helpers ────────────────────────────
const _profit = a => a.reduce((t, s) => t + (s.totalProfit ?? s.profit ?? 0), 0);
const _outstanding = () => _vSales().reduce((t, s) => t + (s.balanceOwing || 0), 0);

// Returns { sales, prevSales, rangeLabel, prevLabel } for the current period.
function _periodWindow(period) {
  const ts = _toIso(new Date());
  if (period === 'today') {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return {
      sales:     _saleDate(ts),
      prevSales: _saleDate(_toIso(y)),
      rangeLabel: 'Today',
      prevLabel:  'yesterday',
    };
  }
  if (period === 'week') {
    const start    = new Date(); start.setDate(start.getDate() - 6);
    const prevStart = new Date(); prevStart.setDate(prevStart.getDate() - 13);
    const prevEnd   = new Date(); prevEnd.setDate(prevEnd.getDate() - 7);
    return {
      sales:     _vSales().filter(s => s.date && s.date >= _toIso(start) && s.date <= ts),
      prevSales: _vSales().filter(s => s.date && s.date >= _toIso(prevStart) && s.date <= _toIso(prevEnd)),
      rangeLabel: 'Week',
      prevLabel:  'last week',
    };
  }
  if (period === 'month') {
    const now = new Date();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const pStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      sales:     _vSales().filter(s => s.date && s.date >= _toIso(mStart) && s.date <= ts),
      prevSales: _vSales().filter(s => s.date && s.date >= _toIso(pStart) && s.date <= _toIso(pEnd)),
      rangeLabel: 'Month',
      prevLabel:  'last month',
    };
  }
  // custom
  const from = _overviewCustomFrom, to = _overviewCustomTo;
  if (!from || !to) return { sales: [], prevSales: [], rangeLabel: 'Custom', prevLabel: 'prior period' };
  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to   + 'T00:00:00');
  const lenMs = Math.max(0, toD.getTime() - fromD.getTime());
  const prevTo   = new Date(fromD.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - lenMs);
  return {
    sales:     _vSales().filter(s => s.date && s.date >= from && s.date <= to),
    prevSales: _vSales().filter(s => s.date && s.date >= _toIso(prevFrom) && s.date <= _toIso(prevTo)),
    rangeLabel: 'Custom',
    prevLabel:  'prior period',
  };
}

function _trendPct(curRev, prevSales) {
  const prevR = _rev(prevSales);
  if (!prevR) return null;
  return Math.round((curRev - prevR) / prevR * 1000) / 10; // 1 decimal
}

// _fmtCompact imported from utils.js (fmtCompact). K=1K, has B suffix.

// Relative time for trade rows: "2 min ago", "1h ago"
function _relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

// Top items by units-sold today, max 4.
function _topItemsToday() {
  const ts = _toIso(new Date());
  const todaySales = _saleDate(ts);
  const byName = {};
  todaySales.forEach(s => {
    if (!Array.isArray(s.items)) return;
    s.items.forEach(it => {
      const name = it.itemName || it.name || '';
      if (!name) return;
      const qty = (it.qty || it.cartons || 0) + (it.rows || 0); // best-effort
      byName[name] = (byName[name] || 0) + (qty || 1);
    });
  });
  return Object.entries(byName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, qty]) => ({ name, qty }));
}

// D.3.2b: dashboard is now top-level. Repaint the dashboard page if it's
// the active .page container.
function _repaintDashboardIfActive() {
  const el = document.getElementById('page-dashboard');
  if (el && el.classList.contains('active')) {
    el.innerHTML = _panelOverview();
  }
}

// Online/offline + transient RECONNECTING state on offline→online flip.
function _initOverviewConnWatcher() {
  if (_connWatcherWired) return;
  _connWatcherWired = true;
  window.addEventListener('offline', () => { _connState = 'offline'; _repaintDashboardIfActive(); });
  window.addEventListener('online',  () => {
    _connState = 'reconnecting';
    _repaintDashboardIfActive();
    setTimeout(() => {
      _connState = navigator.onLine ? 'live' : 'offline';
      _repaintDashboardIfActive();
    }, 2500);
  });
  // The sync engine's own check (it pings the database) catches Wi-Fi with no
  // internet behind it, which the browser's online flag reports as online.
  window.addEventListener('pkConnChange', () => _repaintDashboardIfActive());
}

window.bizSetOverviewPeriod = function(period) {
  if (!['today','week','month','custom'].includes(period)) return;
  _overviewPeriod = period;
  if (period === 'custom' && (!_overviewCustomFrom || !_overviewCustomTo)) {
    const to = _toIso(new Date());
    const fromD = new Date(); fromD.setDate(fromD.getDate() - 6);
    _overviewCustomFrom = _toIso(fromD);
    _overviewCustomTo   = to;
  }
  _repaintDashboardIfActive();
};

window.bizSetOverviewCustomRange = function(which, val) {
  if (which === 'from') _overviewCustomFrom = val;
  if (which === 'to')   _overviewCustomTo   = val;
  if (_overviewPeriod === 'custom') _repaintDashboardIfActive();
};

window.bizGoto = function(panel) {
  const btn = document.querySelector(`.biz-nav-item[data-panel="${panel}"]`);
  window.bizNav(panel, btn);
};

// Quick-action helpers — chain top-level page switch + modal open with
// a microtask gap so the target page is mounted before the open call.
window._pkOvAddStock = function() {
  if (typeof window.switchTab === 'function') window.switchTab('inventory');
  setTimeout(() => window.openAddItemDrawer && window.openAddItemDrawer(false), 60);
};
window._pkOvAddExpense = function() {
  window.bizGoto('expenses');
  setTimeout(() => window.bizOpenExpenseForm && window.bizOpenExpenseForm(), 60);
};

// Dashboard metric-tile drill-downs — tapping a tile lands on the view behind
// the number (Outstanding → owing customers, Low Stock → low inventory, etc.).
// Setting the module-scoped panel/filter before switchTab makes renderBusiness
// open straight onto the right panel with the right filter applied.
window._pkOvGotoPanel = function(panel) {
  _activePanel = panel;
  if (typeof window.switchTab === 'function') window.switchTab('business');
};
window._pkOvViewOwing = function() {
  _custFilter = 'owing';
  window._pkOvGotoPanel('customers');
};
window._pkOvViewInventory = function() {
  if (typeof window.switchTab === 'function') window.switchTab('inventory');
};

// SVG icon library for the dashboard (replaces emoji per build spec).
// Feather-style, 24px viewBox, 1.7 stroke, currentColor.
const _ovIcon = {
  box:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.27 6.96L12 12l8.73-5.04"/><line x1="12" y1="22" x2="12" y2="12"/></svg>',
  hourglass:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h14"/><path d="M5 22h14"/><path d="M17 22v-4a5 5 0 0 0-10 0v4"/><path d="M17 2v4a5 5 0 0 1-10 0V2"/></svg>',
  alert:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  trendDown:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>',
  plus:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  banknote:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4"/><path d="M18 10v4"/></svg>',
  receipt:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16l3-2 3 2 3-2 3 2 3-2V4z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>',
};

// ── Borrower helpers ──────────────────────────────────────────────────────────
// Balance helpers consolidated — see borrowerBalance() in borrowers.js.

// ── RFM ───────────────────────────────────────────────────────────────────────
function _rfm(n,last){
  const d=last?Math.floor((Date.now()-new Date(last+'T00:00:00').getTime())/86400000):9999;
  // cls drives theme-adaptive colors via .biz-rfm-tag--* (dark + [data-theme=light]) in business.css
  if(n>=5&&d<=14)return{l:'Champion',cls:'champion'};
  if(n>=3&&d<=30)return{l:'Regular', cls:'regular'};
  if(n>=2&&d<=60)return{l:'At Risk', cls:'atrisk'};
  if(n<=2&&d<=30)return{l:'New',     cls:'new'};
  if(d>60)        return{l:'Lost',    cls:'lost'};
  return{l:'Occasional',cls:'occasional'};
}

// ── Trade ID ──────────────────────────────────────────────────────────────────
function _generateTradeId(date){
  const ds=(date||today()).replace(/-/g,'');
  const seq=String((window._pkSales||[]).length+1).padStart(3,'0');
  return`NGPKT${ds}${seq}`;
}

// ── Profit correction ─────────────────────────────────────────────────────────
// Cost is LOCKED at sale time. _fixedProfit only fills profit for lines that had
// NO cost recorded (legacy revenue-as-profit lines from before the item had a
// buy price). A line that already has a recorded cost is historical truth and is
// returned untouched — regardless of margin. (A high margin is NOT evidence of a
// wrong cost; treating it as one corrupts cost-at-time accuracy that Insights
// depends on.)
function _fixedProfit(it){
  const storedC=it.cost||0;
  if(storedC>0)return it.profit||0;                 // recorded cost → locked, untouched
  // No cost at sale time → fill from the item's CURRENT buy price (the real price
  // set in inventory before Recalc was run). Uses the same cost-per-unit source
  // of truth as the live sale-write path (trade-modal.js _costPerPiece/_ppc/_ppr)
  // so a backfilled line can never disagree with what a fresh sale of the same
  // item would cost today.
  const rev=it.revenue||0,stored=it.profit||0;
  if(!rev)return 0;
  const item=(window._pkItems||[]).find(i=>i.id===it.itemId);
  if(!item)return stored>=0?stored:0;
  const cpp=_costPerPiece(item);
  if(!cpp)return Math.max(0,stored);
  const u=it.qty||(it.cartons||0)*_ppc(item)+(it.rows||0)*_ppr(item)||1;
  return Math.max(0,rev-cpp*u);
}

// Re-fill profit for ONE sale (pure; mutates the sale). Lines with a recorded
// cost are left completely untouched — only no-cost lines are filled. Returns
// true if the sale's totals changed. Kept as a named pure function so the recalc
// behavior is unit-testable (scripts/test-recalc-profit.mjs).
function _refillSaleProfit(sale){
  if(sale.voided||!Array.isArray(sale.items))return false;
  let tp=0,tc=0;
  sale.items.forEach(it=>{
    if((it.cost||0)>0){tp+=(it.profit||0);tc+=(it.cost||0);return;}   // locked history — do not mutate
    const p=_fixedProfit(it);it.profit=p;it.cost=Math.max(0,(it.revenue||0)-p);
    tp+=p;tc+=it.cost;
  });
  if(Math.abs((sale.totalProfit||0)-tp)>10){sale.totalProfit=tp;sale.totalCost=tc;return true;}
  return false;
}

// ── Profit recalculation ──────────────────────────────────────────────────────
window.bizRecalcProfit=async function(){
  if(!confirm('Fill in profit only for sales of items that had NO cost recorded at the time.\n\nSales that already have a recorded cost are left untouched — their profit is locked at sale time and will not change.\n\nContinue?'))return;
  const btn=document.activeElement;
  await withLoading(btn, async()=>{
    let fixed=0;
    (window._pkSales||[]).forEach(sale=>{if(_refillSaleProfit(sale))fixed++;});
    saveLocal();
    if(currentUser){try{const db=await import('./db.js');for(const s of(window._pkSales||[]).filter(x=>!x.voided)){await db.saveSale(currentUser.uid,s);}}catch(e){console.error('[biz] Profit recalc cloud save failed:', e);toast('⚠️ Recalc done locally but cloud sync failed — try again','err');}}
    toast(fixed?`✅ ${fixed} trade${fixed!==1?'s':''} filled in (no-cost sales only)`:'✅ Nothing to fill — all sales already have a recorded cost','ok');
    if((_activePanel==='profit'||_activePanel==='insights')&&typeof renderInsights==='function')renderInsights();
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SHELL — modern sidebar with glow + notification dot
// ═══════════════════════════════════════════════════════════════════════════════
const NAV_ITEMS=[
  // D.3.2b: 'overview' removed — dashboard is a top-level tab now.
  // Old links to bizNav('overview') redirect to the top-level Dashboard
  // via the bizNav handler below.
  {id:'customers', icon:'users',   label:'Customers'},
  // Borrowers merged into Customers (D.3.5/D.3.6) — debt is a state, not a tab.
  // Profit Insights replaces the old Profit sub-tab (engine: insights-engine.js).
  // Cost-blind roles never see it — filtered out in _buildShell.
  {id:'insights',  icon:'chart',   label:'Insights', costGated:true},
  // Expenses: owner + admin (MISSION §7 v1.18). Cost data, so same gate as
  // Insights. Staff Log: owner only.
  {id:'expenses',  icon:'wallet',  label:'Expenses', costGated:true},
  {id:'staff-activity', icon:'badge', label:'Staff Log', ownerOnly:true},
  // Settings evicted from the sub-nav → owner-chip dropdown (#pkMenuSettings).
];

// Per-panel title shown in the page-head band above the sub-nav.
const _PANEL_TITLE={
  customers:'Customers',
  borrowers:'Customers',
  insights:'Profit insights',
  profit:'Profit insights',
  expenses:'Expenses',
  'staff-activity':'Staff activity log',
  settings:'Settings',
};

function _navIcon(id){
  const icons={
    grid:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    receipt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4v16l3-2 3 2 3-2 3 2 3-2V4"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>`,
    users:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>`,
    hand:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
    chart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
    gear:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    badge:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4V2M16 4V2"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/></svg>`,
    wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h2"/><path d="M2 10h20"/></svg>`,
  };
  return icons[id]||'';
}
function _buildShell(page){
  // Cost-gated panels (Insights = profit data) are invisible to
  // manager/cashier — same gate family as the rest of Bundle 3.
  const visibleNav = NAV_ITEMS.filter(n =>
    (!n.costGated || !costBlindForCurrentRole()) && (!n.ownerOnly || !window._staffOwnerUid));
  const navHTML=visibleNav.map(n=>`
    <button class="biz-nav-item${n.id===_activePanel?' active':''}" data-panel="${n.id}" onclick="bizNav('${n.id}',this)">
      <div class="biz-nav-icon-wrap">${_navIcon(n.icon)}</div>
      <span class="biz-nav-lbl">${n.label}</span>
      ${n.id==='borrowers'?'<span class="biz-nav-badge" id="borrowerBadge" style="display:none;"></span>':''}
    </button>`).join('');

  page.innerHTML=`
    <div class="biz-page-head">
      <div>
        <div class="biz-eyebrow">Business</div>
        <div class="biz-page-title" id="bizPageTitle">${_PANEL_TITLE[_activePanel]||'Business'}</div>
      </div>
      <button class="biz-head-refresh" onclick="window.bizRefreshActivePanel()" title="Refresh" aria-label="Refresh">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>
        Refresh
      </button>
    </div>
    <div id="biz-shell">
      <nav class="biz-nav" id="bizNav">${navHTML}</nav>
      <div class="biz-panel-area" id="bizPanelArea"></div>
    </div>`;
}

function renderBusiness(){
  const page=document.getElementById('page-business');
  if(!page)return;
  if(!document.getElementById('biz-shell')) _buildShell(page);
  _applyAppName();
  document.querySelectorAll('.biz-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.panel===_activePanel));
  _updateBadge();
  _renderPanel(_activePanel);
}
window.renderBusiness=renderBusiness;

// Settings is its own top-level page now (not a Business sub-panel). Renders
// the same settings markup + staff panel into the standalone #page-settings.
export function renderSettings(){
  const area = document.getElementById('settingsArea');
  if (!area) return;
  area.innerHTML = _panelSettings();
  const staffContainer = document.getElementById('staffPanelContainer');
  if (staffContainer && currentUser) _renderStaffPanel(staffContainer);
  else if (staffContainer) staffContainer.innerHTML = 'Sign in to manage staff accounts.';
}
window.renderSettings=renderSettings;

function _updateBadge(){
  const n=(window._pkBorrowers||[]).filter(b=>borrowerBalance(b).balance>0).length;
  const el=document.getElementById('borrowerBadge');
  if(!el)return;el.textContent=n>0?String(n):'';el.style.display=n>0?'flex':'none';
}

window.bizNav=function(panel,btn){
  // D.3.2b: legacy bizNav('overview') redirects to the top-level Dashboard
  // tab — the in-Business Overview sub-panel was promoted to a top-level
  // route in this phase.
  if (panel === 'overview') {
    if (typeof window.switchTab === 'function') window.switchTab('dashboard');
    return;
  }
  // Settings is a top-level page now — redirect legacy bizNav('settings').
  if (panel === 'settings') {
    if (typeof window.switchTab === 'function') window.switchTab('settings');
    return;
  }
  _activePanel=panel;
  document.querySelectorAll('.biz-nav-item').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  else document.querySelector(`.biz-nav-item[data-panel="${panel}"]`)?.classList.add('active');
  _renderPanel(panel);
  pushHash('business/' + panel);
};

// D.3.2b: top-level dashboard renderer. Same _panelOverview() body,
// just unwrapped from the Business panel-scroll wrapper because the
// page is now its own .page container.
export function getBizPanel() { return _activePanel; }

export function renderDashboard() {
  const el = document.getElementById('page-dashboard');
  if (!el) return;
  el.innerHTML = _panelOverview();
}

function _renderPanel(panel){
  const area = document.getElementById('bizPanelArea');
  if (!area) return;

  const titleEl = document.getElementById('bizPageTitle');
  if (titleEl) titleEl.textContent = _PANEL_TITLE[panel] || 'Business';

  const sheet = document.getElementById('borrSheet');
  if (sheet) sheet.classList.remove('open');

  switch(panel){
    case 'overview':
      area.innerHTML = _panelOverview();
      break;

    case 'borrowers':   // merged into Customers — debt is a state, not a tab
    case 'customers':
      area.innerHTML = _panelCustomers();
      // The credit-ledger drawer (reused from the old Borrowers sheet) opens
      // over the Customers panel via window.custViewLedger → bizOpenBorrower.
      if (!document.getElementById('borrSheet')) {
        const sh = document.createElement('div');
        sh.className = 'borr-sheet';
        sh.id = 'borrSheet';
        sh.innerHTML = '<div class="borr-sheet-wrap" id="borrSheetWrap"></div>';
        area.appendChild(sh);
      }
      break;

    case 'profit':   // legacy alias — old links land on Insights
    case 'insights':
      if (costBlindForCurrentRole()) { area.innerHTML = ''; break; }   // never for manager/cashier
      area.innerHTML = `<div class="panel-scroll"><div id="sub-insights"></div></div>`;
      renderInsights();
      break;

    case 'expenses':
      if (costBlindForCurrentRole()) { area.innerHTML = ''; break; }   // owner + admin only
      area.innerHTML = _panelExpenses();
      break;

    case 'staff-activity':
      if (window._staffOwnerUid) { area.innerHTML = ''; break; }       // owner only
      area.innerHTML = `<div class="panel-scroll"><div id="staffActivityPanel"><div class="biz-empty" style="padding:20px;">Loading activity log…</div></div></div>`;
      _loadActivityLog();
      break;

    // 'settings' is no longer a Business sub-panel — it's a top-level page
    // (renderSettings → #page-settings). bizNav('settings') redirects there.
  }
}
// ═══════════════════════════════════════════════════════════════════════════════
//  OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
//  Phase D.3.2 — Dashboard / Command Center
//  Visual contract: docs/mockups/D.3.2-dashboard.html
// ═══════════════════════════════════════════════════════════════════════════════
function _panelOverview(){
  _initOverviewConnWatcher();

  // ── Header date label (e.g. "Today, Wed 13 May") ─────────────
  const now = new Date();
  const wkdy = now.toLocaleDateString('en-NG', { weekday: 'short' });
  const day  = now.getDate();
  const mon  = now.toLocaleDateString('en-NG', { month: 'short' });
  const headline = `Today, ${wkdy} ${day} ${mon}`;

  // ── Period window: current + previous comparison ────────────
  const period = _overviewPeriod;
  const win = _periodWindow(period);
  const periodRev    = _rev(win.sales);
  const periodProfit = _profit(win.sales);
  const periodTxns   = win.sales.length;
  const pct          = _trendPct(periodRev, win.prevSales);
  const margin       = periodRev > 0 ? Math.round((periodProfit / periodRev) * 1000) / 10 : null;

  // ── Role-aware visibility (D.3.2b) ───────────────────────────
  // Cashier sees a restricted dashboard: no profit on hero, no Stock
  // Value / Expenses tiles, single Quick Action, no Top Items card.
  // Hero meta also strips the delta% comparison.
  const actor    = getCurrentActor();
  const isCashier = (actor?.role === 'cashier');
  const sessPerms = getEffectiveSessionPerms();
  const hideCosts = !!(sessPerms?.hideCosts) || isCashier;

  // Metric-tile drill-downs are owner/admin/manager only — a cashier's nav
  // hides Inventory/Business, so their tiles stay display-only (no link).
  const tileCls  = isCashier ? '' : ' pk-ov-tile--link';
  const tileAttr = (fn) => isCashier ? ''
    : ` role="button" tabindex="0" onclick="${fn}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}"`;

  // ── LIVE chip state ──────────────────────────────────────────
  const live = window._pkOnlineState === false ? 'offline' : _connState;
  const liveCls   = live === 'live' ? 'pk-ov-live--live' : live === 'reconnecting' ? 'pk-ov-live--reconnect' : 'pk-ov-live--offline';
  const liveLabel = live === 'live' ? 'LIVE' : live === 'reconnecting' ? 'RECONNECTING' : 'OFFLINE';
  const liveAria  = live === 'live' ? 'Live, online' : live === 'reconnecting' ? 'Reconnecting' : 'Offline';

  // ── Hero formatting ──────────────────────────────────────────
  const nf = new Intl.NumberFormat('en-NG');
  const revFmt    = `<span class="currency">₦</span>${nf.format(Math.round(periodRev))}`;
  const profitFmt = `<span class="currency">₦</span>${nf.format(Math.round(periodProfit))}`;
  const hasComparison = pct !== null;
  const deltaUp   = (pct ?? 0) > 0;
  const deltaZero = (pct ?? 0) === 0;
  const arrow = deltaZero ? '•' : (deltaUp ? '↑' : '↓');
  const deltaClass = deltaZero ? 'pk-ov-delta--flat' : (deltaUp ? 'pk-ov-delta--up' : 'pk-ov-delta--down');
  const deltaText = pct === null ? '' : `${arrow} ${Math.abs(pct).toFixed(1)}%`;
  const rangeUpper = win.rangeLabel;
  const txnLine = periodTxns === 0
    ? `<div class="pk-ov-empty-line">No sales yet ${period === 'today' ? 'today' : `for ${win.rangeLabel.toLowerCase()}`}.</div>`
    : `<div class="pk-ov-txn">${periodTxns} transaction${periodTxns === 1 ? '' : 's'}</div>`;

  // ── Tile 1: Stock value ──────────────────────────────────────
  // stockQty is denominated in item.stockUnit (set explicitly in
  // Inventory) — NOT whatever unit buyPrice happens to be priced in.
  // Multiplying the two directly only works when they happen to agree;
  // when they don't (e.g. stockUnit:'piece' but buyPrice is a per-carton
  // price), it inflates by piecesPerCarton. Convert stockQty to pieces via
  // stockUnit first, then price with _costPerPiece (already unit-aware).
  // Same root cause as the insights-engine.js / trade-payment.js /
  // inventory.js fixes — 23 Jun 2026.
  const items = window._pkItems || [];
  let stockValue = 0;
  let skuCount   = items.length;
  items.forEach(it => {
    const stockQty = parseFloat(it.stockQty) || 0;
    const unit = it.stockUnit || it.buyUnit || 'carton';
    const ppu  = unit === 'carton' ? (_ppc(it) || 1) : (unit === 'row' ? (_ppr(it) || 1) : 1);
    stockValue += (stockQty * ppu) * _costPerPiece(it);
  });

  // ── v1.0: owner/admin-only COMBINED "Items need your attention" amber card.
  // Replaces the standalone Bundle 3 needs-cost banner — its count/filter logic
  // (itemNeedsCost / reviewNeedsCost) is unchanged, just folded into line 2.
  // Line 1 is the new needs-stock-setup reminder (itemNeedsStock = tracked with
  // stockQty null; legacy untracked items are excluded by design, so the meter
  // counts post-ship items only). Each line hides at its own count 0; the whole
  // card is hidden when both are 0. Cost-blind roles get 0s → never rendered.
  // Styles are INLINE on purpose so the amber renders directly from this
  // (always-fresh) JS, immune to any stale business.css cache (5f11a70).
  const needsCostCount  = costBlindForCurrentRole() ? 0 : items.filter(itemNeedsCost).length;
  const needsStockCount = costBlindForCurrentRole() ? 0 : items.filter(itemNeedsStock).length;
  // Colors via theme tokens so the card adapts to light mode (inline styles
  // bypass stylesheet theming, so each must be a var()). The translucent amber
  // fill/border read on both backgrounds; text uses the warning ramp (bright
  // amber on dark, deep amber-brown on light); the solid CTA button keeps a
  // vivid amber fill with dark text — self-contained and legible on either bg.
  const _attnRow = (count, what, why, label, fn, divider) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0 10px 50px;${divider ? 'border-top:1px solid var(--pk-warning-border);' : ''}">
      <span style="font-size:16px;font-weight:500;color:var(--pk-warning-strong);font-variant-numeric:tabular-nums;white-space:nowrap;">${count}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;color:var(--pk-warning-strong);">${what}</div>
        <div style="font-size:11.5px;color:var(--pk-warning-fg);margin-top:2px;line-height:1.45;">${why}</div>
      </div>
      <button type="button" onclick="event.stopPropagation();window.PK?.${fn}?.()" style="background:var(--a2);color:#1a1206;border:1px solid var(--a2);border-radius:8px;font-size:12.5px;font-weight:500;font-family:inherit;padding:8px 14px;cursor:pointer;white-space:nowrap;flex-shrink:0;">${label}</button>
    </div>`;
  const attentionCard = (needsCostCount + needsStockCount) > 0 ? `
    <div style="background:var(--pk-warning-bg);border:1px solid var(--pk-warning-border);border-left:4px solid var(--pk-warning-fg);border-radius:10px;padding:14px 18px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div aria-hidden="true" style="width:38px;height:38px;border-radius:9px;background:var(--pk-warning-bg);border:1px solid var(--pk-warning-border);color:var(--pk-warning-fg);display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;">⚠</div>
        <div style="font-size:15px;font-weight:500;color:var(--pk-warning-strong);line-height:1.2;">Items need your attention</div>
      </div>
      <div style="margin-top:6px;display:flex;flex-direction:column;">
        ${needsStockCount > 0 ? _attnRow(needsStockCount, `need stock setup`, 'No low-stock alerts or count-down on sale until stock is set.', 'Set stock →', 'reviewNeedsStock', false) : ''}
        ${needsCostCount > 0 ? _attnRow(needsCostCount, `need cost`, "Profit can't be calculated on these until you add a buy price.", 'Add cost →', 'reviewNeedsCost', needsStockCount > 0) : ''}
      </div>
    </div>` : '';

  // ── Tile 2: Outstanding (sum of borrower balances) ──────────
  const outstandingTotal = (window._pkBorrowers || []).reduce((t, b) => t + Math.max(0, borrowerBalance(b).balance), 0);
  const owingBorrowers = (window._pkBorrowers || []).filter(b => borrowerBalance(b).balance > 0).length;

  // ── Tile 3: Low stock count ──────────────────────────────────
  // Must match Inventory's "Low" count exactly (getStockSummary /
  // _itemStockState): trust the persisted `low` flag and EXCLUDE sold-out
  // items (qty 0 is its own "Out" state, not Low). The earlier version
  // recomputed thresholds here, which drifted from Inventory and over-counted
  // (folded in Out items + stale recomputes → 14 vs the true 3).
  // D.3.4a — also counts items manually flagged via the inventory kebab
  // menu (restockFlag), independent of trackStock/stockQty/low.
  const lowStockCount = items.filter(it =>
    it.restockFlag === 'low' ||
    (it.trackStock && it.stockQty != null && (parseFloat(it.stockQty) || 0) > 0 && it.low)
  ).length;

  // ── Tile 4: Expenses in range ────────────────────────────────
  const expenses = window._pkExpenses || [];
  const inRange = (d) => {
    if (period === 'today')  return d === _toIso(new Date());
    if (period === 'week') {
      const start = new Date(); start.setDate(start.getDate() - 6);
      return d >= _toIso(start) && d <= _toIso(new Date());
    }
    if (period === 'month') {
      const n = new Date(); const mStart = new Date(n.getFullYear(), n.getMonth(), 1);
      return d >= _toIso(mStart) && d <= _toIso(new Date());
    }
    return _overviewCustomFrom && _overviewCustomTo
      ? (d >= _overviewCustomFrom && d <= _overviewCustomTo)
      : false;
  };
  const periodExpenses = expenses.filter(e => inRange(e.date || ''));
  const expensesTotal  = periodExpenses.reduce((t, e) => t + (e.amount || 0), 0);

  // ── Recent trades (always latest 4, regardless of period) ────
  // BUG-016: the old rule hid these rows unless a trade landed in the last 24h,
  // so a shop that sold nothing today was told "No trades yet today" while real
  // trades sat underneath it. The card says Recent Trades, not Today's Trades,
  // so show whatever the latest four are. Each row already carries its own
  // relative timestamp, which is what tells the owner how stale they are.
  const recentSales = [..._vSales()]
    .sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0))
    .slice(0, 4);
  const hasRecent = recentSales.length > 0;

  const tradeRows = recentSales.map((s, i) => {
    const cust = (window._pkWholesale || []).find(c => c.id === s.custId)?.name || s.customerName || s.custName || 'Walk-in';
    const amt  = s.totalRevenue ?? s.revenue ?? 0;
    const bal  = s.balanceOwing || 0;
    const received = s.amountReceived ?? amt;
    const itemCount = Array.isArray(s.items) ? s.items.length : (s.itemCount || 1);
    const statusKey = bal <= 0 ? 'paid' : (received > 0 ? 'partial' : 'credit');
    const statusLabel = statusKey === 'paid' ? 'PAID' : statusKey === 'partial' ? 'PARTIAL' : 'CREDIT';
    return `
      <div class="pk-ov-trade-row">
        <div>
          <div class="pk-ov-trade-name">${escapeHtml(cust)}</div>
          <div class="pk-ov-trade-meta">${itemCount} item${itemCount === 1 ? '' : 's'} · ${_relTime(s.createdTs)}</div>
        </div>
        <div class="pk-ov-trade-right">
          <div class="pk-ov-trade-amt" data-money><span class="currency">₦</span>${nf.format(Math.round(amt))}</div>
          <div class="pk-ov-trade-status pk-ov-trade-status--${statusKey}">${statusLabel}</div>
        </div>
      </div>`;
  }).join('');

  // ── Top items today ─────────────────────────────────────────
  const top = _topItemsToday();
  const topMax = top[0]?.qty || 1;
  const topRows = top.map((it, i) => {
    const w = Math.max(8, Math.round((it.qty / topMax) * 100));
    const dim = i >= 2 ? ' pk-ov-bar-fill--dim' : '';
    return `
      <div class="pk-ov-item-row">
        <div class="pk-ov-item-line">
          <span class="pk-ov-item-name">${escapeHtml(it.name)}</span>
          <span class="pk-ov-item-count" data-money>${it.qty} sold</span>
        </div>
        <div class="pk-ov-bar-track"><div class="pk-ov-bar-fill${dim}" style="width:${w}%;"></div></div>
      </div>`;
  }).join('');

  // ── Toggle ───────────────────────────────────────────────────
  const tBtn = (key, label) => `
    <button type="button" class="pk-ov-toggle-btn${period === key ? ' pk-ov-toggle-btn--active' : ''}"
      aria-pressed="${period === key ? 'true' : 'false'}"
      onclick="window.bizSetOverviewPeriod('${key}')">${label}</button>`;

  // ── Custom range row (only when 'custom' is active) ─────────
  const customRow = period !== 'custom' ? '' : `
    <div class="pk-ov-custom-row">
      <label class="pk-ov-custom-lbl">From
        <input type="date" class="pk-ov-custom-input" value="${escapeHtml(_overviewCustomFrom)}"
          onchange="window.bizSetOverviewCustomRange('from', this.value)">
      </label>
      <label class="pk-ov-custom-lbl">To
        <input type="date" class="pk-ov-custom-input" value="${escapeHtml(_overviewCustomTo)}"
          onchange="window.bizSetOverviewCustomRange('to', this.value)">
      </label>
    </div>`;

  return `<div class="panel-scroll pk-ov-scroll">
    ${attentionCard}
    <!-- Header -->
    <div class="pk-ov-header">
      <div class="pk-ov-header-left">
        <div class="pk-ov-eyebrow">Command Center</div>
        <div class="pk-ov-h1">${escapeHtml(headline)}</div>
      </div>
      <div class="pk-ov-toggle" role="group" aria-label="Date range">
        ${tBtn('today','Today')}
        ${tBtn('week','Week')}
        ${tBtn('month','Month')}
        ${tBtn('custom','Custom')}
      </div>
    </div>
    ${customRow}

    <!-- Hero -->
    <div class="pk-ov-hero">
      <div class="pk-ov-hero-glow" aria-hidden="true"></div>
      <div class="pk-ov-hero-row">
        <div class="pk-ov-hero-main">
          <div class="pk-ov-hero-label-row">
            <span class="pk-ov-small-eyebrow">Revenue · ${rangeUpper}</span>
            <span class="pk-ov-live-chip ${liveCls}" aria-label="${liveAria}">
              <span class="pk-ov-live-dot ${liveCls}-dot" aria-hidden="true"></span>
              <span class="pk-ov-live-text">${liveLabel}</span>
            </span>
          </div>
          <div class="pk-ov-revenue" data-money>${revFmt}</div>
          <div class="pk-ov-hero-meta">
            ${isCashier
              /* Cashier meta is just the txn count for the active range, no delta. */
              ? `<div class="pk-ov-txn">${periodTxns} transaction${periodTxns === 1 ? '' : 's'}${period === 'today' ? ' today' : ''}</div>`
              : `
                ${hasComparison && periodTxns > 0 ? `
                  <div>
                    <span class="pk-ov-delta ${deltaClass}" data-money><span aria-hidden="true">${arrow}</span> ${Math.abs(pct).toFixed(1)}%</span>
                    <span class="pk-ov-vs">vs ${win.prevLabel}</span>
                  </div>
                  <div class="pk-ov-divider" aria-hidden="true"></div>
                ` : ''}
                ${txnLine}
              `}
          </div>
        </div>
        ${hideCosts ? '' : `
        <div class="pk-ov-hero-side">
          <div class="pk-ov-small-eyebrow" style="margin-bottom:12px;">Profit</div>
          <div class="pk-ov-profit" data-money>${profitFmt}</div>
          <div class="pk-ov-margin" data-money>${margin === null ? '—' : margin.toFixed(1) + '% margin'}</div>
          ${expensesTotal > 0 ? `<div class="pk-ov-margin" data-money style="margin-top:6px;${periodProfit - expensesTotal < 0 ? 'color:var(--red);' : ''}"><span class="currency">₦</span>${nf.format(Math.round(periodProfit - expensesTotal))} after expenses</div>` : ''}
        </div>`}
      </div>
    </div>

    <!-- Metric tiles (admin: 4; cashier: 3) -->
    <div class="pk-ov-metrics${isCashier ? ' pk-ov-metrics--cashier' : ''}">
      ${isCashier ? '' : `
      <div class="pk-ov-tile pk-ov-cost-tile pk-ov-tile--link" role="button" tabindex="0"
           onclick="window._pkOvViewInventory()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
        <div class="pk-ov-tile-head">
          <span class="pk-ov-tile-label">Stock Value</span>
          <span class="pk-ov-tile-icon" aria-hidden="true">${_ovIcon.box}</span>
        </div>
        <div class="pk-ov-tile-value" data-money><span class="currency">₦</span>${fmtCompact(stockValue)}</div>
        <div class="pk-ov-tile-sub" data-money>${skuCount} SKU${skuCount === 1 ? '' : 's'}</div>
      </div>`}
      <div class="pk-ov-tile${tileCls}"${tileAttr('window._pkOvViewOwing()')}>
        <div class="pk-ov-tile-head">
          <span class="pk-ov-tile-label">Outstanding</span>
          <span class="pk-ov-tile-icon" aria-hidden="true">${_ovIcon.hourglass}</span>
        </div>
        <div class="pk-ov-tile-value pk-ov-tile-value--warn" data-money><span class="currency">₦</span>${nf.format(Math.round(outstandingTotal))}</div>
        <div class="pk-ov-tile-sub" data-money>${owingBorrowers} borrower${owingBorrowers === 1 ? '' : 's'}</div>
      </div>
      <div class="pk-ov-tile${tileCls}"${tileAttr('window._pkJumpToLowStock()')}>
        <div class="pk-ov-tile-head">
          <span class="pk-ov-tile-label">Low Stock</span>
          <span class="pk-ov-tile-icon" aria-hidden="true">${_ovIcon.alert}</span>
        </div>
        <div class="pk-ov-tile-value${lowStockCount > 0 ? ' pk-ov-tile-value--danger' : ''}" data-money>${lowStockCount}</div>
        <div class="pk-ov-tile-sub">items below threshold</div>
      </div>
      ${isCashier ? `
      <div class="pk-ov-tile">
        <div class="pk-ov-tile-head">
          <span class="pk-ov-tile-label">Transactions</span>
          <span class="pk-ov-tile-icon" aria-hidden="true">${_ovIcon.receipt}</span>
        </div>
        <div class="pk-ov-tile-value" data-money>${periodTxns}</div>
        <div class="pk-ov-tile-sub">today's count</div>
      </div>` : `
      <div class="pk-ov-tile pk-ov-tile--link pk-ov-expense-tile" role="button" tabindex="0"
           onclick="window._pkOvGotoPanel('expenses')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
        <div class="pk-ov-tile-head">
          <span class="pk-ov-tile-label">Expenses</span>
          <span class="pk-ov-tile-icon" aria-hidden="true">${_ovIcon.trendDown}</span>
        </div>
        <div class="pk-ov-tile-value" data-money><span class="currency">₦</span>${nf.format(Math.round(expensesTotal))}</div>
        <div class="pk-ov-tile-sub" data-money>${periodExpenses.length} ${period === 'today' ? 'entries today' : 'entries in range'}</div>
      </div>`}
    </div>

    <!-- Quick actions (admin: 4-up grid; cashier: single New Sale) -->
    <div class="pk-ov-actions-wrap">
      <div class="pk-ov-section-label">${isCashier ? 'Quick Action' : 'Quick Actions'}</div>
      <div class="pk-ov-actions${isCashier ? ' pk-ov-actions--cashier' : ''}">
        <button type="button" class="pk-ov-action pk-ov-action--primary" onclick="PK.openNewTradeModal()">
          <span class="pk-ov-action-ic" aria-hidden="true">${_ovIcon.plus}</span>
          <span>New Sale</span>
        </button>
        ${isCashier ? '' : `
        <button type="button" class="pk-ov-action" onclick="window._pkOvAddStock()">
          <span class="pk-ov-action-ic" aria-hidden="true">${_ovIcon.box}</span>
          <span>Add Stock</span>
        </button>
        <button type="button" class="pk-ov-action" onclick="window._pkOvViewOwing()">
          <span class="pk-ov-action-ic" aria-hidden="true">${_ovIcon.banknote}</span>
          <span>Record Payment</span>
        </button>
        ${costBlindForCurrentRole() ? '' : `
        <button type="button" class="pk-ov-action" onclick="window._pkOvAddExpense()">
          <span class="pk-ov-action-ic" aria-hidden="true">${_ovIcon.receipt}</span>
          <span>Add Expense</span>
        </button>`}`}
      </div>
    </div>

    <!-- Bottom row (admin: Recent Trades + Top Items; cashier: Recent Trades full width) -->
    <div class="pk-ov-bottom${isCashier ? ' pk-ov-bottom--cashier' : ''}">
      <div class="pk-ov-card">
        <div class="pk-ov-card-head">
          <span class="pk-ov-card-title">Recent Trades</span>
          <button type="button" class="pk-ov-link-gold" onclick="if(typeof window.switchTab==='function')window.switchTab('trade')">View all →</button>
        </div>
        ${hasRecent
          ? tradeRows
          : `<div class="pk-ov-empty-block">No trades recorded yet.</div>`}
      </div>

      ${isCashier ? '' : `
      <div class="pk-ov-card">
        <div class="pk-ov-card-head">
          <span class="pk-ov-card-title">Top Items Today</span>
        </div>
        ${top.length
          ? topRows
          : `<div class="pk-ov-empty-block">No sales yet today.</div>`}
      </div>`}
    </div>

  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CUSTOMERS — unified people panel (Customers + Borrowers merged).
//  Debt is a STATE (badge + Owing filter), not a separate tab.
//  Visual contract: docs/mockups/business-people-merge.html
// ═══════════════════════════════════════════════════════════════════════════════
let _custSearch = '';
let _custSort   = 'spenders';   // spenders | recent | name
let _custFilter = 'all';        // all | owing | drifting | new

// The unified people set: every customer record PLUS any credit account
// (borrower) that has no matching customer by name. Without the second half,
// people who only ever took goods on credit — and never got a customer doc —
// were invisible here, so the "owing" tile (counted from borrowers) exceeded
// the rows actually shown. Link is by normalised name (findBorrowerByName).
function _peopleRecords(){
  const norm=s=>(s||'').trim().toLowerCase();
  const customers=[...(window._pkWholesale||[])];
  const custNames=new Set(customers.map(c=>norm(c.name)));
  const creditOnly=(window._pkBorrowers||[])
    .filter(b=>b && b.name && !custNames.has(norm(b.name)))
    .map(b=>({id:b.id, name:b.name, contact:b.contact||'', _creditOnly:true}));
  return [...customers, ...creditOnly];
}

// Per-customer derived data (revenue, recent sales, debt ledger, RFM).
function _custData(){
  return _peopleRecords().map(c=>{
    const sales=(window._pkSales||[]).filter(s=>s.custId===c.id&&!s.voided);
    const rev=sales.reduce((a,s)=>a+(s.totalRevenue??s.revenue??0),0);
    const sorted=[...sales].sort((a,b)=>(b.createdTs||0)-(a.createdTs||0));
    const last=sorted[0]?.date||null;
    const lastTs=sorted[0]?.createdTs||0;
    const firstTs=sorted.length?(sorted[sorted.length-1].createdTs||0):0;
    const bor=findBorrowerByName(window._pkBorrowers,c.name)||null;
    const debt=bor?borrowerBalance(bor).balance:0;
    // D.3.5: money the shop is holding for this customer (0 when none).
    const held=bor?accountStanding(bor).deposit:0;
    const daysSince=last?Math.floor((Date.now()-new Date(last+'T00:00:00').getTime())/86400000):null;
    return{c,sales:sorted,rev,count:sales.length,last,lastTs,firstTs,bor,debt,held,daysSince,rfm:_rfm(sales.length,last)};
  });
}

// Filter + search + sort applied to the derived list.
function _custList(){
  let list=_custData();
  const now=new Date();
  const inMonth=ts=>{if(!ts)return false;const d=new Date(ts);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();};
  if(_custFilter==='owing')         list=list.filter(x=>x.debt>0);
  else if(_custFilter==='drifting') list=list.filter(x=>x.daysSince!=null&&x.daysSince>30&&x.daysSince<=60);
  else if(_custFilter==='new')      list=list.filter(x=>inMonth(x.firstTs));
  if(_custSearch){const q=_custSearch.toLowerCase();list=list.filter(x=>x.c.name.toLowerCase().includes(q)||(x.c.contact||'').toLowerCase().includes(q));}
  if(_custSort==='spenders')   list.sort((a,b)=>b.rev-a.rev);
  else if(_custSort==='recent')list.sort((a,b)=>(b.lastTs||0)-(a.lastTs||0));
  else if(_custSort==='name')  list.sort((a,b)=>a.c.name.localeCompare(b.c.name));
  return list;
}
function _custSortLabel(){return _custSort==='spenders'?'Top spenders':_custSort==='recent'?'Recent':'Name A–Z';}

// Tile metrics from the FULL set (unaffected by search/filter).
function _custStats(){
  const all=_custData(),now=new Date();
  const inMonth=ts=>{if(!ts)return false;const d=new Date(ts);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();};
  const owingBals=(window._pkBorrowers||[]).map(b=>borrowerBalance(b).balance).filter(x=>x>0);
  const total=all.length;
  const activeCount=all.filter(x=>inMonth(x.lastTs)).length;
  return{
    total,
    owed:owingBals.reduce((a,b)=>a+b,0),
    owingCount:owingBals.length,
    activeCount,
    activePct:total?Math.round(activeCount/total*100):0,
    newCount:all.filter(x=>inMonth(x.firstTs)).length,
    driftCount:all.filter(x=>x.daysSince!=null&&x.daysSince>30&&x.daysSince<=60).length,
  };
}

function _relLast(d){
  if(d==null)return 'No purchases yet';
  if(d<=0)return 'Last bought today';
  if(d===1)return 'Last bought yesterday';
  return `Last bought ${d} days ago`;
}
function _relDate(ts){
  if(!ts)return '—';
  const d=Math.floor((Date.now()-ts)/86400000);
  if(d<=0)return 'Today';
  if(d===1)return 'Yesterday';
  if(d<30)return `${d} days ago`;
  return new Date(ts).toLocaleDateString('en-NG',{day:'numeric',month:'short'});
}
// Short goods summary for a sale row: "Rice 50kg +2 more".
function _goodsSummary(sale){
  const items=sale.items||[];
  if(!items.length)return sale.itemName||'—';
  const first=items[0].itemName||'item';
  return items.length>1?`${first} +${items.length-1} more`:first;
}

// Two-line trade row (When · What · How much · Settled?).
function _custTradeRow(s){
  const bal=s.balanceOwing||0;
  const stt=bal>0?`<span class="biz-stt owing">${fmt(bal)} owing</span>`:`<span class="biz-stt paid">✓ Paid</span>`;
  return `<div class="biz-trow"><div class="l"><div class="top"><b>${escapeHtml(s.id||'—')}</b> · ${_relDate(s.createdTs)}</div>`+
    `<div class="sub">${escapeHtml(_goodsSummary(s))}</div></div>`+
    `<div class="rt"><div class="amt tnum">${fmt(s.totalRevenue??s.revenue??0).slice(1)}</div>${stt}</div></div>`;
}
// Two-line ledger row, linking debt back to its source trade.
function _custLedgerRow(t){
  const pay=t.type==='payment';
  return `<div class="biz-trow"><div class="l"><div class="top">${pay?'Payment received':'Took goods on credit'}</div>`+
    `<div class="sub">${escapeHtml(t.name||'')}${t.date?` · ${t.date}`:''}</div></div>`+
    `<div class="rt"><div class="amt tnum ${pay?'pos':'neg'}">${fmt(t.amount||0).slice(1)}</div></div></div>`;
}

// D.3.8 · account box on a customer row for a switched account: the total and
// where it comes from, worked out from the trades.
function _oneRecordBox(bor,cid){
  const st=accountStanding(bor),owing=st.owing>0,held=st.deposit>0;
  const cls=owing?'owing':held?'holding':'clear';
  return `<div class="biz-debtbox ${cls}">`+
    `<div class="biz-debt-lbl">${owing?'Owes you':held?'You are holding':'Account settled'}</div>`+
    `<div class="biz-debt-bal ${cls}">${owing?'<span class="currency">₦</span>'+fmt(st.owing).slice(1):held?'<span class="currency">₦</span>'+fmt(st.deposit).slice(1):'✓ Clear'}</div>`+
    `<div class="or-split">${_orSplit(st)}</div>`+
    `<div class="biz-cdetail-link"><a href="#" onclick="event.preventDefault();window.custViewLedger('${cid}')">Open account →</a></div>`+
  `</div>`;
}
function _orSplit(st){
  return `<div><span>From trades</span><b>${fmt(st.tradeOwing)}</b></div>`+
    `<div><span>No trade</span><b>${fmt(st.noTrade)}</b></div>`+
    `<div><span>Holding</span><b class="held">${fmt(st.deposit)}</b></div>`;
}

// Just the list rows (so search/filter can re-render this alone, keeping focus).
function _custRows(list){
  if(!list.length){
    const msg=_custSearch?`No customers match "${escapeHtml(_custSearch)}"`
      :_custFilter==='owing'?'No customers currently owing.'
      :_custFilter==='drifting'?'No drifting customers (no visit in 30–60 days).'
      :_custFilter==='new'?'No new customers this month.'
      :'No customers yet. Add one to start tracking.';
    return `<div class="biz-empty" style="padding:28px;">${msg}</div>`;
  }
  return list.map(({c,sales,rev,count,bor,debt,held,daysSince,rfm})=>{
    const recent=sales.slice(0,3);
    const tradesInner=recent.length
      ?recent.map(_custTradeRow).join('')+(count>3?`<div class="biz-cdetail-link"><a href="#" onclick="event.preventDefault();window.custViewTrades('${c.id}')">View all ${count} trades →</a></div>`:'')
      :`<div class="biz-cdetail-empty">No trades yet.</div>`;
    const txs=bor?[...(bor.transactions||[])].sort((a,x)=>(x.createdTs||0)-(a.createdTs||0)):[];
    const ledgerInner=bor&&isOneRecord(bor)?_oneRecordBox(bor,c.id):txs.length
      ?`<div class="biz-debtbox ${debt>0?'owing':held>0?'holding':'clear'}">`+
         `<div class="biz-debt-lbl">${debt>0?'Balance owing':held>0?'You are holding':'Account settled'}</div>`+
         `<div class="biz-debt-bal ${debt>0?'owing':held>0?'holding':'clear'}">${debt>0?'<span class="currency">₦</span>'+fmt(debt).slice(1):held>0?'<span class="currency">₦</span>'+fmt(held).slice(1):'✓ Clear'}</div>`+
         txs.slice(0,3).map(_custLedgerRow).join('')+
         (txs.length>3?`<div class="biz-cdetail-link"><a href="#" onclick="event.preventDefault();window.custViewLedger('${c.id}')">View full ledger · ${txs.length} entries →</a></div>`:'')+
       `</div>`
      :`<div class="biz-cdetail-empty">No credit activity.</div>`;
    return `
    <div class="biz-crow" id="cr-${c.id}">
      <div class="biz-crow-main" onclick="document.getElementById('cr-${c.id}').classList.toggle('open')">
        <div class="biz-cavatar">${escapeHtml(c.name.charAt(0).toUpperCase())}</div>
        <div class="biz-cwho">
          <div class="biz-cname">${escapeHtml(c.name)}
            <span class="biz-rfm-tag biz-rfm-tag--${rfm.cls}">${rfm.l}</span>
            ${debt>0?`<span class="biz-debt-tag">💸 owes ${fmt(debt)}</span>`:''}
            ${held>0?`<span class="biz-held-tag">holding ${fmt(held)}</span>`:''}
          </div>
          ${c.contact?`<div class="biz-ccontact">${escapeHtml(c.contact)}</div>`:''}
        </div>
        <div class="biz-cmeta">
          <div class="biz-cspent"><span class="biz-cspent-cur currency">₦</span>${fmt(rev).slice(1)}</div>
          <div class="biz-clast">${_relLast(daysSince)}</div>
        </div>
        <div class="biz-crow-chev">›</div>
      </div>
      <div class="biz-crow-detail">
        <div class="biz-cdetail-grid">
          <div><div class="biz-cdetail-lbl">Recent trades</div>${tradesInner}</div>
          <div><div class="biz-cdetail-lbl">Account</div>${ledgerInner}</div>
        </div>
        <div class="biz-cdetail-actions">
          <button class="biz-cact gold" onclick="window.custRecordPayment('${c.id}')">💰 Record payment</button>
          <button class="biz-cact" onclick="window.custAddCredit('${c.id}')">＋ Add credit</button>
          <button class="biz-cact" onclick="window.custNewTrade('${c.id}')">🛒 New trade</button>
          <button class="biz-cact" onclick="PK.editCustomer('${c.id}')">✎ Edit</button>
          <button class="biz-cact" onclick="window.exportCustomerCSV('${c.id}')">↧ Export CSV</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _panelCustomers(){
  const s=_custStats();
  const fpill=(key,label,n,cls)=>`<button class="biz-fpill${_custFilter===key?' active':''} ${cls||''}" onclick="window.bizSetCustFilter('filter','${key}')">${label}${n!=null?` <span class="biz-fpill-n">${n}</span>`:''}</button>`;
  return`<div class="biz-cust-scroll"><div class="biz-page">
    <div class="biz-toolbar">
      <div class="biz-search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="custSearchInput" placeholder="Search customers by name or phone…" value="${escapeHtml(_custSearch)}" oninput="window.bizSetCustFilter('search',this.value);window._toggleSearchClear('custSearchInput','custSearchClear')">
        <button type="button" class="biz-search-clear" id="custSearchClear" onclick="window._clearSearchBox('custSearchInput',()=>window.bizSetCustFilter('search',''),'custSearchClear')" aria-label="Clear search" ${_custSearch?'':'hidden'}>✕</button>
      </div>
      <button class="biz-btn-ghost" onclick="window.bizSetCustFilter('sort')">⇅ Sort: ${_custSortLabel()}</button>
      <button class="biz-btn-gold" onclick="PK.openCustModal()">＋ Add Customer</button>
    </div>
    ${needsSwitchOver()?`<div class="or-banner"><div><b>Business is switching to one record.</b> What each customer owes will come straight from their trades, so the two screens always agree.</div><button onclick="PK.openOneRecordReview()">Review</button></div>`:''}
    <div class="biz-tiles">
      <div class="biz-tile"><div class="biz-tile-lbl">Total customers</div><div class="biz-tile-val">${s.total}</div><div class="biz-tile-delta">${s.newCount?`+${s.newCount} this month`:'in your book'}</div></div>
      <div class="biz-tile"><div class="biz-tile-lbl">Owed to you</div><div class="biz-tile-val biz-tile-cur biz-tile-warn">${fmt(s.owed).slice(1)}</div><div class="biz-tile-delta biz-tile-delta--red">across ${s.owingCount} customer${s.owingCount!==1?'s':''}</div></div>
      <div class="biz-tile"><div class="biz-tile-lbl">Active this month</div><div class="biz-tile-val">${s.activeCount}</div><div class="biz-tile-delta biz-tile-delta--muted">${s.activePct}% of base</div></div>
      <div class="biz-tile"><div class="biz-tile-lbl">At risk / drifting</div><div class="biz-tile-val biz-tile-warn">${s.driftCount}</div><div class="biz-tile-delta biz-tile-delta--muted">no visit in 30–60d</div></div>
    </div>
    <div class="biz-fpills">
      ${fpill('all','All',s.total)}
      ${fpill('owing','💸 Owing',s.owingCount,'owing')}
      ${fpill('drifting','Drifting',s.driftCount)}
      ${fpill('new','New',s.newCount)}
    </div>
    <div class="biz-list" id="custPanelList">${_custRows(_custList())}</div>
  </div></div>`;
}

// Lightweight re-render of just the customer list (keeps the search input focused).
function refreshCustomers(){
  const list=document.getElementById('custPanelList');
  if(!list){_renderPanel('customers');return;}
  list.innerHTML=_custRows(_custList());
}
window.refreshCustomers=refreshCustomers;

window.bizSetCustFilter=function(key,val){
  if(key==='search'){_custSearch=val;refreshCustomers();return;}
  if(key==='filter'){_custFilter=val;_renderPanel('customers');return;}
  if(key==='sort'){const order=['spenders','recent','name'];_custSort=order[(order.indexOf(_custSort)+1)%order.length];_renderPanel('customers');}
};

// ── Unified-Customers action handlers ─────────────────────────────────────────
// All reuse existing, proven write paths — no new money logic. A customer ↔
// credit-account link is by name (findBorrowerByName); "Add credit" creates the
// credit account via the borrowers module's proven save path when missing.
// Credit-only rows carry a borrower id (no customer doc), so fall back to the
// borrowers list so their Record-payment / Ledger / Add-credit actions resolve.
function _custById(id){
  return (window._pkWholesale||[]).find(x=>x.id===id)
      || (window._pkBorrowers||[]).find(x=>x.id===id)
      || null;
}
function _custBorrower(c){return c?findBorrowerByName(window._pkBorrowers,c.name):null;}

window.custViewLedger=function(id){
  const b=_custBorrower(_custById(id));
  if(b&&window.bizOpenBorrower)window.bizOpenBorrower(b.id);
};
window.custRecordPayment=function(id){
  const c=_custById(id),b=_custBorrower(c);
  if(b)window.PK?.openAddPaymentModal?.(b.id);
  else toast('⚠️ No outstanding credit balance for this customer','err');
};
window.custAddCredit=async function(id){
  const c=_custById(id);if(!c)return;
  const bid=window.ensureBorrowerForName?await window.ensureBorrowerForName(c.name,c.contact||''):null;
  if(bid)window.PK?.openAddDebtModal?.(bid);
};
window.custNewTrade=function(id){
  if(window.PK?.openNewTradeModal){
    window.PK.openNewTradeModal();
    window.__PK?.populateTradeCustSelect?.(id);
  }
};
window.custViewTrades=function(id){
  window.PK?.setTradeCustomerFilter?.(id);
  if(window.switchTab)window.switchTab('trade');
  window.PK?.renderTradeTable?.();
};

// ═══════════════════════════════════════════════════════════════════════════════
//  BORROWERS
// ═══════════════════════════════════════════════════════════════════════════════
function _panelBorrowers(){
  // Read defaultOwingOnly from settings for initial default
  const defaultFilter=_s('defaultOwingOnly',true)?'owing':'all';
  if(!window._borrowerFilterSet&&_borrowerFilter==='owing') _borrowerFilter=defaultFilter;

  // D.3.5 deposits: an account now points two ways. _dep is money the shop is
  // holding FOR this person, and it is not simply a negative _bal — see
  // accountStanding() for why corrections are subtracted out first.
  let brs=[...(window._pkBorrowers||[])].map(b=>{const st=accountStanding(b);return{...b,_bal:st.balance,_debt:st.debt,_paid:st.paid,_dep:st.deposit};});
  const allC=brs.length,owingC=brs.filter(b=>b._bal>0).length;
  const holdingC=brs.filter(b=>b._dep>0).length;
  const settledC=allC-owingC-holdingC;
  const totalOwed=brs.filter(b=>b._bal>0).reduce((a,b)=>a+b._bal,0);
  const totalHeld=brs.reduce((a,b)=>a+b._dep,0);
  if(_borrowerFilter==='owing')   brs=brs.filter(b=>b._bal>0);
  if(_borrowerFilter==='holding') brs=brs.filter(b=>b._dep>0);
  if(_borrowerFilter==='settled') brs=brs.filter(b=>b._bal<=0&&b._dep<=0);
  if(_borrowerSearch){const q=_borrowerSearch.toLowerCase();brs=brs.filter(b=>b.name.toLowerCase().includes(q)||(b.phone||'').includes(q));}
  if(_borrowerSort==='balance') brs.sort((a,b)=>b._bal-a._bal);
  if(_borrowerSort==='name')    brs.sort((a,b)=>a.name.localeCompare(b.name));
  if(_borrowerSort==='recent')  brs.sort((a,b)=>(b.lastActivityTs||0)-(a.lastActivityTs||0));
  const showDays=_s('showBorrowerDays',true);

  const rows=!brs.length
    ?`<div class="biz-empty">${_borrowerSearch?`No results for "${escapeHtml(_borrowerSearch)}"`:_borrowerFilter==='owing'?'No one currently owes you.':_borrowerFilter==='holding'?'You are not holding money for anyone.':'No borrowers yet.'}</div>`
    :brs.map(b=>{
      const held=b._dep>0;
      const s=b._bal<=0&&!held;
      const lastTx=[...(b.transactions||[])].sort((a,x)=>(x.createdTs||0)-(a.createdTs||0))[0];
      const daysSince=lastTx?.date?Math.floor((Date.now()-new Date(lastTx.date+'T00:00:00').getTime())/86400000):null;
      return`<div class="borr-row" onclick="bizOpenBorrower('${b.id}')">
        <div class="borr-row-left">
          <div class="borr-avatar${held?' holding':s?' settled':''}">${escapeHtml(b.name.charAt(0).toUpperCase())}</div>
          <div class="borr-row-info">
            <div class="borr-row-name">${escapeHtml(b.name)}</div>
            ${b.phone?`<div class="borr-row-phone">${escapeHtml(b.phone)}</div>`:''}
            ${showDays&&daysSince!==null?`<div class="borr-row-days ${daysSince>30?'overdue':''}">${daysSince===0?'Active today':`${daysSince}d ago`}</div>`:''}
          </div>
        </div>
        <div class="borr-row-right">
          <div class="borr-bal ${held?'holding':s?'settled':'owing'}">${held?fmt(b._dep):s?'✅ Clear':fmt(b._bal)}</div>
          ${held?`<div class="borr-bal-sub">you are holding this</div>`:!s?`<div class="borr-bal-sub">${fmt(b._debt)} debt · ${fmt(b._paid)} paid</div>`:''}
        </div>
        <div class="borr-row-chevron">›</div>
      </div>`;
    }).join('');

  return`<div class="panel-scroll-borr">
    <div class="borr-stats-bar">
      <div class="borr-stat"><div class="borr-stat-lbl">Total</div><div class="borr-stat-val">${allC}</div></div>
      <div class="borr-stat"><div class="borr-stat-lbl">Owing</div><div class="borr-stat-val" style="color:var(--red);">${owingC}</div></div>
      <div class="borr-stat"><div class="borr-stat-lbl">Total owed</div><div class="borr-stat-val" style="color:var(--red);">${fmt(totalOwed)}</div></div>
      ${holdingC?`<div class="borr-stat"><div class="borr-stat-lbl">You are holding</div><div class="borr-stat-val borr-stat-held">${fmt(totalHeld)}</div><div class="borr-stat-sub">for ${holdingC} ${holdingC===1?'customer':'customers'}</div></div>`:''}
    </div>
    <div class="panel-toolbar" style="flex-wrap:wrap;gap:8px;">
      <div class="borr-search-wrap">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="borrowerSearchInput" class="borr-search-input" placeholder="Search…" value="${escapeHtml(_borrowerSearch)}" oninput="window.bizSetFilter('search',this.value);window._toggleSearchClear('borrowerSearchInput','borrowerSearchClear')">
        <button type="button" class="borr-search-clear" id="borrowerSearchClear" onclick="window._clearSearchBox('borrowerSearchInput',()=>window.bizSetFilter('search',''),'borrowerSearchClear')" aria-label="Clear search" ${_borrowerSearch?'':'hidden'}>✕</button>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button class="biz-fpill" onclick="window.bizSetFilter('filter','all')"     style="${_borrowerFilter==='all'    ?'background:var(--s3);color:var(--text2);':''}">All (${allC})</button>
        <button class="biz-fpill" onclick="window.bizSetFilter('filter','owing')"   style="${_borrowerFilter==='owing'  ?'background:rgba(255,71,87,.15);color:var(--red);border-color:rgba(255,71,87,.3);':''}">Owing (${owingC})</button>
        <button class="biz-fpill" onclick="window.bizSetFilter('filter','settled')" style="${_borrowerFilter==='settled'?'background:rgba(46,204,113,.1);color:var(--green);border-color:rgba(46,204,113,.3);':''}">Settled (${settledC})</button>
        ${holdingC?`<button class="biz-fpill${_borrowerFilter==='holding'?' on-holding':''}" onclick="window.bizSetFilter('filter','holding')">Holding (${holdingC})</button>`:''}
        <select class="biz-ctrl-sel" onchange="window.bizSetFilter('sort',this.value)">
          <option value="balance" ${_borrowerSort==='balance'?'selected':''}>↓ Balance</option>
          <option value="name"    ${_borrowerSort==='name'   ?'selected':''}>A–Z Name</option>
          <option value="recent"  ${_borrowerSort==='recent' ?'selected':''}>Recent first</option>
        </select>
      </div>
      <button class="btn-secondary" style="font-size:.74rem;padding:7px 13px;" onclick="PK.openBorrowerModal()">＋ Add</button>
    </div>
    <div class="panel-list" id="borrowerPanelList">${rows}</div>
  </div>`;
}

// ── Borrower detail sheet ─────────────────────────────────────────────────────
window.bizOpenBorrower=function(id){
  const b=(window._pkBorrowers||[]).find(x=>x.id===id);
  if(!b)return;
  _borrTxPage=0;_renderBorrowerSheet(b,'all');
  const sheet=document.getElementById('borrSheet');
  if(sheet)sheet.classList.add('open');
};

function _renderBorrowerSheet(b,txFilter,page){
  const wrap=document.getElementById('borrSheetWrap');if(!wrap)return;
  if(isOneRecord(b)) return _renderOneRecordSheet(b,wrap);
  const pg=page??_borrTxPage,bb=accountStanding(b),bal=bb.balance,debt=bb.debt,paid=bb.paid;
  // D.3.5: three states now, not two. Held wins over settled, because "we owe
  // this person money" is the more important fact of the two.
  const held=bb.deposit>0,settled=bal<=0&&!held;
  let txs=[...(b.transactions||[])].sort((a,x)=>(x.createdTs||0)-(a.createdTs||0));
  if(txFilter==='debt')    txs=txs.filter(t=>t.type==='debt');
  if(txFilter==='payment') txs=txs.filter(t=>t.type==='payment');
  const total=txs.length,pages=Math.ceil(total/TX_PAGE_SIZE)||1,safePg=Math.max(0,Math.min(pg,pages-1));
  const slice=txs.slice(safePg*TX_PAGE_SIZE,(safePg+1)*TX_PAGE_SIZE);

  // Running balance column
  let running=bal;
  const withRunning=slice.map(tx=>{
    const before=running;
    running=tx.type==='debt'?running-tx.amount:running+tx.amount;
    return{...tx,runningAfter:before};
  });

  wrap.innerHTML=`
    <div class="borr-sheet-hdr">
      <button class="borr-sheet-back" onclick="document.getElementById('borrSheet').classList.remove('open')">← Back</button>
      <div class="borr-sheet-name">${escapeHtml(b.name)}</div>
      <div style="display:flex;gap:5px;"><button class="ibtn edit" onclick="PK.editBorrower('${b.id}')">✏️</button>${(!window._staffOwnerUid || (window._staffPerms?.canDelete ?? false)) ? `<button class="ibtn del" onclick="PK.deleteBorrower('${b.id}')">🗑</button>` : ''}</div>
    </div>
    <div class="borr-sheet-hero ${held?'holding':settled?'settled':'owing'}">
      <div class="borr-hero-row">
        <div><div class="borr-sheet-hero-lbl">${held?'You are holding':settled?'Account Settled':'Balance Owing'}</div><div class="borr-sheet-hero-amt">${held?fmt(bb.deposit):settled?'✅ CLEAR':fmt(bal)}</div>${held?`<div class="borr-sheet-hero-note">for ${escapeHtml(b.name)}. Owes you nothing.</div>`:''}</div>
        <div class="borr-hero-stats">
          <div class="borr-hero-stat"><span>${fmt(debt)}</span><span>Total debt</span></div>
          <div class="borr-hero-stat"><span style="color:var(--green);">${fmt(paid)}</span><span>Paid</span></div>
          <div class="borr-hero-stat"><span>${(b.transactions||[]).length}</span><span>Transactions</span></div>
        </div>
      </div>
    </div>
    <div class="borr-sheet-btns">
      ${held&&canPayBackDeposit()&&unpaidTradesFor(b.name).total>0?`<button class="borr-action-btn settle" onclick="PK.settleTradesFromDeposit('${b.id}')">✓ Settle old trades</button>`:''}
      ${held&&canPayBackDeposit()?`<button class="borr-action-btn payback" onclick="PK.payBackDeposit('${b.id}')">↩ Pay it back</button>`:''}
      <button class="borr-action-btn debt" onclick="PK.openAddDebtModal('${b.id}')">＋ Add Debt</button>
      <button class="borr-action-btn pay"  onclick="PK.openAddPaymentModal('${b.id}')">💰 Payment</button>
      <button class="borr-action-btn rcpt" onclick="PK.showBorrowerReceipt('${b.id}')">🧾 Receipt</button>
      <button class="borr-action-btn rcpt" onclick="PK.printBorrowerStatement('${b.id}')">📋 Statement</button>
    </div>
    <div class="borr-tx-tabs">
      <button class="borr-tx-tab${txFilter==='all'    ?' active':''}" onclick="bizBorrowerTab('${b.id}','all',0)"    >All (${(b.transactions||[]).length})</button>
      <button class="borr-tx-tab${txFilter==='debt'   ?' active':''}" onclick="bizBorrowerTab('${b.id}','debt',0)"   >Debt (${(b.transactions||[]).filter(t=>t.type==='debt').length})</button>
      <button class="borr-tx-tab${txFilter==='payment'?' active':''}" onclick="bizBorrowerTab('${b.id}','payment',0)">Paid (${(b.transactions||[]).filter(t=>t.type==='payment').length})</button>
    </div>
    <div class="borr-tx-list">
      ${!slice.length?`<div class="biz-empty" style="padding:16px 0;">No ${txFilter==='all'?'transactions':txFilter+'s'} yet.</div>`
        :withRunning.map(tx=>`
          <div class="borr-tx-row">
            <div class="borr-tx-icon ${tx.type==='payment'?'pay':'debt'}">${tx.type==='payment'?'↓':'↑'}</div>
            <div class="borr-tx-info">
              <div class="borr-tx-name">${escapeHtml(tx.name||'—')}${tx.kind==='adjustment'?`<span class="borr-tx-tag">correction</span>`:''}</div>
              <div class="borr-tx-date">${tx.date||'—'}${tx.kind==='adjustment'?' · bill lowered, no money changed hands':''}</div>
            </div>
            <div class="borr-tx-center">
              <div class="borr-tx-amt ${tx.type==='payment'?'pos':'neg'}">${tx.type==='payment'?'-':'+'}${fmt(tx.amount||0)}</div>
              <div class="borr-tx-running">bal: ${fmt(tx.runningAfter)}</div>
            </div>
            <button class="ibtn del" style="width:22px;height:22px;font-size:.6rem;flex-shrink:0;" onclick="PK.deleteBorrowerTx('${b.id}','${tx.id}')">🗑</button>
          </div>`).join('')}
    </div>
    ${pages>1?`
    <div class="borr-tx-pages">
      <button class="borr-pg-btn" onclick="bizBorrowerTab('${b.id}','${txFilter}',${safePg-1})" ${safePg===0?'disabled':''}>‹ Prev</button>
      <span class="borr-pg-info">Page ${safePg+1} of ${pages} · ${total} total</span>
      <button class="borr-pg-btn" onclick="bizBorrowerTab('${b.id}','${txFilter}',${safePg+1})" ${safePg>=pages-1?'disabled':''}>Next ›</button>
    </div>`:''}`;
}

// D.3.8 · layout: docs/mockups/D.3.8-one-record.html, section 1. Every figure
// here is added up from the trades and the bucket lines, never stored.
function _renderOneRecordSheet(b,wrap){
  const st=accountStanding(b),owing=st.owing>0,held=st.deposit>0;
  const isOwner=!window._staffOwnerUid;
  const tag=s=>(s.amountReceived||0)>0?'PART PAID':'CREDIT';
  const tradeRows=st.trades.map(s=>`
    <div class="or-line" onclick="window.custViewTradeId?.('${s.id}')">
      <div><span class="or-tid">${escapeHtml((s.id||'').slice(-5))} ›</span><span class="or-tag">${tag(s)}</span>
        <div class="or-lsub">${escapeHtml(s.date||'')} · ${fmt(s.totalRevenue??s.revenue??0)}${(s.amountReceived||0)>0?` · paid ${fmt(s.amountReceived)}`:''}</div></div>
      <div class="or-owe">${fmt(s.balanceOwing||0)}</div>
    </div>`).join('');
  const extra=[...bucketLines(b,'noTrade'),...bucketLines(b,'held')].sort((a,x)=>(x.createdTs||0)-(a.createdTs||0));
  const sign=t=>t.bucket==='held'?(t.type==='debt'?'−':'+'):(t.type==='payment'?'−':'+');
  const extraRows=extra.map(t=>`
    <div class="or-line">
      <div>${escapeHtml(t.name||'—')}<span class="or-tag">${t.bucket==='held'?'HELD':'NO TRADE'}</span>
        <div class="or-lsub">${escapeHtml(t.date||'')}${t.performedBy?.displayName?` · by ${escapeHtml(t.performedBy.displayName)}`:''}</div></div>
      <div class="${t.bucket==='held'?'held':'or-owe'}">${sign(t)}${fmt(t.amount||0)}</div>
    </div>`).join('');
  const hist=[...(b.transactions||[])].sort((a,x)=>(x.createdTs||0)-(a.createdTs||0));
  wrap.innerHTML=`
    <div class="borr-sheet-hdr">
      <button class="borr-sheet-back" onclick="document.getElementById('borrSheet').classList.remove('open')">← Back</button>
      <div class="borr-sheet-name">${escapeHtml(b.name)}</div>
      <div style="display:flex;gap:5px;"><button class="ibtn edit" onclick="PK.editBorrower('${b.id}')">✏️</button>${(!window._staffOwnerUid || (window._staffPerms?.canDelete ?? false)) ? `<button class="ibtn del" onclick="PK.deleteBorrower('${b.id}')">🗑</button>` : ''}</div>
    </div>
    <div class="borr-sheet-hero ${owing?'owing':held?'holding':'settled'}">
      <div class="borr-sheet-hero-lbl">${owing?'Owes you':held?'You are holding':'Account Settled'}</div>
      <div class="borr-sheet-hero-amt">${owing?fmt(st.owing):held?fmt(st.deposit):'✅ CLEAR'}</div>
      ${owing&&held?`<div class="borr-sheet-hero-note">You are also holding ${fmt(st.deposit)} for them.</div>`:''}
      <div class="or-split">${_orSplit(st)}</div>
    </div>
    <div class="borr-sheet-btns">
      ${held&&owing&&canPayBackDeposit()?`<button class="borr-action-btn settle" onclick="PK.settleTradesFromDeposit('${b.id}')">✓ Use held money on debts</button>`:''}
      ${held&&canPayBackDeposit()?`<button class="borr-action-btn payback" onclick="PK.payBackDeposit('${b.id}')">↩ Pay it back</button>`:''}
      <button class="borr-action-btn debt" onclick="PK.openAddDebtModal('${b.id}')">＋ Add Debt</button>
      <button class="borr-action-btn pay"  onclick="PK.openAddPaymentModal('${b.id}')">💰 Record Payment</button>
      <button class="borr-action-btn rcpt" onclick="PK.showBorrowerReceipt('${b.id}')">🧾 Receipt</button>
      <button class="borr-action-btn rcpt" onclick="PK.printBorrowerStatement('${b.id}')">📋 Statement</button>
    </div>
    ${isOwner?`<div class="or-link">Lent cash, or an old balance? <a href="#" onclick="event.preventDefault();PK.openNoTradeDebtModal('${b.id}')">Add a debt without a trade</a></div>`:''}
    <div class="or-sec">Unpaid trades · oldest first</div>
    ${tradeRows||'<div class="biz-empty" style="padding:12px 0;">No unpaid trades.</div>'}
    <div class="or-sec">No-trade debts and held money</div>
    ${extraRows||'<div class="biz-empty" style="padding:12px 0;">None.</div>'}
    <details class="or-hist"><summary>Full history · ${hist.length} entries</summary>
      ${hist.map(t=>`<div class="or-line or-line--hist"><div>${escapeHtml(t.name||'—')}<div class="or-lsub">${escapeHtml(t.date||'')}${t.kind==='adjustment'?' · correction':''}${!t.bucket&&!t.or&&t.createdTs<(b.oneRecord?.ts||0)?' · before switch-over':''}</div></div><div>${t.type==='payment'?'−':'+'}${fmt(t.amount||0)}</div></div>`).join('')}
    </details>`;
}

// Open one trade in the Trade table from an account.
window.custViewTradeId=function(saleId){
  document.getElementById('borrSheet')?.classList.remove('open');
  if(window.switchTab)window.switchTab('trade');
  setTimeout(()=>window.PK?.expandTradeRow?.(saleId),300);
};

window.bizBorrowerTab=function(id,filter,page){
  const b=(window._pkBorrowers||[]).find(x=>x.id===id);
  if(!b)return;_borrTxPage=page||0;_renderBorrowerSheet(b,filter,page||0);
};


function refreshBorrowers(){
  const list=document.getElementById('borrowerPanelList');
  if(!list){_renderPanel('borrowers');return;}
  // Lightweight re-render of just the list
  _borrowerFilter=window._borrowerFilter||_borrowerFilter;
  _borrowerSearch=window._bizBorSearch||_borrowerSearch;
  _borrowerSort  =window._bizBorSort  ||_borrowerSort;
  let brs=[...(window._pkBorrowers||[])].map(b=>{const bb=borrowerBalance(b);return{...b,_bal:bb.balance,_debt:bb.debt,_paid:bb.paid};});
  if(_borrowerFilter==='owing')   brs=brs.filter(b=>b._bal>0);
  if(_borrowerFilter==='settled') brs=brs.filter(b=>b._bal<=0);
  if(_borrowerSearch){const q=_borrowerSearch.toLowerCase();brs=brs.filter(b=>b.name.toLowerCase().includes(q)||(b.phone||'').includes(q));}
  if(_borrowerSort==='balance') brs.sort((a,b)=>b._bal-a._bal);
  if(_borrowerSort==='name')    brs.sort((a,b)=>a.name.localeCompare(b.name));
  if(_borrowerSort==='recent')  brs.sort((a,b)=>(b.lastActivityTs||0)-(a.lastActivityTs||0));
  const showDays=_s('showBorrowerDays',true);
  list.innerHTML=!brs.length
    ?`<div class="biz-empty">${_borrowerSearch?`No results`:_borrowerFilter==='owing'?'No one currently owes you.':'No borrowers.'}</div>`
    :brs.map(b=>{
      const s=b._bal<=0;
      const lastTx=[...(b.transactions||[])].sort((a,x)=>(x.createdTs||0)-(a.createdTs||0))[0];
      const daysSince=lastTx?.date?Math.floor((Date.now()-new Date(lastTx.date+'T00:00:00').getTime())/86400000):null;
      return`<div class="borr-row" onclick="bizOpenBorrower('${b.id}')">
        <div class="borr-row-left"><div class="borr-avatar${s?' settled':''}">${escapeHtml(b.name.charAt(0).toUpperCase())}</div>
        <div class="borr-row-info"><div class="borr-row-name">${escapeHtml(b.name)}</div>${b.phone?`<div class="borr-row-phone">${escapeHtml(b.phone)}</div>`:''}${showDays&&daysSince!==null?`<div class="borr-row-days ${daysSince>30?'overdue':''}">${daysSince===0?'Active today':`${daysSince}d ago`}</div>`:''}</div></div>
        <div class="borr-row-right"><div class="borr-bal ${s?'settled':'owing'}">${s?'✅ Clear':fmt(b._bal)}</div>${!s?`<div class="borr-bal-sub">${fmt(b._debt)} debt</div>`:''}</div>
        <div class="borr-row-chevron">›</div>
      </div>`;
    }).join('');
}
window.refreshBorrowers=refreshBorrowers;// ═══════════════════════════════════════════════════════════════════════════════

// Re-renders the currently active panel cleanly.
window.bizRefreshActivePanel = function() {
  _updateBadge();
  _renderPanel(_activePanel);
};

window.bizRefreshBorrowersAndSheet = function(borrowerId) {
  _updateBadge();
  // Refresh the borrower list in the background
  if (typeof refreshBorrowers === 'function') refreshBorrowers();
  // Re-render the sheet in place so the user stays on this borrower
  if (borrowerId) {
    const b = (window._pkBorrowers || []).find(x => x.id === borrowerId);
    if (b) {
      const sheet = document.getElementById('borrSheet');
      if (sheet && sheet.classList.contains('open')) {
        _renderBorrowerSheet(b, 'all', 0);
      }
    }
  }
};

// ── Staff Management ──────────────────────────────────────────
async function _renderStaffPanel(container) {
  if (!currentUser) return;
  const sa = await import('./staff-auth.js');
  const code = await sa.getOrCreateBusinessCode(currentUser.uid);

  // Load owner-configurable role permissions (FEATURE-001)
  await sa.loadStaffPermsConfig(currentUser.uid).catch(()=>{});
  const rolePerms = {
    cashier: sa.getEffectiveRolePerms('cashier'),
    manager: sa.getEffectiveRolePerms('manager'),
    admin:   sa.getEffectiveRolePerms('admin'),
  };

  let staffList = [];
  try {
    const { collection, getDocs } = await import('./firebase.js');
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'staff'));
    staffList = snap.docs.map(d => d.data());
  } catch {}
  // Cache the full list (including archived) for both this panel
  // and the Trade-page picker. The picker filters by active !== false;
  // this UI shows active staff up top and archived staff below.
  window._pkStaffCache = staffList;
  window._pkStaff      = staffList;
  const activeStaff   = staffList.filter(s => s.active !== false);
  const archivedStaff = staffList.filter(s => s.active === false);

  // Load activity stats for each staff member
  let activityStats = {};
  try {
    const { collection: col2, getDocs: gd2, query: q2, orderBy: ob2, limit: lim2 }
      = await import('./firebase.js');
    const actSnap = await gd2(q2(col2(db, 'shops', currentUser.uid, 'activityLog'), ob2('timestamp','desc'), lim2(500)));
    actSnap.docs.forEach(d => {
      const log = d.data();
      const uname = log.performedBy?.username;
      if (!uname) return;
      if (!activityStats[uname]) activityStats[uname] = { trades: 0, total: 0, lastSeen: '' };
      activityStats[uname].total++;
      if (log.action === 'ADD_TRADE') activityStats[uname].trades++;
      if (!activityStats[uname].lastSeen || log.date > activityStats[uname].lastSeen)
        activityStats[uname].lastSeen = log.date;
    });
  } catch(e) { /* non-critical */ }

  container.innerHTML = `
    <div class="pk-biz-code-card" style="background:var(--accent-dim,rgba(0,200,150,.08));border:1px solid rgba(0,200,150,.2);border-radius:12px;padding:14px 16px;margin-bottom:20px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Your Business Code</div>
          <div id="pkBizCodeDisplay" class="pk-biz-code-mono">${code}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:4px;">Share this code with staff so they can log in. Keep it private.</div>
        </div>
        <button class="btn-secondary" style="font-size:.72rem;padding:6px 12px;flex-shrink:0;" onclick="window.bizShowBizCodeEditor(this)">
          Change
        </button>
      </div>
      <div id="pkBizCodeEditor" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed rgba(0,200,150,.25);">
        <label class="lbl" style="display:block;margin-bottom:6px;">New code (4–12 letters or digits)</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input id="pkBizCodeInput" type="text" maxlength="12"
            class="setting-input" style="flex:1 1 180px;font-family:var(--fh);font-weight:800;letter-spacing:.2em;text-transform:uppercase;text-align:left;font-size:1rem;width:auto;"
            placeholder="ASSAD24" value="${code}">
          <button class="btn-secondary" style="font-size:.74rem;padding:7px 14px;" onclick="window.bizSaveCustomBizCode()">Save</button>
          <button class="btn-secondary" style="font-size:.74rem;padding:7px 12px;" onclick="window.bizCancelBizCodeEdit()">Cancel</button>
        </div>
        <div id="pkBizCodeMsg" style="font-size:.7rem;color:var(--muted);margin-top:6px;line-height:1.5;">
          Staff use this code to log in. Changing it disables the old code immediately — share the new one with staff before they next sign in.
        </div>
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <div style="font-family:var(--fh);font-weight:700;font-size:.82rem;color:var(--text);margin-bottom:12px;">Add Staff Account</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div class="field">
          <label class="lbl">Display Name</label>
          <input type="text" id="newStaffName" placeholder="e.g. Aminu" class="setting-input" style="width:100%;">
        </div>
        <div class="field">
          <label class="lbl">Username (for login)</label>
          <input type="text" id="newStaffUsername" placeholder="e.g. aminu" class="setting-input" style="width:100%;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <div class="field">
          <label class="lbl">PIN (4 digits)</label>
          <input type="password" id="newStaffPin" placeholder="••••" maxlength="4" inputmode="numeric"
            class="setting-input" style="width:100%;text-align:center;letter-spacing:.3em;font-size:1.1rem;">
        </div>
        <div class="field">
          <label class="lbl">Role</label>
          <select id="newStaffRole" class="setting-input" style="width:100%;">
            <option value="cashier">Cashier — Trade only, no costs</option>
            <option value="manager">Manager — Trade + Inventory, sees costs, can void</option>
            <option value="admin">Admin — Everything except settings</option>
          </select>
        </div>
      </div>
      <button onclick="window.bizAddStaff()" class="btn-secondary"
        style="font-size:.76rem;padding:8px 16px;border-color:rgba(0,200,150,.3);color:var(--accent);">
        ＋ Add Staff
      </button>
    </div>

    <div>
      <div style="font-family:var(--fh);font-weight:700;font-size:.82rem;color:var(--text);margin-bottom:10px;">
        Staff Accounts (${activeStaff.length})
      </div>
      ${!activeStaff.length
        ? `<div style="font-size:.78rem;color:var(--muted);padding:10px 0;">No active staff accounts.</div>`
        : activeStaff.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--s2);border:1px solid var(--border);border-radius:10px;margin-bottom:7px;">
            <div>
              <div style="font-family:var(--fh);font-weight:700;font-size:.82rem;color:var(--text);">${s.displayName||s.username}</div>
              <div style="font-size:.68rem;color:var(--muted);margin-top:1px;">@${s.username} · ${(s.role||'cashier').charAt(0).toUpperCase()+(s.role||'cashier').slice(1)}${s.revoked?' · <span style="color:var(--red);">Disabled</span>':''}</div>
              <div style="font-size:.65rem;color:var(--accent);margin-top:3px;">
                ${(activityStats[s.username]?.trades||0)} trades · ${(activityStats[s.username]?.total||0)} actions
                ${activityStats[s.username]?.lastSeen?' · last '+activityStats[s.username].lastSeen:''}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              <button onclick="window.bizShowStaffPermsModal('${s.username}')"
                class="pk-staff-row-btn"
                title="Edit this staff member's permission overrides">
                Permissions
              </button>
              <button onclick="window.bizShowResetPinModal('${escapeHtml(s.username)}')"
                class="pk-staff-row-btn pk-staff-row-btn--reset"
                title="Reset this staff member's PIN">
                Reset PIN
              </button>
              ${!s.revoked
                ? `<button onclick="window.bizRevokeStaff('${s.username}')"
                    class="pk-staff-row-btn pk-staff-row-btn--danger">
                    Disable
                  </button>`
                : `<button onclick="window.bizEnableStaff('${s.username}')"
                    class="pk-staff-row-btn pk-staff-row-btn--ok">
                    Enable
                  </button>`}
              <button onclick="window.bizDeleteStaff('${s.username}')"
                class="pk-staff-row-btn pk-staff-row-btn--danger">
                Archive
              </button>
            </div>
          </div>`).join('')}
    </div>
    ${archivedStaff.length ? `
      <div style="margin-top:18px;">
        <div style="font-family:var(--fh);font-weight:700;font-size:.78rem;color:var(--muted);margin-bottom:10px;">
          Archived (${archivedStaff.length})
        </div>
        ${archivedStaff.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--s2);border:1px dashed var(--border);border-radius:10px;margin-bottom:7px;opacity:.7;">
            <div>
              <div style="font-family:var(--fh);font-weight:700;font-size:.82rem;color:var(--text2);">${s.displayName||s.username}</div>
              <div style="font-size:.68rem;color:var(--muted);margin-top:1px;">@${s.username} · ${(s.role||'cashier').charAt(0).toUpperCase()+(s.role||'cashier').slice(1)} · <span style="color:var(--muted);">Archived</span></div>
              <div style="font-size:.65rem;color:var(--muted);margin-top:3px;">
                ${(activityStats[s.username]?.trades||0)} historical trades preserve "By: ${s.displayName||s.username}"
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              <button onclick="window.bizRestoreStaff('${s.username}')"
                class="pk-staff-row-btn pk-staff-row-btn--ok">
                Restore
              </button>
            </div>
          </div>`).join('')}
      </div>
    ` : ''}

    <div class="pk-role-perms" style="margin-top:24px;">
      <div style="font-family:var(--fh);font-weight:700;font-size:.82rem;color:var(--text);margin-bottom:6px;">
        Role permissions
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:12px;line-height:1.5;">
        Toggle which actions each role can perform. Defaults: managers can edit and void trades; admins can also delete. Cashiers have none.
      </div>
      <table class="pk-role-perm-table">
        <thead>
          <tr>
            <th style="text-align:left;">Role</th>
            <th>Edit</th>
            <th>Void</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          ${['cashier','manager','admin'].map(role => {
            const p = rolePerms[role];
            const cell = (action) => `
              <td>
                <label class="toggle">
                  <input type="checkbox" ${p[action]?'checked':''}
                    onchange="window.bizSetRolePerm('${role}','${action}', this.checked)">
                  <span class="slider"></span>
                </label>
              </td>`;
            return `
              <tr>
                <td class="pk-role-perm-label">${role.charAt(0).toUpperCase()+role.slice(1)}</td>
                ${cell('canEdit')}
                ${cell('canVoid')}
                ${cell('canDelete')}
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn-secondary" style="font-size:.72rem;padding:6px 12px;" onclick="window.bizResetRolePerms()">
          Reset to defaults
        </button>
      </div>
    </div>

    ${_renderStaffDiscountPerms(activeStaff)}`;
}

// D.3.4a / MISSION v1.4 — per-staff discount permission UI. Each row
// has a toggle (canDiscount) + max input (maxDiscount in ₦, null =
// unlimited) + a "last used" column derived from recent trade history.
// Auto-saves on blur via debounced bizSetStaffMaxDiscount.
function _renderStaffDiscountPerms(activeStaff) {
  // Owner row first (synthetic — owner is not in the staff list).
  const ownerRow = `
    <tr class="pk-disc-row pk-disc-row--owner">
      <td>
        <div class="pk-disc-avatar pk-disc-avatar--owner">${(currentUser?.displayName || currentUser?.email || 'O')[0].toUpperCase()}</div>
        <div>
          <div class="pk-disc-name">${currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Owner'}</div>
          <div class="pk-disc-role pk-disc-role--owner">OWNER</div>
        </div>
      </td>
      <td class="pk-disc-toggle-cell"><span class="pk-disc-fixed-on">ON</span></td>
      <td class="pk-disc-max-cell">
        <input class="pk-disc-max-input pk-disc-max-input--unlimited" value="No limit" readonly>
      </td>
      <td class="pk-disc-last">—</td>
    </tr>`;

  const staffRows = activeStaff.map(s => {
    const perms = s.permissions || {};
    const canDiscount = !!perms.canDiscount;
    const maxDiscount = (perms.maxDiscount === null || typeof perms.maxDiscount === 'number')
      ? perms.maxDiscount : null;
    const role = s.role || 'cashier';
    const lastUsed = _computeLastDiscountUsed(s.username);

    const maxVal = canDiscount
      ? (maxDiscount === null ? '' : String(maxDiscount))
      : '—';
    const maxDisabled = canDiscount ? '' : 'disabled';
    const maxPlaceholder = canDiscount ? 'No limit' : '';

    return `
      <tr class="pk-disc-row" data-username="${s.username}">
        <td>
          <div class="pk-disc-avatar pk-disc-avatar--${role}">${(s.displayName || s.username || '?')[0].toUpperCase()}</div>
          <div>
            <div class="pk-disc-name">${s.displayName || s.username}</div>
            <div class="pk-disc-role pk-disc-role--${role}">${role.toUpperCase()}</div>
          </div>
        </td>
        <td class="pk-disc-toggle-cell">
          <label class="toggle pk-disc-toggle">
            <input type="checkbox" ${canDiscount ? 'checked' : ''}
              onchange="window.bizSetStaffCanDiscount('${s.username}', this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td class="pk-disc-max-cell">
          <span class="pk-disc-max-prefix" ${canDiscount ? '' : 'style="opacity:.3;"'}>₦</span>
          <input class="pk-disc-max-input" type="number" min="0" step="50"
            ${maxDisabled}
            value="${maxVal === '—' ? '' : maxVal}"
            placeholder="${maxPlaceholder}"
            onblur="window.bizSetStaffMaxDiscount('${s.username}', this.value)">
        </td>
        <td class="pk-disc-last">${lastUsed}</td>
      </tr>`;
  }).join('');

  return `
    <div class="pk-disc-section">
      <div class="pk-disc-section-h">
        <div class="pk-disc-section-title">Discount permissions</div>
        <div class="pk-disc-section-sub">Control which staff can apply per-line discounts during a sale, and cap the maximum discount each cashier can grant on a single line. Owner is unlimited.</div>
      </div>
      <table class="pk-disc-table">
        <thead>
          <tr>
            <th style="text-align:left;">Staff member</th>
            <th style="width:120px;">Can discount</th>
            <th style="width:170px;">Max per line</th>
            <th style="width:160px;">Last used</th>
          </tr>
        </thead>
        <tbody>
          ${ownerRow}
          ${staffRows || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:18px;">No active staff to configure.</td></tr>`}
        </tbody>
      </table>
      <div class="pk-disc-savebar">Changes auto-save when you tab out of the input · all changes are logged with timestamp.</div>
    </div>`;
}

// Sum line-discount amounts a staff member has granted on recent trades
// (most-recent first). Returns a short human label like "2 days ago ·
// ₦200" or "Never" when nothing found. Reads from window._pkSales.
function _computeLastDiscountUsed(username) {
  const sales = window._pkSales || [];
  // Most-recent trade by this staff that carried at least one line-discount.
  let mostRecent = null;
  for (const s of sales) {
    if (s.voided) continue;
    if (s.performedBy?.username !== username) continue;
    const lineDisc = (s.items || []).reduce((a, it) =>
      a + (it.lineDiscount ?? it.itemDiscount ?? 0), 0);
    if (lineDisc <= 0) continue;
    if (!mostRecent || (s.createdTs || 0) > (mostRecent.createdTs || 0)) {
      mostRecent = { ...s, lineDisc };
    }
  }
  if (!mostRecent) return `<span style="color:var(--muted);">Never</span>`;
  const days = Math.floor((Date.now() - (mostRecent.createdTs || 0)) / 86400000);
  const when = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  return `${when} · <span style="color:var(--text);font-weight:500;">${fmtSpan(mostRecent.lineDisc)}</span>`;
}

//  SETTINGS — all toggles now actually read and applied
// ═══════════════════════════════════════════════════════════════════════════════
function _panelSettings(){
  const toggle=(key,def,label,desc)=>{
    const on=_s(key,def);
    return`<div class="setting-row">
      <div class="setting-info"><div class="setting-label">${label}</div><div class="setting-desc">${desc}</div></div>
      <label class="toggle"><input type="checkbox" ${on?'checked':''} onchange="window.bizToggleSetting('${key}',this.checked)"><span class="slider"></span></label>
    </div>`;
  };
  // TODO(ui-polish) fix: staff accounts are owner-managed only — Firestore
  // rules block admin from creating/deleting staff (LIMITATION-001/BUG-012
  // pre-session branch is a rate-limit carve-out, not a staff-management
  // grant), so the Staff sub-tab must not render for any staff session,
  // admin included.
  const isOwnerView = !window._staffOwnerUid;
  const tab = (isOwnerView && _settingsTab === 'staff') ? 'staff' : 'general';
  // D.8.2a — offline sync status snapshot (cached, synchronous).
  const _ss = (window.syncEngine?.getStatus?.()) || { online: true, pendingCount: 0, needsReviewCount: 0, lastSyncAt: null };
  const _ssText = `${_ss.online ? 'Online' : 'Offline'}${_ss.pendingCount ? ` · ${_ss.pendingCount} pending` : ''}${_ss.lastSyncAt ? ` · last sync ${new Date(_ss.lastSyncAt).toLocaleTimeString()}` : ''}`;

  return`<div class="panel-scroll pk-settings-scroll" id="pkSettingsScroll" data-settings-tab="${tab}">

    <div class="pk-settings-tabs" role="tablist">
      <button type="button" class="pk-settings-tab" data-tab="general" role="tab" onclick="window.bizSetSettingsTab('general')">General</button>
      ${isOwnerView ? `<button type="button" class="pk-settings-tab" data-tab="staff" role="tab" onclick="window.bizSetSettingsTab('staff')">Staff</button>` : ''}
    </div>

    <div class="pk-settings-tabpanel" data-tab="general" role="tabpanel">

      <div class="settings-section">
        <div class="settings-section-title">Shop Profile</div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:12px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;">
            <div class="modal-field">
              <label class="lbl">Shop Name</label>
              <input type="text" class="setting-input" id="spName"
                placeholder="e.g. Demo Provision"
                value="${localStorage.getItem('pkAppName')||''}"
                style="width:100%;">
            </div>
            <div class="modal-field">
              <label class="lbl">Phone Number</label>
              <input type="text" class="setting-input" id="spPhone"
                placeholder="e.g. 08012345678"
                value="${(() => { try { return JSON.parse(localStorage.getItem('pkShopProfile')||'{}').phone||''; } catch { return ''; } })()}"
                style="width:100%;">
            </div>
          </div>
          <div style="width:100%;">
            <label class="lbl">Address</label>
            <input type="text" class="setting-input" id="spAddress"
              placeholder="e.g. Shop 14, Wuse Market, Abuja"
              value="${(() => { try { return JSON.parse(localStorage.getItem('pkShopProfile')||'{}').address||''; } catch { return ''; } })()}"
              style="width:100%;margin-top:5px;">
          </div>
          <button class="btn-secondary" onclick="window.bizSaveShopProfile()" style="font-size:.74rem;padding:8px 16px;">
            Save Profile
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Display</div>
        ${toggle('showProfit',true,'Show profit on trades','Display profit amount on each trade card in Trade History')}
        ${toggle('showCost',false,'Show cost prices','Show buy/cost prices in trade item breakdowns')}
        ${toggle('showDebtWarning',true,'Debt alert in Trade tab','When you select a customer who owes money, show a warning badge before saving the trade')}
        ${toggle('showLowStockAlert',true,'Low stock alert on Overview','Highlight low-stock items count with a warning colour')}
        <div class="setting-row">
          <div class="setting-info"><div class="setting-label">Light mode</div><div class="setting-desc">Switch the whole app to a light theme. Saved on this device only — staff can also toggle it from the user menu.</div></div>
          <label class="toggle"><input type="checkbox" ${currentTheme()==='light'?'checked':''} onchange="window.bizSetTheme(this.checked?'light':'dark')"><span class="slider"></span></label>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Defaults</div>
        ${toggle('defaultValidOnly',true,'Default to valid trades','Trade History opens showing Valid trades only')}
        ${toggle('defaultOwingOnly',true,'Default to owing borrowers','Borrowers panel opens showing only people who owe money')}
        ${toggle('showBorrowerDays',true,'Days-since label on borrowers','Show how many days since last transaction on each borrower row')}
        <div class="setting-row">
          <div class="setting-info"><div class="setting-label">Low-stock alert at (%)</div><div class="setting-desc">When you restock, the low-stock alert fires once stock falls to this share of the new total — no more fixed carton default. Applies to items without a custom threshold. Default 15%.</div></div>
          <input type="number" class="setting-input" value="${localStorage.getItem('pkLowStockPct')||15}" min="1" max="90" onchange="localStorage.setItem('pkLowStockPct', Math.min(90, Math.max(1, parseFloat(this.value)||15)))">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Safety</div>
        ${toggle('requireVoidReason',true,'Require reason to void','Force entry of reason text when voiding a trade')}
        ${toggle('confirmDelete',true,'Confirm before delete','Show confirmation dialog before permanently deleting a trade')}
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Data</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Fill in missing profit data</div>
            <div class="setting-desc">Only fills profit for sales of items that had no cost recorded at the time, using the item's current buy price. Sales that already have a recorded cost are left untouched — their profit stays locked at sale time. Set the correct buy price in inventory first, then run.</div>
          </div>
          <button class="btn-secondary" style="font-size:.75rem;padding:8px 14px;flex-shrink:0;" onclick="window.bizRecalcProfit()">Run</button>
        </div>
        <div class="setting-row">
          <div class="setting-info"><div class="setting-label">Default markup %</div><div class="setting-desc">Auto-applied when sell price is calculated from buy price</div></div>
          <input type="number" class="setting-input" value="${localStorage.getItem('pkMarkup')||30}" min="1" max="500" onchange="localStorage.setItem('pkMarkup',this.value)">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Offline Sync</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">Status</div>
            <div class="setting-desc" id="obxSyncStatus">${_ssText}</div>
          </div>
          <button class="btn-secondary" style="font-size:.74rem;padding:8px 14px;flex-shrink:0;" onclick="window.obxSyncNow()">Sync now</button>
        </div>
        ${_ss.needsReviewCount > 0 ? `
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label" style="color:var(--red);">${_ss.needsReviewCount} write${_ss.needsReviewCount !== 1 ? 's' : ''} need review</div>
            <div class="setting-desc">Failed to sync after 5 attempts. Clearing deletes them from the queue.</div>
          </div>
          <button class="btn-secondary" style="font-size:.74rem;padding:8px 14px;flex-shrink:0;border-color:rgba(240,149,149,.3);color:var(--red);" onclick="window.obxClearReview()">Clear queue</button>
        </div>` : ''}
      </div>

      <div class="pk-settings-footer">Settings saved automatically · PriceKeeper</div>
    </div>

    ${isOwnerView ? `<div class="pk-settings-tabpanel" data-tab="staff" role="tabpanel">
      <div class="settings-section pk-settings-section--staff">
        <div class="settings-section-title">Staff Accounts</div>
        <div id="staffPanelContainer">Loading...</div>
      </div>
    </div>` : ''}

  </div>`;
}

window.bizToggleSetting=function(key,val){
  _saveS(key,val);
  // Apply immediately where possible
  if(key==='defaultOwingOnly') _borrowerFilter=val?'owing':'all';
  toast(`${val?'✅':'⭕'} ${key.replace(/([A-Z])/g,' $1').toLowerCase()} ${val?'on':'off'}`,'ok');
};

// ── D.8.2a — Offline Sync controls (Settings → General) ───────
window.obxRefreshSyncSettings = function(){
  const el = document.getElementById('obxSyncStatus');
  if(!el || !window.syncEngine) return;
  const ss = window.syncEngine.getStatus();
  el.textContent = `${ss.online?'Online':'Offline'}${ss.pendingCount?` · ${ss.pendingCount} pending`:''}${ss.lastSyncAt?` · last sync ${new Date(ss.lastSyncAt).toLocaleTimeString()}`:''}`;
};
window.obxSyncNow = async function(){
  if(!window.syncEngine) return toast('⚠️ Sync not ready — wait a moment and try again','err');
  toast('⟳ Syncing…','ok');
  await window.syncEngine.forceDrain();
  window.obxRefreshSyncSettings();
  const s = window.syncEngine.getStatus();
  toast(s.pendingCount ? `${s.pendingCount} still pending` : '✅ All synced','ok');
};
window.obxClearReview = async function(){
  if(!window.syncEngine) return;
  const s = window.syncEngine.getStatus();
  if(!s.needsReviewCount) return;
  if(!confirm(`This will delete ${s.needsReviewCount} pending write${s.needsReviewCount!==1?'s':''} that failed to sync. Are you sure?`)) return;
  const n = await window.syncEngine.clearNeedsReview();
  toast(`🗑️ Cleared ${n} failed write${n!==1?'s':''}`,'err');
  window.obxRefreshSyncSettings();
};

window.bizSetSettingsTab=function(tab){
  if(tab!=='general'&&tab!=='staff')return;
  if(tab==='staff'&&window._staffOwnerUid)return; // owner-only, see TODO(ui-polish) fix
  _settingsTab=tab;
  const el=document.getElementById('pkSettingsScroll');
  if(el)el.setAttribute('data-settings-tab',tab);
};

window.bizSetRolePerm = async function(role, action, value) {
  if (!currentUser) return toast('⚠️ Sign in first', 'err');
  if (!['cashier','manager','admin'].includes(role)) return;
  if (!['canEdit','canVoid','canDelete'].includes(action)) return;
  const sa = await import('./staff-auth.js');
  try {
    await sa.saveStaffPermsConfig(currentUser.uid, { [role]: { [action]: !!value } });
    sa.logActivity('UPDATE_ROLE_PERM', { role, action, value: !!value });
    toast(`✅ ${role} · ${action.replace(/^can/,'').toLowerCase()} ${value?'enabled':'disabled'}`, 'ok');
  } catch (e) {
    console.error('[biz] saveStaffPermsConfig failed:', e);
    toast('⚠️ Could not save role permissions — check Firestore rules', 'err');
    // Re-render to revert UI
    const c = document.getElementById('staffPanelContainer');
    if (c) _renderStaffPanel(c);
  }
};

window.bizShowStaffPermsModal = async function(username) {
  if (!currentUser) return toast('⚠️ Sign in first', 'err');
  const staff = (window._pkStaffCache || []).find(s => s.username === username);
  if (!staff) return toast('⚠️ Staff member not found', 'err');
  const sa = await import('./staff-auth.js');
  const rolePerms = sa.getEffectiveRolePerms(staff.role || 'cashier');
  const ov = staff.permissions || {};
  const roleLabel = (staff.role || 'cashier').charAt(0).toUpperCase() + (staff.role || 'cashier').slice(1);

  const select = (action) => {
    const cur = typeof ov[action] === 'boolean' ? String(ov[action]) : '';
    const def = rolePerms[action] ? 'Allow' : 'Deny';
    return `
      <div class="pk-sp-row">
        <div>
          <div class="pk-sp-action">${action.replace(/^can/,'')}</div>
          <div class="pk-sp-default">Role default: <strong>${def}</strong></div>
        </div>
        <select class="setting-input" data-action="${action}" style="width:120px;">
          <option value=""     ${cur===''     ?'selected':''}>Default</option>
          <option value="true" ${cur==='true' ?'selected':''}>Allow</option>
          <option value="false"${cur==='false'?'selected':''}>Deny</option>
        </select>
      </div>`;
  };

  let modal = document.getElementById('pkStaffPermsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pkStaffPermsModal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="rm-overlay" onclick="if(event.target===this)document.getElementById('pkStaffPermsModal').style.display='none'">
      <div class="rm-modal pk-sp-modal">
        <div class="eh-header">
          <div>
            <div class="eh-title">${staff.displayName || staff.username}</div>
            <div style="font-size:.7rem;color:var(--muted);margin-top:2px;">@${staff.username} · ${roleLabel}</div>
          </div>
          <button class="rm-btn close" onclick="document.getElementById('pkStaffPermsModal').style.display='none'">Close</button>
        </div>
        <div class="eh-body" style="gap:10px;">
          <div style="font-size:.72rem;color:var(--muted);line-height:1.5;">
            Per-staff overrides take precedence over role defaults. Choose "Default" to follow the role's setting.
          </div>
          ${select('canEdit')}
          ${select('canVoid')}
          ${select('canDelete')}
        </div>
        <div class="rm-actions">
          <button class="rm-btn close" onclick="document.getElementById('pkStaffPermsModal').style.display='none'">Cancel</button>
          <button class="rm-btn print" onclick="window.bizSaveStaffPerms('${username}')">Save</button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
};

window.bizSaveStaffPerms = async function(username) {
  if (!currentUser) return toast('⚠️ Sign in first', 'err');
  const modal = document.getElementById('pkStaffPermsModal');
  if (!modal) return;
  const selects = modal.querySelectorAll('select[data-action]');
  const perms = {};
  selects.forEach(sel => {
    const action = sel.dataset.action;
    const val = sel.value;
    perms[action] = val === '' ? null : (val === 'true');
  });
  const sa = await import('./staff-auth.js');
  try {
    await sa.saveStaffPermissions(currentUser.uid, username, perms);
    sa.logActivity('UPDATE_STAFF_PERMISSIONS', { username, permissions: perms });
    toast('✅ Staff permissions updated', 'ok');
    modal.style.display = 'none';
    const c = document.getElementById('staffPanelContainer');
    if (c) _renderStaffPanel(c);
  } catch (e) {
    console.error('[biz] saveStaffPermissions failed:', e);
    toast('⚠️ Could not save permissions', 'err');
  }
};

window.bizShowBizCodeEditor = function() {
  const ed = document.getElementById('pkBizCodeEditor');
  if (ed) ed.style.display = 'block';
  document.getElementById('pkBizCodeInput')?.focus();
};

window.bizCancelBizCodeEdit = function() {
  const ed = document.getElementById('pkBizCodeEditor');
  if (ed) ed.style.display = 'none';
  const msg = document.getElementById('pkBizCodeMsg');
  if (msg) {
    msg.textContent = 'Staff use this code to log in. Changing it disables the old code immediately — share the new one with staff before they next sign in.';
    msg.style.color = 'var(--muted)';
  }
};

window.bizSaveCustomBizCode = async function() {
  if (!currentUser) return toast('⚠️ Sign in first', 'err');
  const inp = document.getElementById('pkBizCodeInput');
  const msg = document.getElementById('pkBizCodeMsg');
  const raw = (inp?.value || '').trim().toUpperCase();
  if (!msg) return;
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Updating…';
  const sa = await import('./staff-auth.js');
  try {
    const newCode = await sa.setCustomBusinessCode(currentUser.uid, raw);
    const disp = document.getElementById('pkBizCodeDisplay');
    if (disp) disp.textContent = newCode;
    sa.logActivity('CHANGE_BUSINESS_CODE', { newCode });
    toast(`✅ Business code is now ${newCode}`, 'ok');
    window.bizCancelBizCodeEdit();
  } catch (e) {
    console.error('[biz] setCustomBusinessCode failed:', e);
    msg.style.color = 'var(--red)';
    msg.textContent = e?.message || 'Could not update code. Try again.';
  }
};

window.bizResetRolePerms = async function() {
  if (!currentUser) return toast('⚠️ Sign in first', 'err');
  if (!confirm('Reset all role permissions back to defaults?\n\nCashier: nothing\nManager: edit + void\nAdmin: edit + void + delete')) return;
  const sa = await import('./staff-auth.js');
  const reset = {
    cashier: { canEdit:false, canVoid:false, canDelete:false },
    manager: { canEdit:true,  canVoid:true,  canDelete:false },
    admin:   { canEdit:true,  canVoid:true,  canDelete:true  },
  };
  try {
    await sa.saveStaffPermsConfig(currentUser.uid, reset);
    sa.logActivity('RESET_ROLE_PERMS', {});
    toast('✅ Role permissions reset to defaults', 'ok');
  } catch (e) {
    console.error('[biz] reset role perms failed:', e);
    toast('⚠️ Could not save reset — check Firestore rules', 'err');
  }
  const c = document.getElementById('staffPanelContainer');
  if (c) _renderStaffPanel(c);
};

// ── Void / Delete ─────────────────────────────────────────────────────────────
window.bizVoidTrade=function(saleId){
  const mustR=_s('requireVoidReason',true);
  let reason='';
  if(mustR){reason=prompt('Void this trade?\nEnter a reason (required):');if(reason===null)return;if(!reason.trim())return toast('⚠️ Enter a void reason','err');}
  const sale=(window._pkSales||[]).find(s=>s.id===saleId);if(!sale)return;
  sale.voided=true;sale.voidReason=reason.trim()||'Voided';sale.voidedAt=Date.now();sale.voidedBy=getCurrentActor();
  if(currentUser)voidSale(currentUser.uid,sale);
  logActivity('VOID_TRADE',{tradeId:sale.id,reason:sale.voidReason,amount:sale.totalRevenue??sale.revenue??0});
  saveLocal();_updateBadge();_renderPanel('trades');toast('🚫 Trade voided','ok');
};
window.bizDeleteTrade=async function(id){
  if(_s('confirmDelete',true)&&!confirm('⚠️ Permanently delete this trade?'))return;
  const btn=document.activeElement;
  await withLoading(btn, async()=>{
    const _delSale=(window._pkSales||[]).find(s=>s.id===id);
    window._pkSales=(window._pkSales||[]).filter(s=>s.id!==id);
    if(currentUser){const db=await import('./db.js');await db.removeSale(currentUser.uid,id);}
    logActivity('DELETE_TRADE',{tradeId:id,amount:_delSale?.totalRevenue??_delSale?.revenue??0});
    saveLocal();_renderPanel('trades');toast('🗑 Trade deleted','ok');
  });
};

// ── Window setters ─────────────────────────────────────────────────────────────
window.bizSetFilter=function(key,val){
  if(key==='filter'){_borrowerFilter=val;window._borrowerFilter=val;}
  if(key==='search'){_borrowerSearch=val;window._bizBorSearch=val;}
  if(key==='sort')  {_borrowerSort=val;  window._bizBorSort=val;}
  refreshBorrowers();
};

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPENSES — Firestore-backed with filters, edit, custom confirm
// ═══════════════════════════════════════════════════════════════════════════════
const EXP_CATS = ['Transport','Stall Rent','Loading Fee','Electricity','Staff','Packaging','Other'];
let _expFilterCat  = '';
let _expFilterFrom = '';
let _expFilterTo   = '';
let _expEditingId  = '';

const _activeExpUid = activeUid;

// D.8.2b sub-step 2b — expense writes ride the write gateway (window.gwWrite,
// same pattern as suppliers-store.js): offline they QUEUE (owner-stamped,
// retried by the sync engine) instead of hanging on a direct setDoc that
// never resolves. gwWrite only rejects on real (non-network) failures —
// both paths now toast those instead of swallowing.
// Both return false on a real failure so the caller skips its success toast;
// the two used to fire together, and a rejected write read as saved.
async function _expSaveToDB(exp) {
  const auid = _activeExpUid();
  if (!auid) return true;
  try {
    await window.gwWrite('set', 'expenses', exp.id, exp);
    return true;
  } catch (err) {
    console.error('[expenses] Firestore save failed:', err);
    toast('⚠️ Expense saved locally but cloud sync failed', 'err');
    return false;
  }
}

async function _expDeleteFromDB(id) {
  const auid = _activeExpUid();
  if (!auid) return true;
  try {
    await window.gwWrite('delete', 'expenses', id, null);
    return true;
  } catch (err) {
    console.error('[expenses] Firestore delete failed:', err);
    toast('⚠️ Expense removed locally but cloud delete failed', 'err');
    return false;
  }
}

function _expFiltered() {
  let exps = [...(window._pkExpenses || [])];
  if (_expFilterCat)  exps = exps.filter(e => e.cat === _expFilterCat);
  if (_expFilterFrom) exps = exps.filter(e => (e.date || '') >= _expFilterFrom);
  if (_expFilterTo)   exps = exps.filter(e => (e.date || '') <= _expFilterTo);
  return exps.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0));
}

function _panelExpenses() {
  window._pkExpenses = window._pkExpenses || [];
  const filtered = _expFiltered();
  const filteredTotal = filtered.reduce((a, e) => a + (e.amount || 0), 0);
  const allTotal = window._pkExpenses.reduce((a, e) => a + (e.amount || 0), 0);

  const byCat = {};
  filtered.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + (e.amount || 0); });
  const catBreakdown = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `
    <div class="exp-cat-row">
      <span class="exp-cat-name">${escapeHtml(cat)}</span>
      <span class="exp-cat-amt">${fmt(amt)}</span>
    </div>`).join('');

  const hasFilter = !!(_expFilterCat || _expFilterFrom || _expFilterTo);
  const filterLabel = hasFilter ? 'Filtered' : 'This month';
  const summaryVal = hasFilter
    ? filteredTotal
    : window._pkExpenses.filter(e => (e.date || '').startsWith(today().slice(0, 7))).reduce((a, e) => a + (e.amount || 0), 0);

  const rows = !filtered.length
    ? `<div class="biz-empty">${hasFilter ? 'No expenses match your filters.' : 'No expenses recorded yet.'}</div>`
    : filtered.map(e => `
      <div class="exp-row">
        <div class="exp-row-left">
          <div class="exp-row-cat">${escapeHtml(e.cat || 'Other')}</div>
          <div class="exp-row-desc">${escapeHtml(e.desc || '—')}</div>
          <div class="exp-row-date">${e.date || '—'}</div>
        </div>
        <div class="exp-row-right">
          <div class="exp-row-amt">−${fmtSpan(e.amount || 0)}</div>
          <button class="ibtn edit" onclick="window.bizEditExpense('${e.id}')">✏️</button>
          <button class="ibtn del" onclick="window.bizDeleteExpense('${e.id}')">🗑</button>
        </div>
      </div>`).join('');

  return `<div class="panel-scroll">
    <div class="exp-summary-bar">
      <div class="ov-kpi-card"><div class="ov-kpi-lbl">${filterLabel}</div><div class="ov-kpi-val" style="color:var(--red);">${fmt(summaryVal)}</div></div>
      <div class="ov-kpi-card"><div class="ov-kpi-lbl">All time</div><div class="ov-kpi-val" style="color:var(--red);">${fmt(allTotal)}</div></div>
    </div>

    <div class="exp-filters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
      <select class="biz-ctrl-sel" style="font-size:.72rem;padding:6px 10px;" onchange="window.bizSetExpFilter('cat',this.value)">
        <option value="">All categories</option>
        ${EXP_CATS.map(c => `<option value="${escapeHtml(c)}" ${_expFilterCat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <input type="date" class="biz-date-input" value="${_expFilterFrom}" onchange="window.bizSetExpFilter('from',this.value)" style="font-size:.72rem;">
      <span style="color:var(--muted);font-size:.72rem;">→</span>
      <input type="date" class="biz-date-input" value="${_expFilterTo}" onchange="window.bizSetExpFilter('to',this.value)" style="font-size:.72rem;">
      ${hasFilter ? `<button class="biz-fpill" onclick="window.bizSetExpFilter('clear','')" style="font-size:.68rem;">✕ Clear</button>` : ''}
    </div>

    ${catBreakdown ? `<div class="exp-cat-breakdown">${catBreakdown}</div>` : ''}
    <div class="panel-toolbar" style="margin-top:12px;">
      <span style="font-size:.75rem;color:var(--muted);">${filtered.length} expense${filtered.length !== 1 ? 's' : ''}${hasFilter ? ' (filtered)' : ''}</span>
      <button class="btn-secondary" style="font-size:.74rem;padding:7px 13px;margin-left:auto;" onclick="window.bizOpenExpenseForm()">＋ Add Expense</button>
    </div>
    <div id="expenseFormWrap" style="display:none;" class="exp-form-wrap">
      <input type="hidden" id="expEditId" value="">
      <div class="fg">
        <div class="field">
          <label class="lbl">Category</label>
          <select id="expCat">${EXP_CATS.map(c => `<option>${c}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label class="lbl">Amount (<span class="currency">₦</span>) *</label>
          <input type="number" id="expAmt" placeholder="0" min="0">
        </div>
      </div>
      <div class="fg">
        <div class="field">
          <label class="lbl">Description</label>
          <input type="text" id="expDesc" placeholder="e.g. Keke to market">
        </div>
        <div class="field">
          <label class="lbl">Date</label>
          <input type="date" id="expDate" value="${today()}">
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn-secondary" style="flex:1;" onclick="window.bizCancelExpenseForm()">Cancel</button>
        <button class="btn-add" style="flex:2;" id="expSaveBtn" onclick="window.bizSaveExpense()">Save Expense</button>
      </div>
    </div>
    <div class="panel-list" id="expenseList">${rows}</div>
  </div>`;
}

window.bizSetExpFilter = function(key, val) {
  if (key === 'cat')   _expFilterCat  = val;
  if (key === 'from')  _expFilterFrom = val;
  if (key === 'to')    _expFilterTo   = val;
  if (key === 'clear') { _expFilterCat = ''; _expFilterFrom = ''; _expFilterTo = ''; }
  _renderPanel('expenses');
};

window.bizOpenExpenseForm = function(editId) {
  _expEditingId = editId || '';
  const wrap = document.getElementById('expenseFormWrap');
  if (!wrap) return;
  if (editId) {
    const exp = (window._pkExpenses || []).find(e => e.id === editId);
    if (!exp) return;
    const catEl  = document.getElementById('expCat');  if (catEl)  catEl.value  = exp.cat || 'Other';
    const amtEl  = document.getElementById('expAmt');  if (amtEl)  amtEl.value  = exp.amount;
    const descEl = document.getElementById('expDesc'); if (descEl) descEl.value = exp.desc || '';
    const dateEl = document.getElementById('expDate'); if (dateEl) dateEl.value = exp.date || today();
    const idEl   = document.getElementById('expEditId'); if (idEl) idEl.value = editId;
    const btn    = document.getElementById('expSaveBtn'); if (btn) btn.textContent = 'Update Expense';
  } else {
    ['expAmt', 'expDesc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const dateEl = document.getElementById('expDate'); if (dateEl) dateEl.value = today();
    const catEl  = document.getElementById('expCat');  if (catEl) catEl.selectedIndex = 0;
    const idEl   = document.getElementById('expEditId'); if (idEl) idEl.value = '';
    const btn    = document.getElementById('expSaveBtn'); if (btn) btn.textContent = 'Save Expense';
  }
  wrap.style.display = '';
};

window.bizCancelExpenseForm = function() {
  _expEditingId = '';
  const wrap = document.getElementById('expenseFormWrap');
  if (wrap) wrap.style.display = 'none';
};

window.bizEditExpense = function(id) {
  window.bizOpenExpenseForm(id);
};

let _expSaving = false;
window.bizSaveExpense = async function() {
  const amt = parseFloat(document.getElementById('expAmt')?.value) || 0;
  if (!(amt > 0)) return toast('⚠️ Enter an amount above zero', 'err');
  // A second tap while the first save is still running would record it twice.
  if (_expSaving) return;
  _expSaving = true;
  try { await _bizSaveExpense(amt); } finally { _expSaving = false; }
};
async function _bizSaveExpense(amt) {
  const editId = document.getElementById('expEditId')?.value || '';

  window._pkExpenses = window._pkExpenses || [];

  if (editId) {
    const idx = window._pkExpenses.findIndex(e => e.id === editId);
    if (idx < 0) return toast('⚠️ Expense not found', 'err');
    window._pkExpenses[idx] = {
      ...window._pkExpenses[idx],
      cat:    document.getElementById('expCat')?.value || 'Other',
      desc:   document.getElementById('expDesc')?.value.trim() || '',
      date:   document.getElementById('expDate')?.value || today(),
      amount: amt,
      updatedTs: Date.now(),
    };
    saveLocal();
    const saved = await _expSaveToDB(window._pkExpenses[idx]);
    logActivity('EDIT_EXPENSE', { id: editId, cat: window._pkExpenses[idx].cat, amount: amt });
    if (saved) toast('✅ Expense updated', 'ok');
  } else {
    const exp = {
      id:   uid(),
      cat:  document.getElementById('expCat')?.value || 'Other',
      desc: document.getElementById('expDesc')?.value.trim() || '',
      date: document.getElementById('expDate')?.value || today(),
      amount: amt,
      createdTs: Date.now(),
    };
    window._pkExpenses.unshift(exp);
    saveLocal();
    const saved = await _expSaveToDB(exp);
    logActivity('ADD_EXPENSE', { cat: exp.cat, amount: exp.amount, desc: exp.desc });
    if (saved) toast('✅ Expense saved', 'ok');
  }

  _expEditingId = '';
  _renderPanel('expenses');
}

window.bizDeleteExpense = function(id) {
  const exp = (window._pkExpenses || []).find(e => e.id === id);
  if (!exp) return;
  _showExpenseConfirm(
    `Delete this ${exp.cat} expense of ${fmt(exp.amount)}?`,
    async () => {
      window._pkExpenses = (window._pkExpenses || []).filter(e => e.id !== id);
      saveLocal();
      const removed = await _expDeleteFromDB(id);
      logActivity('DELETE_EXPENSE', { id, cat: exp.cat, amount: exp.amount, desc: exp.desc });
      _renderPanel('expenses');
      if (removed) toast('🗑 Expense deleted', 'ok');
    }
  );
};

function _showExpenseConfirm(message, onConfirm) {
  document.getElementById('pkExpConfirm')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'pkExpConfirm';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:340px;width:100%;">
      <div style="font-size:.82rem;color:var(--text);font-weight:500;margin-bottom:16px;">${escapeHtml(message)}</div>
      <div style="display:flex;gap:8px;">
        <button id="pkExpConfirmCancel" style="flex:1;background:var(--s2);border:1px solid var(--border2);color:var(--muted);border-radius:8px;padding:10px;font-size:.78rem;cursor:pointer;">Cancel</button>
        <button id="pkExpConfirmOk" style="flex:1;background:rgba(240,149,149,.12);border:1px solid rgba(240,149,149,.3);color:var(--red);border-radius:8px;padding:10px;font-size:.78rem;font-weight:500;cursor:pointer;">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#pkExpConfirmCancel').onclick = () => overlay.remove();
  overlay.querySelector('#pkExpConfirmOk').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}
window.bizSaveShopProfile = async function() {
  const name    = document.getElementById('spName')?.value.trim();
  const phone   = document.getElementById('spPhone')?.value.trim();
  const address = document.getElementById('spAddress')?.value.trim();

  // Local-first: instant UI + offline + receipts. The cloud write below makes
  // it persist across the owner's devices and reach staff.
  if (name) {
    localStorage.setItem('pkAppName', name);
    document.querySelectorAll('.app-name-label').forEach(el => el.textContent = name);
    document.title = name;
  }
  localStorage.setItem('pkShopProfile', JSON.stringify({ phone, address }));

  const uid = activeUid();
  if (!uid) { toast('⚠️ Saved locally only — not backed up to cloud', 'err'); return; }
  try {
    await saveShopProfile(uid, { shopName: name || '', phone, address });
    toast('✅ Shop profile saved', 'ok');
  } catch (e) {
    console.error('[shopProfile] cloud save failed:', e);
    toast('⚠️ Saved here, but cloud sync failed — retry when online', 'err');
  }
};

// ── Theme (D.3.theme) ────────────────────────────────────────────────────────
// Dark default, light opt-in, persisted per device in localStorage.pkTheme.
// The index.html boot script applies the saved theme before first paint;
// applyTheme() re-applies it after JS load and these helpers toggle it live.
export function currentTheme() {
  try { return localStorage.getItem('pkTheme') === 'light' ? 'light' : 'dark'; } catch (_) { return 'dark'; }
}
export function applyTheme() {
  if (currentTheme() === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}
export function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('pkTheme', t); } catch (_) {}
  applyTheme();
  return t;
}
// Flip + persist + apply. Returns the new theme so callers can update labels.
window.bizToggleTheme = function() { return setTheme(currentTheme() === 'light' ? 'dark' : 'light'); };
window.bizSetTheme    = function(t) { return setTheme(t); };

window.bizAddStaff = async function() {
  if (!currentUser) return toast('⚠️ Sign in first', 'err');
  const displayName = document.getElementById('newStaffName')?.value.trim();
  const username    = document.getElementById('newStaffUsername')?.value.trim().toLowerCase();
  const pin         = document.getElementById('newStaffPin')?.value.trim();

  if (!displayName || !username || !pin) return toast('⚠️ Fill all fields', 'err');
  if (pin.length !== 4 || isNaN(pin))   return toast('⚠️ PIN must be 4 digits', 'err');
  if (!/^[a-z0-9_]+$/.test(username))   return toast('⚠️ Username: letters and numbers only', 'err');

  // Duplicate username check
  try {
    const { doc: _doc, getDoc: _getDoc } = await import('./firebase.js');
    const existing = await _getDoc(_doc(db, 'shops', currentUser.uid, 'staff', username));
    if (existing.exists()) return toast(`⚠️ Username "${username}" already exists`, 'err');
  } catch (e) { console.error('[biz] Duplicate username check failed:', e); }

  try {
    const { hashPinPBKDF2, generateSalt } = await import('./staff-auth.js');
    const pinSalt = generateSalt();
    const pinHash = await hashPinPBKDF2(pin, pinSalt);

    const { doc, setDoc } = await import('./firebase.js');
    const staffData = {
      username, displayName, pinHash, pinSalt, role: document.getElementById('newStaffRole')?.value || 'cashier',
      revoked: false, createdAt: Date.now(),
      // D.3.4a / MISSION v1.4 — default discount permissions for any new
      // staff are OFF (canDiscount=false, no max). Owner enables case-by-case
      // via Settings → Staff → Discount permissions.
      permissions: { canDiscount: false, maxDiscount: null },
    };
    // Write to both paths: users/ for owner management, shops/ for staff login
    await Promise.all([
      setDoc(doc(db, 'users', currentUser.uid, 'staff', username), staffData),
      setDoc(doc(db, 'shops', currentUser.uid, 'staff', username), staffData),
    ]);
    logActivity('ADD_STAFF', { username, displayName });

    document.getElementById('newStaffName').value     = '';
    document.getElementById('newStaffUsername').value = '';
    document.getElementById('newStaffPin').value      = '';

    toast(`✅ Staff account created for ${displayName}`, 'ok');
    const container = document.getElementById('staffPanelContainer');
    if (container) _renderStaffPanel(container);
  } catch (err) {
    console.error(err);
    toast('⚠️ Failed to create staff account', 'err');
  }
};

window.bizRevokeStaff = async function(username) {
  if (!currentUser || !confirm(`Disable ${username}? They will not be able to log in.`)) return;
  const btn = document.activeElement;
  await withLoading(btn, async () => {
    const { doc, setDoc, getDoc } = await import('./firebase.js');
    const ref  = doc(db, 'users', currentUser.uid, 'staff', username);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const updated = { ...snap.data(), revoked: true };
      await Promise.all([
        setDoc(ref, updated),
        setDoc(doc(db, 'shops', currentUser.uid, 'staff', username), updated),
      ]);
      logActivity('REVOKE_STAFF', { username });
      toast(`🚫 ${username} disabled`, 'ok');
      const container = document.getElementById('staffPanelContainer');
      if (container) _renderStaffPanel(container);
    }
  });
};

window.bizEnableStaff = async function(username) {
  if (!currentUser) return;
  const btn = document.activeElement;
  await withLoading(btn, async () => {
    const { doc, setDoc, getDoc } = await import('./firebase.js');
    const ref  = doc(db, 'users', currentUser.uid, 'staff', username);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const updated = { ...snap.data(), revoked: false };
      await Promise.all([
        setDoc(ref, updated),
        setDoc(doc(db, 'shops', currentUser.uid, 'staff', username), updated),
      ]);
      logActivity('ENABLE_STAFF', { username });
      toast(`✅ ${username} enabled`, 'ok');
      const container = document.getElementById('staffPanelContainer');
      if (container) _renderStaffPanel(container);
    }
  });
};

// D.3.4b UPDATE — soft-archive instead of hard-delete. Setting
// active:false hides the staff member from the active-staff list
// (Trade page picker, new-trade assignment, Staff Management list)
// while preserving the record so old trades keep their "By: {name}"
// attribution. A separate "Restore" path can flip active:true back.
window.bizDeleteStaff = async function(username) {
  if (!currentUser || !confirm(
    `Archive staff member "${username}"?\n\n` +
    `Their old trades will still show their name, but they won't appear ` +
    `in the staff picker or be able to log in.`,
  )) return;
  const btn = document.activeElement;
  await withLoading(btn, async () => {
    const { doc, setDoc, getDoc } = await import('./firebase.js');
    const ref  = doc(db, 'users', currentUser.uid, 'staff', username);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const updated = { ...snap.data(), active: false, revoked: true, archivedAt: Date.now() };
    await Promise.all([
      setDoc(ref, updated),
      setDoc(doc(db, 'shops', currentUser.uid, 'staff', username), updated),
    ]);
    // Refresh in-memory caches so the Trade picker sees this immediately.
    if (Array.isArray(window._pkStaff)) {
      window._pkStaff = window._pkStaff.map(s => s.username === username ? updated : s);
    }
    if (Array.isArray(window._pkStaffCache)) {
      window._pkStaffCache = window._pkStaffCache.map(s => s.username === username ? updated : s);
    }
    logActivity('ARCHIVE_STAFF', { username });
    toast(`📦 ${username} archived · old trades keep their attribution`, 'ok');
    const container = document.getElementById('staffPanelContainer');
    if (container) _renderStaffPanel(container);
  });
};

// Restore a previously-archived staff member (clear active:false).
window.bizRestoreStaff = async function(username) {
  if (!currentUser) return;
  const btn = document.activeElement;
  await withLoading(btn, async () => {
    const { doc, setDoc, getDoc } = await import('./firebase.js');
    const ref  = doc(db, 'users', currentUser.uid, 'staff', username);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const prev = snap.data();
    const updated = { ...prev, active: true, revoked: false };
    delete updated.archivedAt;
    await Promise.all([
      setDoc(ref, updated),
      setDoc(doc(db, 'shops', currentUser.uid, 'staff', username), updated),
    ]);
    if (Array.isArray(window._pkStaff)) {
      window._pkStaff = window._pkStaff.map(s => s.username === username ? updated : s);
    }
    if (Array.isArray(window._pkStaffCache)) {
      window._pkStaffCache = window._pkStaffCache.map(s => s.username === username ? updated : s);
    }
    logActivity('ENABLE_STAFF', { username });
    toast(`✅ ${username} restored`, 'ok');
    const container = document.getElementById('staffPanelContainer');
    if (container) _renderStaffPanel(container);
  });
};

// ── Owner: reset a staff member's PIN (FEATURE-005) ─────────
// Owner-only — the underlying ownerResetStaffPin() hard-gates by checking
// that no staff session is active AND a Google-authed user exists.
window.bizShowResetPinModal = function(username) {
  if (!currentUser || window._staffOwnerUid) {
    toast('⚠️ Only the owner can reset PINs', 'err');
    return;
  }
  // F4 hardening: displayName is free text (no character restriction, unlike
  // username's [a-z0-9_]+ validation) — it used to be threaded through two
  // nested onclick="...('...')" strings with only a bare `'` escape, which
  // protects the JS-string boundary but not the surrounding HTML-attribute
  // boundary (a `"` in the name broke out of the attribute entirely). Now we
  // only ever pass the safe, validated `username` through onclick, and look
  // the display name up here for a single, correctly-escaped HTML render.
  const staffRec    = (window._pkStaff || []).find(s => s.username === username);
  const displayName = staffRec?.displayName || username;
  document.getElementById('bizResetPinModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'bizResetPinModal';
  modal.className = 'pk-pin-overlay';
  modal.innerHTML = `
    <div class="pk-pin-modal">
      <div class="pk-pin-title">🔑 Reset PIN</div>
      <div class="pk-pin-sub">Choose a new 4-digit PIN for <strong>${escapeHtml(displayName)}</strong>. They'll use it next time they sign in.</div>
      <div class="pk-pin-field">
        <label class="pk-pin-lbl">New PIN</label>
        <input id="bizResetPinNew" type="password" maxlength="4" inputmode="numeric"
          placeholder="••••" class="pk-pin-input">
      </div>
      <div class="pk-pin-field">
        <label class="pk-pin-lbl">Confirm New PIN</label>
        <input id="bizResetPinConfirm" type="password" maxlength="4" inputmode="numeric"
          placeholder="••••" class="pk-pin-input">
      </div>
      <div class="pk-pin-actions">
        <button class="pk-pin-cancel" onclick="document.getElementById('bizResetPinModal').remove()">Cancel</button>
        <button class="pk-pin-save" id="bizResetPinSaveBtn"
          onclick="window._bizResetPinConfirm('${escapeHtml(username)}')">Reset PIN ✓</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('bizResetPinNew')?.focus(), 80);
};

window._bizResetPinConfirm = async function(username) {
  const staffRec    = (window._pkStaff || []).find(s => s.username === username);
  const displayName = staffRec?.displayName || username;
  const newPin  = document.getElementById('bizResetPinNew')?.value.trim() || '';
  const confirmPin = document.getElementById('bizResetPinConfirm')?.value.trim() || '';
  if (!/^\d{4}$/.test(newPin)) return toast('⚠️ PIN must be exactly 4 digits', 'err');
  if (newPin !== confirmPin)   return toast('⚠️ PINs do not match', 'err');
  if (!confirm(`Reset PIN for ${displayName}?`)) return;

  const btn = document.getElementById('bizResetPinSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }
  const { ownerResetStaffPin } = await import('./staff-auth.js');
  const result = await ownerResetStaffPin(username, newPin);
  if (btn) { btn.disabled = false; btn.textContent = 'Reset PIN ✓'; }
  if (!result.ok) return toast('⚠️ ' + result.error, 'err');
  document.getElementById('bizResetPinModal')?.remove();
  toast(`✅ PIN reset for ${displayName}`, 'ok');
};


// ═══════════════════════════════════════════════════════════════════════════════
//  STAFF ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════════
const ACTION_LABELS = {
  LOGIN:               { icon: '🔑', label: 'Logged in' },
  LOGOUT:              { icon: '🚪', label: 'Logged out' },
  ADD_TRADE:           { icon: '🧾', label: 'Added trade' },
  VOID_TRADE:          { icon: '🚫', label: 'Voided trade' },
  UNVOID_TRADE:        { icon: '↺', label: 'Unvoided trade' },
  DELETE_TRADE:        { icon: '🗑', label: 'Deleted trade' },
  EDIT_ITEM:           { icon: '✏️', label: 'Edited item' },
  ADD_ITEM:            { icon: '📦', label: 'Added item' },
  DELETE_ITEM:         { icon: '🗑', label: 'Deleted item' },
  ADD_DEBT:            { icon: '📋', label: 'Added debt' },
  ADD_PAYMENT:         { icon: '💰', label: 'Recorded payment' },
  ADD_EXPENSE:         { icon: '💸', label: 'Added expense' },
  ADD_STAFF:           { icon: '👤', label: 'Added staff' },
  REVOKE_STAFF:        { icon: '🔒', label: 'Disabled staff' },
  ENABLE_STAFF:        { icon: '✅', label: 'Enabled staff' },
  ARCHIVE_STAFF:       { icon: '📦', label: 'Archived staff' },
  DELETE_STAFF:        { icon: '🗑', label: 'Deleted staff' },
  UPDATE_DISPLAY_NAME: { icon: '📝', label: 'Updated name' },
  CHANGE_OWN_PIN:      { icon: '🔑', label: 'Changed own PIN' },
  RESET_STAFF_PIN:     { icon: '🔑', label: 'Reset staff PIN' },
  REMOVE_PAYMENT:      { icon: '↩️', label: 'Removed payment' },
  EDIT_TRADE:          { icon: '✏️', label: 'Edited trade' },
};

let _activityFilter = 'all';
let _activitySearch = '';

async function _loadActivityLog() {
  const panel = document.getElementById('staffActivityPanel');
  if (!panel) return;

  const uid = currentUser?.uid;
  if (!uid) {
    panel.innerHTML = '<div class="biz-empty">Sign in to view activity log.</div>';
    return;
  }

  try {
    const { collection: col, getDocs: gd, query: q, orderBy, limit }
      = await import('./firebase.js');

    const snap = await gd(q(col(db, 'shops', uid, 'activityLog'), orderBy('timestamp','desc'), limit(200)));
    const logs = snap.docs.map(d => d.data());
    _renderActivityPanel(logs);
  } catch (err) {
    console.error('Activity log load error:', err);
    panel.innerHTML = '<div class="biz-empty">Could not load activity log. Check Firestore rules for shops/ path.</div>';
  }
}

function _renderActivityPanel(logs) {
  const panel = document.getElementById('staffActivityPanel');
  if (!panel) return;

  // Aggregate stats per staff member
  const staffStats = {};
  logs.forEach(log => {
    const name = log.performedBy?.displayName || log.performedBy?.username || 'Unknown';
    const role = log.performedBy?.role || 'unknown';
    if (!staffStats[name]) staffStats[name] = { name, role, total: 0, trades: 0, voids: 0, deletes: 0, lastSeen: '' };
    staffStats[name].total++;
    if (log.action === 'ADD_TRADE')    staffStats[name].trades++;
    if (log.action === 'VOID_TRADE')   staffStats[name].voids++;
    if (log.action === 'DELETE_TRADE') staffStats[name].deletes++;
    if (!staffStats[name].lastSeen || log.date > staffStats[name].lastSeen)
      staffStats[name].lastSeen = log.date;
  });
  const statCards = Object.values(staffStats)
    .sort((a,b) => b.trades - a.trades)
    .map((s, i) => `
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;
                  padding:12px 14px;display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--s3);
                    display:flex;align-items:center;justify-content:center;
                    font-family:var(--fh);font-weight:800;font-size:.95rem;color:var(--accent);flex-shrink:0;">
          ${i===0?'🥇':i===1?'🥈':i===2?'🥉':escapeHtml(s.name.charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--fh);font-weight:700;font-size:.82rem;color:var(--text);">
            ${escapeHtml(s.name)}
            <span style="font-size:.65rem;color:var(--muted);font-weight:400;margin-left:5px;">${escapeHtml(s.role)}</span>
          </div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:2px;">
            Last active: ${s.lastSeen||'—'}
          </div>
        </div>
        <div style="display:flex;gap:10px;text-align:center;flex-shrink:0;">
          <div>
            <div style="font-family:var(--fh);font-weight:800;font-size:.95rem;color:var(--accent);">${s.trades}</div>
            <div style="font-size:.6rem;color:var(--muted);">Trades</div>
          </div>
          <div>
            <div style="font-family:var(--fh);font-weight:800;font-size:.95rem;color:var(--text);">${s.total}</div>
            <div style="font-size:.6rem;color:var(--muted);">Actions</div>
          </div>
          <div>
            <div style="font-family:var(--fh);font-weight:800;font-size:.95rem;color:var(--red);">${s.voids+s.deletes}</div>
            <div style="font-size:.6rem;color:var(--muted);">Voids/Del</div>
          </div>
        </div>
      </div>`).join('');

  // Categorise actions for color coding + chip filters
  function _actType(action) {
    if (/^(VOID_|DELETE_|REVOKE_|ARCHIVE_|REMOVE_PAYMENT)/.test(action)) return 'danger';
    if (/^(ADD_PAYMENT|ADD_DEBT)/.test(action)) return 'success';
    return 'plain';
  }

  // Filter log entries
  let filtered = [...logs];
  if (_activityFilter === 'danger') {
    filtered = filtered.filter(l => _actType(l.action) === 'danger');
  } else if (_activityFilter === 'success') {
    filtered = filtered.filter(l => _actType(l.action) === 'success');
  } else if (_activityFilter === 'trades') {
    filtered = filtered.filter(l => ['ADD_TRADE','EDIT_TRADE','UNVOID_TRADE'].includes(l.action));
  } else if (_activityFilter === 'inventory') {
    filtered = filtered.filter(l => ['ADD_ITEM','EDIT_ITEM','DELETE_ITEM','RESTOCK_ITEM'].includes(l.action));
  } else if (_activityFilter !== 'all') {
    filtered = filtered.filter(l => l.action === _activityFilter);
  }
  if (_activitySearch) {
    const q = _activitySearch.toLowerCase();
    filtered = filtered.filter(l =>
      (l.performedBy?.displayName||'').toLowerCase().includes(q) ||
      (l.performedBy?.username||'').toLowerCase().includes(q) ||
      (l.action||'').toLowerCase().includes(q) ||
      (l.details?.tradeId||'').toLowerCase().includes(q)
    );
  }

  const rows = !filtered.length
    ? '<div class="biz-empty">No activity yet.</div>'
    : filtered.map(log => {
        const meta  = ACTION_LABELS[log.action] || { icon: '⚙️', label: log.action };
        const type  = _actType(log.action);
        const actor = log.performedBy?.displayName || log.performedBy?.username || 'Unknown';
        const role  = log.performedBy?.role || '';
        const ts    = log.timestamp ? new Date(log.timestamp) : null;
        const timeStr = ts ? ts.toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'}) : '';
        const dateStr = log.date || '';
        const det   = log.details || {};
        let detParts = [];
        if (det.tradeId)  detParts.push(det.tradeId);
        if (det.reason)   detParts.push(`"${det.reason}"`);
        if (det.username) detParts.push(`@${det.username}`);
        if (det.newName)  detParts.push(`→ "${det.newName}"`);
        if (det.itemName) detParts.push(det.itemName);
        if (det.cat)      detParts.push(det.cat);
        const detStr = detParts.length ? ` · ${detParts.join(' · ')}` : '';
        let amtStr = '—';
        if (det.amount) amtStr = (type==='danger'?'−':type==='success'?'+':'') + fmt(det.amount);
        return `
          <div class="act-row">
            <span class="act-strip act-strip--${type}"></span>
            <div class="act-icon act-icon--${type}">${meta.icon}</div>
            <div class="act-body">
              <div class="act-label act-label--${type}">${meta.label}</div>
              <div class="act-meta">
                <strong style="color:var(--text);font-weight:500;">${actor}</strong>
                <span style="color:var(--dim);margin-left:4px;">${role}</span>${detStr}
              </div>
            </div>
            <div class="act-right">
              <div class="act-time">${dateStr}${timeStr?' · '+timeStr:''}</div>
              <div class="act-amt act-amt--${type}">${amtStr}</div>
            </div>
          </div>`;
      }).join('');

  // Chip filter buttons
  const chips = [
    { val: 'all',       label: 'All' },
    { val: 'danger',    label: 'Voids & Deletes', mod: 'danger' },
    { val: 'success',   label: 'Payments',         mod: 'success' },
    { val: 'trades',    label: 'Trades' },
    { val: 'inventory', label: 'Inventory' },
  ].map(c => {
    const active = _activityFilter === c.val ? 'act-chip--active' : '';
    const mod = c.mod ? `act-chip--${c.mod}` : '';
    return `<button class="act-chip ${mod} ${active}" onclick="window._bizActFilter('${c.val}')">${c.label}</button>`;
  }).join('');

  const _leaderOpen = localStorage.getItem('pkActLeaderOpen') === '1';

  panel.innerHTML = `
    <!-- Leaderboard (collapsible) -->
    <div style="margin-bottom:16px;">
      <button onclick="window._bizToggleLeaderboard()" style="background:none;border:none;cursor:pointer;
        width:100%;text-align:left;display:flex;align-items:center;gap:6px;padding:6px 0;
        color:var(--text);font-family:inherit;">
        <span id="actLeaderIcon" style="color:var(--muted);font-size:.72rem;transition:transform .15s;
          display:inline-block;transform:${_leaderOpen?'rotate(90deg)':'rotate(0deg)'};">▶</span>
        <span style="font-size:.78rem;font-weight:500;">🏆 Staff Leaderboard</span>
        <span style="font-size:.65rem;color:var(--muted);font-weight:400;">(by trades added)</span>
      </button>
      <div id="actLeaderBody" style="display:${_leaderOpen?'block':'none'};margin-top:8px;">
        ${statCards || '<div style="font-size:.75rem;color:var(--muted);">No activity recorded yet.</div>'}
      </div>
    </div>

    <!-- Chip filters + search -->
    <div class="act-chip-row">${chips}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
      <div style="position:relative;flex:1;min-width:160px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input id="activitySearchInput" class="borr-search-input" placeholder="Search name, action, trade ID…"
          value="${escapeHtml(_activitySearch)}"
          oninput="window._bizActSearch(this.value)"
          style="padding-left:28px;padding-right:28px;width:100%;box-sizing:border-box;">
        <button type="button" class="borr-search-clear" id="activitySearchClear"
          onclick="window._clearSearchBox('activitySearchInput',()=>window._bizActSearch(''),'activitySearchClear')"
          aria-label="Clear search" ${_activitySearch?'':'hidden'}>✕</button>
      </div>
      <button class="btn-secondary" style="font-size:.7rem;padding:7px 12px;"
        onclick="window._bizActRefresh()">↺ Refresh</button>
    </div>

    <!-- Log entries -->
    <div style="font-size:.7rem;color:var(--muted);margin-bottom:10px;font-variant-numeric:tabular-nums;">
      ${filtered.length} of ${logs.length} entries
    </div>
    <div>${rows}</div>`;

  // Store logs on window for filter re-renders
  window._pkActivityLogs = logs;
}

window._bizToggleLeaderboard = function() {
  const body = document.getElementById('actLeaderBody');
  const icon = document.getElementById('actLeaderIcon');
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (icon) icon.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
  try { localStorage.setItem('pkActLeaderOpen', open ? '1' : '0'); } catch(e) {}
};

window._bizActFilter = function(val) {
  _activityFilter = val;
  if (window._pkActivityLogs) _renderActivityPanel(window._pkActivityLogs);
};
window._bizActSearch = function(val) {
  _activitySearch = val;
  if (window._pkActivityLogs) _renderActivityPanel(window._pkActivityLogs);
};
window._bizActRefresh = function() {
  _activityFilter = 'all';
  _activitySearch = '';
  const panel = document.getElementById('staffActivityPanel');
  if (panel) panel.innerHTML = '<div class="biz-empty" style="padding:20px;">Loading…</div>';
  _loadActivityLog();
};


// ── Exports ───────────────────────────────────────────────────────────────────
export { renderBusiness, refreshBorrowers, _generateTradeId };

export function populateWsMonths() {}
export function toggleWsStats() {}
export function renderWholesale() {}
export function deleteSale(id)    { window.bizDeleteTrade(id); }
export function setHistoryFilter(f) {}
export async function deleteTrade(id) { return window.bizDeleteTrade(id); }

function _applyAppName() {
  const name = localStorage.getItem('pkAppName') || 'PriceKeeper';
  document.querySelectorAll('.app-name-label').forEach(el => el.textContent = name);
  document.title = name;
}

// ── D.3.4a / MISSION v1.4 — Staff discount permission setters ────────
// Both write to /shops/{uid}/staff/{username}.permissions AND the legacy
// mirror /users/{uid}/staff/{username}.permissions (matches the pattern
// used by bizAddStaff / bizRevokeStaff). The session.permissions cache
// for an actively-signed-in staff member only refreshes on next login,
// but for the cashier whose discount perm the OWNER is changing right
// now they're typically not signed in on the owner's device — and even
// if they are, the next sale they ring up reads the latest perms via
// `getDiscountPolicy()` -> getEffectiveSessionPerms (live session.permissions).
async function _saveStaffPermissionsPatch(username, patch) {
  if (!currentUser || !username) return;
  const { doc: _doc, setDoc: _setDoc, getDoc: _getDoc } = await import('./firebase.js');
  const shopRef = _doc(db, 'shops', currentUser.uid, 'staff', username);
  const userRef = _doc(db, 'users', currentUser.uid, 'staff', username);
  // Merge into existing permissions object, don't clobber unrelated overrides
  // (canEdit / canVoid / canDelete are managed through the existing per-staff
  // permissions modal — they must not be reset by a discount toggle).
  const existingSnap = await _getDoc(shopRef).catch(() => null);
  const existingPerms = existingSnap?.exists() ? (existingSnap.data().permissions || {}) : {};
  const merged = { ...existingPerms, ...patch };
  await Promise.all([
    _setDoc(shopRef, { permissions: merged }, { merge: true }),
    _setDoc(userRef, { permissions: merged }, { merge: true }),
  ]);
  // Re-load cached staff list so subsequent renders reflect new perms.
  try {
    const { collection: _col, getDocs: _gd } = await import('./firebase.js');
    const snap = await _gd(_col(db, 'users', currentUser.uid, 'staff'));
    window._pkStaffCache = snap.docs.map(d => d.data());
    window._pkStaff      = window._pkStaffCache;
  } catch (_) { /* cache refresh is best-effort */ }
}

window.bizSetStaffCanDiscount = async function(username, on) {
  try {
    const patch = on
      ? { canDiscount: true }
      : { canDiscount: false, maxDiscount: null };
    await _saveStaffPermissionsPatch(username, patch);
    logActivity('STAFF_DISCOUNT_TOGGLE', { username, canDiscount: !!on });
    toast(on
      ? `✅ ${username} can now apply discounts`
      : `🔒 ${username} can no longer apply discounts`, 'ok');
    const container = document.getElementById('staffPanelContainer');
    if (container) _renderStaffPanel(container);
  } catch (err) {
    console.error('[biz] bizSetStaffCanDiscount failed', err);
    toast('⚠️ Failed to save discount permission', 'err');
  }
};

window.bizSetStaffMaxDiscount = async function(username, rawValue) {
  try {
    const trimmed = String(rawValue || '').trim();
    // Empty input → null (= unlimited within whatever canDiscount allows)
    const next = trimmed === '' ? null : Math.max(0, Math.round(parseFloat(trimmed) || 0));
    if (next !== null && !Number.isFinite(next)) return;
    await _saveStaffPermissionsPatch(username, { maxDiscount: next });
    logActivity('STAFF_DISCOUNT_MAX', { username, maxDiscount: next });
    // Don't re-render the whole panel on every blur — keep the user's
    // focus context. The number is already in the DOM where they typed it.
  } catch (err) {
    console.error('[biz] bizSetStaffMaxDiscount failed', err);
    toast('⚠️ Failed to save discount limit', 'err');
  }
};