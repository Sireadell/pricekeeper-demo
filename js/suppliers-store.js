// ============================================================
//  suppliers-store.js — D.9.1 supplier intelligence data layer
//
//  Owns two new collections (read via live snapshot into in-memory
//  caches, write via window.gwWrite per the D.8 offline gateway):
//    /shops/{uid}/suppliers/       → window._pkSuppliers
//    /shops/{uid}/supplierPrices/  → window._pkSupplierPrices
//
//  Listeners are started from auth.js (owner path + staff path) so this
//  module never has to touch db.js or the deferred staff-auth.js. They
//  are only started for owner/admin/manager — cashier has no read access
//  (firestore.rules denies it), so we never attach a cashier listener.
//
//  "Log only when prices change" discipline lives in restock-modal.js;
//  this module just exposes the primitives it needs.
// ============================================================

import { db, collection, onSnapshot, query } from './firebase.js';
import { uid as newId } from './utils.js';
import { currentUser, activeUid } from './auth.js';
import { getCurrentActor, makePerformedBy } from './staff-auth.js';

let _unsubSuppliers = null;
let _unsubPrices    = null;
let _listeningUid   = null;


// Idempotent listener bootstrap. Called from renderItems() so it covers
// every entry path (owner sign-in, fresh staff login via staff-auth.js,
// and staff reload via auth.js) without modifying those files. Cashier
// has no read access, so we never attach a listener for that role.
export function ensureSupplierListeners() {
  const role = getCurrentActor().role;
  const uid  = activeUid();
  if (!uid || role === 'cashier' || role === 'unknown') {
    if (_listeningUid) stopSupplierListeners();
    return;
  }
  if (uid === _listeningUid) return;   // already listening for this shop
  startSupplierListeners(uid);
  _listeningUid = uid;
}

// ── Listeners ─────────────────────────────────────────────────
export function startSupplierListeners(uid) {
  if (!uid) return;
  stopSupplierListeners();   // never stack duplicates on re-login
  window._pkSuppliers      = window._pkSuppliers      || [];
  window._pkSupplierPrices = window._pkSupplierPrices || [];

  _unsubSuppliers = onSnapshot(query(collection(db, 'shops', uid, 'suppliers')), snap => {
    window._pkSuppliers = snap.docs.map(d => d.data());
    _notifyChanged();
  }, err => console.error('[suppliers] suppliers listener error:', err));

  _unsubPrices = onSnapshot(query(collection(db, 'shops', uid, 'supplierPrices')), snap => {
    window._pkSupplierPrices = snap.docs.map(d => d.data());
    _notifyChanged();
  }, err => console.error('[suppliers] supplierPrices listener error:', err));
}

export function stopSupplierListeners() {
  try { _unsubSuppliers && _unsubSuppliers(); } catch (_) {}
  try { _unsubPrices    && _unsubPrices();    } catch (_) {}
  _unsubSuppliers = null;
  _unsubPrices    = null;
  _listeningUid   = null;
}

function _notifyChanged() {
  try { window.dispatchEvent(new CustomEvent('pkSuppliersChanged')); } catch (_) {}
}

// ── Supplier getters ──────────────────────────────────────────
export function getSuppliers()        { return window._pkSuppliers || []; }
export function getSupplier(id)        { return (window._pkSuppliers || []).find(s => s.id === id) || null; }
export function getActiveSuppliers()   { return (window._pkSuppliers || []).filter(s => s.active !== false); }

// ── Supplier writes (via gwWrite) ─────────────────────────────
export async function createSupplier(data) {
  const id = newId();
  const doc = {
    id,
    name:     (data.name || '').trim(),
    location: (data.location || '').trim(),
    contact:  (data.contact || '').trim(),
    notes:    (data.notes || '').trim(),
    active:   data.active !== false,
    createdBy: makePerformedBy(getCurrentActor()),
    createdAt: Date.now(),
  };
  await window.gwWrite('set', 'suppliers', id, doc);
  // Optimistic local insert so the dropdown shows it immediately even
  // before the snapshot round-trips (mirrors the items.js pattern).
  window._pkSuppliers = window._pkSuppliers || [];
  if (!window._pkSuppliers.some(s => s.id === id)) window._pkSuppliers.push(doc);
  _notifyChanged();
  return doc;
}

export async function updateSupplier(id, data) {
  const existing = getSupplier(id);
  if (!existing) throw new Error('[suppliers] updateSupplier: not found ' + id);
  const merged = { ...existing, ...data, id, updatedAt: Date.now() };
  await window.gwWrite('set', 'suppliers', id, merged);
  const idx = (window._pkSuppliers || []).findIndex(s => s.id === id);
  if (idx >= 0) window._pkSuppliers[idx] = merged;
  _notifyChanged();
  return merged;
}

// ── Supplier-price getters ────────────────────────────────────
function _priceTs(p) { return p.lastRestockAt || p.observedAt || p.createdAt || 0; }

export function getSupplierPricesForItem(itemId) {
  return (window._pkSupplierPrices || [])
    .filter(p => p.itemId === itemId)
    .sort((a, b) => _priceTs(b) - _priceTs(a));
}

// Latest price doc for an item (optionally narrowed to one supplier).
export function getLatestPriceForItem(itemId, supplierId = null) {
  const rows = getSupplierPricesForItem(itemId)
    .filter(p => !supplierId || p.supplierId === supplierId);
  return rows[0] || null;
}

// Convenience summary used by the Restock prefill + Edit-modal info box.
// Returns null when the item has no recorded supplier price yet.
export function getLastRestockInfo(itemId) {
  const latest = getLatestPriceForItem(itemId);
  if (!latest) return null;
  const supplier = getSupplier(latest.supplierId);
  return {
    priceId:      latest.id,
    supplierId:   latest.supplierId,
    supplierName: supplier ? supplier.name : '(unknown supplier)',
    price:        latest.price,
    perUnit:      latest.perUnit || 'carton',
    at:           _priceTs(latest),
  };
}

// ── Supplier-price writes (via gwWrite) ───────────────────────
export async function createSupplierPrice(data) {
  const id  = newId();
  const now = Date.now();
  const doc = {
    id,
    itemId:       data.itemId,
    supplierId:   data.supplierId,
    price:        Number(data.price) || 0,
    perUnit:      data.perUnit || 'carton',
    observedAt:   data.observedAt || now,
    lastRestockAt: now,
    qtyAdded:     Number(data.qtyAdded) || 0,
    isPurchase:   data.isPurchase !== false,   // default true (a restock/buy)
    notes:        (data.notes || '').trim(),
    createdBy:    makePerformedBy(getCurrentActor()),
    createdAt:    now,
  };
  await window.gwWrite('set', 'supplierPrices', id, doc);
  window._pkSupplierPrices = window._pkSupplierPrices || [];
  if (!window._pkSupplierPrices.some(p => p.id === id)) window._pkSupplierPrices.push(doc);
  _notifyChanged();
  return doc;
}

// Same supplier + same price → just refresh the timestamp on the
// existing doc (no new price log), per the "log only on change" rule.
export async function refreshSupplierPriceTimestamp(priceId, extra = {}) {
  const existing = (window._pkSupplierPrices || []).find(p => p.id === priceId);
  if (!existing) throw new Error('[suppliers] refreshSupplierPriceTimestamp: not found ' + priceId);
  const now = Date.now();
  const merged = {
    ...existing,
    lastRestockAt: now,
    // qtyAdded accumulates the units bought on this same-price restock so
    // the doc still reflects total purchased at this price point.
    qtyAdded: (Number(existing.qtyAdded) || 0) + (Number(extra.qtyAdded) || 0),
  };
  await window.gwWrite('set', 'supplierPrices', priceId, merged);
  const idx = (window._pkSupplierPrices || []).findIndex(p => p.id === priceId);
  if (idx >= 0) window._pkSupplierPrices[idx] = merged;
  _notifyChanged();
  return merged;
}

// Expose for non-module callers / DevTools.
window.suppliersStore = {
  getSuppliers, getSupplier, getActiveSuppliers,
  getSupplierPricesForItem, getLatestPriceForItem, getLastRestockInfo,
  createSupplier, updateSupplier, createSupplierPrice, refreshSupplierPriceTimestamp,
};
