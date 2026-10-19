// ============================================================
//  db.js — All Firestore database operations
//
//  Write strategy:
//  - Owner writes: both users/{uid}/... AND shops/{uid}/...
//  - Staff writes: shops/{uid}/... ONLY (no permission for users/)
//  - Owner reads:  shops/{uid}/... via onSnapshot (catches both)
//  - Staff reads:  shops/{uid}/... via onSnapshot in staff-auth.js
// ============================================================

import { db, collection, doc, setDoc, deleteDoc,
         getDoc, getDocs,
         onSnapshot, query, writeBatch }            from './firebase.js';
import { saveLocal, toast }                          from './utils.js';
import { renderItems, updateSummary }               from './inventory.js';
import { renderReports }                            from './reports.js';
import { renderWholesale }                          from './wholesale.js';
import { renderTradeTable }                         from './trade-table.js';
import { startContactListener, stopContactListener } from './contacts.js';
import * as offlineStore from './offline-store.js';   // D.8.1 — additive offline mirror
import { normalizeSales } from './sale-derive.js';
import { gwWrite } from './write-gateway.js';          // D.8.2b sub-step 1
import { withPending, refreshPending, hasPending } from './pending-overlay.js';

// ── Active Firestore listeners ─────────────────────────────────────────────
let unsubItems    = null;
let unsubCusts    = null;
let unsubSales    = null;
let unsubExpenses = null;
let unsubProfile  = null;

// Dashboard live-refresh: re-render the Dashboard only when its page is
// currently visible. Avoids wasted innerHTML churn on every sale write
// when the user is on a different tab. The renderDashboard function is
// resolved through window.__PK to dodge the db.js → business.js cycle
// (business.js already imports from db.js).
function _refreshDashboardIfActive() {
  const dash = document.getElementById('page-dashboard');
  if (!dash || !dash.classList.contains('active')) return;
  window.__PK?.renderDashboard?.();
}

// Owner listens to shops/{uid}/... so they see staff writes instantly
export function startListeners(uid) {
  stopListeners(); // Prevent duplicate listeners on re-login
  unsubItems = onSnapshot(query(collection(db, 'shops', uid, 'items')), snap => {
    window._pkItems = withPending('items', snap.docs.map(d => d.data()));
    window._pkItems.sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0));
    saveLocal();
    renderItems();
    updateSummary();
    renderReports();
    _refreshDashboardIfActive();
    // D.8.1 — additive offline mirror (does not affect the lines above).
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') offlineStore.removeMirror('items', ch.doc.id);
      else offlineStore.putMirror('items', ch.doc.data());
    });
  });

  unsubCusts = onSnapshot(query(collection(db, 'shops', uid, 'customers')), snap => {
    if (window._pkContactsActive) return;
    window._pkWholesale = withPending('customers', snap.docs.map(d => d.data()));
    saveLocal();
    renderWholesale();
    // D.8.1 — additive offline mirror (legacy non-contacts mode only).
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') offlineStore.removeMirror('customers', ch.doc.id);
      else offlineStore.putMirror('customers', ch.doc.data());
    });
  });

  startContactListener(uid);

  unsubSales = onSnapshot(query(collection(db, 'shops', uid, 'sales')), snap => {
    window._pkSales = normalizeSales(withPending('sales', snap.docs.map(d => d.data())));
    saveLocal();
    renderTradeTable();
    renderWholesale();
    renderReports();
    _refreshDashboardIfActive();
    // D.8.1 — additive offline mirror (does not affect the lines above).
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') offlineStore.removeMirror('sales', ch.doc.id);
      else offlineStore.putMirror('sales', ch.doc.data());
    });
  });

  unsubExpenses = onSnapshot(query(collection(db, 'shops', uid, 'expenses')), snap => {
    const expDocs = withPending('expenses', snap.docs.map(d => d.data()));
    if (expDocs.length > 0) {
      window._pkExpenses = expDocs;
      saveLocal();
      _refreshDashboardIfActive();
    } else if ((window._pkExpenses || []).length > 0) {
      _migrateExpensesToFirestore(uid);
    }
    // D.8.1 — additive offline mirror (runs regardless of the branch above).
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') offlineStore.removeMirror('expenses', ch.doc.id);
      else offlineStore.putMirror('expenses', ch.doc.data());
    });
  });

  // Shop profile (name/phone/address) — live so a name change on one device
  // reflects on the owner's other devices and on staff. If no cloud profile
  // exists yet but this device has a local name (set during onboarding before
  // cloud sync existed), seed it up — same auto-migration idea as expenses.
  unsubProfile = onSnapshot(
    doc(db, 'shops', uid, 'settings', 'profile'),
    snap => {
      if (snap.exists()) { window.applyShopProfile?.(snap.data()); return; }
      const localName = localStorage.getItem('pkAppName');
      if (!localName) return;
      let prof = {}; try { prof = JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch (_) {}
      saveShopProfile(uid, { shopName: localName, phone: prof.phone || '', address: prof.address || '' })
        .catch(e => console.warn('[shopProfile] seed failed (non-critical):', e));
    },
    err => console.error('[shopProfile] listen failed:', err));

  // Reopened with saves still waiting to be sent: the first database refresh
  // can land before the queue is read, so lay the waiting saves over what is
  // on screen once it has been.
  refreshPending().then(_reapplyPending);
}

function _reapplyPending() {
  if (!hasPending()) return;
  window._pkItems     = withPending('items', window._pkItems || []);
  window._pkSales     = normalizeSales(withPending('sales', window._pkSales || []));
  window._pkExpenses  = withPending('expenses', window._pkExpenses || []);
  if (window._pkContactsActive) {
    window.__pkReapplyPendingContacts?.();
  } else {
    window._pkWholesale = withPending('customers', window._pkWholesale || []);
    window._pkBorrowers = withPending('borrowers', window._pkBorrowers || []);
  }
  saveLocal();
  renderItems(); updateSummary(); renderReports(); renderTradeTable(); renderWholesale();
  window.__PK?.renderBorrowers?.();
  _refreshDashboardIfActive();
}

async function _migrateExpensesToFirestore(uid) {
  const local = window._pkExpenses || [];
  if (!local.length) return;
  try {
    const batch = writeBatch(db);
    for (const e of local) {
      if (!e.id) continue;
      batch.set(doc(db, 'shops', uid, 'expenses', e.id), e, { merge: true });
    }
    await batch.commit();
    console.log(`[expenses] Auto-migrated ${local.length} expenses from localStorage to Firestore`);
  } catch (err) {
    console.warn('[expenses] Auto-migration failed (non-critical):', err);
  }
}

export function stopListeners() {
  [unsubItems, unsubCusts, unsubSales, unsubExpenses, unsubProfile].forEach(u => u && u());
  unsubItems = unsubCusts = unsubSales = unsubExpenses = unsubProfile = null;
  stopContactListener();
}

// ── Write helpers ──────────────────────────────────────────────────────────
// Owner: writes both `/shops/{uid}/...` AND legacy mirror `/users/{uid}/...`
// Staff: writes `/shops/{uid}/...` only. Firestore rules deny `/users/` to
//        anyone except the owner, so attempting the mirror would reject the
//        whole Promise.all and surface a misleading toast.
function _isOwnerWriter() {
  return !window._staffOwnerUid;
}

async function _setData(uid, subcol, id, data, options = {}) {
  try {
    const writes = [setDoc(doc(db, 'shops', uid, subcol, id), data, options)];
    if (_isOwnerWriter()) {
      writes.push(setDoc(doc(db, 'users', uid, subcol, id), data, options));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error(`[db] Failed to save ${subcol}/${id}:`, err);
    toast('⚠️ Cloud backup failed — saved locally. Retry when online', 'err');
    throw err;
  }
}

async function _deleteData(uid, subcol, id) {
  try {
    const writes = [deleteDoc(doc(db, 'shops', uid, subcol, id))];
    if (_isOwnerWriter()) {
      writes.push(deleteDoc(doc(db, 'users', uid, subcol, id)));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error(`[db] Failed to delete ${subcol}/${id}:`, err);
    toast('⚠️ Cloud delete failed — removed locally. Retry when online', 'err');
    throw err;
  }
}

// Partial-field item update with merge:true. Used by sale-driven stock
// decrement so cashier writes pass the rule that requires
// affectedKeys ⊆ {stockQty, qty, low, updatedTs}.
// D.8.2b sub-step 2a — via the write gateway: the payload stays the MINIMAL
// patch (rule-critical) and {merge:true} is preserved through the queue;
// offline the patch queues instead of hanging on a direct setDoc.
export async function patchItem(uid, itemId, patch) {
  try {
    await gwWrite('update', 'items', itemId, patch, { merge: true });
  } catch (err) {
    console.error(`[db] Failed to patch item ${itemId}:`, err);
    toast('⚠️ Stock sync failed — try again', 'err');
    throw err;
  }
}

// ── Tombstone functions ─────────────────────────────────────────────────────
export async function addTombstone(uid, itemId) {
  // D.8.2b sub-step 2a — queued so an offline item delete can't lose its
  // tombstone (a lost tombstone lets the deleted item resurrect via
  // mergeLocalToFirestore). Throws raw on real failure, as before.
  await gwWrite('set', '_pkDeleted', itemId, { id: itemId, deletedAt: Date.now() });
}

export async function getTombstones(uid) {
  const snap = await getDocs(collection(db, 'shops', uid, '_pkDeleted'));
  return new Set(snap.docs.map(d => d.id));
}

// ── Merge with tombstone awareness ──────────────────────────────────────────
export async function mergeLocalToFirestore(uid, localItems, localCustomers, localSales, localBorrowers = [], localExpenses = []) {
  const tombstones = await getTombstones(uid);
  const batch = writeBatch(db);

  for (const item of localItems) {
    if (!item.id || tombstones.has(item.id)) continue;
    batch.set(doc(db, 'shops', uid, 'items', item.id), item, { merge: true });
  }
  for (const c of localCustomers) {
    if (!c.id) continue;
    batch.set(doc(db, 'shops', uid, 'customers', c.id), c, { merge: true });
  }
  for (const s of localSales) {
    if (!s.id) continue;
    batch.set(doc(db, 'shops', uid, 'sales', s.id), s, { merge: true });
  }
  for (const b of localBorrowers) {
    if (!b.id) continue;
    batch.set(doc(db, 'shops', uid, 'borrowers', b.id), b, { merge: true });
  }
  for (const e of localExpenses) {
    if (!e.id) continue;
    batch.set(doc(db, 'shops', uid, 'expenses', e.id), e, { merge: true });
  }
  for (const ct of (window._pkContacts || [])) {
    if (!ct.id) continue;
    batch.set(doc(db, 'shops', uid, 'contacts', ct.id), ct, { merge: true });
  }

  await batch.commit();
}

// Rescue local-only records that never reached the cloud — e.g. trades rung
// while the Google session had silently expired (the June-8 data-loss case).
// Runs on sign-in for the SAME owner only (callers pass !ownerChanged). Unlike
// mergeLocalToFirestore it uploads ONLY docs whose id is absent from the cloud
// (and not tombstoned), so it never duplicates, never resurrects a deleted
// record, and never clobbers a cloud-edited one. Must run BEFORE the snapshot
// listeners overwrite local state. Returns a per-collection rescued count.
export async function rescueLocalToFirestore(uid, locals = {}) {
  const tombstones = await getTombstones(uid);
  const specs = [
    ['items',     locals.items     || []],
    ['customers', locals.customers || []],
    ['sales',     locals.sales     || []],
    ['borrowers', locals.borrowers || []],
    ['expenses',  locals.expenses  || []],
    ['contacts',  locals.contacts  || []],
  ];
  const rescued = {};
  let batch = writeBatch(db), ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
  for (const [col, arr] of specs) {
    if (!arr.length) continue;
    const cloud = await getDocs(collection(db, 'shops', uid, col));
    const cloudIds = new Set(cloud.docs.map(d => d.id));
    for (const rec of arr) {
      if (!rec || !rec.id || cloudIds.has(rec.id) || tombstones.has(rec.id)) continue;
      batch.set(doc(db, 'shops', uid, col, rec.id), rec, { merge: true });
      ops++; rescued[col] = (rescued[col] || 0) + 1;
      if (ops >= 400) await flush();   // Firestore batch cap is 500
    }
  }
  await flush();
  return rescued;
}

// ── Items ───────────────────────────────────────────────────────────────────
// D.8.2b sub-step 2a — via the write gateway (queued offline, owner-stamped,
// retried). Error reporting mirrors _setData (console + toast + rethrow);
// uid param kept for caller-signature compat (gwWrite resolves it itself).
export const saveItem = async (uid, item) => {
  try { await gwWrite('set', 'items', item.id, item); }
  catch (err) {
    console.error(`[db] Failed to save items/${item.id}:`, err);
    toast('⚠️ Cloud save failed for items', 'err');
    throw err;
  }
};
export const removeItem = async (uid, id) => {
  try { await gwWrite('delete', 'items', id, null); }
  catch (err) {
    console.error(`[db] Failed to delete items/${id}:`, err);
    toast('⚠️ Cloud delete failed for items', 'err');
    throw err;
  }
};

// ── Customers ───────────────────────────────────────────────────────────────
// Through the offline queue, like items and sales: a direct write never
// finishes with no internet, which left the Save button stuck.
export const saveCustomer = async (uid, c) => {
  try { await gwWrite('set', 'customers', c.id, c); }
  catch (err) {
    console.error(`[db] Failed to save customers/${c.id}:`, err);
    toast('⚠️ Cloud save failed for customer', 'err');
    throw err;
  }
};
export const removeCustomer = async (uid, id) => {
  try { await gwWrite('delete', 'customers', id, null); }
  catch (err) {
    console.error(`[db] Failed to delete customers/${id}:`, err);
    toast('⚠️ Cloud delete failed for customer', 'err');
    throw err;
  }
};

// ── Shop profile ────────────────────────────────────────────────────────────
// Name / phone / address kept at shops/{uid}/settings/profile so they persist
// across the owner's devices and are readable by staff (rules: staff read,
// owner write). Owner-only write — staff never edit the shop profile.
export async function saveShopProfile(uid, profile) {
  if (!uid) return;
  // Through the offline queue so it never hangs with no internet.
  await gwWrite('set', 'settings', 'profile', { ...profile, updatedTs: Date.now() }, { merge: true });
}
export function subscribeShopProfile(uid, cb) {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, 'shops', uid, 'settings', 'profile'),
    snap => { if (snap.exists()) cb(snap.data()); },
    err => console.error('[shopProfile] listen failed:', err));
}

// ── Public storefront ───────────────────────────────────────────────────────
// Owner publishes a SANITIZED snapshot to shops/{uid}/public/storefront. The
// payload must already be clean (sell prices + stock badge only — never cost/
// profit/stock); building that is storefront.js's job. Owner-only write per
// rules; the raw items collection is never made public.
export async function publishStorefront(uid, payload) {
  if (!uid) return;
  await setDoc(doc(db, 'shops', uid, 'public', 'storefront'),
    { ...payload, updatedTs: Date.now() }, { merge: true });
}

// Clean storefront URL slugs: storefronts/{slug} → { uid }. Public read, but a
// slug can only point to (and be changed by) its owner — see rules.
export async function storefrontSlugTaken(slug, uid) {
  const snap = await getDoc(doc(db, 'storefronts', slug));
  return snap.exists() && snap.data().uid !== uid;   // taken by someone else
}
export async function claimStorefrontSlug(uid, slug) {
  if (!uid || !slug) return;
  await setDoc(doc(db, 'storefronts', slug), { uid, updatedTs: Date.now() });
}

// ── Sales ───────────────────────────────────────────────────────────────────
// D.8.2b sub-step 2d — via the write gateway (queued offline, owner-stamped,
// retried). Create/payment paths were already on gwWrite (trade-payment.js);
// these cover void / unvoid / delete / bulk-recalc saves. The void flow's
// borrower-ledger reversal is enqueued BEFORE the void write (trade-table.js
// reverses first), so both ride the queue together in order — an offline
// void can no longer reverse the ledger and then lose its voided flag on
// reload. Error reporting mirrors _setData (console + toast + rethrow).
export const saveSale = async (uid, s) => {
  try { await gwWrite('set', 'sales', s.id, s); }
  catch (err) {
    console.error(`[db] Failed to save sales/${s.id}:`, err);
    toast('⚠️ Cloud save failed for sales', 'err');
    throw err;
  }
};
export const voidSale = async (uid, sale) => {
  try { await gwWrite('update', 'sales', sale.id, sale, { merge: true }); }
  catch (err) {
    console.error(`[db] Failed to void sales/${sale.id}:`, err);
    toast('⚠️ Cloud save failed for sales', 'err');
    throw err;
  }
};
export const removeSale = async (uid, id) => {
  try { await gwWrite('delete', 'sales', id, null); }
  catch (err) {
    console.error(`[db] Failed to delete sales/${id}:`, err);
    toast('⚠️ Cloud delete failed for sales', 'err');
    throw err;
  }
};
export const deleteSaleDB = removeSale;

// ── Borrowers ───────────────────────────────────────────────────────────────
// D.8.2b sub-step 1 — via the write gateway: queues offline (owner-stamped,
// retried) instead of a direct setDoc that hangs offline. gwWrite resolves
// the uid itself; the uid param is kept for caller-signature compat. Error
// reporting mirrors _setData (console + toast + rethrow).
export const saveBorrower = async (uid, b) => {
  try { await gwWrite('set', 'borrowers', b.id, b); }
  catch (err) {
    console.error(`[db] Failed to save borrowers/${b.id}:`, err);
    toast('⚠️ Cloud save failed for borrowers', 'err');
    throw err;
  }
};
export const removeBorrower = async (uid, id) => {
  try { await gwWrite('delete', 'borrowers', id, null); }
  catch (err) {
    console.error(`[db] Failed to delete borrowers/${id}:`, err);
    toast('⚠️ Cloud delete failed for borrowers', 'err');
    throw err;
  }
};

// ── One-time sync: copy users/ data into shops/ ─────────────────────────────
export async function syncOwnerDataToShopsPath(uid) {
  const [iSnap, cSnap, sSnap, bSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'items')),
    getDocs(collection(db, 'users', uid, 'customers')),
    getDocs(collection(db, 'users', uid, 'sales')),
    getDocs(collection(db, 'users', uid, 'borrowers')),
  ]);

  const b = writeBatch(db);
  iSnap.docs.forEach(d => b.set(doc(db, 'shops', uid, 'items',     d.id), d.data()));
  cSnap.docs.forEach(d => b.set(doc(db, 'shops', uid, 'customers', d.id), d.data()));
  sSnap.docs.forEach(d => b.set(doc(db, 'shops', uid, 'sales',     d.id), d.data()));
  bSnap.docs.forEach(d => b.set(doc(db, 'shops', uid, 'borrowers', d.id), d.data()));
  await b.commit();
}