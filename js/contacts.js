// ============================================================
//  contacts.js — Unified Contact Layer (Firestore-backed)
//
//  /shops/{uid}/contacts/{contactId} is the single source of truth.
//  Legacy /customers/ and /borrowers/ arrays are DERIVED from contacts
//  for backward compatibility with code not yet migrated.
//
//  Lifecycle:
//    1. startContactListener(uid) subscribes to /contacts/
//    2. On snapshot: populates _pkContacts, derives _pkWholesale + _pkBorrowers
//    3. Writes go to /contacts/ + dual-write to legacy collections
//    4. If /contacts/ is empty (pre-migration), legacy listeners remain active
// ============================================================

import { db, collection, onSnapshot, query } from './firebase.js';
import { uid as genId, saveLocal, toast } from './utils.js';
import { currentUser, activeUid } from './auth.js';
import { gwWrite } from './write-gateway.js';   // D.8.2b sub-step 1
import { withPending } from './pending-overlay.js';

let _unsubContacts = null;

export function normName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}


// ── Listener ────────────────────────────────────────────────────
export function startContactListener(uid) {
  if (_unsubContacts) { _unsubContacts(); _unsubContacts = null; }
  _unsubContacts = onSnapshot(query(collection(db, 'shops', uid, 'contacts')), snap => {
    const docs = withPending('contacts', snap.docs.map(d => d.data()));
    if (docs.length === 0) return;
    window._pkContacts = docs;
    window._pkContactsActive = true;
    _deriveFromContacts();
    saveLocal();
    window.__PK?.renderBorrowers?.();
    window.__PK?.renderItems?.();
    window.__PK?.populateTradeCustSelect?.();
    window.__PK?.renderDashboard?.();
  });
}

export function stopContactListener() {
  if (_unsubContacts) { _unsubContacts(); _unsubContacts = null; }
}

function _deriveFromContacts() {
  const contacts = window._pkContacts || [];
  window._pkWholesale = contacts
    .filter(c => c.tags?.includes('customer'))
    .map(c => ({ id: c.id, name: c.name, contact: c.phone || '' }));
  window._pkBorrowers = contacts
    .filter(c => c.tags?.includes('borrower'))
    .map(c => ({
      id: c.id, name: c.name, phone: c.phone || '',
      note: c.note || '', transactions: c.transactions || [],
      ...(c.oneRecord ? { oneRecord: c.oneRecord } : {}),
      createdTs: c.createdTs, lastActivityTs: c.lastActivityTs,
    }));
}

// ── Lookups ─────────────────────────────────────────────────────
export function findContact(name) {
  const q = normName(name);
  return (window._pkContacts || []).find(c => normName(c.name) === q) || null;
}

export function findContactById(id) {
  return (window._pkContacts || []).find(c => c.id === id) || null;
}

export function getContactDebt(contact) {
  if (!contact) return 0;
  const txs = contact.transactions || [];
  const debt = txs.filter(t => t.type === 'debt').reduce((s, t) => s + (t.amount || 0), 0);
  const paid = txs.filter(t => t.type === 'payment').reduce((s, t) => s + (t.amount || 0), 0);
  return debt - paid;
}

export function searchContacts(query, tag = null) {
  const q = normName(query);
  return (window._pkContacts || []).filter(c => {
    const matchQ = !q || normName(c.name).includes(q) || (c.phone || '').includes(q);
    const matchT = !tag || c.tags?.includes(tag);
    return matchQ && matchT;
  });
}

export function isContactsActive() {
  return !!window._pkContactsActive;
}

// ── Firestore writes ────────────────────────────────────────────

// D.8.2b sub-step 1 — contact writes ride the write gateway: offline they
// QUEUE (owner-stamped by sub-step 0, retried by the sync engine) instead of
// a direct setDoc that never resolves offline. Real (non-network) failures
// toast + rethrow, matching db.js _setData reporting — no more silent loss.
export async function saveContactDB(uid, contact) {
  try {
    await gwWrite('set', 'contacts', contact.id, contact);
  } catch (err) {
    console.error(`[contacts] Failed to save contacts/${contact.id}:`, err);
    toast('⚠️ Cloud backup failed — change saved locally', 'err');
    throw err;
  }
  mirrorContactLegacy(contact);
}

// BUG-014 — pulled out of saveContactDB so trade-payment.js's
// gwWriteLinked() path (which writes the PRIMARY contacts/ doc itself, as
// part of an atomic batch with the matching sale) can still fire these
// same legacy mirrors afterward. Best-effort/unawaited, exactly as when
// this lived inline in saveContactDB — the mirrors were never part of any
// atomicity guarantee, they're a dual-write-period convenience for legacy
// readers (see BUG_LOG.md — the customers/borrowers → contacts migration
// is still an active dual-write period, not yet cut over).
export function mirrorContactLegacy(contact) {
  if (contact.tags?.includes('customer')) {
    gwWrite('set', 'customers', contact.id,
      { id: contact.id, name: contact.name, contact: contact.phone || '' },
      { merge: true }).catch(err => console.error('[contacts] legacy customer mirror save failed:', err));
  }
  if (contact.tags?.includes('borrower')) {
    gwWrite('set', 'borrowers', contact.id, {
      id: contact.id, name: contact.name, phone: contact.phone || '',
      note: contact.note || '', transactions: contact.transactions || [],
      ...(contact.oneRecord ? { oneRecord: contact.oneRecord } : {}),
      createdTs: contact.createdTs, lastActivityTs: contact.lastActivityTs,
    }, { merge: true }).catch(err => console.error('[contacts] legacy borrower mirror save failed:', err));
  }
}

export async function deleteContactDB(uid, contactId) {
  try {
    await gwWrite('delete', 'contacts', contactId, null);
  } catch (err) {
    console.error(`[contacts] Failed to delete contacts/${contactId}:`, err);
    toast('⚠️ Cloud delete failed — removed locally', 'err');
    throw err;
  }
  gwWrite('delete', 'customers', contactId, null).catch(err => console.error('[contacts] legacy customer mirror delete failed:', err));
  gwWrite('delete', 'borrowers', contactId, null).catch(err => console.error('[contacts] legacy borrower mirror delete failed:', err));
}

// ── In-memory upsert (updates _pkContacts + saves to Firestore) ─
export async function upsertContact({ name, phone = '', tags = [], note = '' }) {
  if (!name?.trim()) return null;
  window._pkContacts = window._pkContacts || [];
  const q = normName(name);
  const idx = window._pkContacts.findIndex(c => normName(c.name) === q);
  let contact;
  if (idx >= 0) {
    contact = window._pkContacts[idx];
    if (phone) contact.phone = phone;
    if (note) contact.note = note;
    tags.forEach(t => { if (!contact.tags.includes(t)) contact.tags.push(t); });
    contact.lastActivityTs = Date.now();
    window._pkContacts[idx] = contact;
  } else {
    contact = { id: genId(), name: name.trim(), phone, tags, note, transactions: [], createdTs: Date.now(), lastActivityTs: Date.now() };
    window._pkContacts.push(contact);
  }
  _deriveFromContacts();
  saveLocal();
  const uid = activeUid();
  if (uid) await saveContactDB(uid, contact);
  return contact;
}

// ── Convert a borrower-shaped object to its contact for saving ──
export function borrowerToContact(borrower) {
  const existing = (window._pkContacts || []).find(c => c.id === borrower.id);
  return {
    ...(existing || {}),
    id: borrower.id,
    name: borrower.name,
    phone: borrower.phone || existing?.phone || '',
    note: borrower.note || existing?.note || '',
    transactions: borrower.transactions || [],
    ...(borrower.oneRecord ? { oneRecord: borrower.oneRecord } : {}),
    tags: existing?.tags || ['borrower'],
    createdTs: borrower.createdTs || existing?.createdTs || Date.now(),
    lastActivityTs: borrower.lastActivityTs || Date.now(),
  };
}

// ── Convert a customer-shaped object to its contact for saving ──
export function customerToContact(customer) {
  const existing = (window._pkContacts || []).find(c => c.id === customer.id);
  return {
    ...(existing || {}),
    id: customer.id,
    name: customer.name,
    phone: customer.contact || existing?.phone || '',
    note: existing?.note || '',
    transactions: existing?.transactions || [],
    tags: existing?.tags || ['customer'],
    createdTs: existing?.createdTs || Date.now(),
    lastActivityTs: existing?.lastActivityTs || Date.now(),
  };
}

// ── Init (called on app load) ───────────────────────────────────
export function initContacts() {
  window._pkContacts = window._pkContacts || [];
  window._pkContactsActive = false;
}

// db.js calls this on startup when saves are still waiting to be sent, so a
// contact changed offline stays on screen after the app is reopened.
window.__pkReapplyPendingContacts = function () {
  if (!(window._pkContacts || []).length) return;
  window._pkContacts = withPending('contacts', window._pkContacts);
  _deriveFromContacts();
};
