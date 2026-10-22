// ============================================================
//  auth.js — Google Authentication + Sync Bar UI (UPDATED)
//  - startBorrowerListener now called with shops/ path awareness
//  - __authState exposed for db.js _isOwnerUid check
//  - Anonymous (staff) users dispatched to staff-auth.js
//  - authReady promise resolves on first auth-state callback (BUG-003)
// ============================================================

import { auth, provider, signInWithPopup, signOut, onAuthStateChanged } from './firebase.js';
import { startListeners, stopListeners, rescueLocalToFirestore } from './db.js';
import { safe, saveLocal, toast } from './utils.js';
import { normalizeSales } from './sale-derive.js';
import { renderItems, updateSummary } from './inventory.js';
import { renderReports } from './reports.js';
import { renderWholesale } from './wholesale.js';
import { startBorrowerListener, stopBorrowerListener } from './borrowers.js';
import {
  loadStaffSessionFromFirestore,
  clearStaffSessionState,
  applyStaffMode,
  loadOwnerDataForStaff,
  isStaffLoginInProgress,
} from './staff-auth.js';

export let currentUser = null;
export function activeUid() { return window._staffOwnerUid || currentUser?.uid || null; }
let _previousUid = localStorage.getItem('pkLastUid') || null;

// Expose auth state globally so db.js can check if owner is logged in
window.__authState = { currentUser: null };

// Resolves on first onAuthStateChanged callback — app.js awaits this before
// lifting the splash so no owner-mode UI flashes for staff on reload (BUG-003).
let _authReadyResolve;
let _authReadyResolved = false;
export const authReady = new Promise(r => { _authReadyResolve = r; });

export async function signIn() {
  const lbl = document.getElementById('authLabel');
  const btn = document.querySelector('.pk-auth-btn, .auth-btn');
  if (btn) btn.disabled = true;
  if (lbl) lbl.textContent = 'Signing in...';
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('[auth] Google sign-in failed:', e?.code || e, e?.message || '');
    const messages = {
      'auth/popup-blocked': 'Allow pop-ups for this site, then try Google sign-in again',
      'auth/popup-closed-by-user': 'Google sign-in was cancelled',
      'auth/unauthorized-domain': 'This site is not authorized in Firebase Authentication -> Settings -> Authorized domains',
      'auth/operation-not-allowed': 'Google sign-in is disabled in Firebase Authentication -> Sign-in method',
      'auth/network-request-failed': 'Google sign-in could not reach Firebase — check your connection',
      'auth/cancelled-popup-request': 'Another Google sign-in window is already open',
    };
    toast(`⚠️ ${messages[e?.code] || 'Google sign-in failed — check the browser console for details'}`, 'err');
    if (lbl) lbl.textContent = 'Sign in with Google';
    if (btn) btn.disabled = false;
  }
}

export async function signOut_() {
  stopListeners();
  if (typeof stopBorrowerListener === 'function') stopBorrowerListener();
  await signOut(auth);
  _previousUid = null;
  localStorage.removeItem('pkLastUid');
  window.__authState.currentUser = null;

  window._pkItems     = safe('pkItems');
  window._pkWholesale = safe('pkWholesale');
  window._pkSales     = normalizeSales(safe('pkSales'));
  window._pkBorrowers = safe('pkBorrowers');
  window._pkContacts  = safe('pkContacts');
  window._pkContactsActive = false;

  updateAuthUI(null);
  renderItems();
  updateSummary();
  renderWholesale();
  renderReports();
  window._pkExpenses = safe('pkExpenses');
}

export function handleAuth() {
  if (currentUser) signOut_();
  else signIn();
}

export function updateAuthUI(user) {
  currentUser = user;
  window.__authState.currentUser = user;
  const av     = document.getElementById('userAvatar');
  const lbl    = document.getElementById('authLabel');
  const circle = document.getElementById('userAvatarCircle');
  const tag    = document.getElementById('authRoleTag');
  const btn    = document.querySelector('.pk-auth-btn, .auth-btn');
  const wrap   = document.getElementById('authBtn');
  if (btn) btn.disabled = false;
  if (user) {
    // Owner = admin tier → gold avatar + OWNER role tag.
    const name = user.displayName || user.email || 'Owner';
    const initial = (name.trim()[0] || 'O').toUpperCase();
    if (lbl) lbl.textContent = name.split(' ')[0] || 'Owner';
    if (tag) { tag.textContent = 'OWNER'; tag.style.display = 'inline-block'; }
    if (wrap) wrap.setAttribute('data-role', 'owner');
    if (circle) {
      circle.textContent = initial;
      circle.style.display = 'inline-flex';
    }
    if (av) {
      av.src = user.photoURL || '';
      av.style.display = user.photoURL ? 'inline-block' : 'none';
    }
  } else {
    if (lbl) lbl.textContent = 'Sign in';
    if (tag) { tag.textContent = ''; tag.style.display = 'none'; }
    if (wrap) wrap.setAttribute('data-role', '');
    if (circle) { circle.textContent = ''; circle.style.display = 'none'; }
    if (av) av.style.display = 'none';
  }
  // Privacy toggle is owner-only and meaningless signed out — show it only when
  // signed in. (Staff sessions are handled in applyStaffMode; the cost-blind CSS
  // rule there still hides it for manager/cashier.)
  const priv = document.getElementById('pkPrivacyToggle');
  if (priv) priv.style.display = user ? '' : 'none';
  // Staff Login button: hidden while an owner is signed in, shown otherwise.
  // The active-staff-session case is handled separately by applyStaffMode().
  const slBtn = document.getElementById('staffLoginBtn');
  if (slBtn) slBtn.style.display = user ? 'none' : '';
  updateSyncBar(navigator.onLine);
}

export function updateSyncBar(online) {
  if (window._pkForceOffline) online = false;   // offline-switch.js test switch
  let msg, cls;
  if (!currentUser) {
    msg = 'Not signed in — data saved locally only';
    cls = '';
  } else if (!online) {
    msg = '⚡ Offline — changes saved locally, will sync when back online';
    cls = 'offline';
  } else {
    msg = '☁️ Synced to Google — ' + (currentUser.displayName || currentUser.email);
    cls = 'online';
  }
  ['sd1','sd2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'sync-dot';
    if (cls) el.classList.add(cls);
  });
  ['sl1','sl2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  });
}

// Clear the redundant per-owner localStorage mirror + in-memory arrays when a
// DIFFERENT Google owner signs in on the same browser. The pk* mirror is a
// convenience copy only — Firestore + the SDK's persistent cache are
// authoritative, so clearing loses nothing: the new owner's snapshot listeners
// repopulate from their own shop. Zeroing the window._pk* arrays too prevents a
// flash of the previous owner's data before the first snapshot lands.
//
// Scope is deliberate: data keys + shop-identity keys only. Device-level prefs
// (pkTheme, pkPrivacyMode, pkOnboardingDone), auth (pkLastUid) and staff keys
// (pkBizCode_*, pkOwnerName) are kept. The offline pendingWrites queue
// (IndexedDB) is NOT touched here — it is owner-safe on its own since D.8.2b
// sub-step 0: entries are ownerUid-stamped and the sync-engine drain parks
// foreign-owner entries until their owner signs back in.
function clearOwnerLocalMirror() {
  const keys = [
    'pkItems', 'pkWholesale', 'pkSales', 'pkBorrowers', 'pkExpenses', 'pkContacts',
    'pkAppName', 'pkShopProfile', 'pkMarkup', 'pkSettings',
  ];
  keys.forEach(k => localStorage.removeItem(k));
  window._pkItems       = [];
  window._pkWholesale   = [];
  window._pkSales       = [];
  window._pkBorrowers   = [];
  window._pkExpenses    = [];
  window._pkContacts    = [];
  window._pkContactsActive = false;
}

export function initAuth() {
  window.addEventListener('online',  () => updateSyncBar(true));
  window.addEventListener('offline', () => updateSyncBar(false));

  onAuthStateChanged(auth, async user => {
    try {
      if (user && user.isAnonymous) {
        // Staff path. Do NOT call updateAuthUI(user) — `currentUser` must stay
        // null so other modules don't treat the anon UID as the owner's UID.
        if (isStaffLoginInProgress()) {
          // staffLogin() is mid-flight: it signed in anonymously, will write
          // /sessions/{anonUid} momentarily, and renders itself on success.
          // Don't race ahead and force-logout an orphan that isn't orphaned yet.
          console.log('[auth] anon user appeared during staffLogin — yielding');
          updateSyncBar(navigator.onLine);
        } else {
          const result = await loadStaffSessionFromFirestore(user.uid);
          if (result.ok) {
            // BUG-005: set perms BEFORE loading owner data — loadOwnerDataForStaff
            // registers onSnapshot listeners that can render before perms exist,
            // re-opening the race that let staff void/delete with no role check.
            applyStaffMode();
            await loadOwnerDataForStaff(result.session.ownerUid);
            window.__PK?.renderItems?.();
            window.__PK?.updateSummary?.();
            window.__PK?.initTradeTab?.();
            window._pkSignedIn = true;          // staff session = signed in
            localStorage.removeItem('pkWasSignedOut');
            window.syncEngine?.refreshBanner?.();
          } else if (result.reason === 'permission-denied' || result.reason === 'not-found') {
            console.warn('[auth] anon user without valid /sessions doc — forcing re-login');
            clearStaffSessionState();
            await signOut(auth).catch(e => console.error('[auth] orphan signOut failed:', e));
          } else {
            toast('⚠️ Reconnecting to your shop...', 'err');
          }
          updateSyncBar(navigator.onLine);
        }

      } else if (user) {
        // Owner path (Google).
        updateAuthUI(user);
        window._pkSignedIn = true;
        window.syncEngine?.refreshBanner?.();

        const prevUid      = _previousUid;
        const isNewLogin   = prevUid !== user.uid;
        const ownerChanged = !!prevUid && prevUid !== user.uid;
        _previousUid = user.uid;
        localStorage.setItem('pkLastUid', user.uid);

        // A DIFFERENT Google owner is signing in on this browser: the pk* mirror
        // belongs to the PREVIOUS owner. Clear it BEFORE merge/listeners run so a
        // prior owner's local data can neither merge into nor flash under the new
        // owner's shop.
        if (ownerChanged) clearOwnerLocalMirror();

        // Rescue local-only records BEFORE the snapshot listeners overwrite
        // local state. Covers BOTH genuine first-ever onboarding AND the
        // signed-back-in-after-the-session-expired case — the June-8 data loss:
        // same owner (so isNewLogin is false), but the local cache held trades
        // that never reached the cloud. SAME OWNER ONLY — a different owner's
        // data must never merge in (ownerChanged already cleared the mirror).
        // rescueLocalToFirestore uploads only ids absent from the cloud, so it
        // never duplicates, resurrects a deleted doc, or clobbers a cloud edit.
        const wasSignedOut = localStorage.getItem('pkWasSignedOut') === '1';
        if (!ownerChanged && (isNewLogin || wasSignedOut)) {
          const locals = {
            items:     safe('pkItems'),
            customers: safe('pkWholesale'),
            sales:     safe('pkSales'),
            borrowers: safe('pkBorrowers'),
            expenses:  safe('pkExpenses'),
            contacts:  safe('pkContacts'),
          };
          if (Object.values(locals).some(a => a.length > 0)) {
            ['sl1','sl2'].forEach(id => {
              const el = document.getElementById(id);
              if (el) el.textContent = '⏳ Saving your local data to the cloud...';
            });
            try {
              const rescued = await rescueLocalToFirestore(user.uid, locals);
              const n = Object.values(rescued).reduce((a, b) => a + b, 0);
              if (n > 0) toast(`✅ Recovered ${n} unsynced record${n !== 1 ? 's' : ''} to your account`, 'ok');
            } catch (err) {
              console.error('[auth] rescue merge failed:', err);
              toast('⚠️ Some data couldn\'t sync — saved on this device. Try again when you have a stable connection', 'err');
            }
          }
        }
        localStorage.removeItem('pkWasSignedOut');

        // Start listeners — both watch shops/ so owner sees staff changes live
        startListeners(user.uid);
        if (typeof startBorrowerListener === 'function') startBorrowerListener(user.uid);

        renderItems();
        updateSummary();
        renderWholesale();
        renderReports();

        // D.3.2b: every new sign-in lands on Dashboard. Existing sessions
        // (reload of an already-authed tab) stay on whatever tab is active.
        if (isNewLogin && typeof window.switchTab === 'function') {
          window.switchTab('dashboard');
        }

        updateSyncBar(navigator.onLine);

      } else {
        // Signed out. Flag it so the next sign-in RESCUES any trades rung in
        // this logged-out window before the cloud snapshot overwrites them,
        // and raise the loud "not signed in" banner so sales are blocked.
        updateAuthUI(null);
        stopListeners();
        if (typeof stopBorrowerListener === 'function') stopBorrowerListener();
        window._pkSignedIn = false;
        localStorage.setItem('pkWasSignedOut', '1');
        window.syncEngine?.refreshBanner?.();
        updateSyncBar(navigator.onLine);
      }
    } catch (err) {
      console.error('[auth] onAuthStateChanged handler error:', err);
    } finally {
      if (!_authReadyResolved) {
        _authReadyResolved = true;
        _authReadyResolve();
      }
    }
  });
}