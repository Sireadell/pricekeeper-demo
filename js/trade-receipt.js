// ============================================================
//  trade-receipt.js — v3
//  Fixes:
//  · Per-item discounts shown on modal receipt
//  · Per-item discounts shown on print/save receipt
//  · Total discount line on both
//  · Edited banner on both
// ============================================================

import { fmt, fmtSpan, escapeHtml } from './utils.js';

window._showReceiptModal = function(saleId) {
  const sale    = (window._pkSales || []).find(s => s.id === saleId);
  if (!sale) return;
  const hasHistory = Array.isArray(sale.editHistory) && sale.editHistory.length > 0;
  const appName  = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const settings = (() => { try { return JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch { return {}; } })();
  const cust     = (window._pkWholesale || []).find(c => c.id === sale.custId) || { name: sale.customerName || sale.custName || 'Walk-in' };
  const revenue  = sale.totalRevenue ?? sale.revenue ?? 0;
  const discount = sale.totalDiscount || 0;
  const received = sale.amountReceived ?? revenue;
  const balance  = sale.balanceOwing ?? 0;

  let rows = '';
  if (Array.isArray(sale.items)) {
    rows = sale.items.map((it, i) => {
      const itemDisc = it.itemDiscount || 0;
      return `
        <div class="rm-item-row">
          <span class="rm-sn">${i + 1}</span>
          <span class="rm-name">${escapeHtml(it.itemName)}</span>
          <span class="rm-qty">${escapeHtml(it.label || '')}</span>
          <span class="rm-item-disc-col">${itemDisc > 0 ? `<span class="rm-item-disc">-${fmtSpan(itemDisc)}</span>` : ''}</span>
          <span class="rm-amt">${fmtSpan(it.revenue)}</span>
        </div>`;
    }).join('');
  } else {
    rows = `<div class="rm-item-row"><span class="rm-sn">1</span><span class="rm-name">${escapeHtml(sale.itemName || '—')}</span><span class="rm-qty"></span><span></span><span class="rm-amt">${fmtSpan(revenue)}</span></div>`;
  }

  let modal = document.getElementById('receiptModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'receiptModal'; document.body.appendChild(modal); }

  const payStatusMap = { paid: '✅ Paid in Full', partial: '🔶 Partial Payment', credit: '⚠️ Credit / Unpaid' };
  const payLabel = payStatusMap[sale.paymentStatus] || (balance <= 0 ? '✅ Paid in Full' : '⚠️ Balance Owing');

  modal.innerHTML = `
    <div class="rm-overlay" onclick="if(event.target===this)document.getElementById('receiptModal').style.display='none'">
      <div class="rm-modal">
        <div class="rm-paper">
          <div class="rm-shop-name">${appName}</div>
          ${settings.phone || settings.address ? `<div class="rm-shop-meta">${[settings.phone, settings.address].filter(Boolean).join(' · ')}</div>` : ''}
          ${sale.voided   ? '<div class="rm-voided-banner">⚠ VOIDED</div>' : ''}
          ${sale.editedAt ? '<div class="rm-edited-banner">✏️ Edited Record</div>' : ''}
          <div class="rm-meta-grid">
            <div class="rm-meta-row"><span>Trade</span><strong>${sale.id || '—'}</strong></div>
            <div class="rm-meta-row"><span>Customer</span><strong>${escapeHtml(cust.name)}</strong></div>
            ${sale.visitorName ? `<div class="rm-meta-row"><span>Via</span><strong>${escapeHtml(sale.visitorName)}</strong></div>` : ''}
            <div class="rm-meta-row"><span>Date</span><strong>${sale.date || '—'}</strong></div>
            <div class="rm-meta-row"><span>Status</span><strong>${payLabel}</strong></div>
          </div>
          <div class="rm-divider"></div>
          <div class="rm-items-header">
            <span>#</span><span>Item</span><span>Qty</span><span style="text-align:right;">Disc</span><span style="text-align:right;">Amt</span>
          </div>
          <div class="rm-items">${rows}</div>
          <div class="rm-divider"></div>
          ${discount > 0 ? `
            <div class="rm-subtotal-row"><span>Subtotal</span><span>${fmtSpan((sale.totalRevenue ?? 0) + discount)}</span></div>
            <div class="rm-discount-row"><span>🏷️ Total Discount</span><span>-${fmtSpan(discount)}</span></div>
          ` : ''}
          <div class="rm-total-row"><span>TOTAL</span><span>${fmtSpan(revenue)}</span></div>
          <div class="rm-payment-row paid"><span>Paid</span><span>${fmtSpan(received)}</span></div>
          ${balance > 0 ? `<div class="rm-payment-row balance"><span>Balance Owing</span><span>${fmtSpan(balance)}</span></div>` : ''}
          <div class="rm-thanks">Thank you for your business!<br><span style="color:var(--accent);">${appName}</span></div>
        </div>
        <div class="rm-actions">
          <button class="rm-btn close" onclick="document.getElementById('receiptModal').style.display='none'">Close</button>
          ${hasHistory ? `<button class="rm-btn history" onclick="window._showEditHistoryModal('${saleId}')">🕘 View edit history (${sale.editHistory.length})</button>` : ''}
          <button class="rm-btn print" onclick="window._rmPrint('${saleId}')">🖨️ Print / Save</button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
};

window._rmPrint = function(saleId) {
  const sale     = (window._pkSales || []).find(s => s.id === saleId);
  if (!sale) return;
  const appName  = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const settings = (() => { try { return JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch { return {}; } })();
  const cust     = (window._pkWholesale || []).find(c => c.id === sale?.custId) || { name: sale?.customerName || sale?.custName || 'Walk-in' };
  const revenue  = sale?.totalRevenue ?? sale?.revenue ?? 0;
  const discount = sale?.totalDiscount || 0;
  const received = sale?.amountReceived ?? revenue;
  const balance  = sale?.balanceOwing ?? 0;

  let rows = '';
  if (Array.isArray(sale?.items)) {
    rows = sale.items.map((it, i) => {
      const itemDisc = it.itemDiscount || 0;
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.itemName)}</td>
        <td>${escapeHtml(it.label || '')}</td>
        <td style="text-align:right;color:#27ae60;">${itemDisc > 0 ? `-${fmtSpan(itemDisc)}` : ''}</td>
        <td style="text-align:right;font-weight:700;">${fmtSpan(it.revenue)}</td>
      </tr>`;
    }).join('');
  }

  const editedNote = sale?.editedAt ? `<div class="badge edited-note">✏️ Edited record — original may differ</div>` : '';
  const voidedNote = sale?.voided   ? `<div class="badge voided-note">⚠ VOIDED</div>` : '';
  const payStatusMap = { paid: 'Paid in Full', partial: 'Partial Payment', credit: 'Credit / Unpaid' };
  const payLabel = payStatusMap[sale.paymentStatus] || (balance <= 0 ? 'Paid in Full' : 'Balance Owing');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt · ${sale?.id || ''}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Courier New',monospace;max-width:420px;margin:0 auto;padding:24px 20px;font-size:12px;color:#111;}
    .currency{font-family:'Noto Sans','Segoe UI','Arial',sans-serif;}
    h2{text-align:center;font-size:15px;font-family:sans-serif;font-weight:900;margin-bottom:2px;}
    .meta{text-align:center;color:#777;font-size:10px;margin-bottom:14px;line-height:1.7;}
    .badge{display:block;padding:4px 10px;border-radius:4px;font-weight:700;font-size:11px;margin:6px 0;text-align:center;}
    .voided-note{background:#fff0f0;color:#cc0000;border:1px solid #ffcccc;}
    .edited-note{background:#fffbf0;color:#996600;border:1px solid #ffe0a0;}
    .divider{border:none;border-top:1px dashed #ccc;margin:10px 0;}
    table{width:100%;border-collapse:collapse;}
    th{border-bottom:2px solid #111;text-align:left;padding:4px 3px;font-size:10px;text-transform:uppercase;font-family:sans-serif;}
    td{padding:4px 3px;border-bottom:1px solid #eee;font-size:11px;vertical-align:middle;}
    .sub-row td{font-size:11px;color:#555;border-bottom:none;padding-top:10px;}
    .disc-row td{font-size:11px;color:#27ae60;border-bottom:1px dashed #ccc;}
    .total-row td{font-weight:900;font-size:13px;border-top:2px solid #111;border-bottom:none;padding-top:8px;font-family:sans-serif;}
    .pay-row td{font-size:11px;color:#27ae60;border-bottom:none;padding-top:4px;}
    .bal-row td{font-weight:700;font-size:12px;color:#cc0000;border-top:1px dashed #ccc;padding-top:6px;}
    .footer{text-align:center;margin-top:18px;font-size:10px;color:#aaa;line-height:1.8;}
  </style></head><body>
  <h2>${appName}</h2>
  <div class="meta">
    ${[settings.phone, settings.address].filter(Boolean).join(' · ')}
    ${settings.phone || settings.address ? '<br>' : ''}
    Trade: <strong>${sale?.id || '—'}</strong> · ${escapeHtml(cust.name)}${sale?.visitorName ? ` · via ${escapeHtml(sale.visitorName)}` : ''} · ${sale?.date || '—'}
    <br>Status: <strong>${payLabel}</strong>
  </div>
  ${voidedNote}
  ${editedNote}
  <table>
    <tr><th>#</th><th>Item</th><th>Qty</th><th style="text-align:right">Disc</th><th style="text-align:right">Amount</th></tr>
    ${rows}
    ${discount > 0 ? `
      <tr class="sub-row"><td colspan="4">Subtotal</td><td style="text-align:right">${fmtSpan(revenue + discount)}</td></tr>
      <tr class="disc-row"><td colspan="4">🏷️ Total Discount</td><td style="text-align:right">-${fmtSpan(discount)}</td></tr>
    ` : ''}
    <tr class="total-row"><td colspan="4">TOTAL</td><td style="text-align:right">${fmtSpan(revenue)}</td></tr>
    <tr class="pay-row"><td colspan="4">Paid</td><td style="text-align:right">${fmtSpan(received)}</td></tr>
    ${balance > 0 ? `<tr class="bal-row"><td colspan="4">Balance Owing</td><td style="text-align:right">${fmtSpan(balance)}</td></tr>` : ''}
  </table>
  <div class="footer">Thank you for your business!<br>${appName}</div>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (win) { win.onload = () => { win.print(); URL.revokeObjectURL(url); }; }
  else {
    const a = document.createElement('a');
    a.href = url; a.download = `receipt-${sale?.id || saleId}.html`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }
};

// ============================================================
//  Edit history modal (FEATURE-006)
// ============================================================

function _ehGetVersion(saleId, versionIdx) {
  const sale = (window._pkSales || []).find(s => s.id === saleId);
  if (!sale) return null;
  const history = Array.isArray(sale.editHistory) ? sale.editHistory : [];
  if (versionIdx < history.length) return { data: history[versionIdx], isCurrent: false };
  return { data: sale, isCurrent: true };
}

function _ehFormatTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-NG', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(ts); }
}

function _ehFormatActor(actor) {
  if (!actor) return '';
  const name = actor.name || actor.displayName || actor.username || actor.uid || '—';
  const role = actor.role || '';
  return role ? `${name} (${role})` : name;
}

function _ehRenderVersionBody(data) {
  const cust     = (window._pkWholesale || []).find(c => c.id === data.custId) || { name: data.customerName || data.custName || 'Walk-in' };
  const revenue  = data.totalRevenue ?? data.revenue ?? 0;
  const discount = data.totalDiscount || 0;
  const received = data.amountReceived ?? revenue;
  const balance  = data.balanceOwing ?? 0;
  const payStatusMap = { paid: '✅ Paid in Full', partial: '🔶 Partial Payment', credit: '⚠️ Credit / Unpaid' };
  const payLabel = payStatusMap[data.paymentStatus] || (balance <= 0 ? '✅ Paid in Full' : '⚠️ Balance Owing');

  let rows = '';
  if (Array.isArray(data.items)) {
    rows = data.items.map((it, i) => {
      const itemDisc = it.itemDiscount || 0;
      return `
        <div class="rm-item-row">
          <span class="rm-sn">${i + 1}</span>
          <span class="rm-name">${escapeHtml(it.itemName || '')}</span>
          <span class="rm-qty">${escapeHtml(it.label || '')}</span>
          <span class="rm-item-disc-col">${itemDisc > 0 ? `<span class="rm-item-disc">-${fmtSpan(itemDisc)}</span>` : ''}</span>
          <span class="rm-amt">${fmtSpan(it.revenue)}</span>
        </div>`;
    }).join('');
  } else {
    rows = `<div class="rm-item-row"><span class="rm-sn">1</span><span class="rm-name">${data.itemName || '—'}</span><span class="rm-qty"></span><span></span><span class="rm-amt">${fmtSpan(revenue)}</span></div>`;
  }

  return `
    <div class="eh-meta-grid">
      <div class="rm-meta-row"><span>Customer</span><strong>${escapeHtml(cust.name)}</strong></div>
      <div class="rm-meta-row"><span>Date</span><strong>${data.date || '—'}</strong></div>
      <div class="rm-meta-row"><span>Status</span><strong>${payLabel}</strong></div>
    </div>
    <div class="rm-items-header">
      <span>#</span><span>Item</span><span>Qty</span><span style="text-align:right;">Disc</span><span style="text-align:right;">Amt</span>
    </div>
    <div class="rm-items">${rows}</div>
    <div class="rm-divider"></div>
    ${discount > 0 ? `
      <div class="rm-subtotal-row"><span>Subtotal</span><span>${fmtSpan(revenue + discount)}</span></div>
      <div class="rm-discount-row"><span>🏷️ Total Discount</span><span>-${fmtSpan(discount)}</span></div>
    ` : ''}
    <div class="rm-total-row"><span>TOTAL</span><span>${fmtSpan(revenue)}</span></div>
    <div class="rm-payment-row paid"><span>Paid</span><span>${fmtSpan(received)}</span></div>
    ${balance > 0 ? `<div class="rm-payment-row balance"><span>Balance Owing</span><span>${fmtSpan(balance)}</span></div>` : ''}
  `;
}

window._showEditHistoryModal = function(saleId) {
  const sale = (window._pkSales || []).find(s => s.id === saleId);
  if (!sale || !Array.isArray(sale.editHistory) || !sale.editHistory.length) return;

  const total = sale.editHistory.length;

  const versionCards = sale.editHistory.map((snap, i) => {
    const label = i === 0 ? 'Original' : `Edit ${i}`;
    const actorLine = _ehFormatActor(snap.snapshotBy);
    return `
      <div class="eh-version">
        <div class="eh-version-head">
          <div class="eh-version-label">${label}</div>
          <div class="eh-version-meta">${_ehFormatTs(snap.snapshotAt)}${actorLine ? ' · ' + actorLine : ''}</div>
        </div>
        <div class="eh-paper">${_ehRenderVersionBody(snap)}</div>
        <div class="eh-actions">
          <button class="rm-btn print" onclick="window._ehPrintVersion('${saleId}', ${i})">🖨️ Print</button>
          <button class="rm-btn wa" onclick="window._ehShareWhatsApp('${saleId}', ${i})">📱 WhatsApp</button>
        </div>
      </div>`;
  }).join('');

  const currentActor = sale.editedBy
    ? { name: sale.editedBy.displayName || sale.editedBy.name, role: sale.editedBy.role, uid: sale.editedBy.username || sale.editedBy.uid }
    : null;
  const currentCard = `
    <div class="eh-version eh-current">
      <div class="eh-version-head">
        <div class="eh-version-label">Current (live)</div>
        <div class="eh-version-meta">${_ehFormatTs(sale.editedAt)}${currentActor ? ' · ' + _ehFormatActor(currentActor) : ''}</div>
      </div>
      <div class="eh-paper">${_ehRenderVersionBody(sale)}</div>
      <div class="eh-actions">
        <button class="rm-btn print" onclick="window._ehPrintVersion('${saleId}', ${total})">🖨️ Print</button>
        <button class="rm-btn wa" onclick="window._ehShareWhatsApp('${saleId}', ${total})">📱 WhatsApp</button>
      </div>
    </div>`;

  let modal = document.getElementById('editHistoryModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'editHistoryModal'; document.body.appendChild(modal); }
  modal.innerHTML = `
    <div class="rm-overlay" onclick="if(event.target===this)document.getElementById('editHistoryModal').style.display='none'">
      <div class="rm-modal eh-modal">
        <div class="eh-header">
          <div class="eh-title">Edit history · ${saleId}</div>
          <button class="rm-btn close" onclick="document.getElementById('editHistoryModal').style.display='none'">Close</button>
        </div>
        <div class="eh-body">
          ${versionCards}
          ${currentCard}
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
};

window._ehPrintVersion = function(saleId, versionIdx) {
  const v = _ehGetVersion(saleId, versionIdx);
  if (!v) return;
  const data     = v.data;
  const appName  = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const settings = (() => { try { return JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch { return {}; } })();
  const cust     = (window._pkWholesale || []).find(c => c.id === data.custId) || { name: data.customerName || data.custName || 'Walk-in' };
  const revenue  = data.totalRevenue ?? data.revenue ?? 0;
  const discount = data.totalDiscount || 0;
  const received = data.amountReceived ?? revenue;
  const balance  = data.balanceOwing ?? 0;

  let rows = '';
  if (Array.isArray(data.items)) {
    rows = data.items.map((it, i) => {
      const itemDisc = it.itemDiscount || 0;
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.itemName)}</td>
        <td>${escapeHtml(it.label || '')}</td>
        <td style="text-align:right;color:#27ae60;">${itemDisc > 0 ? `-${fmtSpan(itemDisc)}` : ''}</td>
        <td style="text-align:right;font-weight:700;">${fmtSpan(it.revenue)}</td>
      </tr>`;
    }).join('');
  }

  const label = v.isCurrent ? 'Current (live)' : (versionIdx === 0 ? 'Original' : `Edit ${versionIdx}`);
  const ts = v.isCurrent ? data.editedAt : data.snapshotAt;
  const by = v.isCurrent
    ? (data.editedBy ? _ehFormatActor({ name: data.editedBy.displayName, role: data.editedBy.role }) : '')
    : _ehFormatActor(data.snapshotBy);
  const payStatusMap = { paid: 'Paid in Full', partial: 'Partial Payment', credit: 'Credit / Unpaid' };
  const payLabel = payStatusMap[data.paymentStatus] || (balance <= 0 ? 'Paid in Full' : 'Balance Owing');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt · ${data.id || ''} · ${label}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Courier New',monospace;max-width:420px;margin:0 auto;padding:24px 20px;font-size:12px;color:#111;}
    .currency{font-family:'Noto Sans','Segoe UI','Arial',sans-serif;}
    h2{text-align:center;font-size:15px;font-family:sans-serif;font-weight:900;margin-bottom:2px;}
    .meta{text-align:center;color:#777;font-size:10px;margin-bottom:14px;line-height:1.7;}
    .version-banner{display:block;padding:4px 10px;border-radius:4px;font-weight:700;font-size:11px;margin:6px 0;text-align:center;background:#fffbf0;color:#996600;border:1px solid #ffe0a0;}
    table{width:100%;border-collapse:collapse;}
    th{border-bottom:2px solid #111;text-align:left;padding:4px 3px;font-size:10px;text-transform:uppercase;font-family:sans-serif;}
    td{padding:4px 3px;border-bottom:1px solid #eee;font-size:11px;vertical-align:middle;}
    .sub-row td{font-size:11px;color:#555;border-bottom:none;padding-top:10px;}
    .disc-row td{font-size:11px;color:#27ae60;border-bottom:1px dashed #ccc;}
    .total-row td{font-weight:900;font-size:13px;border-top:2px solid #111;border-bottom:none;padding-top:8px;font-family:sans-serif;}
    .pay-row td{font-size:11px;color:#27ae60;border-bottom:none;padding-top:4px;}
    .bal-row td{font-weight:700;font-size:12px;color:#cc0000;border-top:1px dashed #ccc;padding-top:6px;}
    .footer{text-align:center;margin-top:18px;font-size:10px;color:#aaa;line-height:1.8;}
  </style></head><body>
  <h2>${appName}</h2>
  <div class="meta">
    ${[settings.phone, settings.address].filter(Boolean).join(' · ')}
    ${settings.phone || settings.address ? '<br>' : ''}
    Trade: <strong>${data.id || '—'}</strong> · ${escapeHtml(cust.name)} · ${data.date || '—'}
    <br>Status: <strong>${payLabel}</strong>
  </div>
  <div class="version-banner">📜 ${label}${ts ? ' · ' + _ehFormatTs(ts) : ''}${by ? ' · ' + by : ''}</div>
  <table>
    <tr><th>#</th><th>Item</th><th>Qty</th><th style="text-align:right">Disc</th><th style="text-align:right">Amount</th></tr>
    ${rows}
    ${discount > 0 ? `
      <tr class="sub-row"><td colspan="4">Subtotal</td><td style="text-align:right">${fmtSpan(revenue + discount)}</td></tr>
      <tr class="disc-row"><td colspan="4">🏷️ Total Discount</td><td style="text-align:right">-${fmtSpan(discount)}</td></tr>
    ` : ''}
    <tr class="total-row"><td colspan="4">TOTAL</td><td style="text-align:right">${fmtSpan(revenue)}</td></tr>
    <tr class="pay-row"><td colspan="4">Paid</td><td style="text-align:right">${fmtSpan(received)}</td></tr>
    ${balance > 0 ? `<tr class="bal-row"><td colspan="4">Balance Owing</td><td style="text-align:right">${fmtSpan(balance)}</td></tr>` : ''}
  </table>
  <div class="footer">Thank you for your business!<br>${appName}</div>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (win) { win.onload = () => { win.print(); URL.revokeObjectURL(url); }; }
  else {
    const a = document.createElement('a');
    a.href = url; a.download = `receipt-${data.id || saleId}-${label.replace(/\s+/g,'_')}.html`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }
};

window._ehShareWhatsApp = function(saleId, versionIdx) {
  const v = _ehGetVersion(saleId, versionIdx);
  if (!v) return;
  const data    = v.data;
  const appName = localStorage.getItem('pkAppName') || 'PriceKeeper';
  const cust    = (window._pkWholesale || []).find(c => c.id === data.custId) || { name: data.customerName || data.custName || 'Walk-in' };
  const revenue = data.totalRevenue ?? data.revenue ?? 0;
  const received = data.amountReceived ?? revenue;
  const balance = data.balanceOwing ?? 0;
  const label = v.isCurrent ? 'Current (live)' : (versionIdx === 0 ? 'Original' : `Edit ${versionIdx}`);
  const ts = v.isCurrent ? data.editedAt : data.snapshotAt;

  const itemLines = Array.isArray(data.items)
    ? data.items.map((it, i) => `${i + 1}. ${it.itemName}${it.label ? ` (${it.label})` : ''} — ${fmt(it.revenue)}`).join('\n')
    : '';

  const lines = [
    `*${appName}*`,
    `Trade ${data.id || '—'} · ${label}`,
    ts ? `Recorded: ${_ehFormatTs(ts)}` : '',
    `Customer: ${cust.name}`,
    `Date: ${data.date || '—'}`,
    '',
    itemLines,
    '',
    `*Total:* ${fmt(revenue)}`,
    `Paid: ${fmt(received)}`,
    balance > 0 ? `Balance: ${fmt(balance)}` : '',
  ].filter(Boolean).join('\n');

  const url = 'https://wa.me/?text=' + encodeURIComponent(lines);
  window.open(url, '_blank');
};