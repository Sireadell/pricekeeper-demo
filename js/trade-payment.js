// ============================================================
//  trade-payment.js — v7
//  Fixes:
//  · OVERPAYMENT: _handleOverpayment is now properly awaited
//    in both _pmConfirm (new trade) and _pmConfirmExisting
//    (existing trade). renderTradeTable() is called ONLY after
//    all async ops complete, so in-memory balanceOwing updates
//    are visible before the table re-renders.
//  · Source trade balanceOwing is set to 0 and saved BEFORE
//    _handleOverpayment runs, preventing stale reads.
//  · _refreshBorrowers + renderTradeTable de-duped to one
//    final call site per flow.
//  · syncBorrowerPaymentToTrades exported so Credit Accounts
//    payments flow back into the trade table (FIFO).
// ============================================================

import { fmt, fmtSpan, uid, today, toast, saveLocal, escapeHtml, findBorrowerByName, lowThresholdFromPct } from './utils.js';
import { borrowerBalance, accountStanding } from './borrowers.js';
import { currentUser, activeUid as resolveUid } from './auth.js';
import { saveItem, patchItem, saveBorrower } from './db.js';
import { logActivity, getCurrentActor, makePerformedBy } from './staff-auth.js';
import { getCart, getEditingTradeId, clearCart, _ntmUpdateTotal, _ppc, _ppr } from './trade-modal.js';
import { renderTradeTable }                   from './trade-table.js';
import { isContactsActive, saveContactDB, borrowerToContact, mirrorContactLegacy } from './contacts.js';
import { gwWrite, gwWriteLinked }              from './write-gateway.js';   // D.8.2a sales writes; BUG-014 linked writes
import { isOneRecord, oneRecordStanding, newAccountFields, planAccountPayment, bucketTag } from './ledger.js';   // D.3.8

// Hard auth gate for any sale/payment write. With no signed-in account the
// write is skipped at the cloud edge (gwWrite only fires `if (activeUid)`) and
// persists ONLY to localStorage — then the next cloud snapshot silently erases
// it. That is exactly how the June-8 trades were lost. Refuse the write and
// tell the user to log in, rather than save into a black hole.
function _requireSaleAuth() {
  const uid = resolveUid();
  if (uid) return uid;
  toast('⛔ Session expired — please refresh the page and try again. Trade was NOT saved.', 'err');
  return null;
}

function _generateTradeId(date) {
  const ds   = (date || today()).replace(/-/g, '');
  const rand = crypto.randomUUID().slice(0, 5).toUpperCase();
  return `NGPKT${ds}${rand}`;
}

// ── Duplicate-submit guard (D.8.2a fix) ───────────────────────
// A stuck "Syncing" banner made the founder think an offline sale had
// failed, so they re-recorded the SAME cart → a second sale (new id,
// identical contents) landed in Firestore. This guards the cart
// submission: if an identical sale was just recorded, confirm before
// creating another. In-memory + per-session is enough (the scenario is
// a quick retry); genuine repeat sales just click through the confirm.
const _DUP_WINDOW_MS = 3 * 60 * 1000;
let _lastSale = { sig: null, tradeId: null, ts: 0 };

// Same idea for PAYMENTS on an existing trade (the 2026-07-16 double
// payment on NGPKT2026071629CB4): same amount, same trade, seconds apart.
// Payments are lower-frequency and more sensitive than trade creation, so
// the window is tight (60s) and checked against the trade's own payment
// history — no global signature needed.
const _PAY_DUP_WINDOW_MS = 60 * 1000;

function _cartSignature(cart, custId, total) {
  const items = (cart || [])
    .map(r => `${r.itemId}:${r.cartons || 0}:${r.rows || 0}:${r.qty || 0}:${Math.round(r.revenue || 0)}`)
    .sort()
    .join('|');
  return `${custId || ''}#${Math.round(total || 0)}#${items}`;
}

// Returns true if it's safe to proceed, false if the user cancelled a
// suspected duplicate.
function _confirmNotDuplicate(sig) {
  if (_lastSale.sig !== sig) return true;
  if (Date.now() - _lastSale.ts >= _DUP_WINDOW_MS) return true;
  const secs = Math.round((Date.now() - _lastSale.ts) / 1000);
  const ago  = secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
  return window.confirm(
    `This looks identical to trade ${_lastSale.tradeId}, recorded ${ago} ago.\n\n` +
    `If the last one didn't sync yet it will still sync on its own — you don't need to redo it.\n\n` +
    `Record this as a SEPARATE sale anyway?`
  );
}

// ── Refresh borrowers UI via any available handle ─────────────
function _refreshBorrowers() {
  if (typeof window.__PK?.renderBorrowers === 'function') window.__PK.renderBorrowers();
  else if (typeof window.PK?.renderBorrowers === 'function') window.PK.renderBorrowers();
  window.__PK?.populateTradeCustSelect?.();
}

// ── Firestore batch save helper ───────────────────────────────
async function _firestoreSaveSales(activeUid, sales) {
  if (!sales.length) return;
  try {
    // D.8.2a — sales routed through the write gateway (queues if offline).
    // gwWrite resolves the uid itself; activeUid kept for signature compat.
    await Promise.all(sales.map(s => gwWrite('update', 'sales', s.id, s)));
  } catch (err) {
    console.error('[trade-payment] Failed to save sales to cloud:', err);
    toast('⚠️ Some sales failed to sync to cloud', 'err');
  }
}

// D.8.2b sub-step 1 — ledger saves ride the write gateway (inside
// saveContactDB / db.js saveBorrower): offline they QUEUE (owner-stamped by
// sub-step 0, retried by the sync engine) instead of hanging forever on a
// direct setDoc — the root cause of the v1.0 debt-sync bug. Real failures
// now toast from the save layer instead of being swallowed by .catch(()=>{}).
// Deliberately NOT rethrown from here: by the time a ledger save fails the
// sale/payment is already written — bubbling up would show a false
// "payment failed" and invite duplicate retries.
//
// BUG-014 — as of the full call-site pass, this function's only remaining
// caller is _applyOverpaymentToBorrower. Every other former caller
// (_autoRecordDebt, _recordBorrowerDelta, _autoRecordRepaymentForTrade,
// _reversePaymentInBorrowers) was split into a _prepare*() descriptor
// function + a gwWriteLinked() call at its own call site, where the sale
// write and the ledger write are ONE atomic operation — there, a real
// failure means NEITHER half landed, so surfacing it as a failed
// save/payment (via the caller's own try/catch) is correct, not a false
// alarm; a retry is a clean retry, not a duplicate-write risk.
// _applyOverpaymentToBorrower is the deliberate exception: its write has no
// sibling sale-doc write in the same operation to batch it with (it applies
// leftover overpayment to the borrower's manual balance, not to any specific
// trade doc — the trade that GENERATED the overpayment already had its own
// write completed earlier, separately). So it keeps writing through here,
// swallow-don't-rethrow, same as always — there's no atomicity gap to close.
async function _firestoreSaveBorrower(activeUid, borrower) {
  if (!activeUid) return;
  try {
    if (isContactsActive()) {
      await saveContactDB(activeUid, borrowerToContact(borrower));
    } else {
      await saveBorrower(activeUid, borrower);
    }
  } catch (err) {
    console.error('[trade-payment] borrower ledger save failed:', err);
  }
}

// BUG-014 — same collection/payload shape _firestoreSaveBorrower would
// write, but returned as a descriptor instead of written directly, so a
// caller can fold it into a gwWriteLinked() batch with the sale write it
// belongs to. Only the primary contacts/borrowers write is linked — the
// legacy customers/borrowers MIRROR writes saveContactDB fires when
// contacts mode is active stay best-effort/unawaited, same as today.
function _prepareBorrowerWrite(borrower) {
  if (isContactsActive()) {
    const contact = borrowerToContact(borrower);
    return { op: 'set', collection: 'contacts', docId: contact.id, payload: contact };
  }
  return { op: 'set', collection: 'borrowers', docId: borrower.id, payload: borrower };
}

// ── Open payment modal (new trade) ────────────────────────────
export function openPaymentModal() {
  const cart      = getCart();
  const editingId = getEditingTradeId();
  const custId    = document.getElementById('ntmCustSelect')?.value;
  if (!custId)      return toast('⚠️ Select a customer first', 'err');
  if (!cart.length) return toast('⚠️ Add items to cart first', 'err');
  _ntmUpdateTotal();

  const cust  = (window._pkWholesale || []).find(c => c.id === custId) || { name: 'Walk-in' };
  const total = cart.reduce((a, r) => a + (r.revenue || 0), 0);
  if (total <= 0) return toast('⚠️ Trade total must be greater than 0', 'err');

  if (editingId) return _saveEditedTrade(custId, cust, total, editingId);

  // D.3.4a — optional inline payment (cart-foot "💳 Pay now, on this page").
  // Skips the popup ONLY if the cashier actually typed/set an amount in
  // there (value is non-empty) — opening the panel just to look, then
  // hitting Complete without touching it, must NOT silently finalize as
  // full credit with no confirmation. Untouched/collapsed panel falls
  // through to the popup below, unchanged from before.
  const inlineAmountEl = document.getElementById('nt2PayInlineAmount');
  const inlineSet = document.getElementById('nt2PayInline')?.classList.contains('open')
    && inlineAmountEl?.value !== '';
  if (inlineSet) {
    const received = parseFloat(inlineAmountEl.value) || 0;
    const btn = document.querySelector('#nt2CartFoot .nt2-complete-btn');
    const idleLabel = `Complete · ${fmtSpan(total)}`;
    return _finalizeNewSale(received, custId, total, btn, idleLabel);
  }

  // D.3.5 — is the shop holding money for this customer? Capped at the trade
  // total, because spending more deposit than the goods cost would hand back
  // the difference as change, which is a refund wearing a sale's clothes.
  const account = findBorrowerByName(window._pkBorrowers, cust.name);
  const deposit = account ? accountStanding(account).deposit : 0;
  const depositUsable = Math.min(deposit, total);

  let modal = document.getElementById('paymentModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'paymentModal'; document.body.appendChild(modal); }

  modal.innerHTML = `
    <div class="pm-overlay">
      <div class="pm-modal">
        <div class="pm-header">
          <div class="pm-title">💳 Payment</div>
          <button class="pm-close" onclick="document.getElementById('paymentModal').style.display='none'">✕</button>
        </div>
        <div class="pm-body">
          <div class="pm-customer">Customer: <strong>${escapeHtml(cust.name)}</strong></div>
          <div class="pm-total-display">
            <div class="pm-total-lbl">Total Amount</div>
            <div class="pm-total-val currency">${fmt(total)}</div>
          </div>
          ${deposit > 0 ? `
          <div class="pm-deposit" id="pmDepUsing" style="display:none;">
            <div class="pm-deposit-tx">Using <strong id="pmDepUsingAmt"></strong> from their deposit.</div>
            <button class="pm-deposit-undo" onclick="window._pmUndoDeposit(${total})">Undo</button>
          </div>
          <div class="pm-deposit-left" id="pmDepLeft" style="display:none;">
            <span>Still to pay</span><strong id="pmDepLeftAmt"></strong>
          </div>` : ''}
          <div class="pm-field">
            <label class="pm-lbl"><span id="pmReceivedLbl">Amount Received</span> (<span class="currency">₦</span>)</label>
            <input type="number" id="pmReceived" class="pm-input" placeholder="0"
              oninput="window._pmCalc(${total},'${custId}')" autofocus>
          </div>
          <div class="pm-calc-row" id="pmCalcRow" style="display:none;">
            <div class="pm-calc-item" id="pmChangeRow" style="display:none;">
              <span class="pm-calc-lbl">Change to give</span>
              <span class="pm-calc-val green currency" id="pmChange">₦0</span>
            </div>
            <div class="pm-calc-item" id="pmBalanceRow" style="display:none;">
              <span class="pm-calc-lbl">Balance owing</span>
              <span class="pm-calc-val red currency" id="pmBalance">₦0</span>
            </div>
            <div class="pm-calc-item" id="pmBorrowerNote" style="display:none;">
              <span class="pm-calc-note">⚠️ Balance will auto-record under <strong>${escapeHtml(cust.name)}</strong> in Credit Accounts</span>
            </div>
          </div>
          ${deposit > 0 ? `
          <div class="pm-deposit" id="pmDepOffer">
            <div class="pm-deposit-tx">You are holding <strong>${fmt(deposit)}</strong> for ${escapeHtml(cust.name)}.</div>
            <button class="pm-deposit-btn" onclick="window._pmUseDeposit(${depositUsable},${total})">Use ${fmt(depositUsable)} of it</button>
          </div>` : ''}
          <input type="hidden" id="pmFromDeposit" value="0">
          <div class="pm-quick-row">
            <button class="pm-quick" onclick="window._pmExact(${total})">Exact</button>
            <button class="pm-quick" onclick="window._pmSetAmount(0)">Full Credit</button>
          </div>
          <button class="pm-confirm-btn" id="pmConfirmBtn" onclick="window._pmConfirm(${total},'${custId}')">
            Confirm Payment ✓
          </button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
  document.getElementById('pmReceived')?.focus();
}

window._pmSetAmount = v => {
  const el = document.getElementById('pmReceived');
  if (el) { el.value = v; el.dispatchEvent(new Event('input')); }
};

// D.3.5 (docs/mockups/D.3.5-deposit-cash-on-top.html). The deposit in use is
// its own line, held in #pmFromDeposit, and the amount box means cash only.
// Typing cash never touches the deposit; only Undo takes it off. This used to
// share one box: typing the cash handed over on top silently cleared the
// deposit, so the typed figure was booked as cash and the deposit never spent.
function _pmDepositInUse() {
  return parseFloat(document.getElementById('pmFromDeposit')?.value) || 0;
}

function _pmShowDeposit(amount, total) {
  const using = amount > 0;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('pmDepUsing', using);
  show('pmDepLeft', using);
  show('pmDepOffer', !using);
  const amt = document.getElementById('pmDepUsingAmt');  if (amt)  amt.textContent  = fmt(amount);
  const left = document.getElementById('pmDepLeftAmt');  if (left) left.textContent = fmt(Math.max(0, total - amount));
  const lbl = document.getElementById('pmReceivedLbl');  if (lbl)  lbl.textContent  = using ? 'Cash received' : 'Amount Received';
}

window._pmUseDeposit = (amount, total) => {
  const dep = document.getElementById('pmFromDeposit');
  if (dep) dep.value = String(amount);
  _pmShowDeposit(amount, total);
  window._pmSetAmount('');
  document.getElementById('pmReceived')?.focus();
};

window._pmUndoDeposit = total => {
  const dep = document.getElementById('pmFromDeposit');
  if (dep) dep.value = '0';
  _pmShowDeposit(0, total);
  window._pmCalc(total);
};

// Exact fills in what is still to pay in cash, after any deposit in use.
window._pmExact = total => window._pmSetAmount(Math.max(0, total - _pmDepositInUse()));

// Shared payment-calc render path (Phase C.7).
// Used by both the new-trade modal (via _pmCalc) and the record-payment
// modal (via _pmCalcExisting). The borrowerNote toggle is a no-op when
// its element isn't in the DOM — the existing-payment modal doesn't
// render #pmBorrowerNote, so the null-check short-circuits.
function _pmCalcShared(target) {
  const received     = parseFloat(document.getElementById('pmReceived')?.value) || 0;
  const calcRow      = document.getElementById('pmCalcRow');
  const changeRow    = document.getElementById('pmChangeRow');
  const balanceRow   = document.getElementById('pmBalanceRow');
  const borrowerNote = document.getElementById('pmBorrowerNote');
  if (calcRow) calcRow.style.display = '';
  if (received >= target) {
    const over = received - target;
    if (changeRow)    changeRow.style.display    = over > 0 ? '' : 'none';
    if (balanceRow)   balanceRow.style.display   = 'none';
    if (borrowerNote) borrowerNote.style.display = 'none';
    const cEl = document.getElementById('pmChange'); if (cEl) cEl.textContent = `${fmt(over)}`;
  } else {
    const rem = target - received;
    if (changeRow)    changeRow.style.display    = 'none';
    if (balanceRow)   balanceRow.style.display   = '';
    if (borrowerNote) borrowerNote.style.display = '';
    const bEl = document.getElementById('pmBalance'); if (bEl) bEl.textContent = `${fmt(rem)}`;
  }
}

// `custId` is unused but kept in the signature because the new-trade
// modal HTML still passes it (oninput="window._pmCalc(${total},'${custId}')").
window._pmCalc = function(total /*, custId */) {
  // Cash is measured against what is left after any deposit in use.
  _pmCalcShared(Math.max(0, total - _pmDepositInUse()));
};

window._pmConfirm = async function(total, custId) {
  const cash = parseFloat(document.getElementById('pmReceived')?.value) || 0;
  const btn  = document.getElementById('pmConfirmBtn');
  // Deposit and cash together are what the trade received. The deposit part
  // is capped at the total, the same cap the "Use" button already applies.
  const fromDeposit = Math.min(_pmDepositInUse(), total);
  const received    = cash + fromDeposit;
  return _finalizeNewSale(received, custId, total, btn, 'Confirm Payment ✓', fromDeposit);
};

// ── Finalize a new sale — shared by the payment popup (_pmConfirm) and the
// inline "Pay now, on this page" panel in the cart-foot (D.3.4a). Same
// validation, same write path, same receipt/close behavior either way —
// only where `received` came from and which button shows the progress
// state differ. `idleLabel` is the button's resting HTML, restored on
// error so the inline Complete button doesn't get stuck saying "Confirm
// Payment ✓" (the popup's label) if it ever fails.
async function _finalizeNewSale(received, custId, total, btn, idleLabel, fromDeposit = 0) {
  if (btn) { btn.disabled = true; btn.innerHTML = 'Processing…'; btn.style.opacity = '.6'; }
  try {
    if (!_requireSaleAuth()) {
      if (btn) { btn.disabled = false; btn.innerHTML = idleLabel; btn.style.opacity = ''; }
      return;
    }
    // D.3.4a — final defensive discount-policy check at the save edge.
    // The modal already disables the Complete button on over-limit lines,
    // but a tampered DOM could submit anyway. This blocks it server-side
    // -of-app before the Firestore write.
    const { getDiscountPolicy } = await import('./staff-auth.js');
    const policy = getDiscountPolicy();
    const cartPre = getCart();
    const blockedLines = cartPre.filter(r => {
      const d = r.itemDiscount || 0;
      if (d <= 0) return false;
      if (!policy.canDiscount) return true;
      if (policy.maxDiscount !== null && d > policy.maxDiscount) return true;
      return false;
    });
    if (blockedLines.length) {
      if (btn) { btn.disabled = false; btn.innerHTML = idleLabel; btn.style.opacity = ''; }
      toast(`⛔ Discount over your limit on ${blockedLines.length} line${blockedLines.length !== 1 ? 's' : ''}. Reduce or ask Owner.`, 'err');
      return;
    }

    const balance  = Math.max(0, total - received);
    const cust     = (window._pkWholesale || []).find(c => c.id === custId) || { name: 'Walk-in' };
    const cart     = getCart();
    const date     = document.getElementById('ntmDate')?.value || today();
    const visitorName = (document.getElementById('ntmVisitor')?.value || '').trim();

    // Duplicate-submit guard: identical cart recorded moments ago?
    const dupSig = _cartSignature(cart, custId, total);
    if (!_confirmNotDuplicate(dupSig)) {
      if (btn) { btn.disabled = false; btn.innerHTML = idleLabel; btn.style.opacity = ''; }
      return;
    }

    const tradeId  = _generateTradeId(date);
    const actor    = getCurrentActor();

    const totalRevenue  = cart.reduce((a, r) => a + (r.revenue || 0), 0);
    const totalOriginal = cart.reduce((a, r) => a + (r.originalRevenue || r.revenue || 0), 0);
    const totalCost     = cart.reduce((a, r) => a + (r.cost || 0), 0);
    const totalDiscount = totalOriginal - totalRevenue;
    // Security queue #3 — Firestore rules can't loop items[] to cap each
    // line's discount, so the single largest per-line discount is hoisted
    // to its own field the rule CAN check cheaply. Mirrors getDiscountPolicy()
    // maxDiscount, which is also a per-line (not per-sale) cap.
    const maxLineDiscount = cart.reduce((a, r) => Math.max(a, r.itemDiscount || 0), 0);

    // D.3.5b: money from a held deposit gets its own line, so the history
    // says where every naira came from. The sum is the same as before.
    const depPart  = Math.min(fromDeposit || 0, received);
    const cashPart = Math.round((received - depPart) * 100) / 100;
    const initialPayments = [
      ...(depPart > 0 ? [{
        id: uid(), amount: depPart, date, createdTs: Date.now(),
        note: 'Paid from their deposit', source: 'deposit',
        performedBy: makePerformedBy(actor),
      }] : []),
      ...(cashPart > 0 ? [{
        id: uid(), amount: cashPart, date, createdTs: Date.now(),
        note: 'Initial payment at sale',
        performedBy: makePerformedBy(actor),
      }] : []),
    ];

    const sale = {
      id: tradeId, custId, date, visitorName,
      ...(custId ? { customerName: cust.name } : {}),
      performedBy: actor,
      items: cart.map(row => ({
        itemId: row.itemId, itemName: row.itemName, ...(row.custom ? { custom: true } : {}),
        cartons: row.cartons || 0, rows: row.rows || 0, qty: row.qty || 0,
        label: row.label,
        pieceSell: row.pieceSell || 0, cartonSell: row.cartonSell || 0, rowSell: row.rowSell || 0,
        originalRevenue: row.originalRevenue ?? row.revenue,
        // D.3.4a / MISSION v1.4 — write the new canonical lineDiscount
        // field alongside the legacy itemDiscount one so old readers
        // keep working AND new readers can move to lineDiscount.
        itemDiscount: row.itemDiscount || 0,
        lineDiscount: row.itemDiscount || 0,
        discEach: row._discMode === 'each' ? (row.discEach || 0) : 0,
        revenue: row.revenue, cost: row.cost || 0,
        profit: row.revenue - (row.cost || 0),
      })),
      totalRevenue, totalOriginal, totalDiscount, totalCost, maxLineDiscount,
      totalProfit:    totalRevenue - totalCost,
      itemCount:      cart.length,
      amountReceived: received,
      balanceOwing:   balance,
      paymentStatus:  balance <= 0 ? 'paid' : received <= 0 ? 'credit' : 'partial',
      payments:       initialPayments,
      createdTs:      Date.now(),
      voided: false, voidReason: null, voidedAt: null, editedAt: null,
    };

    window._pkSales = window._pkSales || [];
    window._pkSales.push(sale);
    const activeUid = resolveUid();

    // BUG-014 — sale creation and its initial debt entry (when the sale opens
    // with a balance owing) used to be two separate writes: gwWrite('create',
    // 'sales', ...) here, then a separate direct borrower-ledger write inside
    // _autoRecordDebt. Same race the payment-recording fix closed: a network
    // blip on one and not the other left the sale and the ledger disagreeing
    // about whether this trade's debt was ever recorded — worse here than a
    // payment-timing mismatch, because the debt can go missing entirely.
    // _prepareDebt returns a write descriptor instead of writing directly, so
    // it folds into ONE atomic gwWriteLinked() call with the sale write —
    // they can now only land, or queue, together.
    // D.3.5 — deposit first, debt second, on purpose. Both mutate the SAME
    // in-memory account, so running the deposit entry first means _prepareDebt's
    // snapshot already contains it and a part-deposit, part-credit trade still
    // produces exactly one account write instead of two that would race.
    const depositAccount = _addDepositUse(fromDeposit, cust, tradeId, date);
    const debtWrite = _prepareDebt(balance, cust, tradeId, total, received, date);
    const ledgerWrite = debtWrite || (depositAccount ? _prepareBorrowerWrite(depositAccount) : null);
    const saleWrite = { op: 'create', collection: 'sales', docId: sale.id, payload: sale };
    // The old code branched on whether the SALE write queued: if it did,
    // _autoRecordDebt fired without awaiting (fire-and-forget + .catch) to
    // avoid freezing the Complete button, because back then _autoRecordDebt's
    // borrower write was a raw setDoc that could hang forever offline (this
    // app has no Firestore offline persistence). That's no longer true —
    // saveBorrower()/saveContactDB() were routed through gwWrite() in
    // D.8.2b sub-step 1 (e1af17a), and gwWriteLinked (re-read from
    // write-gateway.js before making this change) has the identical
    // online-try/network-error-enqueue/offline-enqueue shape as gwWrite: it
    // always resolves, never hangs, on any of those three paths. Enqueueing
    // is a local IndexedDB put, not a network round trip, so awaiting it
    // doesn't reintroduce a perceptible delay either. The queued/direct
    // branch was vestigial complexity from before that fix landed — collapsed
    // to one straight await.
    let writeResult = { ok: true, synced: true, queueId: null };
    if (activeUid) {
      writeResult = await gwWriteLinked(ledgerWrite ? [saleWrite, ledgerWrite] : [saleWrite], { background: true });
      if (ledgerWrite && ledgerWrite.collection === 'contacts') mirrorContactLegacy(ledgerWrite.payload);
    }
    // Checkout always saves to the phone first now, so "queued" only means
    // something to the cashier when there is no connection to send it on.
    const queued = !!(writeResult && writeResult.synced === false) && !window._pkOnlineState;

    logActivity('ADD_TRADE', { tradeId, customer: cust.name, amount: totalRevenue, items: cart.length });

    const overpayment = received - total;
    let unhandledOver = 0;
    if (overpayment > 0 && custId) {
      unhandledOver = await _handleOverpayment(overpayment, custId, cust, tradeId, date, activeUid);
    }
    if (unhandledOver > 0) {
      const pidx = (window._pkSales || []).findIndex(s => s.id === tradeId);
      if (pidx >= 0) {
        window._pkSales[pidx].refundDue = unhandledOver;
        sale.refundDue = unhandledOver;
        if (activeUid) await gwWrite('update', 'sales', tradeId, window._pkSales[pidx])
          .catch(e => {
            console.error('[trade-payment] refundDue patch failed:', e);
            toast(`⚠️ ${fmt(unhandledOver)} refund-due flag failed to save — note it manually`, 'err');
          });
      }
    }

    saveLocal();
    _lastSale = { sig: dupSig, tradeId, ts: Date.now() };   // arm dup-guard before close

    // Transition the Complete button out of "Processing…" (founder spec):
    // synced → "✓ Recorded", queued → "✓ Queued — will sync". Stays disabled
    // through the close delay so a stray double-tap can't re-fire.
    if (btn) {
      btn.innerHTML = queued ? '✓ Queued — will sync' : '✓ Recorded';
      btn.style.opacity = '';
    }
    toast(
      queued
        ? `✅ Trade ${tradeId} queued — will sync when online`
        : `✅ Trade ${tradeId} saved${balance > 0 ? ' · ' + fmt(balance) + ' as debt' : ''}`,
      'ok'
    );

    // Close modal(s) + show receipt after a short beat so the button feedback
    // is visible. Done in a timer (not awaited) so neither path can hang the UI.
    setTimeout(async () => {
      try {
        const pm = document.getElementById('paymentModal');
        if (pm) pm.style.display = 'none';
        clearCart();
        const { closeNewTradeModal } = await import('./trade-modal.js');
        closeNewTradeModal();
        window._showReceiptModal(tradeId);
        renderTradeTable();
        _refreshBorrowers();
      } catch (err) {
        console.error('[trade-payment] post-sale close failed:', err);
      }
    }, queued ? 900 : 350);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = idleLabel; btn.style.opacity = ''; }
    toast('⚠️ Failed to save trade, try again', 'err');
    throw e;
  }
}

// ── Overpayment choice dialog ─────────────────────────────────
// Shown whenever a customer has paid more than the trade came to, whether
// that happened at the till or because an edit lowered the total afterwards.
//
// D.3.5 made this three ways instead of two. Before, money that could not be
// spent on an older trade had nowhere to go but a cash refund, which is why
// the shop could never simply keep a customer's money for next time.
//
//   'trades'  spend it on their oldest unpaid trades first
//   'deposit' hold it for them, to spend later or take back in cash
//   'refund'  owe it back in cash, flagged on the trade until handed over
//
// Resolves to one of those, or 'cancel'. The 'trades' option is hidden when
// they have no unpaid trades, rather than offered and then doing nothing.
function _showOverpaymentChoiceDialog(overpayment, custName, { hasOlderTrades, title, sub } = {}) {
  return new Promise(resolve => {
    document.getElementById('_pkRefundChoiceDialog')?.remove();

    const el = document.createElement('div');
    el.id = '_pkRefundChoiceDialog';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.80);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;';

    const safe   = escapeHtml(custName);
    const amount = fmt(overpayment);
    // Debt typed straight onto the account, with no trade behind it. Holding
    // money pays this off first, so the box has to say so.
    const acct   = findBorrowerByName(window._pkBorrowers, custName);
    const owes   = hasOlderTrades || !acct ? 0 : accountStanding(acct).owing;
    const OPT    = 'display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:8px;border:1px solid #2a2a2a;background:#1a1a1a;cursor:pointer;text-align:left;width:100%;font-family:inherit;';

    el.innerHTML = `
      <div style="background:#141414;border:1px solid #333;border-radius:10px;width:380px;max-width:100%;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.8);">
        <div style="padding:16px 18px;border-bottom:1px solid #222;">
          <div style="font-size:14px;font-weight:500;color:#F5F5F5;">${escapeHtml(title || 'Paid more than the total')}</div>
          <div style="font-size:12px;color:#888;margin-top:3px;">${escapeHtml(sub || `${custName} handed over more than this trade came to`)}</div>
        </div>
        <div style="padding:16px 18px;">
          <div style="background:rgba(133,183,235,.07);border:1px solid rgba(133,183,235,.22);border-radius:8px;padding:12px 14px;margin-bottom:16px;text-align:center;">
            <div style="font-size:11px;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;">Extra money</div>
            <div style="font-size:28px;font-weight:500;color:#85B7EB;font-variant-numeric:tabular-nums;">${amount}</div>
            <div style="font-size:11px;color:#555;margin-top:4px;">Where should it go?</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${hasOlderTrades ? `
            <button id="_pkRcdTradesBtn" style="${OPT}">
              <span style="font-size:18px;flex-shrink:0;line-height:1.2;">→</span>
              <div>
                <div style="font-size:13px;font-weight:500;color:#F5F5F5;">Clear older trades</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Pays off ${safe}'s oldest unpaid trades first. Anything still left over is held as their money.</div>
              </div>
            </button>` : ''}
            ${!hasOlderTrades ? `
            <button id="_pkRcdDepositBtn" style="${OPT}">
              <span style="font-size:18px;flex-shrink:0;line-height:1.2;">◆</span>
              <div>
                <div style="font-size:13px;font-weight:500;color:#F5F5F5;">Hold it for ${safe}</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">${owes > 0
                  ? `They owe ${fmt(owes)} on their account, so that is paid first. ${overpayment > owes ? `${fmt(overpayment - owes)} is kept as their money.` : 'Nothing is left to keep.'}`
                  : `Keep ${amount} as their money. They can spend it on a future trade, or you can pay it back in cash.`}</div>
              </div>
            </button>` : ''}
            <button id="_pkRcdFlagBtn" style="${OPT}">
              <span style="font-size:18px;flex-shrink:0;line-height:1.2;">↩</span>
              <div>
                <div style="font-size:13px;font-weight:500;color:#F5F5F5;">Give cash back</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Mark ${amount} as owed back. Shows as "Refund Due" on the trade until you mark it handed over.</div>
              </div>
            </button>
          </div>
        </div>
        <div style="padding:12px 18px;border-top:1px solid #222;display:flex;gap:8px;">
          <button id="_pkRcdCancelBtn" style="padding:9px 16px;border-radius:7px;border:1px solid #2a2a2a;background:#1f1f1f;color:#888;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;">Cancel</button>
          <button id="_pkRcdConfirmBtn" style="flex:1;padding:9px 12px;border-radius:7px;border:none;background:#D4A537;color:#000;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;">Confirm</button>
        </div>
      </div>`;

    document.body.appendChild(el);

    const btns = {
      trades:  el.querySelector('#_pkRcdTradesBtn'),
      deposit: el.querySelector('#_pkRcdDepositBtn'),
      refund:  el.querySelector('#_pkRcdFlagBtn'),
    };
    const TINT = {
      trades:  ['1px solid rgba(93,202,165,.4)',  'rgba(93,202,165,.06)'],
      deposit: ['1px solid rgba(133,183,235,.4)', 'rgba(133,183,235,.08)'],
      refund:  ['1px solid rgba(240,149,149,.4)', 'rgba(240,149,149,.08)'],
    };
    const LABEL = {
      trades:  'Clear older trades',
      deposit: 'Hold it for them',
      refund:  'Flag for refund',
    };
    const confirmBtn = el.querySelector('#_pkRcdConfirmBtn');

    // Defaults to clearing older trades when there are any, because that is
    // what the shop was already doing before deposits existed, and a dialog
    // that quietly changes the habitual answer is how money goes astray.
    let selected = hasOlderTrades ? 'trades' : 'deposit';

    const select = (choice) => {
      selected = choice;
      Object.entries(btns).forEach(([key, btn]) => {
        if (!btn) return;
        btn.style.border     = key === choice ? TINT[key][0] : '1px solid #2a2a2a';
        btn.style.background = key === choice ? TINT[key][1] : '#1a1a1a';
      });
      confirmBtn.textContent = LABEL[choice];
    };

    Object.entries(btns).forEach(([key, btn]) => btn?.addEventListener('click', () => select(key)));
    select(selected);

    el.querySelector('#_pkRcdCancelBtn').addEventListener('click', () => { el.remove(); resolve('cancel'); });
    confirmBtn.addEventListener('click', () => { el.remove(); resolve(selected); });
    el.addEventListener('click', e => { if (e.target === el) { el.remove(); resolve('cancel'); } });
  });
}

// Edit saved a lower Amount Received than the payment history shows.
// Resolves 'refund' (money handed back, log it), 'keep' (leave it as paid,
// the overpayment choices follow), 'typo' (save as typed) or 'cancel'.
// Layout: docs/mockups/D.3.5-edit-paid-less.html
function _showPaidLessDialog(paidBefore, typed, diff, custName) {
  return new Promise(resolve => {
    document.getElementById('_pkPaidLessDialog')?.remove();

    const el = document.createElement('div');
    el.id = '_pkPaidLessDialog';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.80);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;';

    const safe = escapeHtml(custName);
    const OPT  = 'display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:8px;border:1px solid #2a2a2a;background:#1a1a1a;cursor:pointer;text-align:left;width:100%;font-family:inherit;';
    const BOX  = 'background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:10px;text-align:center;';
    const K    = 'font-size:10px;color:#888;letter-spacing:.08em;text-transform:uppercase;';
    const V    = 'font-size:16px;font-weight:500;margin-top:4px;font-variant-numeric:tabular-nums;';

    el.innerHTML = `
      <div style="background:#141414;border:1px solid #333;border-radius:10px;width:380px;max-width:100%;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.8);">
        <div style="padding:16px 18px;border-bottom:1px solid #222;">
          <div style="font-size:14px;font-weight:500;color:#F5F5F5;">${safe} already paid ${fmt(paidBefore)}</div>
          <div style="font-size:12px;color:#888;margin-top:3px;">You typed ${fmt(typed)}. What happened to the other ${fmt(diff)}?</div>
        </div>
        <div style="padding:16px 18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
            <div style="${BOX}"><div style="${K}">Paid before</div><div style="${V}color:#F5F5F5;">${fmt(paidBefore)}</div></div>
            <div style="${BOX}"><div style="${K}">Typed now</div><div style="${V}color:#F5F5F5;">${fmt(typed)}</div></div>
            <div style="${BOX}border-color:rgba(240,149,149,.35);background:rgba(240,149,149,.06);"><div style="${K}">Difference</div><div style="${V}color:#F09595;">${fmt(diff)}</div></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button id="_pkPlRefundBtn" style="${OPT}">
              <span style="font-size:18px;flex-shrink:0;line-height:1.2;">↩</span>
              <div>
                <div style="font-size:13px;font-weight:500;color:#F5F5F5;">I gave ${fmt(diff)} back to them</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Records a ${fmt(diff)} refund on this trade, so the payment history matches.</div>
              </div>
            </button>
            <button id="_pkPlKeepBtn" style="${OPT}">
              <span style="font-size:18px;flex-shrink:0;line-height:1.2;">◆</span>
              <div>
                <div style="font-size:13px;font-weight:500;color:#F5F5F5;">Keep it for them</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Leaves ${fmt(paidBefore)} as paid. Next you choose: clear their older trades, hold it, or give it back later.</div>
              </div>
            </button>
            <button id="_pkPlTypoBtn" style="${OPT}">
              <span style="font-size:18px;flex-shrink:0;line-height:1.2;">✎</span>
              <div>
                <div style="font-size:13px;font-weight:500;color:#F5F5F5;">${fmt(paidBefore)} was a mistake, they only paid ${fmt(typed)}</div>
                <div style="font-size:11px;color:#888;margin-top:2px;">Saves ${fmt(typed)} as typed. Use only to fix a wrong entry.</div>
              </div>
            </button>
          </div>
        </div>
        <div style="padding:12px 18px;border-top:1px solid #222;display:flex;gap:8px;">
          <button id="_pkPlCancelBtn" style="padding:9px 16px;border-radius:7px;border:1px solid #2a2a2a;background:#1f1f1f;color:#888;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;">Cancel</button>
          <button id="_pkPlConfirmBtn" style="flex:1;padding:9px 12px;border-radius:7px;border:none;background:#D4A537;color:#000;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;">Confirm</button>
        </div>
      </div>`;

    document.body.appendChild(el);

    const btns = {
      refund: el.querySelector('#_pkPlRefundBtn'),
      keep:   el.querySelector('#_pkPlKeepBtn'),
      typo:   el.querySelector('#_pkPlTypoBtn'),
    };
    const LABEL = {
      refund: `Record ${fmt(diff)} refund`,
      keep:   'Keep it for them',
      typo:   `Save ${fmt(typed)}`,
    };
    const confirmBtn = el.querySelector('#_pkPlConfirmBtn');

    // Defaults to the refund because that is what lowering the amount after
    // removing an item almost always means: the cash already went back.
    let selected = 'refund';
    const select = (choice) => {
      selected = choice;
      Object.entries(btns).forEach(([key, btn]) => {
        btn.style.border     = key === choice ? '1px solid rgba(93,202,165,.4)' : '1px solid #2a2a2a';
        btn.style.background = key === choice ? 'rgba(93,202,165,.06)' : '#1a1a1a';
      });
      confirmBtn.textContent = LABEL[choice];
    };
    Object.entries(btns).forEach(([key, btn]) => btn.addEventListener('click', () => select(key)));
    select(selected);

    el.querySelector('#_pkPlCancelBtn').addEventListener('click', () => { el.remove(); resolve('cancel'); });
    confirmBtn.addEventListener('click', () => { el.remove(); resolve(selected); });
    el.addEventListener('click', e => { if (e.target === el) { el.remove(); resolve('cancel'); } });
  });
}

// ── Save edited trade — now records borrower debt delta ───────
async function _saveEditedTrade(custId, cust, total, editingId) {
  const cart        = getCart();
  const date        = document.getElementById('ntmDate')?.value || today();
  const visitorName = (document.getElementById('ntmVisitor')?.value || '').trim();

  // Find original trade first so we can fall back to its amountReceived
  // if the input field is blank or NaN (parseFloat("") = NaN, and NaN ?? null
  // still = NaN because ?? only catches null/undefined — the original bug).
  const idx = (window._pkSales || []).findIndex(s => s.id === editingId);
  if (idx < 0) return toast('⚠️ Could not find original trade', 'err');

  const originalSale  = window._pkSales[idx];
  const receivedVal   = parseFloat(document.getElementById('ntmAmountReceived')?.value);
  let received        = !isNaN(receivedVal) ? receivedVal : (originalSale.amountReceived || 0);

  // BUG-015 guard: the Amount Received field is free text, decoupled from
  // the trade's own payments[] log. A number lower than what the payment
  // history proves was collected is usually money handed back after an
  // item was removed, so ask what happened to the difference and record
  // it properly (docs/mockups/D.3.5-edit-paid-less.html) instead of a
  // browser warning that left the history and the trade disagreeing.
  const netProvenPaid = Math.round((originalSale.payments || [])
    .reduce((a, p) => p.removed ? a : a + (p.type === 'refund' ? -p.amount : p.amount), 0) * 100) / 100;
  const shortfall = Math.round((netProvenPaid - received) * 100) / 100;
  let refundNow = 0;
  if (shortfall > 0.01) {
    const choice = await _showPaidLessDialog(netProvenPaid, received, shortfall, cust.name);
    if (choice === 'cancel') return;
    if (choice === 'refund') refundNow = shortfall;
    else if (choice === 'keep') received = netProvenPaid;
    // 'typo': save the typed amount as it is.
  }

  // D.3.5b: whatever the edit does to the amount received goes into the
  // trade's own payment history, so the history and the trade always agree
  // (sale-derive rebuilds the amount from this list on every load, and an
  // unlogged change used to be undone on the next reload).
  const editEntries = [];
  const _pb = makePerformedBy(getCurrentActor());
  if (refundNow) editEntries.push({
    id: uid(), amount: refundNow, date: today(), createdTs: Date.now(),
    note: `Refund of ${fmt(refundNow)} given to customer (trade edited)`,
    type: 'refund', performedBy: _pb,
  });
  const editDiff = Math.round((received - (netProvenPaid - refundNow)) * 100) / 100;
  if (editDiff > 0.01) editEntries.push({
    id: uid(), amount: editDiff, date: today(), createdTs: Date.now(),
    note: 'Added while editing trade', performedBy: _pb,
  });
  else if (editDiff < -0.01) editEntries.push({
    id: uid(), amount: -editDiff, date: today(), createdTs: Date.now(),
    note: 'Correction while editing trade (amount was typed wrong)',
    type: 'refund', kind: 'correction', performedBy: _pb,
  });

  const totalRevenue  = cart.reduce((a, r) => a + (r.revenue || 0), 0);
  const totalOriginal = cart.reduce((a, r) => a + (r.originalRevenue || r.revenue || 0), 0);
  const totalCost     = cart.reduce((a, r) => a + (r.cost || 0), 0);
  const totalDiscount = totalOriginal - totalRevenue;
  // Security queue #3 — see matching comment in _pmConfirm.
  const maxLineDiscount = cart.reduce((a, r) => Math.max(a, r.itemDiscount || 0), 0);
  const newBalance    = Math.max(0, totalRevenue - received);
  // Auto-detect from amount, same rule as new trades (_pmConfirm below) —
  // no more manual status dropdown that could drift from the real balance.
  const statusVal     = newBalance <= 0 ? 'paid' : received <= 0 ? 'credit' : 'partial';

  const oldBalance = originalSale.balanceOwing || 0;
  const activeUid  = resolveUid();

  const actor = getCurrentActor();
  const preEditClone = { ...window._pkSales[idx] };
  delete preEditClone.editHistory;
  const snapshot = {
    ...preEditClone,
    snapshotAt: Date.now(),
    snapshotBy: {
      uid:  actor.username,
      name: actor.displayName,
      role: actor.role,
    },
  };
  const prevHistory = Array.isArray(window._pkSales[idx].editHistory)
    ? window._pkSales[idx].editHistory
    : [];
  const newEditHistory = [...prevHistory, snapshot];

  // ── Detect overpayment created by this edit ───────────────
  const overpayment = Math.round((received - totalRevenue) * 100) / 100;
  let _refundChoice = null;
  if (overpayment > 0) {
    // D.3.5 — same three-way dialog as the till. The older-trades option is
    // offered only when there are older trades to clear, and 'deposit' is
    // handled below by the same _handleOverpayment call that 'trades' uses,
    // since that function now knows how to hold money as well as spend it.
    const hasOlderTrades = (window._pkSales || []).some(
      s => s.custId === custId && s.id !== editingId && (s.balanceOwing || 0) > 0 && !s.voided,
    );
    _refundChoice = await _showOverpaymentChoiceDialog(overpayment, cust.name, {
      hasOlderTrades,
      title: 'Edit leaves the customer overpaid',
      sub: `${cust.name} has already paid more than the new total`,
    });
    if (_refundChoice === 'cancel') return;
  }

  const updated = {
    ...window._pkSales[idx],
    custId, date, visitorName,
    ...(custId && cust?.name ? { customerName: cust.name } : {}),
    items: cart.map(row => ({
      itemId: row.itemId, itemName: row.itemName, ...(row.custom ? { custom: true } : {}),
      cartons: row.cartons || 0, rows: row.rows || 0, qty: row.qty || 0,
      label: row.label,
      pieceSell: row.pieceSell || 0, cartonSell: row.cartonSell || 0, rowSell: row.rowSell || 0,
      originalRevenue: row.originalRevenue ?? row.revenue,
      itemDiscount: row.itemDiscount || 0,
      lineDiscount: row.itemDiscount || 0,
      discEach: row._discMode === 'each' ? (row.discEach || 0) : 0,
      revenue: row.revenue, cost: row.cost || 0,
      profit: row.revenue - (row.cost || 0),
    })),
    totalRevenue, totalOriginal, totalDiscount, totalCost, maxLineDiscount,
    totalProfit:  totalRevenue - totalCost,
    itemCount:    cart.length,
    amountReceived: received,
    balanceOwing:   newBalance,
    paymentStatus:  statusVal,
    editedAt:       Date.now(),
    editedBy:       actor,
    editHistory:    newEditHistory,
    ...(editEntries.length ? { payments: [...(originalSale.payments || []), ...editEntries] } : {}),
    // Clear any prior refundDue; set new one if flagged.
    // overpaymentApplied marks that the excess went somewhere real, which
    // suppresses the false "↩ REFUND" badge in trade-table.js. D.3.5: being
    // held for the customer counts as somewhere real, same as clearing an
    // older trade, because in neither case is the shop owing them cash.
    refundDue: _refundChoice === 'refund' ? overpayment : 0,
    overpaymentApplied: (_refundChoice === 'trades' || _refundChoice === 'deposit') ? overpayment : 0,
  };

  window._pkSales[idx] = updated;

  // Stock follows the edit: old lines go back on the shelf, new lines come
  // off, netted per item. A voided trade already has its stock back.
  if (!originalSale.voided) _restockForEdit(originalSale.items, cart, activeUid);

  // BUG-014 — the trade-edit save and its matching borrower-delta ledger
  // entry (added/reduced owing) used to be two separate sequential writes
  // (gwWrite here, then a separate direct write inside _recordBorrowerDelta)
  // — the same divergence race. _prepareBorrowerDelta returns a descriptor
  // instead of writing directly so both fold into one gwWriteLinked() call
  // and can only land, or queue, together.
  // Moving the trade to another customer: the old account drops what it was
  // owed on this trade, and the new account takes the full new balance.
  // Only the difference used to be recorded, on the new customer.
  const deltaWrites = [];
  const oldCust = (window._pkWholesale || []).find(c => c.id === originalSale.custId);
  if (originalSale.custId && originalSale.custId !== custId && oldCust) {
    if (oldBalance > 0) deltaWrites.push(_prepareBorrowerDelta(-oldBalance, originalSale.custId, oldCust, editingId, date));
    if (newBalance > 0) deltaWrites.push(_prepareBorrowerDelta(newBalance, custId, cust, editingId, date));
  } else {
    const delta = Math.round((newBalance - oldBalance) * 100) / 100;
    if (Math.abs(delta) > 0) deltaWrites.push(_prepareBorrowerDelta(delta, custId, cust, editingId, date));
  }
  const accountWrites = deltaWrites.filter(Boolean);
  const saleWrite = { op: 'update', collection: 'sales', docId: updated.id, payload: updated };
  if (activeUid) {
    // _saveEditedTrade has no outer try/catch (unlike _finalizeNewSale /
    // _pmConfirmExisting), so a real gwWriteLinked failure must be caught
    // right here — otherwise it surfaces as an unhandled promise rejection
    // with no toast at all, worse than the .catch() this replaces.
    try {
      await gwWriteLinked([saleWrite, ...accountWrites]);
      accountWrites.forEach(w => { if (w.collection === 'contacts') mirrorContactLegacy(w.payload); });
    } catch (e) {
      console.error('[trade-payment] Failed to save edited trade:', e);
      toast('⚠️ Trade updated locally but cloud sync failed', 'err');
    }
  }
  logActivity('EDIT_TRADE', { tradeId: editingId, customer: cust.name, amount: totalRevenue });

  if ((_refundChoice === 'trades' || _refundChoice === 'deposit') && overpayment > 0) {
    await _handleOverpayment(overpayment, custId, cust, editingId, date, activeUid, _refundChoice);
  }

  saveLocal();
  clearCart();
  const { closeNewTradeModal } = await import('./trade-modal.js');
  closeNewTradeModal();
  renderTradeTable();
  _refreshBorrowers();
  const refundNote = _refundChoice === 'refund' ? ` · ${fmt(overpayment)} flagged for refund` : '';
  const givenNote  = refundNow ? ` · ${fmt(refundNow)} refund recorded` : '';
  toast(`✅ Trade ${editingId} updated${refundNote}${givenNote}`, 'ok');
}

// ── Prepare a borrower-delta write when a trade is edited ─────
// BUG-014 — this used to write directly (await _firestoreSaveBorrower at
// the end, formerly _recordBorrowerDelta). Prepare-only now: mutates the
// in-memory borrower exactly as before (creating one if this edit is the
// customer's first-ever debt) and returns a write descriptor for the caller
// to batch via gwWriteLinked() with the edited trade's sale write. Returns
// null when there's nothing to record — same borrower-missing guard as
// before, just no write to skip now.
function _prepareBorrowerDelta(delta, custId, cust, tradeId, date) {
  window._pkBorrowers = window._pkBorrowers || [];
  let borrower = findBorrowerByName(window._pkBorrowers, cust.name);

  if (!borrower && delta > 0) {
    borrower = {
      id: uid(), name: cust.name, phone: '', note: '',
      transactions: [], createdTs: Date.now(), lastActivityTs: Date.now(), ...newAccountFields(),
    };
    window._pkBorrowers.push(borrower);
  }
  if (!borrower) return null;

  const actor = getCurrentActor();
  borrower.transactions = borrower.transactions || [];

  if (delta > 0) {
    borrower.transactions.push({
      id: uid(), type: 'debt',
      name: `Trade ${tradeId} (edit — added ${fmt(delta)})`,
      amount: delta,
      note: `Trade edited. Owing increased by ${fmt(delta)}`,
      date, createdTs: Date.now(),
      performedBy: makePerformedBy(actor),
    });
  } else {
    const reduction = Math.abs(delta);
    // kind:'adjustment' marks this as a correction to the bill, not money
    // the customer handed over. It has always reduced the balance exactly
    // like a real payment and it still does, so no balance changes here.
    // The difference only matters reading the ledger the other way round,
    // to answer 'is the shop holding this person's money?'. A negative
    // balance built out of adjustments is an over-corrected bill, not a
    // deposit, and paying it back as cash would hand out money nobody
    // ever left.
    borrower.transactions.push({
      id: uid(), type: 'payment', kind: 'adjustment',
      name: `Trade ${tradeId} (edit — reduced ${fmt(reduction)})`,
      amount: reduction,
      note: `Trade edited. Owing reduced by ${fmt(reduction)}`,
      date, createdTs: Date.now(),
      performedBy: makePerformedBy(actor),
    });
  }

  borrower.lastActivityTs = Date.now();
  return _prepareBorrowerWrite(borrower);
}

// ── Payment modal for existing trade (💳 in table) ────────────
window._showPaymentModal = function(saleId) {
  const sale = (window._pkSales || []).find(s => s.id === saleId);
  if (!sale) return;
  const cust      = (window._pkWholesale || []).find(c => c.id === sale.custId) || { name: sale.customerName || sale.custName || 'Walk-in' };
  const total     = sale.totalRevenue ?? sale.revenue ?? 0;
  // Compute effective paid from the payments array directly so both old trades
  // (where amountReceived was never decremented on refund) and new ones are correct.
  // Payments received from customer count +; type:'refund' entries count −.
  const paymentLog = (sale.payments || []).slice().sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0));
  const effectiveAlreadyPaid = paymentLog.reduce(
    (sum, p) => p.removed ? sum : p.type === 'refund' ? sum - (p.amount || 0) : sum + (p.amount || 0), 0
  );
  const alreadyPaid = Math.max(0, effectiveAlreadyPaid);
  // Recompute balance from payments so the modal is self-consistent even when
  // the stored balanceOwing is stale (e.g. after a double-refund data error).
  const stillOwing  = Math.max(0, total - alreadyPaid);

  // Per BUG-008 spec: payment removal is owner-only until FEATURE-001 (toggle
  // for staff) lands. Cashier/manager/admin staff don't see the X button.
  const canRemovePayments = !window._staffOwnerUid;
  const historyHtml = paymentLog.length
    ? `<div class="pm-history">
        <div class="pm-history-title">📋 Payment History</div>
        ${paymentLog.map(p => {
          const isRefund = p.type === 'refund';
          const amtHtml  = isRefund
            ? `<span class="pm-history-amt red">−${fmtSpan(p.amount)}</span>`
            : `<span class="pm-history-amt green">+${fmtSpan(p.amount)}</span>`;
          const removeBtn = canRemovePayments && p.id && !isRefund && !p.removed
            ? `<button class="pm-history-remove" title="Remove this payment" onclick="window._removeTradePayment('${saleId}','${p.id}')">✕</button>`
            : '';
          // D.3.5b: a removed payment keeps its row, faded and crossed out.
          const removedTag = p.removed
            ? `<span class="pm-history-removed-tag">Removed by ${escapeHtml(p.removedBy?.displayName || 'owner')} on ${p.removedDate || '?'}, not counted</span>`
            : '';
          return `
          <div class="pm-history-row${p.removed ? ' removed' : ''}">
            <span class="pm-history-date">${p.date || '—'}</span>
            <span class="pm-history-by">${escapeHtml(p.performedBy?.displayName || '—')}</span>
            <span class="pm-history-note">${escapeHtml(p.note || '')}</span>
            ${amtHtml}
            ${removeBtn || (p.removed ? '<span></span>' : '')}
            ${removedTag}
          </div>`;
        }).join('')}
        <div class="pm-history-summary">
          <span>Total paid so far</span>
          <span class="green">${fmtSpan(alreadyPaid)}</span>
        </div>
      </div>`
    : alreadyPaid > 0
      ? `<div class="pm-history"><div class="pm-history-summary"><span>Amount already paid</span><span class="green">${fmtSpan(alreadyPaid)}</span></div></div>`
      : '';

  // Fully-paid notice: make sure the person SEES the trade owes nothing
  // before they type an amount. Doesn't block — legitimate overpayments,
  // tips and rounding do happen — but no more silent entry.
  const fullyPaidWarn = stillOwing <= 0
    ? `<div class="pm-paid-warn">⚠️ This trade is already fully paid (${fmt(0)} owing). Any amount you record here will be treated as an overpayment.</div>`
    : '';

  let modal = document.getElementById('paymentModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'paymentModal'; document.body.appendChild(modal); }
  modal.innerHTML = `
    <div class="pm-overlay">
      <div class="pm-modal">
        <div class="pm-header">
          <div class="pm-title">💳 Record Payment · ${sale.id}</div>
          <button class="pm-close" onclick="document.getElementById('paymentModal').style.display='none'">✕</button>
        </div>
        <div class="pm-body">
          <div class="pm-customer">Customer: <strong>${escapeHtml(cust.name)}</strong></div>
          <div class="pm-total-display">
            <div class="pm-total-lbl">Trade Total</div>
            <div class="pm-total-val currency">${fmt(total)}</div>
          </div>
          ${historyHtml}
          <div class="pm-total-display" style="margin-top:8px;">
            <div class="pm-total-lbl">Balance Owing</div>
            <div class="pm-total-val currency" style="color:var(--red);">${fmt(stillOwing)}</div>
          </div>
          ${fullyPaidWarn}
          <div class="pm-field">
            <label class="pm-lbl">Amount Received Now (<span class="currency">₦</span>)</label>
            <input type="number" id="pmReceived" class="pm-input" placeholder="0"
              oninput="window._pmCalcExisting(${stillOwing})" autofocus>
          </div>
          <div class="pm-calc-row" id="pmCalcRow" style="display:none;">
            <div class="pm-calc-item" id="pmChangeRow" style="display:none;">
              <span class="pm-calc-lbl">Overpayment</span>
              <span class="pm-calc-val green currency" id="pmChange">₦0</span>
            </div>
            <div class="pm-calc-item" id="pmBalanceRow" style="display:none;">
              <span class="pm-calc-lbl">Remaining balance</span>
              <span class="pm-calc-val red currency" id="pmBalance">₦0</span>
            </div>
          </div>
          <div class="pm-quick-row">
            <button class="pm-quick" onclick="window._pmSetAmount(${stillOwing})">Pay All</button>
          </div>
          <button class="pm-confirm-btn" id="pmConfirmBtn" onclick="window._pmConfirmExisting('${saleId}',${alreadyPaid},${total})">
            Record Payment ✓
          </button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
  document.getElementById('pmReceived')?.focus();
};

window._pmCalcExisting = function(owing) { _pmCalcShared(owing); };

// NOTE: prevReceived is still passed by the onclick call site but is no
// longer trusted — it's a snapshot from when the modal rendered. The live
// sale.amountReceived is read inside instead (see the double-payment fix).
window._pmConfirmExisting = async function(saleId, prevReceived, total) {
  const btn = document.getElementById('pmConfirmBtn');
  const newPayment = parseFloat(document.getElementById('pmReceived')?.value) || 0;
  if (newPayment <= 0) return toast('⚠️ Enter an amount', 'err');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; btn.style.opacity = '.6'; }
  try {
    if (!_requireSaleAuth()) {
      if (btn) { btn.disabled = false; btn.textContent = 'Record Payment ✓'; btn.style.opacity = ''; }
      return;
    }
    const idx = (window._pkSales || []).findIndex(s => s.id === saleId);
    if (idx < 0) return;
    const sale = window._pkSales[idx];

    // Duplicate-payment guard (mirrors _confirmNotDuplicate for new trades):
    // if a payment of this exact amount just landed on this same trade,
    // confirm before recording another one.
    const priorPayments = (sale.payments || []).filter(p => !p.removed);
    const lastPay = priorPayments[priorPayments.length - 1];
    if (lastPay && lastPay.type !== 'refund' && lastPay.amount === newPayment &&
        Date.now() - (lastPay.createdTs || 0) < _PAY_DUP_WINDOW_MS) {
      const secs = Math.round((Date.now() - (lastPay.createdTs || 0)) / 1000);
      const proceed = window.confirm(
        `A payment of ${fmt(newPayment)} was already recorded on this trade just ${secs}s ago.\n\n` +
        `If that one is still syncing it will finish on its own, you do not need to redo it.\n\n` +
        `Record this as a SEPARATE payment anyway?`
      );
      if (!proceed) {
        if (btn) { btn.disabled = false; btn.textContent = 'Record Payment ✓'; btn.style.opacity = ''; }
        return;
      }
    }

    // Read what's already paid from LIVE data at click time, NOT the
    // prevReceived parameter baked into the button's onclick when the modal
    // rendered. If the same rendered button fires twice (slow network keeping
    // the modal open, a repeat tap), the stale parameter recomputes roughly
    // the same total and the second payment silently vanishes from the
    // aggregates — that's how the NGPKT2026071629CB4 duplicate went invisible.
    // With a live read, a genuine double-submit now lands as an overpayment
    // and the existing _handleOverpayment/refundDue machinery catches it.
    const liveReceived  = sale.amountReceived || 0;
    const totalReceived = liveReceived + newPayment;
    const newBalance    = Math.max(0, total - totalReceived);
    const actor         = getCurrentActor();
    const activeUid     = resolveUid();

    window._pkSales[idx] = {
      ...sale,
      amountReceived: totalReceived,
      balanceOwing:   newBalance,
      paymentStatus:  newBalance <= 0 ? 'paid' : 'partial',
      payments: [
        ...(sale.payments || []),
        {
          id: uid(), amount: newPayment,
          date: today(), createdTs: Date.now(),
          note: 'Payment recorded via trade table',
          performedBy: makePerformedBy(actor),
        },
      ],
    };

    // BUG-014 — the sale update and its matching Credit Account ledger entry
    // used to be two separate sequential gwWrite() calls. A network blip
    // affecting only one of them left the sale showing a balance owing after
    // the ledger already showed it settled (or vice versa) until the queue
    // happened to drain — exactly what happened on NGPKT20260715FF5D9.
    // gwWriteLinked() batches them as one atomic writeBatch online, or one
    // combined queue entry offline, so they always land together.
    //
    // Ledger gets only the portion applied to THIS trade. Any overpayment is
    // recorded by the overpayment helpers themselves (_prepareRepaymentForTrade
    // per cleared older trade, _applyOverpaymentToBorrower for leftover) —
    // recording the full newPayment here double-counted the overage in the
    // borrower ledger and made Credit Accounts under-report the debt.
    const owingBefore   = Math.max(0, total - liveReceived);
    const borrowerWrite = _prepareRepayment(Math.min(newPayment, owingBefore), sale.custId, saleId, today());
    if (activeUid) {
      const saleWrite = { op: 'update', collection: 'sales', docId: window._pkSales[idx].id, payload: window._pkSales[idx] };
      await gwWriteLinked(borrowerWrite ? [saleWrite, borrowerWrite] : [saleWrite], { background: true });
      // The PRIMARY contacts/ write (if contacts mode is active) just landed
      // atomically above as part of borrowerWrite. The legacy customers/
      // borrowers/ MIRROR writes saveContactDB would normally also fire are
      // NOT part of that batch (never part of the atomicity guarantee — see
      // mirrorContactLegacy's own comment) — fire them the same
      // best-effort/unawaited way saveContactDB always has, so this path
      // doesn't quietly stop feeding legacy readers during the dual-write
      // period documented in BUG_LOG.md.
      if (borrowerWrite && borrowerWrite.collection === 'contacts') mirrorContactLegacy(borrowerWrite.payload);
    }

    const overpayment = totalReceived - total;
    let unhandledOver = 0;
    if (overpayment > 0 && sale.custId) {
      const cust = (window._pkWholesale || []).find(c => c.id === sale.custId);
      if (cust) unhandledOver = await _handleOverpayment(overpayment, sale.custId, cust, saleId, today(), activeUid);
    }
    if (unhandledOver > 0) {
      window._pkSales[idx].refundDue = unhandledOver;
      if (activeUid) await gwWrite('update', 'sales', window._pkSales[idx].id, window._pkSales[idx])
        .catch(e => {
          console.error('[trade-payment] refundDue patch failed:', e);
          toast(`⚠️ ${fmt(unhandledOver)} refund-due flag failed to save — note it manually`, 'err');
        });
    }

    saveLocal();
    document.getElementById('paymentModal').style.display = 'none';

    renderTradeTable();
    _refreshBorrowers();
    toast(`✅ ${fmt(newPayment)} recorded${newBalance > 0 ? ` · ${fmt(newBalance)} still owing` : ' · Fully paid'}`, 'ok');
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Record Payment ✓'; btn.style.opacity = ''; }
    toast('⚠️ Failed to record payment, try again', 'err');
    throw e;
  }
};

// Marks the trade that GENERATED an overpayment as resolved once the
// FIFO/borrower flow below has actually applied some of it elsewhere.
// Same field _dismissTradeOverpay sets manually, but fired automatically
// so the REFUND badge doesn't sit there asking a human to confirm what
// the app already did (see BUG report 2026-08-12).
// `held` is the part kept as the customer's money, so the Trade table can say
// where the extra went instead of just showing PAID.
async function _markOverpaymentApplied(sourceSaleId, appliedAmount, activeUid, held = 0) {
  if (appliedAmount <= 0) return;
  const idx = (window._pkSales || []).findIndex(s => s.id === sourceSaleId);
  if (idx < 0) return;
  window._pkSales[idx] = {
    ...window._pkSales[idx],
    overpaymentApplied: appliedAmount,
    overpaymentHeld: Math.round(Math.max(0, held) * 100) / 100,
  };
  if (activeUid) await gwWrite('update', 'sales', sourceSaleId, window._pkSales[idx])
    .catch(e => console.error('[trade-payment] markOverpaymentApplied failed:', e));
}

// ── Handle overpayment: scan OTHER older trades FIFO ─────────
// `preChoice` is passed by the edit path, which has already asked the same
// question with the same dialog before writing the trade. Without it the
// customer would be asked twice about the same money.
async function _handleOverpayment(overpayment, custId, cust, sourceSaleId, date, activeUid, preChoice = null) {
  const unpaid = (window._pkSales || [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.custId === custId && s.id !== sourceSaleId && (s.balanceOwing || 0) > 0 && !s.voided)
    .sort((a, b) => (a.s.createdTs || 0) - (b.s.createdTs || 0));

  // D.3.5 - one dialog for every case now. This used to be a bare yes/no
  // that only appeared when older trades existed, and answering no dropped
  // straight through to a cash refund. There are three real answers, and
  // keeping the money for the customer was the one with no way to say it.
  const choice = preChoice || await _showOverpaymentChoiceDialog(overpayment, cust.name, {
    hasOlderTrades: unpaid.length > 0,
  });
  if (choice === 'cancel' || choice === 'refund') return overpayment;

  // No older trades to clear: hold it. Any debt typed straight onto the
  // account (no trade behind it) is paid off by the same entry first, so only
  // the rest is really held.
  //
  // With older unpaid trades, "hold" is never honoured as a plain hold any
  // more. The account is one running figure, so a held payment silently paid
  // down the debt there while the old trades kept showing as owing in the
  // Trade table, and nothing was actually held. Found 2026-10-06. It now runs
  // the same path as "Clear older trades", which keeps both screens agreeing
  // and still holds whatever is left after the old trades are cleared.
  if (!unpaid.length) {
    const acct = findBorrowerByName(window._pkBorrowers, cust.name);
    const owedBefore = acct ? accountStanding(acct).owing : 0;
    await _keepAsDeposit(overpayment, cust, sourceSaleId, date, activeUid);
    await _markOverpaymentApplied(sourceSaleId, overpayment, activeUid, overpayment - owedBefore);
    saveLocal();
    return 0;
  }

  const actor   = getCurrentActor();
  let remaining = overpayment;
  const toSave  = [];

  for (const { s, i } of unpaid) {
    if (remaining <= 0) break;
    const owing   = s.balanceOwing || 0;
    const applied = Math.min(remaining, owing);

    const newBalance = remaining >= owing ? 0 : Math.round((owing - remaining) * 100) / 100;

    window._pkSales[i] = {
      ...s,
      amountReceived: (s.amountReceived || 0) + applied,
      balanceOwing:   newBalance,
      paymentStatus:  newBalance <= 0 ? 'paid' : 'partial',
      payments: [
        ...(s.payments || []),
        {
          id: uid(), amount: applied,
          date, createdTs: Date.now(),
          note: `Cleared by overpayment from trade ${sourceSaleId}`,
          performedBy: makePerformedBy(actor),
        },
      ],
    };

    toSave.push(window._pkSales[i]);
    remaining -= applied;
  }

  // BUG-014 — each older trade cleared here used to get its sale-doc write
  // (via _firestoreSaveSales, all cleared trades in one Promise.all pass)
  // and its ledger entry (via _autoRecordRepaymentForTrade, in a SEPARATE
  // loop afterward) as two independent write passes. A network blip between
  // the two loops could clear a trade's balance on the sale side while the
  // ledger never recorded that portion of the payment, or the reverse.
  // Pairing each trade's sale write with its OWN ledger write in one
  // gwWriteLinked() call per trade closes that gap. Sequential per-pair
  // (not Promise.all like the old _firestoreSaveSales call it replaces) —
  // slightly less parallel, but each pair is now a clean atomic unit and one
  // trade's write failing doesn't stop the sale side of another from saving.
  for (const saved of toSave) {
    const appliedToThis = saved.payments[saved.payments.length - 1].amount;
    const repayWrite = _prepareRepaymentForTrade(appliedToThis, custId, saved.id, sourceSaleId, date);
    const clearSaleWrite = { op: 'update', collection: 'sales', docId: saved.id, payload: saved };
    if (activeUid) {
      try {
        await gwWriteLinked(repayWrite ? [clearSaleWrite, repayWrite] : [clearSaleWrite]);
        if (repayWrite && repayWrite.collection === 'contacts') mirrorContactLegacy(repayWrite.payload);
      } catch (e) {
        console.error('[trade-payment] Failed to save cleared trade', saved.id, e);
        toast(`⚠️ ${saved.id} updated locally but cloud sync failed`, 'err');
      }
    }
  }


  // D.3.5 — whatever the older trades could not swallow is held for the
  // customer rather than turned into a cash refund they have to come back for.
  // The dialog said this would happen, so there is no second question here.
  let held = 0;
  if (remaining > 0) {
    const acct = findBorrowerByName(window._pkBorrowers, cust.name);
    held = remaining - (acct ? accountStanding(acct).owing : 0);
    await _keepAsDeposit(remaining, cust, sourceSaleId, date, activeUid);
  }
  const leftover = 0;

  const totalApplied = overpayment;
  const clearedCount = toSave.filter(s => s.balanceOwing === 0).length;
  toast(
    clearedCount > 0
      ? `✅ ${clearedCount} older trade${clearedCount > 1 ? 's' : ''} cleared · ${fmt(totalApplied)} applied`
      : `💰 ${fmt(totalApplied)} applied to older trades`,
    'ok'
  );

  await _markOverpaymentApplied(sourceSaleId, totalApplied, activeUid, held);
  saveLocal();
  return leftover || 0;
}

// ── Apply leftover to manual borrower balance ─────────────────
// BUG-014 — investigated and deliberately NOT converted to the
// prepare+gwWriteLinked pattern. Both call sites (the "no unpaid older
// trades" fast path and the post-FIFO "remaining > 0" leftover at the
// bottom of _handleOverpayment) apply this amount straight to the
// borrower's manual Credit Account balance — it isn't tied to any specific
// sale-doc mutation in this same operation. The trade that generated the
// overpayment (sourceSaleId) already had its own write completed earlier,
// separately, before _handleOverpayment was ever called. There is no
// sibling sale write in this function's scope to batch this write WITH, so
// there's no BUG-014-shaped divergence to close here — this is a single,
// standalone write, already non-lossy on its own via the existing
// _firestoreSaveBorrower → gwWrite() routing. Left unchanged.
async function _keepAsDeposit(amount, cust, sourceSaleId, date, activeUid) {
  if (!(amount > 0)) return 0;
  window._pkBorrowers = window._pkBorrowers || [];
  let borrower = findBorrowerByName(window._pkBorrowers, cust.name);

  // Somebody can overpay on their very first visit, before they have ever
  // taken anything on credit, so there may be no account yet. Created here
  // in the same shape _prepareDebt uses, because the alternative is telling
  // the shop it cannot keep money a customer has already handed over.
  if (!borrower) {
    borrower = {
      id: uid(), name: cust.name, phone: '', note: '',
      transactions: [], createdTs: Date.now(), lastActivityTs: Date.now(), ...newAccountFields(),
    };
    window._pkBorrowers.push(borrower);
  }

  // The whole amount, not capped at what they owe. That cap is exactly what
  // used to force the remainder out as a cash refund. Any debt on the account
  // is cleared by this same entry on the way past, because the balance is one
  // running figure, so no separate step is needed for it.
  const actor = getCurrentActor();
  borrower.transactions = borrower.transactions || [];
  // D.3.8: on a switched account the money first pays any debt with no trade
  // behind it, and only the rest is held.
  const noTradeOwed = isOneRecord(borrower) ? oneRecordStanding(borrower).noTrade : 0;
  const toNoTrade = Math.round(Math.min(amount, noTradeOwed) * 100) / 100;
  const toHeld = Math.round((amount - toNoTrade) * 100) / 100;
  if (toNoTrade > 0) borrower.transactions.push({
    id: uid(), type: 'payment', ...bucketTag(borrower, 'noTrade'),
    name: `Overpayment · ${sourceSaleId}`,
    amount: toNoTrade,
    note: `${fmt(toNoTrade)} extra from trade ${sourceSaleId} paid a debt with no trade`,
    date, createdTs: Date.now(),
    performedBy: makePerformedBy(actor),
  });
  if (toHeld > 0) borrower.transactions.push({
    id: uid(), type: 'payment', ...bucketTag(borrower, 'held'),
    name: `Overpayment · ${sourceSaleId}`,
    amount: toHeld,
    note: `${fmt(toHeld)} left with the shop from trade ${sourceSaleId}`,
    date, createdTs: Date.now(),
    performedBy: makePerformedBy(actor),
  });
  borrower.lastActivityTs = Date.now();
  if (activeUid) await _firestoreSaveBorrower(activeUid, borrower);
  toast(toHeld > 0 ? `◆ ${fmt(toHeld)} held for ${cust.name}` : `✅ ${fmt(toNoTrade)} paid off ${cust.name}'s debt`, 'ok');
  return 0;
}

// ── Spend a customer's deposit on the trade in front of them ──
// D.3.5. The shop was holding this money and is now keeping part or all of it
// against goods, so the ledger gets a DEBT entry: the deposit shrinks by
// exactly what was spent.
//
// No cash comes in here. The cash arrived whenever the deposit was made. The
// sale still records the amount as received, because the trade really is paid
// for, just not out of today's till.
//
// Mutates the in-memory account and returns it, deliberately WITHOUT building
// a write descriptor. The caller runs this BEFORE _prepareDebt so that when a
// trade is part deposit and part credit, one snapshot carries both entries and
// there is only ever one write for this account. Returns null when there is no
// account to spend from, which should be unreachable, since a deposit cannot
// exist without one.
function _addDepositUse(amount, cust, tradeId, date) {
  if (!(amount > 0)) return null;
  window._pkBorrowers = window._pkBorrowers || [];
  const borrower = findBorrowerByName(window._pkBorrowers, cust.name);
  if (!borrower) {
    console.error('[trade-payment] deposit use skipped: no account named', cust.name, 'trade', tradeId);
    toast(`⚠️ Trade saved, but ${cust.name} has no account. Deposit not deducted`, 'err');
    return null;
  }
  const actor = getCurrentActor();
  borrower.transactions = borrower.transactions || [];
  borrower.transactions.push({
    id: uid(), type: 'debt', kind: 'deposit-use', ...bucketTag(borrower, 'held'),
    name: `Trade ${tradeId} (paid from deposit)`,
    amount,
    note: `${fmt(amount)} of this customer's deposit spent on trade ${tradeId}. No cash collected.`,
    date, createdTs: Date.now(),
    performedBy: makePerformedBy(actor),
  });
  borrower.lastActivityTs = Date.now();
  return borrower;
}

// ── Prepare a debt write for the borrowers ledger (new trade w/ balance) ─
// BUG-014 — this used to write directly (await _firestoreSaveBorrower at
// the end, formerly _autoRecordDebt). It's now prepare-only: it mutates the
// in-memory borrower object exactly as before (creating one if this is the
// customer's first debt) and returns a write descriptor for the caller to
// batch via gwWriteLinked() with the matching sale-creation write, so the
// two can never land at different times. Returns null when there's no debt
// to record — same balance<=0 guard as before, just no write to skip now.
function _prepareDebt(balance, cust, tradeId, total, received, date) {
  if (balance <= 0) return null;
  window._pkBorrowers = window._pkBorrowers || [];
  let borrower = findBorrowerByName(window._pkBorrowers, cust.name);
  if (!borrower) {
    borrower = {
      id: uid(), name: cust.name, phone: '', note: '',
      transactions: [], createdTs: Date.now(), lastActivityTs: Date.now(), ...newAccountFields(),
    };
    window._pkBorrowers.push(borrower);
  }
  borrower.transactions = borrower.transactions || [];
  borrower.transactions.push({
    id: uid(), type: 'debt', name: `Trade ${tradeId}`, amount: balance,
    note: `Auto from trade. Total: ${fmt(total)}, Paid: ${fmt(received)}`,
    date, createdTs: Date.now(),
  });
  borrower.lastActivityTs = Date.now();
  return _prepareBorrowerWrite(borrower);
}

// ── Prepare a repayment write for the borrowers ledger ─────────
// BUG-014 — this used to write directly (await _firestoreSaveBorrower at
// the end). It's now prepare-only: it mutates the in-memory borrower object
// exactly as before and returns a write descriptor for the caller to batch
// via gwWriteLinked() with the matching sale-doc write, so the two can
// never land at different times. Returns null (having already toasted the
// reason) when there's nowhere to record the repayment — same cases as
// before, just no write to skip now.
function _prepareRepayment(amount, custId, tradeId, date, noteOverride) {
  if (amount <= 0) return null;
  const cust = (window._pkWholesale || []).find(c => c.id === custId);
  if (!cust) {
    console.error('[trade-payment] repayment ledger skipped: no customer for custId', custId, 'trade', tradeId);
    toast('⚠️ Payment saved — but Credit Account not updated (customer missing). Check Credit Accounts', 'err');
    return null;
  }
  window._pkBorrowers = window._pkBorrowers || [];
  const borrower = findBorrowerByName(window._pkBorrowers, cust.name);
  if (!borrower) {
    console.error('[trade-payment] repayment ledger skipped: no borrower named', cust.name, 'trade', tradeId);
    toast(`⚠️ Payment saved — ${cust.name} has no Credit Account. Ledger not updated`, 'err');
    return null;
  }

  const actor = getCurrentActor();
  borrower.transactions = borrower.transactions || [];
  borrower.transactions.push({
    id: uid(), type: 'payment',
    name: `Payment · Trade ${tradeId}`,
    amount,
    note: noteOverride || 'Repayment recorded from trade payment modal',
    date, createdTs: Date.now(),
    performedBy: makePerformedBy(actor),
  });
  borrower.lastActivityTs = Date.now();
  return _prepareBorrowerWrite(borrower);
}

// BUG-014 — this used to write directly (await _firestoreSaveBorrower at
// the end, formerly _autoRecordRepaymentForTrade). Prepare-only now: mutates
// the in-memory borrower exactly as before and returns a write descriptor
// for the FIFO overpayment loop in _handleOverpayment to batch via
// gwWriteLinked() with the matching older-trade sale write it clears.
// Returns null silently when there's no borrower to record against — same
// guard as before (this path never toasted on a missing borrower, unlike
// _prepareRepayment).
function _prepareRepaymentForTrade(amount, custId, clearedTradeId, sourceSaleId, date) {
  if (amount <= 0) return null;
  const cust = (window._pkWholesale || []).find(c => c.id === custId);
  if (!cust) return null;
  window._pkBorrowers = window._pkBorrowers || [];
  const borrower = findBorrowerByName(window._pkBorrowers, cust.name);
  if (!borrower) return null;
  const actor = getCurrentActor();
  borrower.transactions = borrower.transactions || [];
  borrower.transactions.push({
    id: uid(), type: 'payment',
    name: `Payment · Trade ${clearedTradeId}`,
    amount,
    note: `Applied from overpayment on trade ${sourceSaleId}`,
    date, createdTs: Date.now(),
    performedBy: makePerformedBy(actor),
  });
  borrower.lastActivityTs = Date.now();
  return _prepareBorrowerWrite(borrower);
}

// ── Remove a payment from an existing trade (BUG-008) ────────
// Marks the payment removed (D.3.5b: it stays in sale.payments, faded in the
// history, and counts for nothing), recalculates amountReceived,
// balanceOwing, paymentStatus, and adds a "Payment reversal" debt entry on
// the borrower if one exists. Owner-only until FEATURE-001 lands — the
// visibility check at the modal already hides the X button for staff.
window._removeTradePayment = async function(saleId, paymentId) {
  if (window._staffOwnerUid) return toast('⚠️ Only the owner can remove payments', 'err');

  const idx = (window._pkSales || []).findIndex(s => s.id === saleId);
  if (idx < 0) return toast('⚠️ Trade not found', 'err');
  const sale    = window._pkSales[idx];
  const payment = (sale.payments || []).find(p => p.id === paymentId);
  if (!payment) return toast('⚠️ Payment not found', 'err');
  if (payment.removed) return toast('⚠️ That payment was already removed', 'err');

  if (!confirm(`Remove this ${fmt(payment.amount)} payment recorded on ${payment.date || 'unknown date'}?\n\nIt stays in the history, crossed out, so there is a record. The balance owing goes back up.`)) return;

  try {
    const activeUid = _requireSaleAuth();
    if (!activeUid) return;
    const total     = sale.totalRevenue ?? sale.revenue ?? 0;

    const remover   = makePerformedBy(getCurrentActor());
    const remaining = (sale.payments || []).map(p => p.id === paymentId
      ? { ...p, removed: true, removedTs: Date.now(), removedDate: today(), removedBy: remover }
      : p);
    // type:'refund' entries are deductions; removed entries count for nothing.
    const totalReceived = Math.max(0, remaining.reduce(
      (sum, p) => p.removed ? sum : p.type === 'refund' ? sum - (p.amount || 0) : sum + (p.amount || 0), 0
    ));
    const newBalance    = Math.max(0, total - totalReceived);
    const newStatus     = newBalance <= 0 && totalReceived > 0
      ? 'paid'
      : totalReceived > 0 ? 'partial' : 'credit';

    window._pkSales[idx] = {
      ...sale,
      payments:       remaining,
      amountReceived: totalReceived,
      balanceOwing:   newBalance,
      paymentStatus:  newStatus,
    };

    // BUG-014 — the restored sale balance and the ledger's reversal entry
    // used to be two separate sequential writes (gwWrite here, then a
    // separate direct write inside _reversePaymentInBorrowers); batched via
    // gwWriteLinked so removing a payment can't leave the sale showing the
    // balance restored while the ledger still shows it paid, or the reverse.
    // This whole function already has an outer try/catch (below), so a real
    // failure surfaces via the existing "Failed to remove payment" toast —
    // no local try/catch needed here, same as _pmConfirmExisting's style.
    const reversalWrite = _prepareReversal(payment, saleId, sale.custId);
    const removalSaleWrite = { op: 'update', collection: 'sales', docId: window._pkSales[idx].id, payload: window._pkSales[idx] };
    if (activeUid) {
      await gwWriteLinked(reversalWrite ? [removalSaleWrite, reversalWrite] : [removalSaleWrite]);
      if (reversalWrite && reversalWrite.collection === 'contacts') mirrorContactLegacy(reversalWrite.payload);
    }

    await logActivity('REMOVE_PAYMENT', {
      tradeId:      saleId,
      amount:       payment.amount,
      paymentDate:  payment.date,
      originalNote: payment.note,
    });

    saveLocal();
    document.getElementById('paymentModal').style.display = 'none';
    renderTradeTable();
    _refreshBorrowers();
    toast(`✅ ${fmt(payment.amount)} payment removed · Balance restored`, 'ok');
  } catch (err) {
    console.error('[trade-payment] Failed to remove payment:', err);
    toast('⚠️ Failed to remove payment, try again', 'err');
  }
};

// Prepare a "Payment reversal" debt entry so the ledger reflects the
// trade's new owing balance. BUG-014 — this used to write directly (await
// _firestoreSaveBorrower at the end, formerly _reversePaymentInBorrowers).
// Prepare-only now: mutates the in-memory borrower exactly as before and
// returns a write descriptor for window._removeTradePayment to batch via
// gwWriteLinked() with the restored-balance sale write. Returns null when
// there's no borrower for this customer (cash-only sale) — same guard as
// before; the trade itself still goes back to 'credit' status either way.
function _prepareReversal(payment, saleId, custId) {
  if (!payment || !payment.amount || !custId) return null;
  const cust = (window._pkWholesale || []).find(c => c.id === custId);
  if (!cust) return null;

  window._pkBorrowers = window._pkBorrowers || [];
  let borrower = findBorrowerByName(window._pkBorrowers, cust.name);
  // A cash customer with no account yet now owes money, so they get one,
  // the same way a new credit trade opens one.
  if (!borrower) {
    borrower = {
      id: uid(), name: cust.name, phone: '', note: '',
      transactions: [], createdTs: Date.now(), lastActivityTs: Date.now(), ...newAccountFields(),
    };
    window._pkBorrowers.push(borrower);
  }

  borrower.transactions = borrower.transactions || [];
  const actor = getCurrentActor();
  borrower.transactions.push({
    id:          uid(),
    type:        'debt',
    name:        `Payment reversal · Trade ${saleId}`,
    amount:      payment.amount,
    note:        `Payment of ₦${payment.amount} on ${payment.date || 'unknown date'} was removed`,
    date:        today(),
    createdTs:   Date.now(),
    performedBy: makePerformedBy(actor),
  });
  borrower.lastActivityTs = Date.now();
  return _prepareBorrowerWrite(borrower);
}

// Sold pieces per item for a list of cart rows or sale.items[] (same shape),
// signed: sign -1 takes stock off, +1 puts it back. Several rows for one item
// collapse into one entry so each item gets a single write.
function _piecesByItem(rows, sign, into = new Map()) {
  (rows || []).forEach(row => {
    if (!row || !row.itemId) return;
    const item = (window._pkItems || []).find(i => i.id === row.itemId);
    if (!item) return;
    const ppc = _ppc(item) || 1;
    const ppr = _ppr(item) || 1;
    const pieces = (row.qty || 0) + (row.cartons || 0) * ppc + (row.rows || 0) * ppr;
    if (!pieces) return;
    into.set(row.itemId, (into.get(row.itemId) || 0) + sign * pieces);
  });
  return into;
}

function _decrementStock(cart, activeUid) {
  _applyStockDelta(_piecesByItem(cart, -1), activeUid);
}

// Void, delete, and the "before" half of an edit: the goods are back on the
// shelf, so give the stock back using the same unit maths as the sale.
export function restoreStock(items, activeUid) {
  _applyStockDelta(_piecesByItem(items, +1), activeUid);
}

// Unvoid: the trade counts as sold again, so take the stock back off.
export function takeStock(items, activeUid) {
  _applyStockDelta(_piecesByItem(items, -1), activeUid);
}

// Edit: put the old items back and take the new ones off, netted per item so
// an unchanged line causes no write at all.
function _restockForEdit(oldItems, newCart, activeUid) {
  _applyStockDelta(_piecesByItem(newCart, -1, _piecesByItem(oldItems, +1)), activeUid);
}

function _applyStockDelta(deltaByItem, activeUid) {
  deltaByItem.forEach((deltaPieces, itemId) => {
    if (!deltaPieces) return;
    const idx = (window._pkItems || []).findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const item    = window._pkItems[idx];
    const ppc     = _ppc(item) || 1;
    const ppr     = _ppr(item) || 1;
    const row     = { itemName: item.name };

    // stockQty is denominated in item.stockUnit (set explicitly in
    // Inventory), NOT a guessed "buy unit". Convert the sold quantity to
    // pieces first (unambiguous), then into stockUnit. Previously guessed
    // the unit from buyUnit/cartonSell directly and decremented in THAT
    // unit — wrong whenever it disagreed with stockUnit. Found via CENTRE
    // FRUIT: stockUnit:'piece' but cartonSell set → guessed 'carton',
    // decrementing stock 24x too little per sale (divided by piecesPerCarton
    // before subtracting from a stockQty that was actually counting pieces).
    // Mirrors the same fix in insights-engine.js's deadStock(). 23 Jun 2026.
    // Positive = pieces leaving the shelf (a sale), negative = coming back.
    const soldPieces = -deltaPieces;
    const stockUnit  = item.stockUnit || (item.buyUnit || ((item.cartonSell || ppc > 1) ? 'carton' : 'piece'));

    let soldInStockUnit;
    if (stockUnit === 'carton')    soldInStockUnit = soldPieces / ppc;
    else if (stockUnit === 'row')  soldInStockUnit = soldPieces / ppr;
    else                           soldInStockUnit = soldPieces;

    soldInStockUnit = Math.round(soldInStockUnit * 1000) / 1000;
    if (!soldInStockUnit) {
      console.warn('[stock] zero soldInStockUnit for', row.itemName, row);
      return;
    }

    // Build a minimal patch — these are the only keys the cashier-update
    // Firestore rule whitelist accepts (stockQty, qty, low, updatedTs).
    const patch = { updatedTs: Date.now() };
    let nextLocal = { ...item, updatedTs: patch.updatedTs };

    if (item.trackStock && item.stockQty != null) {
      const newQty    = Math.max(0, (parseFloat(item.stockQty) || 0) - soldInStockUnit);
      const rawThresh = parseFloat(item.lowThreshold);
      const threshold = Number.isFinite(rawThresh) ? rawThresh : lowThresholdFromPct(newQty);
      patch.stockQty  = Math.round(newQty * 1000) / 1000;
      patch.low       = patch.stockQty <= threshold;
      // K6 fix: stockQtyPcs is a denormalized pieces-cache read by
      // inventory sort/insights — must stay in lockstep with stockQty or
      // it goes stale the moment a sale happens. Same unit conversion as
      // inventory.js's _toPcs2 / the add-item path.
      patch.stockQtyPcs  = stockUnit === 'carton' ? patch.stockQty * ppc
                          : stockUnit === 'row'    ? patch.stockQty * ppr
                          : patch.stockQty;
      nextLocal.stockQty    = patch.stockQty;
      nextLocal.low         = patch.low;
      nextLocal.stockQtyPcs = patch.stockQtyPcs;
    } else if (item.qty || (soldInStockUnit < 0 && item.qty != null && item.qty !== '')) {
      // Legacy qty field. A sale needs something to take from; a return may
      // land on a count that had already hit 0.
      const currentQty = parseFloat(item.qty) || 0;
      if (!currentQty && soldInStockUnit > 0) return;
      patch.qty       = String(Math.max(0, Math.round(currentQty - soldInStockUnit)));
      nextLocal.qty   = patch.qty;
    } else {
      // No stock tracking at all — nothing to decrement.
      return;
    }

    window._pkItems[idx] = nextLocal;

    if (!activeUid) return;
    const isStaff = !!window._staffOwnerUid;
    const sync = isStaff
      ? patchItem(activeUid, item.id, patch)
      : saveItem(activeUid, nextLocal);
    sync.catch(e => {
      console.error('[stock] sync failed for', item.id, isStaff ? '(staff/patch)' : '(owner/setDoc)', e);
      toast('⚠️ Stock updated locally but cloud sync failed', 'err');
    });
  });

  if (typeof window.__PK?.renderItems === 'function') window.__PK.renderItems();
  else if (typeof window.PK?.renderItems === 'function') window.PK.renderItems();
}

// ── Sync a Credit Accounts payment to outstanding trades FIFO ─
// Called from borrowers.js when a payment is recorded there.
export async function syncBorrowerPaymentToTrades(custId, amount, date, activeUid, note) {
  const { applied, leftover, toSave } = _applyPaymentToTradesFIFO(custId, amount, date, note);
  if (toSave.length) {
    await _firestoreSaveSales(activeUid, toSave);
    saveLocal();
    renderTradeTable();
  }
  return { applied, leftover };
}

// A payment recorded on the customer's account (Customers tab / Credit
// Accounts): the ledger entry and the trades it clears are saved as ONE
// linked write, like every trade-side payment since BUG-014. The two used to
// be separate writes, so a crash or dropped connection between them left the
// account saying paid while the trades still said owing. `borrower` already
// carries the new ledger entry. Returns { applied, leftover }.
export async function recordAccountPayment(borrower, custId, amount, date, activeUid, note) {
  const { applied, leftover, toSave } = custId
    ? _applyPaymentToTradesFIFO(custId, amount, date, note)
    : { applied: 0, leftover: amount, toSave: [] };
  if (activeUid) {
    const ledgerWrite = _prepareBorrowerWrite(borrower);
    const saleWrites  = toSave.map(s => ({ op: 'update', collection: 'sales', docId: s.id, payload: s }));
    await gwWriteLinked([ledgerWrite, ...saleWrites], { background: true });
    if (ledgerWrite.collection === 'contacts') mirrorContactLegacy(ledgerWrite.payload);
  }
  if (toSave.length) { saveLocal(); renderTradeTable(); }
  return { applied, leftover };
}

// D.3.8 · a payment on a switched account. Follows planAccountPayment exactly,
// the same plan the cashier saw in the preview: oldest unpaid trade first,
// then debts with no trade, then whatever is left is held. The trades it pays
// and the account are saved as one linked write. Each trade portion also gets
// a plain history line on the account, which counts for nothing in the total.
export async function recordOneRecordPayment(borrower, amount, date, activeUid, note) {
  const plan  = planAccountPayment(borrower, amount);
  const actor = makePerformedBy(getCurrentActor());
  const toSave = [];
  borrower.transactions = borrower.transactions || [];

  for (const { sale, amount: pay } of plan.toTrades) {
    const i = (window._pkSales || []).findIndex(s => s.id === sale.id);
    if (i < 0) continue;
    const s = window._pkSales[i];
    const newBalance = Math.round(((s.balanceOwing || 0) - pay) * 100) / 100;
    window._pkSales[i] = {
      ...s,
      amountReceived: Math.round(((s.amountReceived || 0) + pay) * 100) / 100,
      balanceOwing:   Math.max(0, newBalance),
      paymentStatus:  newBalance <= 0 ? 'paid' : 'partial',
      payments: [...(s.payments || []), { id: uid(), amount: pay, date, createdTs: Date.now(), note, performedBy: actor }],
    };
    toSave.push(window._pkSales[i]);
    borrower.transactions.push({
      id: uid(), type: 'payment', name: `Payment · Trade ${s.id}`, amount: pay,
      note, date, createdTs: Date.now(), performedBy: actor,
    });
  }
  if (plan.toNoTrade > 0) borrower.transactions.push({
    id: uid(), type: 'payment', ...bucketTag(borrower, 'noTrade'), name: 'Payment · no-trade debt',
    amount: plan.toNoTrade, note, date, createdTs: Date.now(), performedBy: actor,
  });
  if (plan.toHeld > 0) borrower.transactions.push({
    id: uid(), type: 'payment', ...bucketTag(borrower, 'held'), name: 'Payment · kept for them',
    amount: plan.toHeld, note: `${fmt(plan.toHeld)} left over, kept as their money`, date, createdTs: Date.now(), performedBy: actor,
  });
  borrower.lastActivityTs = Date.now();

  if (activeUid) {
    const ledgerWrite = _prepareBorrowerWrite(borrower);
    const saleWrites  = toSave.map(s => ({ op: 'update', collection: 'sales', docId: s.id, payload: s }));
    await gwWriteLinked([ledgerWrite, ...saleWrites], { background: true });
    if (ledgerWrite.collection === 'contacts') mirrorContactLegacy(ledgerWrite.payload);
  }
  if (toSave.length) { saveLocal(); renderTradeTable(); }
  return plan;
}

// D.3.8 · spend money held for a switched account on what it owes: oldest
// trade first, then no-trade debts. No cash comes in. The held figure goes
// down by exactly what was spent.
export async function spendHeldOnDebts(borrower, activeUid, noteOverride) {
  const st = oneRecordStanding(borrower);
  const use = Math.round(Math.min(st.held, st.owing) * 100) / 100;
  if (use <= 0) return { used: 0, cleared: 0 };
  const plan  = planAccountPayment(borrower, use);
  const actor = makePerformedBy(getCurrentActor());
  const date  = today();
  const note  = noteOverride || `Paid from ${borrower.name}'s money held by the shop`;
  const toSave = [];
  borrower.transactions = borrower.transactions || [];
  for (const { sale, amount: pay } of plan.toTrades) {
    const i = (window._pkSales || []).findIndex(s => s.id === sale.id);
    if (i < 0) continue;
    const s = window._pkSales[i];
    const newBalance = Math.round(((s.balanceOwing || 0) - pay) * 100) / 100;
    window._pkSales[i] = {
      ...s,
      amountReceived: Math.round(((s.amountReceived || 0) + pay) * 100) / 100,
      balanceOwing:   Math.max(0, newBalance),
      paymentStatus:  newBalance <= 0 ? 'paid' : 'partial',
      payments: [...(s.payments || []), { id: uid(), amount: pay, date, createdTs: Date.now(), note, performedBy: actor }],
    };
    toSave.push(window._pkSales[i]);
  }
  if (plan.toNoTrade > 0) borrower.transactions.push({
    id: uid(), type: 'payment', ...bucketTag(borrower, 'noTrade'), name: 'Paid from held money',
    amount: plan.toNoTrade, note, date, createdTs: Date.now(), performedBy: actor,
  });
  borrower.transactions.push({
    id: uid(), type: 'debt', kind: 'deposit-use', ...bucketTag(borrower, 'held'), name: 'Held money used on debts',
    amount: use, note, date, createdTs: Date.now(), performedBy: actor,
  });
  borrower.lastActivityTs = Date.now();
  if (activeUid) {
    const ledgerWrite = _prepareBorrowerWrite(borrower);
    await gwWriteLinked([ledgerWrite, ...toSave.map(s => ({ op: 'update', collection: 'sales', docId: s.id, payload: s }))], { background: true });
    if (ledgerWrite.collection === 'contacts') mirrorContactLegacy(ledgerWrite.payload);
  }
  saveLocal(); renderTradeTable();
  return { used: use, cleared: plan.toTrades.filter(t => t.clears).length };
}

// Spread a payment over the customer's unpaid trades, oldest first. Updates
// window._pkSales in memory and returns the changed trades without saving.
function _applyPaymentToTradesFIFO(custId, amount, date, note) {
  if (!custId || amount <= 0) return { applied: 0, leftover: amount, toSave: [] };

  const unpaidTrades = (window._pkSales || [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.custId === custId && (s.balanceOwing || 0) > 0 && !s.voided)
    .sort((a, b) => (a.s.createdTs || 0) - (b.s.createdTs || 0));

  if (!unpaidTrades.length) return { applied: 0, leftover: amount, toSave: [] };

  const actor = getCurrentActor();
  let remaining = amount;
  const toSave  = [];

  for (const { s, i } of unpaidTrades) {
    if (remaining <= 0) break;
    const owing      = s.balanceOwing || 0;
    const applied    = Math.min(remaining, owing);
    const newBalance = Math.round((owing - applied) * 100) / 100;

    window._pkSales[i] = {
      ...s,
      amountReceived: (s.amountReceived || 0) + applied,
      balanceOwing:   newBalance,
      paymentStatus:  newBalance <= 0 ? 'paid' : 'partial',
      payments: [
        ...(s.payments || []),
        {
          id: uid(), amount: applied,
          date, createdTs: Date.now(),
          note: note || 'Payment recorded via Credit Accounts',
          performedBy: makePerformedBy(actor),
        },
      ],
    };
    toSave.push(window._pkSales[i]);
    remaining -= applied;
  }

  return { applied: amount - remaining, leftover: remaining, toSave };
}

// ── Mark refund as given ──────────────────────────────────────
// Clears refundDue, logs a refund entry in the payments array, and
// flips the trade back to normal 'paid' status in the UI.
window._markTradeRefunded = async function(saleId) {
  const idx = (window._pkSales || []).findIndex(s => s.id === saleId);
  if (idx < 0) return toast('⚠️ Trade not found', 'err');
  const sale = window._pkSales[idx];
  const refundDue = sale.refundDue || 0;
  if (refundDue <= 0) return;

  if (!confirm(`Mark ${fmt(refundDue)} as physically refunded to customer?\n\nThis will log the refund and clear the "Refund Due" flag on this trade.`)) return;

  const activeUid = _requireSaleAuth();
  if (!activeUid) return;

  const actor = getCurrentActor();
  const totalRevenue    = sale.totalRevenue ?? sale.revenue ?? 0;
  const newAmtReceived  = Math.max(0, (sale.amountReceived || 0) - refundDue);
  const newBalance      = Math.max(0, totalRevenue - newAmtReceived);
  const newStatus       = newBalance <= 0 ? 'paid' : newAmtReceived > 0 ? 'partial' : 'credit';

  window._pkSales[idx] = {
    ...sale,
    refundDue:      0,
    amountReceived: newAmtReceived,
    balanceOwing:   newBalance,
    paymentStatus:  newStatus,
    payments: [
      ...(sale.payments || []),
      {
        id: uid(),
        amount: refundDue,
        date: today(),
        createdTs: Date.now(),
        note: `Refund of ${fmt(refundDue)} given to customer`,
        type: 'refund',
        performedBy: makePerformedBy(actor),
      },
    ],
  };

  // The customer's account must hear about cash handed back too, or it
  // keeps counting the refunded money as paid and shows them owing less
  // than the trades do (Hajia Samira, trade 2D54C: ₦900 refunded on the
  // trade, never on the account).
  const refundLedger = _prepareRefundGiven(refundDue, saleId, sale.custId, newBalance);
  const refundSaleWrite = { op: 'update', collection: 'sales', docId: window._pkSales[idx].id, payload: window._pkSales[idx] };
  if (activeUid) {
    try {
      await gwWriteLinked(refundLedger ? [refundSaleWrite, refundLedger] : [refundSaleWrite]);
      if (refundLedger && refundLedger.collection === 'contacts') mirrorContactLegacy(refundLedger.payload);
    } catch (e) {
      console.error('[trade-payment] Failed to save refund:', e);
      toast('⚠️ Refund marked locally but cloud sync failed', 'err');
    }
  }

  logActivity('MARK_REFUNDED', { tradeId: saleId, amount: refundDue });
  saveLocal();
  renderTradeTable();
  toast(`✅ ${fmt(refundDue)} refund marked as given`, 'ok');
};

// Account entry for cash handed back on a trade. Only the part the account
// had actually counted as paid on this trade is added back: the account's
// own entries for this trade (debts minus payments) should end up equal to
// what the trade still owes. An overpayment the account never saw (e.g. the
// till's "refund" choice on a new sale) needs nothing, so no entry is made.
function _prepareRefundGiven(amount, saleId, custId, tradeOwes) {
  if (!amount || !custId) return null;
  const cust = (window._pkWholesale || []).find(c => c.id === custId);
  if (!cust) return null;
  const borrower = findBorrowerByName(window._pkBorrowers || [], cust.name);
  if (!borrower) return null;
  const ref = new RegExp(`\\b${saleId}\\b`);
  const acctNet = (borrower.transactions || [])
    .filter(t => ref.test(t.name || ''))
    .reduce((a, t) => a + (t.type === 'debt' ? 1 : -1) * (t.amount || 0), 0);
  const addBack = Math.round(Math.min(amount, (tradeOwes || 0) - acctNet) * 100) / 100;
  if (addBack <= 0.01) return null;
  borrower.transactions = borrower.transactions || [];
  borrower.transactions.push({
    id: uid(), type: 'debt',
    name: `Refund given · Trade ${saleId}`,
    amount: addBack,
    note: `${fmt(addBack)} handed back to the customer in cash`,
    date: today(), createdTs: Date.now(),
    performedBy: makePerformedBy(getCurrentActor()),
  });
  borrower.lastActivityTs = Date.now();
  return _prepareBorrowerWrite(borrower);
}

// ── Flag a silent overpayment for refund (popover "Flag for refund") ─
// Called when amountReceived > totalRevenue but refundDue was never set
// (trade created with overpayment and user dismissed the apply dialog).
window._flagTradeOverpay = async function(saleId) {
  const idx = (window._pkSales || []).findIndex(s => s.id === saleId);
  if (idx < 0) return toast('⚠️ Trade not found', 'err');
  const sale = window._pkSales[idx];
  const overpay = Math.max(0, Math.round(((sale.amountReceived || 0) - (sale.totalRevenue ?? sale.revenue ?? 0)) * 100) / 100);
  if (overpay <= 0) return;
  const activeUid = _requireSaleAuth();
  if (!activeUid) return;
  window._pkSales[idx] = { ...sale, refundDue: overpay };
  if (activeUid) await gwWrite('update', 'sales', saleId, window._pkSales[idx])
    .catch(e => { console.error('[trade-payment] flagTradeOverpay failed:', e); toast('⚠️ Flag saved locally but cloud sync failed', 'err'); });
  logActivity('FLAG_REFUND', { tradeId: saleId, amount: overpay });
  saveLocal();
  renderTradeTable();
  toast(`↩ ${fmt(overpay)} flagged for refund on trade ${saleId}`, 'ok');
};

// ── Dismiss a silent overpayment as "already handled" ────────────
// Stores overpaymentApplied on the trade so the ↩ REFUND badge is
// suppressed permanently — used when the excess was manually applied
// to a previous debt rather than via the app's apply-overpayment flow.
window._dismissTradeOverpay = async function(saleId, amount) {
  const idx = (window._pkSales || []).findIndex(s => s.id === saleId);
  if (idx < 0) return toast('⚠️ Trade not found', 'err');
  const sale = window._pkSales[idx];
  const overpay = amount ?? Math.max(0, Math.round(((sale.amountReceived || 0) - (sale.totalRevenue ?? sale.revenue ?? 0)) * 100) / 100);
  if (overpay <= 0) return;
  const activeUid = _requireSaleAuth();
  if (!activeUid) return;

  window._pkSales[idx] = { ...sale, overpaymentApplied: overpay };
  if (activeUid) await gwWrite('update', 'sales', saleId, window._pkSales[idx])
    .catch(e => { console.error('[trade-payment] dismissTradeOverpay failed:', e); toast('⚠️ Dismissed locally but cloud sync failed', 'err'); });
  saveLocal();
  renderTradeTable();
  toast(`✓ Overpayment dismissed on trade ${saleId}`, 'ok');
};

// No-op — styles now live in trade.css
export function injectPaymentStyles() {}