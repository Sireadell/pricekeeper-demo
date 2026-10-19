// ============================================================
//  profit.js — Session 10
//  Fixes:
//  - Top items count = unique TRADE IDs (not line appearances)
//  - "6 sales" → "in 6 trades" for clarity
//  - Progress bars removed (user asked)
//  - Margin threshold 85%
//  - Cost = revenue - corrected profit
// ============================================================

import { fmt, escapeHtml, isoDate, csvCell, CSV_BOM } from './utils.js';
import { costBlindForCurrentRole } from './staff-auth.js';
import { _ppc, _ppr, _costPerPiece } from './trade-modal.js';

let _profitPeriod = 'week';
const _toIso = isoDate;

function _periodSales(period) {
  const all=(window._pkSales||[]).filter(s=>!s.voided);
  const now=new Date(), ts=_toIso(now);
  return all.filter(s=>{
    const d=s.date||(s.createdTs?_toIso(new Date(s.createdTs)):'');
    if(!d)return false;
    if(period==='today')return d===ts;
    if(period==='week') return(now-new Date(d+'T00:00:00'))/86400000<7;
    if(period==='month')return d.startsWith(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
    return false;
  });
}

// Corrected profit: recompute from inventory if margin > 85% or cost = 0.
// A loss with a real cost recorded (sold below cost, heavy discount) is kept
// as a loss. It used to be clamped to zero, which overstated profit.
// Uses the same cost-per-unit source of truth as the live sale-write path
// (trade-modal.js _costPerPiece/_ppc/_ppr) so the Profit report can never
// disagree with what a sale actually cost.
function _correctedProfit(it) {
  const rev=it.revenue||0, stored=it.profit||0, storedC=it.cost||0;
  if(!rev) return 0;
  if(storedC>0 && stored/rev<0.85) return stored;
  const item=(window._pkItems||[]).find(i=>i.id===it.itemId);
  if(!item) return stored>=0?stored:0;
  const cpp=_costPerPiece(item);
  if(!cpp) return Math.max(0,stored);
  const u=it.qty||(it.cartons||0)*_ppc(item)+(it.rows||0)*_ppr(item)||1;
  return Math.max(0,rev-cpp*u);
}

// Old one-item trades: loss is kept when a cost was recorded.
function _legacyProfit(s) {
  const rev=s.totalRevenue??s.revenue??0, cost=s.totalCost??s.cost??0;
  return cost>0 ? rev-cost : Math.max(0,rev-cost);
}

// Top items — count = unique trade IDs (not line appearances)
// This means if Top Cafe appears as carton + row in one trade, it still counts as 1 trade
function _topItems(sales, limit=8) {
  const map={};
  sales.forEach(s=>{
    (s.items||[]).forEach(it=>{
      if(!map[it.itemId]) map[it.itemId]={name:it.itemName,profit:0,revenue:0,tradeIds:new Set()};
      map[it.itemId].profit  += _correctedProfit(it);
      map[it.itemId].revenue += (it.revenue||0);
      map[it.itemId].tradeIds.add(s.id); // unique trade, not line count
    });
    if(!Array.isArray(s.items)&&s.itemId){
      if(!map[s.itemId]) map[s.itemId]={name:s.itemName||'—',profit:0,revenue:0,tradeIds:new Set()};
      map[s.itemId].profit  += _correctedProfit({itemId:s.itemId,revenue:s.revenue||0,cost:s.cost||0,profit:s.profit||0});
      map[s.itemId].revenue += (s.revenue||0);
      map[s.itemId].tradeIds.add(s.id);
    }
  });
  return Object.values(map)
    .filter(x=>x.profit>0)
    .sort((a,b)=>b.profit-a.profit)
    .slice(0,limit)
    .map(x=>({...x, count:x.tradeIds.size})); // count = unique trades
}

function _last7() {
  return Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i));
    const ds=_toIso(d);
    const day=(window._pkSales||[]).filter(s=>!s.voided&&(s.date||'')===ds);
    const profit=day.reduce((a,s)=>{
      if(Array.isArray(s.items))return a+s.items.reduce((b,it)=>b+_correctedProfit(it),0);
      return a+_legacyProfit(s);
    },0);
    return{ds,profit};
  });
}

export function renderProfit() {
  const container=document.getElementById('sub-profit');
  if(!container)return;
  // Bundle 3 (Stage 4): the Profit report is owner/admin only. Cost-blind
  // roles (manager/cashier) can't reach the Business tab via nav, but if they
  // somehow land here, never render the profit/cost data — show a notice.
  if (costBlindForCurrentRole()) {
    container.innerHTML = '<div class="biz-empty" style="padding:24px;">Profit reporting is available to the owner.</div>';
    return;
  }
  const sales=_periodSales(_profitPeriod);
  const revenue=sales.reduce((a,s)=>a+(s.totalRevenue??s.revenue??0),0);
  const netProfit=sales.reduce((a,s)=>{
    if(Array.isArray(s.items))return a+s.items.reduce((b,it)=>b+_correctedProfit(it),0);
    return a+_legacyProfit(s);
  },0);
  const corrCost=Math.max(0,revenue-netProfit);
  const units=sales.reduce((a,s)=>a+(s.itemCount||(Array.isArray(s.items)?s.items.length:1)),0);
  const margin=revenue>0?((netProfit/revenue)*100).toFixed(1):'0.0';
  const last7=_last7(); const maxP=Math.max(...last7.map(d=>Math.abs(d.profit)),1);
  const topItems=_topItems(sales);
  const labels={today:'Today',week:'This Week',month:'This Month'};

  container.innerHTML=`<div class="profit-wrap">
    <div class="profit-period-row">
      ${['today','week','month'].map(p=>`
        <button class="profit-period-btn${_profitPeriod===p?' active':''}"
          onclick="window.__PK._setProfitPeriod('${p}')">${labels[p]}</button>`).join('')}
    </div>

    <div class="profit-hero-card">
      <div class="profit-hero-label">Net Profit — ${labels[_profitPeriod].toLowerCase()}</div>
      <div class="profit-hero-amount${netProfit<0?' neg':''}">${fmt(netProfit)}</div>
      <div class="profit-hero-sub">Revenue ${fmt(revenue)} · Cost of goods ${fmt(corrCost)}</div>
    </div>

    <div class="profit-metrics-grid">
      <div class="profit-metric"><div class="pm-label">Revenue</div><div class="pm-val" style="color:var(--blue2);">${fmt(revenue)}</div></div>
      <div class="profit-metric"><div class="pm-label">Cost of Goods</div><div class="pm-val" style="color:var(--red);">${fmt(corrCost)}</div></div>
      <div class="profit-metric"><div class="pm-label">Margin</div><div class="pm-val" style="color:var(--accent);">${margin}%</div></div>
      <div class="profit-metric"><div class="pm-label">Items Sold</div><div class="pm-val" style="color:var(--muted);">${units}</div></div>
    </div>

    <div class="profit-spark-card">
      <div class="profit-spark-title">Daily profit — last 7 days</div>
      <div class="profit-spark-bars">
        ${last7.map((d,i)=>{
          const h=Math.max(4,Math.round((Math.abs(d.profit)/maxP)*52));
          const isT=i===6;
          const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(d.ds+'T00:00:00').getDay()];
          return`<div class="profit-spark-col">
            <div class="profit-spark-bar" title="${d.ds}: ${fmt(d.profit)}"
              style="height:${h}px;background:${d.profit<0?(isT?'var(--red)':'rgba(255,71,87,.35)'):(isT?'var(--green)':'rgba(46,204,113,.28)')}"></div>
            <div class="profit-spark-lbl">${day[0]}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <button class="profit-export-btn" onclick="window.exportProfitCSV('${_profitPeriod}')">
      ⬇️ Export profit report (CSV)
    </button>

    ${topItems.length?`
      <div class="profit-top-hdr">
        <span>🏆 Top items by profit</span>
        <span style="font-size:.62rem;color:var(--muted);">sorted by <span class="currency">₦</span> profit earned</span>
      </div>
      <div class="profit-top-items">
        ${topItems.map((it,i)=>{
          const m=it.revenue>0?((it.profit/it.revenue)*100).toFixed(0):0;
          // count = unique trades this item appeared in
          const tradeLabel=`in ${it.count} trade${it.count!==1?'s':''}`;
          return`<div class="profit-top-row">
            <span class="profit-top-rank">#${i+1}</span>
            <div class="profit-top-body">
              <div class="profit-top-name-row">
                <span class="profit-top-name">${escapeHtml(it.name)}</span>
                <span class="profit-top-profit">${fmt(it.profit)}</span>
              </div>
              <div class="profit-top-meta">
                <span class="profit-top-margin">${m}% margin</span>
                <span class="profit-top-trades">${tradeLabel}</span>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`:''}
  </div>`;

  if(window.__PK) window.__PK._setProfitPeriod=p=>{_profitPeriod=p;renderProfit();};
}

window.exportProfitCSV=function(period){
  const sales=_periodSales(period||_profitPeriod);
  if(!sales.length){alert('No sales data for this period.');return;}
  const rows=[['Trade ID','Date','Customer','Item','Qty','Revenue','Cost','Profit','Margin %','Voided']];
  sales.forEach(s=>{
    const cust=(window._pkWholesale||[]).find(c => c.id === s.custId)?.name || s.customerName || s.custName || 'Walk-in';
    if(Array.isArray(s.items)){
      s.items.forEach(it=>{
        const p=_correctedProfit(it),c=Math.max(0,(it.revenue||0)-p);
        const m=(it.revenue||0)>0?((p/(it.revenue||0))*100).toFixed(1)+'%':'—';
        rows.push([s.id||'',s.date||'',cust,it.itemName,it.label||'',it.revenue||0,c,p,m,s.voided?'Yes':'No']);
      });
    } else {
      const rev=(s.totalRevenue??s.revenue??0),p=_legacyProfit(s);
      rows.push([s.id||'',s.date||'',cust,s.itemName||'—','',rev,rev-p,p,rev>0?((p/rev)*100).toFixed(1)+'%':'—','No']);
    }
  });
  const csv=rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  const blob=new Blob([CSV_BOM+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`profit-${period||_profitPeriod}-${isoDate(new Date())}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
};