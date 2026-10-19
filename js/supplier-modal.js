// ============================================================
//  supplier-modal.js — D.9.1 supplier add modal + D.9.3 edit mode
//
//  Reused by (a) the Restock drawer "＋ New supplier…" option,
//  (b) the "＋ New supplier" button in the Suppliers Directory, and
//  (c) the per-card ✎ Edit action in the Suppliers Directory.
//  Piggybacks the existing .overlay/.modal styles (css/main.css).
//
//  Permission split (D.9.3, per founder):
//    • Add new supplier  → owner / admin / manager
//    • Edit existing     → owner / admin only (manager is read-only on edits)
//    • Cashier           → no access
//  Mirrored in firestore.rules (supplier create now allows manager;
//  update/delete stays owner/admin). An optional onCreated(supplier)
//  callback lets the caller refresh / auto-select after a save.
// ============================================================

import { openModal, closeModal, toast, setBtnLoading, escapeHtml } from './utils.js';
import { createSupplier, updateSupplier } from './suppliers-store.js';
import { getCurrentActor } from './staff-auth.js';

let _onCreated = null;
let _editId    = null;   // null = add mode; supplier id = edit mode

function _canAdd() {
  const role = getCurrentActor().role;
  return role === 'owner' || role === 'admin' || role === 'manager';
}
function _canEdit() {
  const role = getCurrentActor().role;
  return role === 'owner' || role === 'admin';
}

// opts.supplier        — pass a supplier object to open in EDIT mode
// opts.onCreated(sup)   — called after a successful create/update
export function openSupplierModal(opts = {}) {
  const editing = !!opts.supplier;
  if (editing ? !_canEdit() : !_canAdd()) {
    toast(editing
      ? '⛔ Only the owner or an admin can edit suppliers'
      : '⛔ You do not have permission to add suppliers', 'err');
    return;
  }
  _onCreated = typeof opts.onCreated === 'function' ? opts.onCreated : null;
  _editId    = editing ? opts.supplier.id : null;

  const sup = opts.supplier || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('supEditId',   _editId || '');
  set('supName',     sup.name);
  set('supLocation', sup.location);
  set('supContact',  sup.contact);
  set('supNotes',    sup.notes);

  const title = document.getElementById('supModalTitle');
  if (title) title.textContent = editing ? '✎ Edit Supplier' : '★ New Supplier';
  const saveBtn = document.querySelector('#supplierOverlay .btn-save');
  if (saveBtn) saveBtn.textContent = editing ? 'Save Changes' : 'Save Supplier';

  const err = document.getElementById('supError');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  openModal('supplierOverlay');
  setTimeout(() => document.getElementById('supName')?.focus(), 80);
}

export function closeSupplierModal() {
  _onCreated = null;
  _editId    = null;
  closeModal('supplierOverlay');
}

export async function saveSupplierRecord() {
  const editing = !!_editId;
  if (editing ? !_canEdit() : !_canAdd()) {
    toast(editing
      ? '⛔ Only the owner or an admin can edit suppliers'
      : '⛔ You do not have permission to add suppliers', 'err');
    return;
  }
  const name = document.getElementById('supName')?.value.trim();
  const err  = document.getElementById('supError');
  if (!name) {
    if (err) { err.textContent = 'Supplier name is required.'; err.style.display = 'block'; }
    return;
  }
  const data = {
    name,
    location: document.getElementById('supLocation')?.value || '',
    contact:  document.getElementById('supContact')?.value || '',
    notes:    document.getElementById('supNotes')?.value || '',
  };
  const btn = document.querySelector('#supplierOverlay .btn-save');
  setBtnLoading(btn, true);
  try {
    const supplier = editing
      ? await updateSupplier(_editId, data)
      : await createSupplier(data);
    toast(editing
      ? `✅ Supplier "${escapeHtml(supplier.name)}" updated`
      : `✅ Supplier "${escapeHtml(supplier.name)}" added`, 'ok');
    const cb = _onCreated;
    _onCreated = null;
    _editId    = null;
    closeModal('supplierOverlay');
    if (cb) { try { cb(supplier); } catch (e) { console.error(e); } }
  } catch (e) {
    console.error('[supplier-modal] save failed:', e);
    const msg = (e && /permission/i.test(e.message || e.code || ''))
      ? 'You do not have permission for this change.'
      : 'Could not save supplier. Try again.';
    if (err) { err.textContent = msg; err.style.display = 'block'; }
    toast('⚠️ ' + msg, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

window.openSupplierModal  = openSupplierModal;
window.closeSupplierModal = closeSupplierModal;
