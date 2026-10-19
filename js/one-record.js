// ============================================================
//  one-record.js · D.3.8 switch-over review
//  Layout: docs/mockups/D.3.8-one-record.html, section 4.
//
//  Shown once, to the owner, before Business stops keeping its own running
//  totals. Accounts whose old total already equals what their trades owe
//  switch with nothing to decide. For every other account the owner says
//  which side is right, and nothing is written until every one is answered.
// ============================================================

import { fmt, escapeHtml, toast, saveLocal } from './utils.js';
import { activeUid } from './auth.js';
import { getCurrentActor, makePerformedBy, logActivity } from './staff-auth.js';
import { gwWrite } from './write-gateway.js';
import { isContactsActive, saveContactDB, borrowerToContact } from './contacts.js';
import { isOneRecord, switchOverCheck, switchAccount } from './ledger.js';
import { spendHeldOnDebts } from './trade-payment.js';

const _choices = {};   // borrowerId -> 'trades' | 'business'

export function needsSwitchOver() {
  if (window._staffOwnerUid) return false;   // owner only
  return (window._pkBorrowers || []).some(b => !isOneRecord(b));
}

function _pending() {
  const rows = (window._pkBorrowers || []).filter(b => !isOneRecord(b))
    .map(b => ({ b, ...switchOverCheck(b) }));
  return {
    matching: rows.filter(r => r.matches),
    mismatched: rows.filter(r => !r.matches).sort((a, x) => Math.abs(x.diff) - Math.abs(a.diff)),
  };
}

// Plain-words reason, from what is on the account. A hint, not a verdict.
function _why(b) {
  const tx = b.transactions || [];
  if (tx.some(t => t.kind === 'adjustment')) return 'Has corrections saved when a trade was edited.';
  if (tx.some(t => /^Overpayment/.test(t.name || ''))) return 'Has extra money from an overpaid trade.';
  if (tx.some(t => t.type === 'debt' && !/trade|NGPKT/i.test(t.name || ''))) return 'Has debts typed in with no trade behind them.';
  return 'Payments on the account and on the trades do not add up the same.';
}

// What "Business is right" will do, in plain words. Business showing LESS
// owed than the trades means payments reached the account but never the
// trades, so those trades get marked paid first and only the rest is held.
function _businessMeans(diff, trades) {
  if (diff > 0) return `"Business is right" keeps ${fmt(diff)} as a debt with no trade.`;
  const toTrades = Math.min(-diff, Math.max(0, trades));
  const rest = Math.round((-diff - toTrades) * 100) / 100;
  if (toTrades <= 0) return `"Business is right" keeps ${fmt(rest)} as their money, held by you.`;
  return `"Business is right" marks ${fmt(toTrades)} of their trades as paid${rest > 0 ? ` and keeps ${fmt(rest)} as their money` : ''}.`;
}

// "₦6,400 his" for money the shop holds, "₦2,000 owed" for money owed.
const _side = v => v < 0 ? `${fmt(-v)} theirs` : v > 0 ? `${fmt(v)} owed` : '₦0';

export function openOneRecordReview() {
  if (window._staffOwnerUid) return toast('⚠️ Only the owner can do this', 'err');
  const { matching, mismatched } = _pending();
  document.getElementById('orReview')?.remove();
  const el = document.createElement('div');
  el.id = 'orReview';
  el.className = 'or-overlay';
  const answered = mismatched.filter(r => _choices[r.b.id]).length;
  el.innerHTML = `
    <div class="or-sheet">
      <div class="or-head">
        <div class="or-title">Switch Business to one record</div>
        <div class="or-sub">Business will work out what each customer owes from their trades, so the two screens always agree. First, check the customers whose numbers do not match today. Nothing changes until you press Switch over.</div>
      </div>
      <div class="or-list">
        ${mismatched.map(({ b, business, trades, diff }) => `
          <div class="or-card">
            <div class="or-row"><div class="or-name">${escapeHtml(b.name)}</div><div class="or-off">Off by ${fmt(Math.abs(diff))}</div></div>
            <div class="or-nums">
              <div>Trades say<b>${_side(trades)}</b></div>
              <div>Business says<b>${_side(business)}</b></div>
              <div>Difference<b class="or-warn">${fmt(Math.abs(diff))}</b></div>
            </div>
            <div class="or-why">${_why(b)} ${_businessMeans(diff, trades)}</div>
            <div class="or-choice">
              <button class="${_choices[b.id] === 'trades' ? 'on' : ''}" onclick="PK.oneRecordPick('${b.id}','trades')">Trades are right</button>
              <button class="${_choices[b.id] === 'business' ? 'on' : ''}" onclick="PK.oneRecordPick('${b.id}','business')">Business is right</button>
              <button onclick="document.getElementById('orReview').remove();window.bizOpenBorrower?.('${b.id}')">Show me the history</button>
            </div>
          </div>`).join('')}
        <div class="or-ok">${matching.length} other customer${matching.length === 1 ? ' already matches' : 's already match'} ✓</div>
      </div>
      <div class="or-foot">
        <button class="or-cancel" onclick="document.getElementById('orReview').remove()">Not now</button>
        <button class="or-go" ${answered < mismatched.length ? 'disabled' : ''} onclick="PK.oneRecordSwitch()">
          ${answered < mismatched.length ? `Answer ${mismatched.length - answered} more to switch` : 'Switch over'}
        </button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

export function oneRecordPick(id, choice) {
  _choices[id] = choice;
  const scroll = document.querySelector('#orReview .or-list')?.scrollTop || 0;
  openOneRecordReview();
  const list = document.querySelector('#orReview .or-list');
  if (list) list.scrollTop = scroll;
}

export async function oneRecordSwitch() {
  const { matching, mismatched } = _pending();
  if (mismatched.some(r => !_choices[r.b.id])) return toast('⚠️ Answer every customer first', 'err');
  if (!confirm(`Switch ${matching.length + mismatched.length} customer accounts to one record?\n\nThis cannot be undone from the app.`)) return;

  const by = makePerformedBy(getCurrentActor());
  const uid = activeUid();
  if (!uid) return toast('⚠️ Sign in first, so the switch is saved', 'err');
  let failed = 0;
  // Every account is switched in memory first, so a new account made while
  // the saves run is already born switched. The old transaction list is kept
  // so an account whose save fails can be put back and offered again.
  const all = [...matching.map(r => [r.b, 'matched']), ...mismatched.map(r => [r.b, _choices[r.b.id]])];
  const before = new Map(all.map(([b]) => [b.id, [...(b.transactions || [])]]));
  all.forEach(([b, choice]) => switchAccount(b, choice, by));
  for (const [b] of all) {
    let saved = false;
    try {
      if (isContactsActive()) await saveContactDB(uid, borrowerToContact(b));
      else await gwWrite('set', 'borrowers', b.id, b);
      saved = true;
      // Business said less than the trades: that money was paid, so the
      // trades are marked paid with it rather than it sitting as held money.
      const r = mismatched.find(x => x.b.id === b.id);
      if (r && _choices[b.id] === 'business' && r.diff < 0) {
        await spendHeldOnDebts(b, uid, 'Payment recorded on the account before switch-over');
      }
    } catch (e) {
      failed++;
      console.error('[one-record] save failed for', b.name, e);
      if (saved) continue;   // saved, only marking trades failed: keep it switched
      delete b.oneRecord;
      b.transactions = before.get(b.id);
    }
  }
  saveLocal();
  logActivity('ONE_RECORD_SWITCH', {
    accounts: all.length,
    trades: mismatched.filter(r => _choices[r.b.id] === 'trades').map(r => `${r.b.name} ${r.diff}`),
    business: mismatched.filter(r => _choices[r.b.id] === 'business').map(r => `${r.b.name} ${r.diff}`),
  });
  document.getElementById('orReview')?.remove();
  window.bizRefreshActivePanel?.();
  window.__PK?.populateTradeCustSelect?.();
  toast(failed ? `⚠️ Switched, but ${failed} account${failed > 1 ? 's' : ''} did not finish. Open Review again when you are online` : `✅ Business now uses one record for ${all.length} customers`, failed ? 'err' : 'ok');
}
