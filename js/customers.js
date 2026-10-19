// ============================================================
//  customers.js — Customer Intelligence
//  Changes this session:
//  - Replaced 3-column metric box grid with compact stat line
//    (CLV | trades | avg order | last trade — one line)
//  - Removed Revenue/Profit/Cost boxes (redundant with Profit tab)
//  - RFM tags, debt badge, top items, trade history retained
//  - renderWholesale() renders into #customersList
//  - populateWsMonths / toggleWsStats imported from history.js
//  - bizRefreshActivePanel called after every save/delete so
//    the business.js panel updates without needing a tab switch
// ============================================================

import { fmt, uid, today, openModal, closeModal, toast, saveLocal, setBtnLoading, escapeHtml, withLoading, findBorrowerByName, csvCell, CSV_BOM } from './utils.js';
import { borrowerBalance, carryRename } from './borrowers.js';
import { assertPermission, logActivity, costBlindForCurrentRole } from './staff-auth.js';
import { currentUser, activeUid }   from './auth.js';
import { saveCustomer, removeCustomer } from './db.js';
import { renderWholesale }          from './history.js';
import { populateTradeCustSelect }  from './trade.js';
import { isContactsActive, saveContactDB, deleteContactDB, customerToContact } from './contacts.js';

// ── RFM scoring ───────────────────────────────────────────────────────────────
function _rfmTag(tradeCount, lastDate) {
  const daysSince = lastDate
    ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
    : 9999;
  // cls drives theme-adaptive colors via .biz-rfm-tag--* (dark + [data-theme=light]) in business.css
  if (tradeCount >= 5 && daysSince <= 14)  return { label:'Champion',   cls:'champion' };
  if (tradeCount >= 3 && daysSince <= 30)  return { label:'Regular',    cls:'regular' };
  if (tradeCount >= 2 && daysSince <= 60)  return { label:'At Risk',    cls:'atrisk' };
  if (tradeCount <= 2 && daysSince <= 30)  return { label:'New',        cls:'new' };
  if (daysSince > 60)                      return { label:'Lost',       cls:'lost' };
  return                                          { label:'Occasional', cls:'occasional' };
}

// ── Compute customer stats ────────────────────────────────────────────────────
function _stats(custId) {
  const sales = (window._pkSales||[]).filter(s => s.custId===custId && !s.voided);
  if (!sales.length) return null;
  const totalRevenue = sales.reduce((a,s) => a+(s.totalRevenue??s.revenue??0), 0);
  const tradeCount   = sales.length;
  const avgOrder     = totalRevenue / tradeCount;
  const sorted       = [...sales].sort((a,b)=>(b.createdTs||0)-(a.createdTs||0));
  const lastDate     = sorted[0].date || null;
  const firstDate    = sorted[sorted.length-1].date || null;

  const itemMap = {};
  sales.forEach(s => {
    (s.items||[]).forEach(it => {
      if (!itemMap[it.itemName]) itemMap[it.itemName] = 0;
      itemMap[it.itemName] += (it.revenue||0);
    });
    if (!Array.isArray(s.items) && s.itemName) {
      if (!itemMap[s.itemName]) itemMap[s.itemName] = 0;
      itemMap[s.itemName] += (s.totalRevenue??s.revenue??0);
    }
  });
  const topItems = Object.entries(itemMap).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([name,rev]) => ({name,revenue:rev}));

  const custName = (window._pkWholesale||[]).find(c=>c.id===custId)?.name;

  // Per-visitor breakdown — different people can buy on one account (e.g. a
  // household), each trade optionally tagged with who physically came in.
  // Only surfaced when at least one trade actually names a visitor, so
  // accounts nobody's tagged don't show a redundant single-row "breakdown."
  const hasNamedVisitor = sales.some(s => (s.visitorName||'').trim());
  let byVisitor = [];
  if (hasNamedVisitor) {
    const visitorMap = {};
    sales.forEach(s => {
      const v = (s.visitorName||'').trim() || (custName || 'Account holder');
      if (!visitorMap[v]) visitorMap[v] = { name:v, trades:0, revenue:0, paid:0, owing:0 };
      visitorMap[v].trades++;
      visitorMap[v].revenue += (s.totalRevenue ?? s.revenue ?? 0);
      visitorMap[v].paid    += (s.amountReceived || 0);
      visitorMap[v].owing   += (s.balanceOwing || 0);
    });
    byVisitor = Object.values(visitorMap).sort((a,b)=>b.revenue-a.revenue);
  }
  const borrower = findBorrowerByName(window._pkBorrowers, custName);
  const debtTotal = borrower ? borrowerBalance(borrower).balance : 0;

  const rfm = _rfmTag(tradeCount, lastDate);
  return { totalRevenue, tradeCount, avgOrder, lastDate, firstDate, topItems,
           hasDebt: debtTotal>0, debtTotal, rfm, sales: sorted };
}

// ── Render Customer Intelligence ──────────────────────────────────────────────
export function renderCustomers() {
  const list = document.getElementById('customersList');
  if (!list) return;

  const customers = window._pkWholesale || [];
  if (!customers.length) {
    list.innerHTML = `<div class="empty"><div class="ico">🤝</div><p>No customers yet.<br>Add one from the Trade tab.</p></div>`;
    return;
  }

  // Sort by lifetime revenue
  const withStats = customers.map(c => ({c, stats:_stats(c.id)}))
    .sort((a,b) => (b.stats?.totalRevenue||0)-(a.stats?.totalRevenue||0));

  list.innerHTML = withStats.map(({c, stats}) => {
    if (!stats) return `
      <div class="customer-card">
        <div class="cust-hdr">
          <div>
            <div class="cust-name">🤝 ${escapeHtml(c.name)}</div>
            ${c.contact?`<div class="cust-contact">📞 ${escapeHtml(c.contact)}</div>`:''}
            <div style="font-size:.63rem;color:var(--muted);margin-top:3px;">No trades yet</div>
          </div>
          <div class="actions">
            <button class="ibtn edit" onclick="PK.editCustomer('${c.id}')">✏️</button>
            <button class="ibtn del"  onclick="PK.deleteCustomer('${c.id}')">🗑</button>
          </div>
        </div>
      </div>`;

    const rfm = stats.rfm;
    const lastStr  = stats.lastDate  ? new Date(stats.lastDate+'T00:00:00').toLocaleDateString('en-NG',{day:'numeric',month:'short'}) : '—';
    const firstStr = stats.firstDate ? new Date(stats.firstDate+'T00:00:00').toLocaleDateString('en-NG',{day:'numeric',month:'short'}) : '—';

    return `
      <div class="customer-card" id="cc-${c.id}">
        <div class="cust-hdr" onclick="document.getElementById('cc-${c.id}').classList.toggle('open')">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:3px;">
              <div class="cust-name">🤝 ${escapeHtml(c.name)}</div>
              <span class="biz-rfm-tag biz-rfm-tag--${rfm.cls}">${rfm.label}</span>
              ${stats.hasDebt?`<span style="font-size:.58rem;font-family:var(--fh);font-weight:700;padding:2px 7px;border-radius:10px;color:var(--red);background:rgba(255,71,87,.08);border:1px solid rgba(255,71,87,.2);">💸 ${fmt(stats.debtTotal)}</span>`:''}
            </div>
            ${c.contact?`<div class="cust-contact">📞 ${escapeHtml(c.contact)}</div>`:''}
            <!-- Compact stat line — no boxes -->
            <div style="font-size:.63rem;color:var(--muted);margin-top:4px;display:flex;gap:10px;flex-wrap:wrap;">
              <span>CLV <strong style="color:var(--green);">${fmt(stats.totalRevenue)}</strong></span>
              <span>${stats.tradeCount} trade${stats.tradeCount!==1?'s':''}</span>
              <span>avg ${fmt(stats.avgOrder)}</span>
              <span>last ${lastStr}</span>
            </div>
          </div>
          <div class="actions" onclick="event.stopPropagation()">
            <button class="ibtn edit" onclick="PK.editCustomer('${c.id}')">✏️</button>
            <button class="ibtn del"  onclick="PK.deleteCustomer('${c.id}')">🗑</button>
          </div>
        </div>

        <div class="cust-body">
          <!-- Timeline -->
          <div style="font-size:.64rem;color:var(--muted);margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap;">
            <span>First: <strong style="color:var(--text2);">${firstStr}</strong></span>
            <span>Last: <strong style="color:var(--text2);">${lastStr}</strong></span>
            <span>${stats.tradeCount} trades total</span>
          </div>

          <!-- Top items -->
          ${stats.topItems.length?`
            <div style="font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);margin-bottom:5px;">Top items</div>
            ${stats.topItems.map((it,i)=>`
              <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);padding:4px 0;border-bottom:1px dashed var(--border);">
                <span><span style="color:var(--muted);font-size:.6rem;margin-right:5px;">#${i+1}</span><span style="color:var(--text2);font-family:var(--fh);font-weight:600;">${escapeHtml(it.name)}</span></span>
                <span style="color:var(--blue2);font-family:var(--fh);font-weight:700;">${fmt(it.revenue)}</span>
              </div>`).join('')}
            <div style="margin-top:6px;"></div>
          `:''}

          <!-- Debt -->
          ${stats.hasDebt?`
            <div style="background:rgba(255,71,87,.06);border:1px solid rgba(255,71,87,.2);border-radius:8px;padding:9px 12px;margin-bottom:10px;">
              <div style="font-size:.58rem;color:var(--red);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);margin-bottom:3px;">Outstanding Debt</div>
              <div style="font-family:var(--fh);font-weight:800;font-size:.95rem;color:var(--red);">${fmt(stats.debtTotal)}</div>
            </div>`:''}

          <!-- Export + trade list -->
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <button class="btn-secondary" style="font-size:.7rem;padding:6px 11px;" onclick="window.exportCustomerCSV('${c.id}')">⬇️ Export CSV</button>
          </div>

          <div style="font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-family:var(--fb);margin-bottom:7px;">Trade history</div>
          ${stats.sales.slice(0,8).map(s => {
            const rev = s.totalRevenue??s.revenue??0;
            const items = Array.isArray(s.items)
              ? s.items.map(it=>`${escapeHtml(it.itemName)} (${escapeHtml(it.label)})`).join(', ')
              : `${escapeHtml(s.itemName||'—')}`;
            return `<div class="sale-group">
              <div class="sale-group-hdr" onclick="this.parentElement.classList.toggle('open')">
                <div>
                  <div class="sale-group-name">${s.id||'—'}</div>
                  <div class="sale-group-meta">${s.date||'—'} · ${s.itemCount||1} item${(s.itemCount||1)!==1?'s':''}</div>
                </div>
                <div class="sale-group-amt">${fmt(rev)}</div>
              </div>
              <div class="sale-group-detail">
                <div style="font-size:.69rem;color:var(--muted);padding:3px 0;">${items}</div>
              </div>
            </div>`;
          }).join('')}
          ${stats.sales.length>8?`<div style="font-size:.64rem;color:var(--muted);text-align:center;padding:6px 0;">+ ${stats.sales.length-8} more — export CSV</div>`:''}
        </div>
      </div>`;
  }).join('');
}

// CSV export
window.exportCustomerCSV = function(custId) {
  const cust  = (window._pkWholesale||[]).find(c=>c.id===custId);
  const sales = (window._pkSales||[]).filter(s=>s.custId===custId&&!s.voided)
    .sort((a,b)=>(b.createdTs||0)-(a.createdTs||0));
  if (!sales.length) return toast('No sales to export','err');
  const rows = [['Trade ID','Date','Items','Revenue','Cost','Profit','Discount']];
  sales.forEach(s => {
    rows.push([s.id||'',s.date||'',
      (s.items||[]).map(it=>`${it.itemName}(${it.label})`).join('; '),
      s.totalRevenue??s.revenue??0, s.totalCost??0, s.totalProfit??s.profit??0,
      s.totalDiscount||0]);
  });
  // Staff who may not see costs get no Cost or Profit columns (same rule as the trade export).
  if (costBlindForCurrentRole()) rows.forEach(r => r.splice(4, 2));
  const csv  = rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([CSV_BOM + csv],{type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`${(cust?.name||custId).replace(/\s+/g,'-')}-trades.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast(`⬇️ ${cust?.name||'Customer'} trades exported`,'ok');
};

// ── Customer CRUD ─────────────────────────────────────────────────────────────
export function openCustModal(id) {
  const title = document.getElementById('custModalTitle');
  if (title) title.textContent = id ? '✏️ Edit Customer' : '➕ New Customer';
  const idEl = document.getElementById('custId'); if (idEl) idEl.value = id||'';
  if (id) {
    // Fall back to the borrowers list so a credit-only person (no customer doc
    // yet) prefills correctly — saving then promotes them to a full customer.
    const c = (window._pkWholesale||[]).find(c=>c.id===id)
           || (window._pkBorrowers||[]).find(b=>b.id===id);
    const n  = document.getElementById('custName');    if(n)  n.value  = c?.name   ||'';
    const ct = document.getElementById('custContact'); if(ct) ct.value = c?.contact||'';
  } else {
    const n  = document.getElementById('custName');    if(n)  n.value  = '';
    const ct = document.getElementById('custContact'); if(ct) ct.value = '';
  }
  openModal('custOverlay');
}

export const editCustomer = id => openCustModal(id);

export async function saveCustomerRecord() {
  const btn     = document.querySelector('#custOverlay .btn-save');
  const name    = document.getElementById('custName')?.value.trim()    || '';
  const contact = document.getElementById('custContact')?.value.trim() || '';
  const eid     = document.getElementById('custId')?.value             || '';
  if (!name) return toast('⚠️ Enter customer name', 'err');
  if (name.length > 60) return toast('⚠️ Customer name must be 60 characters or less', 'err');

  // Duplicate name check
  const dupCandidate = findBorrowerByName(window._pkWholesale, name);
  const duplicate = dupCandidate && dupCandidate.id !== eid ? dupCandidate : null;
  if (duplicate) return toast(`⚠️ A customer named "${duplicate.name}" already exists`, 'err');

  setBtnLoading(btn, true);
  try {
    window._pkWholesale = window._pkWholesale||[];
    const idx = eid ? window._pkWholesale.findIndex(c=>c.id===eid) : -1;
    let record;
    const oldName = idx>=0 ? window._pkWholesale[idx].name : '';
    if (idx>=0) {
      // Existing customer — update in place.
      window._pkWholesale[idx] = {...window._pkWholesale[idx], name, contact};
      record = window._pkWholesale[idx];
    } else {
      // New customer, OR promoting a credit-only person (eid is their borrower
      // id) to a full customer record — reuse that id so the name link holds.
      record = {id: eid || uid(), name, contact};
      window._pkWholesale.push(record);
    }
    const auid = activeUid();
    if (auid && isContactsActive()) {
      await saveContactDB(auid, customerToContact(record));
    } else if (currentUser) {
      await saveCustomer(currentUser.uid, record);
    }
    await carryRename(oldName, name, record.id);
    saveLocal();
    renderCustomers();
    populateTradeCustSelect();
    closeModal('custOverlay');
    toast('✅ Customer saved!','ok');
    window.bizRefreshActivePanel?.();
  } finally { setBtnLoading(btn,false); }
}

export async function deleteCustomer(id) {
  if (!assertPermission('deleteBorrower')) return;
  const c = (window._pkWholesale||[]).find(c=>c.id===id);
  if (!c) return;
  // Their trades find their account through this record, so it stays while
  // anything is still owed.
  const owing = (window._pkSales||[]).filter(s=>s.custId===id && !s.voided && (s.balanceOwing||0)>0.009);
  if (owing.length) return toast(`⚠️ ${c.name} still owes on ${owing.length} trade${owing.length>1?'s':''}. Settle them before deleting.`, 'err');
  if (!confirm('Delete "'+c.name+'"?\nThis removes the customer record only.')) return;
  const btn = document.querySelector(`#cc-${id} .ibtn.del`);
  await withLoading(btn, async () => {
    window._pkWholesale = window._pkWholesale.filter(c=>c.id!==id);
    const auid = activeUid();
    const contact = (window._pkContacts||[]).find(x=>x.id===id);
    if (auid && isContactsActive() && contact?.tags?.includes('borrower')) {
      // Same person holds a credit account: drop only the customer side.
      await saveContactDB(auid, { ...contact, tags: contact.tags.filter(t=>t!=='customer') });
    } else if (auid && isContactsActive()) {
      await deleteContactDB(auid, id);
    } else if (currentUser) {
      await removeCustomer(currentUser.uid, id);
    }
    saveLocal();
    renderCustomers();
    populateTradeCustSelect();
    logActivity('DELETE_CUSTOMER', { name: c.name });
    toast('🗑 Customer deleted','ok');
    window.bizRefreshActivePanel?.();
  });
}