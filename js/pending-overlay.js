// ============================================================
//  pending-overlay.js — keep offline saves on screen
//
//  Saves made with no internet wait in the offline queue (pendingWrites) and
//  only reach the database once back online. Until then the database's own
//  copy does not have them, so every time it refreshes the screen (and every
//  time the app is reopened offline) a sale, item or customer made offline
//  dropped off the list. Shopkeepers then think it was lost and enter it
//  again.
//
//  withPending(collection, docs) lays the queued saves over what the database
//  sent, in the order they were made. The data listeners run every snapshot
//  through it. Once a save is sent it leaves the queue and stops being laid
//  over, and the database copy takes over.
// ============================================================

import * as offlineStore from './offline-store.js';

let _byCol = new Map();   // collection -> Map(docId -> { del, merge, payload })

function _add(map, w) {
  if (!w || !w.collection || !w.docId) return;
  if (!map.has(w.collection)) map.set(w.collection, new Map());
  const col  = map.get(w.collection);
  const prev = col.get(w.docId);
  if (w.op === 'delete') { col.set(w.docId, { del: true }); return; }
  const merge = !!(w.options && w.options.merge);
  if (merge && prev && !prev.del) {
    col.set(w.docId, { del: false, merge: prev.merge, payload: { ...prev.payload, ...w.payload } });
  } else {
    col.set(w.docId, { del: false, merge, payload: { ...(w.payload || {}) } });
  }
}

async function _activeUid() {
  if (window._staffOwnerUid) return window._staffOwnerUid;
  try { const { currentUser } = await import('./auth.js'); return currentUser?.uid || null; }
  catch (_) { return null; }
}

// Re-read the queue. Cheap (one IndexedDB read), called whenever it changes.
export async function refreshPending() {
  try {
    // On a reopen the data listeners can start before app boot has opened the
    // phone's store, and reading it then quietly returns nothing, which hid
    // every save still waiting to be sent. open() is shared and safe to repeat.
    await offlineStore.open();
    const uid = await _activeUid();
    const all = await offlineStore.readAll('pendingWrites');
    const next = new Map();
    all.filter(e => e.status !== 'needs_review' && (!uid || !e.ownerUid || e.ownerUid === uid))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach(e => (e.op === 'batch' ? (e.subWrites || []) : [e]).forEach(w => _add(next, w)));
    _byCol = next;
  } catch (_) { /* offline store unavailable: show the database copy as before */ }
}

export function hasPending() {
  for (const m of _byCol.values()) if (m.size) return true;
  return false;
}

export function withPending(collection, docs) {
  const pend = _byCol.get(collection);
  if (!pend || !pend.size) return docs;
  const out = (docs || []).slice();
  pend.forEach((w, id) => {
    const i = out.findIndex(d => d && d.id === id);
    if (w.del) { if (i >= 0) out.splice(i, 1); return; }
    if (w.merge) { if (i >= 0) out[i] = { ...out[i], ...w.payload, _pkSyncPending: true }; return; }
    const doc = { ...w.payload, id: w.payload.id ?? id, _pkSyncPending: true };
    if (i >= 0) out[i] = doc; else out.push(doc);
  });
  return out;
}

window.addEventListener('pkOfflineWrite', () => { refreshPending(); });
window.addEventListener('pkQueueChanged', async () => { await refreshPending(); _clearSentFlags(); });

// A save that has been sent no longer shows the waiting-to-sync clock. The
// database refresh that confirmed it can land before the queue is re-read,
// which left the clock on.
const _ARRAYS = { sales: '_pkSales', items: '_pkItems', expenses: '_pkExpenses', customers: '_pkWholesale', borrowers: '_pkBorrowers', contacts: '_pkContacts' };
function _clearSentFlags() {
  let salesChanged = false;
  for (const [col, key] of Object.entries(_ARRAYS)) {
    const pend = _byCol.get(col);
    (window[key] || []).forEach(d => {
      if (d && d._pkSyncPending && !(pend && pend.has(d.id))) { delete d._pkSyncPending; if (col === 'sales') salesChanged = true; }
    });
  }
  if (salesChanged) import('./trade-table.js').then(m => m.renderTradeTable?.()).catch(() => {});
}

// Called by the write gateway the moment a save is queued, so a database
// refresh that lands before the queue is re-read cannot drop it.
export function notePending(writes) {
  (writes || []).forEach(w => _add(_byCol, { ...w, payload: w.payload && typeof w.payload === 'object' ? { ...w.payload } : w.payload }));
}
