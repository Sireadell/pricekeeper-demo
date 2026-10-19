// ============================================================
//  write-gateway.js — the offline-capable write gateway
//
//  gwWrite(op, collection, docId, payload, options) is the single-doc path.
//    op: 'create' | 'update' | 'set' → setDoc ; 'delete' → deleteDoc
//
//  gwWriteLinked(subWrites) — BUG-014 — is the multi-doc, ATOMIC sibling:
//  subWrites is [{op, collection, docId, payload, options}]. Use this
//  whenever two writes represent one real-world fact and must never be
//  allowed to land at different times (e.g. a trade payment + the matching
//  Credit Account ledger entry — two sequential gwWrite() calls for that
//  pair is exactly how BUG-014 happened: a network blip on the first call
//  queues it while the second succeeds immediately, leaving the two
//  records disagreeing until the queue drains).
//
//  Behaviour (both):
//    online  → write Firestore directly (single doc, or one atomic
//              writeBatch for the linked form), then mirror to offline
//              store. A transient NETWORK error mid-flight falls back to
//              enqueue. Permission/validation errors bubble up (real
//              rejection).
//    offline → enqueue to pendingWrites with an optimistic local mirror,
//              return a synthetic success {ok, synced:false, queueId}.
//              gwWriteLinked enqueues ALL sub-writes as ONE queue entry
//              (op:'batch') so the sync engine always replays them
//              together, never individually.
//
//  As of BUG-014, gwWriteLinked is used by trade-payment.js's
//  _pmConfirmExisting only. Several other sale+ledger write pairs in that
//  file (initial sale creation, trade edits, overpayment handling, payment
//  removal) still make separate gwWrite() calls and carry the same
//  race — tracked as a documented fast-follow in docs/BUG_LOG.md, not
//  fixed here, to keep this change reviewable per project convention.
//  The sync engine (sync-engine.js) drains the queue; it listens for the
//  'pkOfflineWrite' event we fire.
//
//  `_pkSyncPending` is a LOCAL-ONLY flag set on the in-memory doc object
//  so Trade history can show a pending-sync clock. It is stripped from
//  everything written to Firestore / stored in the queue.
// ============================================================

import { db, doc, setDoc, deleteDoc, writeBatch } from './firebase.js';
import * as offlineStore from './offline-store.js';
import { notePending } from './pending-overlay.js';

// Network-ish Firestore error codes → safe to queue + retry. NOT
// permission-denied / failed-precondition / invalid-argument (real
// rejections that retrying won't fix).
const NETWORK_CODES = new Set([
  'unavailable', 'deadline-exceeded', 'cancelled', 'aborted',
  'internal', 'resource-exhausted', 'unknown',
]);
function isNetworkError(err) {
  const code = (err && err.code) ? String(err.code).replace(/^.*\//, '') : '';
  if (NETWORK_CODES.has(code)) return true;
  return /network|offline|failed to (get|reach)|transport|connection/i.test(err?.message || '');
}

function _online() {
  const state = (typeof window._pkOnlineState === 'boolean') ? window._pkOnlineState : navigator.onLine;
  return state && !window._pkForceOffline;
}

function _clean(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!('_pkSyncPending' in payload)) return payload;
  const c = { ...payload };
  delete c._pkSyncPending;
  return c;
}

async function _activeUid() {
  const { currentUser } = await import('./auth.js');   // lazy → no load-time cycle
  return window._staffOwnerUid || currentUser?.uid || null;
}

// Raw Firestore write. Owner dual-writes shops/ + legacy users/; staff
// writes shops/ only (rules deny users/ to non-owners). Mirrors db.js
// _setData / _deleteData semantics so a rerouted sales write is identical
// on the wire to the old path.
// D.8.2b sub-step 0 — queued replays pass the entry's own ownerUid so the
// target shop path can never drift from who rang the write; live (non-queue)
// writes omit it and resolve the active session as before.
async function directFirestoreWrite(op, collection, docId, payload, options = {}, ownerUid = null) {
  const uid = ownerUid || await _activeUid();
  if (!uid) throw new Error('[write-gateway] no active uid for write');
  const isOwner = !window._staffOwnerUid;

  if (op === 'delete') {
    const writes = [deleteDoc(doc(db, 'shops', uid, collection, docId))];
    if (isOwner) writes.push(deleteDoc(doc(db, 'users', uid, collection, docId)));
    await Promise.all(writes);
    return;
  }
  const clean = _clean(payload);
  const writes = [setDoc(doc(db, 'shops', uid, collection, docId), clean, options)];
  if (isOwner) writes.push(setDoc(doc(db, 'users', uid, collection, docId), clean, options));
  await Promise.all(writes);
}

// BUG-014 — atomic sibling of directFirestoreWrite for a set of writes that
// must land together or not at all (e.g. a trade payment + the matching
// Credit Account ledger entry). Reuses the exact same owner-dual-write
// shape as directFirestoreWrite (shops/ + legacy users/ for the owner) so a
// batched write is identical on the wire to N individual ones, just atomic.
// subWrites: [{op, collection, docId, payload, options}], op: 'set'|'delete'
// (no partial-batch semantics needed here — no 'create'/'update' distinction).
async function directFirestoreBatch(subWrites, ownerUid = null) {
  const uid = ownerUid || await _activeUid();
  if (!uid) throw new Error('[write-gateway] no active uid for batch write');
  const isOwner = !window._staffOwnerUid;

  const batch = writeBatch(db);
  for (const w of subWrites) {
    if (w.op === 'delete') {
      batch.delete(doc(db, 'shops', uid, w.collection, w.docId));
      if (isOwner) batch.delete(doc(db, 'users', uid, w.collection, w.docId));
    } else {
      const clean = _clean(w.payload);
      batch.set(doc(db, 'shops', uid, w.collection, w.docId), clean, w.options || {});
      if (isOwner) batch.set(doc(db, 'users', uid, w.collection, w.docId), clean, w.options || {});
    }
  }
  await batch.commit();
}

async function _mirror(op, collection, docId, payload, options) {
  if (op === 'delete') { offlineStore.removeMirror(collection, docId); return; }
  const clean = _clean(payload);
  let toStore = (clean && clean.id != null) ? clean : { ...clean, id: docId };
  // D.8.2b sub-step 2a — merge-aware mirror: a {merge:true} partial patch
  // (e.g. the stock decrement's {stockQty, updatedTs}) must MERGE into the
  // mirrored doc, not replace it — replacing would gut the item mirror down
  // to the patch keys until the next snapshot heals it.
  if (options && options.merge) {
    const existing = await offlineStore.readOne(collection, docId);
    if (existing) toStore = { ...existing, ...toStore };
  }
  offlineStore.putMirror(collection, toStore);
}

async function _enqueue(op, collection, docId, payload, options) {
  const queueId = `pw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id: queueId, op, collection, docId,
    payload: _clean(payload), options: options || {},
    // D.8.2b sub-step 0 — stamp the owner whose shop this write belongs to,
    // captured at ENQUEUE time. The sync-engine drain guard parks any entry
    // whose ownerUid doesn't match the active owner, so a queued write can
    // never replay into a different owner's shop.
    ownerUid: await _activeUid(),
    status: 'pending', attempts: 0, nextAttemptAt: 0,
    createdAt: Date.now(),
  };
  await offlineStore.putMirror('pendingWrites', entry);   // pendingWrites keyPath 'id'
  notePending([{ op, collection, docId, payload: entry.payload, options: entry.options }]);
  _mirror(op, collection, docId, payload, options);       // optimistic local mirror
  // Mark the in-memory doc so Trade history can show the clock icon. This
  // mutates the caller's object (which is the _pkSales entry for sales),
  // and is naturally cleared by the post-sync snapshot.
  if (op !== 'delete' && payload && typeof payload === 'object') payload._pkSyncPending = true;
  try { window.dispatchEvent(new CustomEvent('pkOfflineWrite', { detail: { queueId } })); } catch (_) {}
  return { ok: true, synced: false, queueId };
}

// True when this shop already has writes waiting in the queue. A direct
// write must not overtake them: queued sales docs are full replacements, so
// a later direct patch (e.g. refundDue) that landed first would be
// overwritten by the older queued copy when the drain caught up.
async function _queueBusy() {
  if (window._pkOfflineDisabled) return false;
  try {
    const uid = await _activeUid();
    const all = await offlineStore.readAll('pendingWrites');
    return all.some(e => e.status !== 'needs_review' && (!e.ownerUid || e.ownerUid === uid));
  } catch (_) { return false; }
}

export async function gwWrite(op, collection, docId, payload, options = {}) {
  if (await _queueBusy()) return await _enqueue(op, collection, docId, payload, options);
  if (_online()) {
    try {
      await directFirestoreWrite(op, collection, docId, payload, options);
      _mirror(op, collection, docId, payload, options);
      if (payload && typeof payload === 'object') delete payload._pkSyncPending;  // synced now
      return { ok: true, synced: true, queueId: null };
    } catch (err) {
      if (isNetworkError(err)) return await _enqueue(op, collection, docId, payload, options);
      throw err;   // permission / validation → real failure, bubble up
    }
  }
  return await _enqueue(op, collection, docId, payload, options);
}

// BUG-014 — a single combined queue entry (op:'batch') for writes that must
// land, or queue, together. Unlike N separate gwWrite() calls, there is no
// window where one half syncs and the other doesn't: online, one
// writeBatch() commits atomically; offline/network-error, one queue entry
// carries all sub-writes, so the sync engine replays them as one unit
// (same backoff/retry — see sync-engine.js's 'batch' branch).
async function _enqueueLinked(subWrites) {
  const queueId = `pw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id: queueId, op: 'batch',
    // Readable summary for the sync log / needs-review panel (they render
    // entry.collection/entry.docId; a real trade+borrower pair should be
    // recognizable there, not blank).
    collection: subWrites.map(w => w.collection).join('+'),
    docId:      subWrites.map(w => w.docId).join(','),
    subWrites:  subWrites.map(w => ({ ...w, payload: _clean(w.payload) })),
    ownerUid: await _activeUid(),
    status: 'pending', attempts: 0, nextAttemptAt: 0,
    createdAt: Date.now(),
  };
  await offlineStore.putMirror('pendingWrites', entry);
  notePending(entry.subWrites);
  for (const w of subWrites) _mirror(w.op, w.collection, w.docId, w.payload, w.options);
  // Only the sales sub-write should show the pending-sync clock in Trade
  // history — mirrors the single-write _enqueue's intent for that flag.
  const salesWrite = subWrites.find(w => w.collection === 'sales');
  if (salesWrite && salesWrite.op !== 'delete' && salesWrite.payload && typeof salesWrite.payload === 'object') {
    salesWrite.payload._pkSyncPending = true;
  }
  try { window.dispatchEvent(new CustomEvent('pkOfflineWrite', { detail: { queueId } })); } catch (_) {}
  return { ok: true, synced: false, queueId };
}

// { background: true } — save to the local queue and return at once; the
// sync engine sends it (pkOfflineWrite triggers an immediate drain when
// online). Used by the checkout buttons so the cashier is not held on a
// spinner for the Firestore server round trip. Falls back to the normal
// path when the offline store is unavailable, since the queue could not
// hold the write durably then.
export async function gwWriteLinked(subWrites, { background = false } = {}) {
  if (background && !window._pkOfflineDisabled) return await _enqueueLinked(subWrites);
  if (await _queueBusy()) return await _enqueueLinked(subWrites);
  if (_online()) {
    try {
      await directFirestoreBatch(subWrites);
      for (const w of subWrites) {
        _mirror(w.op, w.collection, w.docId, w.payload, w.options);
        if (w.payload && typeof w.payload === 'object') delete w.payload._pkSyncPending;
      }
      return { ok: true, synced: true, queueId: null };
    } catch (err) {
      if (isNetworkError(err)) return await _enqueueLinked(subWrites);
      throw err;
    }
  }
  return await _enqueueLinked(subWrites);
}

// Used by the sync engine to replay queued writes.
export { directFirestoreWrite, directFirestoreBatch };

window.gwWrite = gwWrite;
window.gwWriteLinked = gwWriteLinked;
