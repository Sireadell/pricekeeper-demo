// ============================================================
//  offline-store.js — D.8.1 offline foundation (IndexedDB mirror)
//
//  Scope (D.8.1): establish the IndexedDB schema + read/write helpers.
//  This module ONLY mirrors server data and offers reads. It does NOT
//  queue writes, sync, or resolve conflicts — those are D.8.2 / D.8.4.
//
//  Failure policy: offline-store must NEVER crash the app. Every op is
//  wrapped; on failure we console.error/warn and degrade silently. If
//  IndexedDB is unavailable, open() sets window._pkOfflineDisabled=true
//  and resolves null so boot continues normally.
//
//  Object stores (version 1):
//    8 collection mirrors — items, sales, customers, borrowers,
//      contacts, expenses, staff, settings   (keyPath 'id')
//    pendingWrites, syncLog                   (DEFINED, NOT USED — D.8.2)
// ============================================================

const DB_NAME    = 'pricekeeper-offline';
const DB_VERSION = 1;

const COLLECTION_STORES = [
  'items', 'sales', 'customers', 'borrowers',
  'contacts', 'expenses', 'staff', 'settings',
];

let _db          = null;   // single shared connection for the app lifetime
let _openPromise = null;   // idempotent: open() returns the same promise

// ── open() ────────────────────────────────────────────────────
// Resolves to the IDBDatabase, or null if IndexedDB is unavailable.
// Never rejects — callers can `await open()` without try/catch and boot
// continues regardless.
export function open() {
  if (_openPromise) return _openPromise;
  _openPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      console.error('[offline-store] IndexedDB unavailable — offline mirror disabled');
      window._pkOfflineDisabled = true;
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      console.error('[offline-store] indexedDB.open() threw — offline mirror disabled:', err);
      window._pkOfflineDisabled = true;
      resolve(null);
      return;
    }

    // Idempotent + forward-compatible: each store is guarded by a
    // contains() check, so a future version bump can add new stores
    // here without disturbing existing ones (and re-running cleanly on
    // a partially-created DB).
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const name of COLLECTION_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pendingWrites')) {
        db.createObjectStore('pendingWrites', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('syncLog')) {
        db.createObjectStore('syncLog', { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      // If another tab opens a newer version, close this connection so the
      // upgrade isn't blocked. We simply drop the handle — ops no-op until
      // the next open(). (D.8.1 has no reopen logic; that's fine — mirror
      // is not read by the UI yet.)
      _db.onversionchange = () => { try { _db.close(); } catch (_) {} _db = null; };
      window._pkOfflineDisabled = false;
      resolve(_db);
    };
    req.onerror = (e) => {
      console.error('[offline-store] IndexedDB open failed — offline mirror disabled:', e.target?.error);
      window._pkOfflineDisabled = true;
      resolve(null);
    };
    req.onblocked = () => {
      console.warn('[offline-store] IndexedDB open blocked (another tab holds an older version open)');
    };
  });
  return _openPromise;
}

// ── internal: get an object store, or null if unavailable ─────
function _store(name, mode) {
  if (!_db) return null;
  try {
    return _db.transaction(name, mode).objectStore(name);
  } catch (err) {
    console.warn(`[offline-store] transaction(${name}, ${mode}) failed:`, err);
    return null;
  }
}

// ── putMirror(collection, doc) → Promise<bool> ────────────────
// Upserts a single doc into its mirror store. Key is doc.id (keyPath).
// Resolves true on transaction COMPLETE (durable), false on any
// failure/skip. Never rejects, never crashes the app. Returning a
// completion-aware promise matters for the sync engine: it awaits this
// so a follow-up read (_recountQueue) sees the committed write — a
// fire-and-forget request could still be in flight, leaving the banner
// stuck on a stale count (D.8.2a banner-stuck fix).
export function putMirror(collection, docData) {
  return new Promise((resolve) => {
    try {
      if (!_db) return resolve(false);
      if (!docData || docData.id == null) {
        console.warn(`[offline-store] putMirror(${collection}) skipped — doc has no id`);
        return resolve(false);
      }
      const tx = _db.transaction(collection, 'readwrite');
      tx.objectStore(collection).put(docData);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => { console.error(`[offline-store] putMirror ${collection}/${docData.id} failed:`, e.target?.error); resolve(false); };
      tx.onabort = (e) => { console.error(`[offline-store] putMirror ${collection}/${docData.id} aborted:`, e.target?.error); resolve(false); };
    } catch (err) {
      // QuotaExceededError lands here on some browsers — log, never crash.
      console.error(`[offline-store] putMirror ${collection} threw:`, err);
      resolve(false);
    }
  });
}

// ── removeMirror(collection, id) → Promise<bool> ──────────────
// Resolves true on transaction COMPLETE (durable delete), false on any
// failure/skip. Never rejects. The sync engine awaits this so the queue
// entry is provably gone before the next recount.
export function removeMirror(collection, id) {
  return new Promise((resolve) => {
    try {
      if (!_db || id == null) return resolve(false);
      const tx = _db.transaction(collection, 'readwrite');
      tx.objectStore(collection).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => { console.error(`[offline-store] removeMirror ${collection}/${id} failed:`, e.target?.error); resolve(false); };
      tx.onabort = (e) => { console.error(`[offline-store] removeMirror ${collection}/${id} aborted:`, e.target?.error); resolve(false); };
    } catch (err) {
      console.error(`[offline-store] removeMirror ${collection} threw:`, err);
      resolve(false);
    }
  });
}

// ── readAll(collection) → Promise<doc[]> ──────────────────────
// Reads are NOT used by the UI in D.8.1 (that's D.8.3) but the API is
// exported so later phases can build on it. Resolves [] on any failure.
export function readAll(collection) {
  return new Promise((resolve) => {
    try {
      const st = _store(collection, 'readonly');
      if (!st) { resolve([]); return; }
      const r = st.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror   = (e) => { console.warn(`[offline-store] readAll ${collection} failed:`, e.target?.error); resolve([]); };
    } catch (err) {
      console.warn(`[offline-store] readAll ${collection} threw:`, err);
      resolve([]);
    }
  });
}
// read(collection) is an alias of readAll(collection).
export const read = readAll;

// ── readOne(collection, id) → Promise<doc|null> ───────────────
export function readOne(collection, id) {
  return new Promise((resolve) => {
    try {
      const st = _store(collection, 'readonly');
      if (!st) { resolve(null); return; }
      const r = st.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror   = (e) => { console.warn(`[offline-store] readOne ${collection}/${id} failed:`, e.target?.error); resolve(null); };
    } catch (err) {
      console.warn(`[offline-store] readOne ${collection}/${id} threw:`, err);
      resolve(null);
    }
  });
}

// Expose for non-module callers + DevTools debugging.
window.offlineStore = { open, read, readAll, readOne, putMirror, removeMirror };
