// ============================================================
//  staff-auth.js — Staff account system  (OPTION B: anonymous Auth + /sessions/)
//
//  Truth model:
//  - /sessions/{anonUid} doc = source of truth for {role, ownerUid, ...}
//  - sessionStorage only stores {sessionId, schemaVersion} as a hint
//  - In-memory `_currentStaffSession` mirrors /sessions/, populated on auth-state
//    change by loadStaffSessionFromFirestore() (called from auth.js)
// ============================================================

import {
  db, auth,
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, addDoc,
  onSnapshot, query, where, serverTimestamp,
  signInAnonymously, signOut as fbSignOut,
} from './firebase.js';
import { toast, saveLocal, today } from './utils.js';
import { currentUser }   from './auth.js';
import { normalizeSales } from './sale-derive.js';

const SESSION_KEY            = 'pkStaffSession';
const SESSION_SCHEMA_VERSION = 2;

// ── Legacy session detection — old format stored role/ownerUid directly.
// Wipe it so the user is forced to re-login under Option B. Runs at module load.
(function _migrateLegacySession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || s.schemaVersion !== SESSION_SCHEMA_VERSION) {
      console.log('[auth] legacy staff session detected — clearing, will require re-login');
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
  }
})();

// In-memory mirror of /sessions/{anonUid}. Null until loaded.
let _currentStaffSession = null;

// True while staffLogin() is mid-flight (between signInAnonymously and the
// /sessions/{anonUid} write). auth.js's onAuthStateChanged checks this so it
// doesn't race ahead and try to load a /sessions/ doc that doesn't exist yet.
let _staffLoginInProgress = false;
export function isStaffLoginInProgress() { return _staffLoginInProgress; }

// ── Hash PIN — PBKDF2 with per-user random salt ──────────────
function _hexEncode(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPinPBKDF2(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return _hexEncode(bits);
}

function generateSalt() {
  return _hexEncode(crypto.getRandomValues(new Uint8Array(32)));
}

// Legacy hash for migration detection
async function hashPinLegacy(pin) {
  const encoded = new TextEncoder().encode(pin + 'pkStaffSalt2026');
  const buffer  = await crypto.subtle.digest('SHA-256', encoded);
  return _hexEncode(buffer);
}

// Unified hash: uses PBKDF2 if salt exists, falls back to legacy
export { hashPinPBKDF2, generateSalt };
async function hashPin(pin, salt) {
  if (salt) return hashPinPBKDF2(pin, salt);
  return hashPinLegacy(pin);
}

// ── Active session accessors ─────────────────────────────────
export function getStaffSession()  { return _currentStaffSession; }
export function isStaffMode()      { return !!_currentStaffSession; }
export function getStaffOwnerUid() { return _currentStaffSession?.ownerUid || null; }

// ── Load /sessions/{anonUid} into _currentStaffSession ───────
// Called from auth.js onAuthStateChanged when an anonymous user is seen.
// Returns one of:
//   { ok: true,  session }
//   { ok: false, reason: 'permission-denied' | 'not-found' | 'network' }
// 'permission-denied' or 'not-found' → caller should force logout.
// 'network' → caller should keep auth alive and show "Reconnecting..." UI.
export async function loadStaffSessionFromFirestore(anonUid) {
  const ref = doc(db, 'sessions', anonUid);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        _currentStaffSession = null;
        return { ok: false, reason: 'not-found' };
      }
      _currentStaffSession = { sessionId: anonUid, ...snap.data() };
      console.log('[auth] session loaded: role=' + _currentStaffSession.role
                + ', ownerUid=' + _currentStaffSession.ownerUid
                + (attempt > 1 ? ' (retry)' : ''));
      return { ok: true, session: _currentStaffSession };
    } catch (err) {
      if (err?.code === 'permission-denied') {
        console.warn('[auth] /sessions/' + anonUid + ' permission denied');
        _currentStaffSession = null;
        return { ok: false, reason: 'permission-denied' };
      }
      if (attempt === 1) {
        console.warn('[auth] /sessions fetch failed (network?), retrying once...', err);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        console.error('[auth] /sessions fetch failed after retry — staying signed in', err);
        _currentStaffSession = null;
        return { ok: false, reason: 'network' };
      }
    }
  }
  // unreachable
  return { ok: false, reason: 'network' };
}

// ── Clear in-memory + sessionStorage state ───────────────────
export function clearStaffSessionState() {
  _currentStaffSession = null;
  sessionStorage.removeItem(SESSION_KEY);
}

// ── Who is performing the current action? ────────────────────
export function getCurrentActor() {
  if (_currentStaffSession) {
    return {
      username:    _currentStaffSession.staffUsername,
      displayName: _currentStaffSession.displayName,
      role:        _currentStaffSession.role || 'cashier',
      isOwner:     false,
    };
  }
  if (currentUser) {
    return {
      username:    currentUser.uid,
      displayName: localStorage.getItem('pkOwnerName') || 'Owner',
      role:        'owner',
      isOwner:     true,
    };
  }
  return { username: 'unknown', displayName: 'Unknown', role: 'unknown', isOwner: false };
}

// ── Canonical performedBy shape for activity log + tx records ─
// Strips `isOwner` (internal-only) and provides defaults so callers
// don't have to null-check. Phase C.3 single source of truth.
export function makePerformedBy(actor) {
  return {
    username:    actor?.username    || 'owner',
    displayName: actor?.displayName || 'Owner',
    role:        actor?.role        || 'owner',
  };
}

// ── Log an activity ──────────────────────────────────────────
export async function logActivity(action, details = {}) {
  try {
    const actor    = getCurrentActor();
    const ownerUid = actor.isOwner ? currentUser?.uid : getStaffOwnerUid();
    if (!ownerUid) return;

    const entry = {
      action,
      details,
      performedBy: makePerformedBy(actor),
      timestamp: Date.now(),
      date:      today(),
    };

    // Not awaited: with no internet the database only confirms once back
    // online, so waiting here froze whatever called it (removing a payment,
    // logging out). The entry is kept on the phone and sent later.
    addDoc(collection(db, 'shops', ownerUid, 'activityLog'), entry)
      .catch(err => console.warn('Activity log failed (non-critical):', err));
  } catch (err) {
    console.warn('Activity log failed (non-critical):', err);
  }
}

// ── Generate business code ───────────────────────────────────
// F8 hardening: used to trust localStorage alone — clearing site data or
// switching device/browser meant this silently minted a SECOND code for
// the same shop (both stay valid forever, and Settings/staff could end up
// pointing at different codes). Now checks Firestore for an existing code
// owned by this uid first (a scoped query the rules can statically verify
// only returns the caller's own docs — see firestore.rules /businesses
// `allow list`), and only mints a new one if genuinely none exists yet.
export async function getOrCreateBusinessCode(ownerUid) {
  const key = 'pkBizCode_' + ownerUid;
  let code = localStorage.getItem(key);
  if (code) return code;

  if (db) {
    try {
      const existing = await getDocs(query(collection(db, 'businesses'), where('ownerUid', '==', ownerUid)));
      if (!existing.empty) {
        code = existing.docs[0].data().code || existing.docs[0].id;
        localStorage.setItem(key, code);
        return code;
      }
    } catch (e) {
      console.warn('[staff-auth] Existing business code lookup failed, falling back to local cache:', e);
    }
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = crypto.getRandomValues(new Uint8Array(6));
  code = Array.from(randomBytes, b => chars[b % chars.length]).join('');
  localStorage.setItem(key, code);
  if (db) {
    await setDoc(doc(db, 'businesses', code), {
      ownerUid, code, createdAt: Date.now()
    }).catch(e => { console.error('[staff-auth] Failed to save business code:', e); toast('⚠️ Business code created locally but cloud save failed', 'err'); });
  }
  return code;
}

// ── Set a custom business code (FEATURE-002) ──────────────────
// Validates format + uniqueness, swaps the /businesses/ index, and
// updates the local cache. Throws on validation/conflict so the caller
// can surface a user-friendly message.
const BIZ_CODE_RE = /^[A-Z0-9]{4,12}$/;

export async function setCustomBusinessCode(ownerUid, rawNewCode) {
  if (!ownerUid) throw new Error('Sign in first');
  const newCode = String(rawNewCode || '').trim().toUpperCase();
  if (!BIZ_CODE_RE.test(newCode)) {
    throw new Error('Code must be 4–12 letters or digits (A–Z, 0–9)');
  }
  const oldCode = (localStorage.getItem('pkBizCode_' + ownerUid) || '').toUpperCase();
  if (newCode === oldCode) return newCode; // no-op

  // Uniqueness check
  const newRef = doc(db, 'businesses', newCode);
  const newSnap = await getDoc(newRef);
  if (newSnap.exists() && newSnap.data().ownerUid !== ownerUid) {
    throw new Error('That code is taken — try another');
  }

  // Claim the new code first so we don't end up with no working code
  await setDoc(newRef, { ownerUid, code: newCode, createdAt: Date.now(), custom: true });

  // Best-effort remove the old code so staff can't use it anymore
  if (oldCode) {
    await deleteDoc(doc(db, 'businesses', oldCode)).catch(e =>
      console.warn('[staff-auth] Could not delete old business code', oldCode, ':', e?.code || e?.message),
    );
  }

  localStorage.setItem('pkBizCode_' + ownerUid, newCode);
  return newCode;
}

// ── Rate limiting constants ──────────────────────────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 60 * 1000; // 60 seconds

// ── Remembered business code (D.3.x login UX) ────────────────
// Usernames are namespaced per shop (/shops/{ownerUid}/staff/{username}),
// so the business code is what resolves which shop to look in — it can't
// be dropped without a global username index (risky once more than one
// shop exists). Instead we cache the last-used code per device so repeat
// logins only ask for username + PIN; the code field reappears via
// "change" if the device is ever used for a different shop.
const REMEMBERED_BIZ_KEY = 'pkLastBizCode';

export function getRememberedBizCode() {
  try { return localStorage.getItem(REMEMBERED_BIZ_KEY) || ''; }
  catch (_) { return ''; }
}

function _rememberBizCode(code) {
  try { localStorage.setItem(REMEMBERED_BIZ_KEY, code); }
  catch (_) { /* localStorage unavailable — non-critical, just re-asks next time */ }
}

// ── Staff Login (Option B, revised — sign in BEFORE Firestore reads) ──
// Flow:
//   1. signInAnonymously() — every subsequent read/write runs under
//      request.auth != null, satisfying the tightened Firestore rules
//   2. Resolve businessCode → ownerUid via /businesses/{code}
//   3. Verify PIN against /shops/{ownerUid}/staff/{username}
//   4. Write /sessions/{anonUid} doc with serverTimestamp createdAt
//   5. Populate _currentStaffSession + sessionStorage hint
// On any failure after step 1, _cleanupAnon() signs out the anon user so it
// doesn't linger in auth state.
export async function staffLogin(businessCode, username, pin) {
  if (!businessCode || !username || !pin)
    return { ok: false, error: 'All fields are required' };

  _staffLoginInProgress = true;
  let anonUid = null;

  try {
    // Step 1: sign in anonymously FIRST.
    let cred;
    try {
      cred = await signInAnonymously(auth);
    } catch (err) {
      console.error('[auth] signInAnonymously failed:', err);
      _staffLoginInProgress = false;
      return { ok: false, error: 'Could not connect to authentication service. Check your connection.' };
    }
    anonUid = cred.user.uid;
    console.log('[auth] anon uid=' + anonUid + ' (pre-PIN-verify)');

    // Force token propagation before the first rule-gated Firestore read.
    // Without this the Firestore SDK can fire getDoc() before its internal
    // auth-state listener picks up the freshly-minted anon token, sending
    // the request with request.auth == null and getting rejected by the
    // `allow read: if request.auth != null` rule. See firebase-js-sdk #5193.
    try {
      await cred.user.getIdToken(true);
    } catch (err) {
      console.error('[auth] getIdToken refresh failed:', err);
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      return { ok: false, error: 'Could not establish session. Check your connection.' };
    }

    // Step 2: businessCode → ownerUid
    const bizSnap = await getDoc(doc(db, 'businesses', businessCode.toUpperCase()));
    if (!bizSnap.exists()) {
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      return { ok: false, error: 'Invalid business code' };
    }
    const { ownerUid } = bizSnap.data();

    // Step 3a: staff record (now authenticated, passes chicken-and-egg rule)
    const staffRef  = doc(db, 'shops', ownerUid, 'staff', username.toLowerCase().trim());
    const staffSnap = await getDoc(staffRef);
    if (!staffSnap.exists()) {
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      return { ok: false, error: 'Invalid username' };
    }
    const staff = staffSnap.data();

    // Step 3b: rate-limit check
    if (staff.lockedUntil && Date.now() < staff.lockedUntil) {
      const secsLeft = Math.ceil((staff.lockedUntil - Date.now()) / 1000);
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      return { ok: false, error: `Account locked. Try again in ${secsLeft}s` };
    }

    // Step 3c: PIN check
    const hashed = await hashPin(pin, staff.pinSalt || null);
    if (hashed !== staff.pinHash) {
      const attempts   = (staff.failedAttempts || 0) + 1;
      const lockFields = attempts >= MAX_ATTEMPTS
        ? { failedAttempts: attempts, lockedUntil: Date.now() + LOCKOUT_MS }
        : { failedAttempts: attempts };
      // Bump the rate-limit counter while still authenticated.
      await setDoc(staffRef, lockFields, { merge: true })
        .catch(e => console.warn('[auth] failed-attempt write failed (non-critical):', e));
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      if (attempts >= MAX_ATTEMPTS) {
        return { ok: false, error: `Too many attempts. Locked for 60 seconds` };
      }
      return { ok: false, error: `Wrong PIN (${MAX_ATTEMPTS - attempts} attempts left)` };
    }
    if (staff.revoked) {
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      return { ok: false, error: 'This account has been disabled' };
    }

    // Step 4: write /sessions/{anonUid}. Failure here leaves a half-state
    // (signed in, no session doc), so we explicitly clean up the anon user.
    const sessionPayload = {
      role:           staff.role || 'cashier',
      ownerUid,
      staffUsername:  staff.username,
      displayName:    staff.displayName || staff.username,
      businessCode:   businessCode.toUpperCase(),
      createdAt:      serverTimestamp(),
      // FEATURE-003: snapshot per-staff permission overrides into the session
      // so the resolver can layer them over role-effective perms without an
      // extra Firestore read per action.
      permissions:    staff.permissions || null,
    };
    try {
      await setDoc(doc(db, 'sessions', anonUid), sessionPayload);
    } catch (err) {
      console.error('[auth] /sessions write failed:', err);
      await _cleanupAnon(anonUid);
      _staffLoginInProgress = false;
      return { ok: false, error: 'Could not save session. Check your connection.' };
    }

    // Step 3d (moved here, F3): failed-attempt counter reset. Used to run
    // before the session doc existed (same chicken-and-egg gap the bump
    // write had, BUG-012), which meant the pre-session rules branch had to
    // accept an unconditional reset-to-0 with no way to verify it followed
    // a real correct PIN — an attacker with direct Firestore/SDK access
    // could bump-then-reset in a loop and the lockout would never engage.
    // Now runs after Step 4, so staffSession(uid) is true and this lands on
    // the existing rule branch that already allows failedAttempts/lockedUntil
    // for a session member (same shape as the pinHash/pinSalt branch below).
    // The pre-session rules branch now only ever allows the +1 bump.
    if (staff.failedAttempts) {
      await setDoc(staffRef, { failedAttempts: 0, lockedUntil: null }, { merge: true }).catch(() => {});
    }

    // Step 3e (moved here, BUG-012): transparent legacy → PBKDF2 hash
    // migration. Used to run before the session doc existed, so the
    // pinHash/pinSalt write always failed the staffSession() rule check
    // (same chicken-and-egg gap the failedAttempts counter had) and legacy
    // accounts silently never upgraded off the older hash. Now runs after
    // Step 4, so staffSession(uid) is true and this lands on the existing
    // rule branch that already allows pinHash/pinSalt for a session member.
    if (!staff.pinSalt) {
      const newSalt = generateSalt();
      const newHash = await hashPinPBKDF2(pin, newSalt);
      await setDoc(staffRef, { pinHash: newHash, pinSalt: newSalt }, { merge: true }).catch(() => {});
      const usersRef = doc(db, 'users', ownerUid, 'staff', username.toLowerCase().trim());
      await setDoc(usersRef, { pinHash: newHash, pinSalt: newSalt }, { merge: true }).catch(() => {});
    }

    // Step 5: local state.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      sessionId:     anonUid,
      schemaVersion: SESSION_SCHEMA_VERSION,
    }));
    _currentStaffSession = { sessionId: anonUid, ...sessionPayload };
    console.log('[auth] staff session created: role=' + sessionPayload.role
              + ', ownerUid=' + ownerUid);
    _rememberBizCode(businessCode.toUpperCase());

    await logActivity('LOGIN', { username: staff.username });

    _staffLoginInProgress = false;
    return { ok: true, session: _currentStaffSession };

  } catch (err) {
    console.error('[auth] Staff login unexpected error:', err);
    if (anonUid) await _cleanupAnon(anonUid);
    _staffLoginInProgress = false;
    return { ok: false, error: 'Login failed. Check your connection.' };
  }
}

// Sign out the anonymous user that was created for an aborted login.
// Best-effort — failures here are logged but don't override the real error.
async function _cleanupAnon(anonUid) {
  try {
    await fbSignOut(auth);
    console.log('[auth] aborted login — anon user ' + anonUid + ' signed out');
  } catch (err) {
    console.warn('[auth] cleanup signOut failed:', err);
  }
}

// ── Staff Logout — robust: continue cleanup even if /sessions delete fails ──
// TODO(Phase G): implement server-side TTL on /sessions/{uid} so stuck session
// docs (network failure during logout) get cleaned up automatically.
export async function staffLogout() {
  const hint      = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  const sessionId = _currentStaffSession?.sessionId || hint?.sessionId || auth.currentUser?.uid;

  try { await logActivity('LOGOUT', {}); }
  catch (e) { console.warn('[auth] logout activity log failed (non-critical):', e); }

  if (sessionId) {
    try {
      // Offline the delete never confirms, which froze sign-out. Wait at most
      // a few seconds; Phase G TTL cleans up a session left behind.
      await Promise.race([
        deleteDoc(doc(db, 'sessions', sessionId)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('offline, not confirmed')), 4000)),
      ]);
      console.log('[auth] /sessions/' + sessionId + ' deleted');
    } catch (err) {
      console.warn('[auth] /sessions delete failed — Phase G TTL will clean up:', err);
    }
  }

  stopStaffListeners();
  clearStaffSessionState();

  // Clear shop data from memory + localStorage so the next person on this
  // device can't see the previous staff member's shop.
  window._pkItems       = [];
  window._pkSales       = [];
  window._pkWholesale   = [];
  window._pkBorrowers   = [];
  window._pkExpenses    = [];
  window._pkContacts    = [];
  window._pkContactsActive = false;
  window._staffOwnerUid = null;
  window._staffPerms    = null;
  localStorage.removeItem('pkItems');
  localStorage.removeItem('pkSales');
  localStorage.removeItem('pkWholesale');
  localStorage.removeItem('pkBorrowers');
  localStorage.removeItem('pkExpenses');
  localStorage.removeItem('pkContacts');

  try {
    await fbSignOut(auth);
    console.log('[auth] anonymous user signed out');
  } catch (err) {
    console.error('[auth] signOut failed:', err);
  }

  window.location.reload();
}

// ── Staff updates their own PIN (FEATURE-005) ─────────────────
// Verifies currentPin against the stored hash (PBKDF2 or legacy SHA-256),
// then writes a fresh PBKDF2 hash + new salt to /shops/{uid}/staff/{username}.
// Owner-mirror /users/ write is skipped because staff have no permission
// there — the next session's snapshot will pick up the canonical /shops/ doc.
export async function staffChangeOwnPin(currentPin, newPin, confirmPin) {
  const session = _currentStaffSession;
  if (!session) return { ok: false, error: 'Not signed in' };
  if (!currentPin || !newPin || !confirmPin)
    return { ok: false, error: 'All fields required' };
  if (!/^\d{4}$/.test(newPin))
    return { ok: false, error: 'New PIN must be exactly 4 digits' };
  if (newPin !== confirmPin)
    return { ok: false, error: 'New PIN and confirmation do not match' };
  if (newPin === currentPin)
    return { ok: false, error: 'New PIN must be different from current PIN' };

  try {
    const staffRef = doc(db, 'shops', session.ownerUid, 'staff', session.staffUsername);
    const snap     = await getDoc(staffRef);
    if (!snap.exists()) return { ok: false, error: 'Account not found' };

    const staff      = snap.data();
    const currentHashed = await hashPin(currentPin, staff.pinSalt || null);
    if (currentHashed !== staff.pinHash)
      return { ok: false, error: 'Current PIN is incorrect' };

    const newSalt = generateSalt();
    const newHash = await hashPinPBKDF2(newPin, newSalt);
    await setDoc(staffRef, { pinHash: newHash, pinSalt: newSalt }, { merge: true });

    await logActivity('CHANGE_OWN_PIN', { username: session.staffUsername });
    return { ok: true };
  } catch (err) {
    console.error('[auth] staff change own PIN failed:', err);
    return { ok: false, error: 'Could not update PIN — check connection and try again' };
  }
}

// ── Owner resets a staff member's PIN (FEATURE-005) ───────────
// OWNER ROLE ONLY — explicit guard at start. Doesn't require the staff's
// current PIN. Generates a fresh PBKDF2 hash + salt and writes to both
// /shops/ and /users/ (owner has permission to both).
export async function ownerResetStaffPin(staffUsername, newPin) {
  // Hard-gate: must be the Google-authed owner, not any staff session.
  if (_currentStaffSession || !currentUser)
    return { ok: false, error: 'Only the owner can reset a staff PIN' };
  if (!staffUsername) return { ok: false, error: 'Missing staff' };
  if (!/^\d{4}$/.test(newPin))
    return { ok: false, error: 'PIN must be exactly 4 digits' };

  try {
    const shopRef  = doc(db, 'shops', currentUser.uid, 'staff', staffUsername);
    const snap     = await getDoc(shopRef);
    if (!snap.exists()) return { ok: false, error: 'Staff account not found' };

    const newSalt = generateSalt();
    const newHash = await hashPinPBKDF2(newPin, newSalt);
    const usersRef = doc(db, 'users', currentUser.uid, 'staff', staffUsername);
    await Promise.all([
      setDoc(shopRef,  { pinHash: newHash, pinSalt: newSalt, failedAttempts: 0, lockedUntil: null }, { merge: true }),
      setDoc(usersRef, { pinHash: newHash, pinSalt: newSalt, failedAttempts: 0, lockedUntil: null }, { merge: true }),
    ]);

    await logActivity('RESET_STAFF_PIN', { username: staffUsername });
    return { ok: true };
  } catch (err) {
    console.error('[auth] owner reset staff PIN failed:', err);
    return { ok: false, error: 'Could not reset PIN — check connection and try again' };
  }
}

// ── Staff updates their own display name ─────────────────────
export async function staffUpdateDisplayName(newName) {
  const session = _currentStaffSession;
  if (!session) return { ok: false, error: 'Not logged in' };
  if (!newName?.trim()) return { ok: false, error: 'Name cannot be empty' };

  try {
    // Source of record in the shop
    await setDoc(
      doc(db, 'shops', session.ownerUid, 'staff', session.staffUsername),
      { displayName: newName.trim() },
      { merge: true }
    );
    // Live session doc — so the change survives a reload without a staff-table round-trip
    await setDoc(
      doc(db, 'sessions', session.sessionId),
      { displayName: newName.trim() },
      { merge: true }
    );
    _currentStaffSession.displayName = newName.trim();
    const roleLabel = session.role.charAt(0).toUpperCase() + session.role.slice(1);
    const lbl = document.getElementById('staffModeLabel');
    if (lbl) lbl.textContent = `${newName.trim()} · ${roleLabel}`;
    await logActivity('UPDATE_DISPLAY_NAME', { newName: newName.trim() });
    return { ok: true };
  } catch (err) {
    console.error('Update display name error:', err);
    return { ok: false, error: 'Failed to update name' };
  }
}

// ── Role permissions ─────────────────────────────────────────
// cashier  : trade tab only, costs HIDDEN IN UI (Bundle 3, not stripped)
// manager  : trade + inventory, costs HIDDEN IN UI (Bundle 3, not stripped), can void trades
// admin    : everything except account/settings
//
// `tabs` is a hardcoded baseline. `hideCosts` is DEPRECATED (Bundle 3 removed
// the data-strip) — now false for all roles; cost-hiding is UI-only via
// isCostBlindRole. Last remaining reader: business.js dashboard gate (Stage 1).
// `canEdit`, `canVoid`, `canDelete` are owner-toggleable per role via
// /shops/{uid}/settings/staffPerms (FEATURE-001). Missing override fields
// fall back to these defaults.
// Discount fields (D.3.4a · MISSION v1.4):
//   canDiscount  — boolean. false by default for ALL staff roles. Owner
//                  is the only role implicitly granted unlimited discounting
//                  (owners don't have a staff session, see getDiscountPolicy
//                  below). Override per-staff via staff.permissions.canDiscount.
//   maxDiscount  — number | null. null = unlimited (only meaningful when
//                  canDiscount is true). Override per-staff via
//                  staff.permissions.maxDiscount.
// canPayBackDeposit (D.3.5 deposits): may hand a customer their deposit back
// as cash out of the till. Founder decision, 2026-09-24: owner and admin only.
// Owner has no staff session so it never reaches this table. Manager and
// cashier are false, and unlike the flags above it is NOT exposed in the Staff
// Perms UI, so the only way to grant it is to make someone an admin. That is
// deliberate: every other flag changes what someone can record, this one
// changes who can take money out of the drawer.
export const DEFAULT_ROLE_PERMS = {
  // D.3.2b: dashboard is now the primary landing tab for every role.
  // tabs[0] is also the post-signin destination in applyStaffMode().
  cashier: { tabs:['dashboard','trade'],                         hideCosts:false, canVoid:false, canEdit:false, canDelete:false, canDiscount:false, maxDiscount:null, canPayBackDeposit:false },
  manager: { tabs:['dashboard','trade','inventory'],             hideCosts:false, canVoid:true,  canEdit:true,  canDelete:false, canDiscount:false, maxDiscount:null, canPayBackDeposit:false },
  admin:   { tabs:['dashboard','trade','inventory','business'],  hideCosts:false, canVoid:true,  canEdit:true,  canDelete:true,  canDiscount:false, maxDiscount:null, canPayBackDeposit:true  },
};

// Cache populated from /shops/{uid}/settings/staffPerms. Null = no overrides loaded.
let _staffPermsConfig = null;
let _staffPermsUnsub  = null;

export function getStaffPermsConfig() { return _staffPermsConfig; }

export function getEffectiveRolePerms(role) {
  const base = DEFAULT_ROLE_PERMS[role] || DEFAULT_ROLE_PERMS.cashier;
  const ov   = _staffPermsConfig?.[role] || {};
  return {
    ...base,
    canEdit:     typeof ov.canEdit     === 'boolean' ? ov.canEdit     : base.canEdit,
    canVoid:     typeof ov.canVoid     === 'boolean' ? ov.canVoid     : base.canVoid,
    canDelete:   typeof ov.canDelete   === 'boolean' ? ov.canDelete   : base.canDelete,
    // canDiscount / maxDiscount overrides at role level are not exposed
    // in the Staff Perms UI (per-staff makes more sense) — we still
    // honour them if present in /shops/{uid}/settings/staffPerms.
    canDiscount: typeof ov.canDiscount === 'boolean' ? ov.canDiscount : base.canDiscount,
    maxDiscount: ov.maxDiscount === null || typeof ov.maxDiscount === 'number' ? ov.maxDiscount : base.maxDiscount,
  };
}

export async function loadStaffPermsConfig(ownerUid) {
  if (!ownerUid) return null;
  try {
    const ref  = doc(db, 'shops', ownerUid, 'settings', 'staffPerms');
    const snap = await getDoc(ref);
    _staffPermsConfig = snap.exists() ? snap.data() : null;
    return _staffPermsConfig;
  } catch (e) {
    console.warn('[auth] staffPerms config not loaded (falling back to defaults):', e?.code || e?.message);
    _staffPermsConfig = null;
    return null;
  }
}

export async function saveStaffPermsConfig(ownerUid, partial) {
  if (!ownerUid) throw new Error('saveStaffPermsConfig: ownerUid required');
  const ref = doc(db, 'shops', ownerUid, 'settings', 'staffPerms');
  await setDoc(ref, partial, { merge: true });
  _staffPermsConfig = { ...(_staffPermsConfig || {}), ...partial };
}

// FEATURE-003: per-staff override write.
// `permissions` is the full intended state object, e.g.
//   { canEdit: true, canVoid: null, canDelete: false }
// null/missing fields → "use the role default at lookup time".
// Mirrors to both /shops/{uid}/staff/{u} (canonical, read by login) and
// /users/{uid}/staff/{u} (legacy mirror, read by owner UI) to match the
// pattern used by bizAddStaff / bizRevokeStaff / bizDeleteStaff.
export async function saveStaffPermissions(ownerUid, username, permissions) {
  if (!ownerUid || !username) throw new Error('ownerUid + username required');
  const payload = { permissions: permissions || {} };
  await Promise.all([
    setDoc(doc(db, 'shops', ownerUid, 'staff', username), payload, { merge: true }),
    setDoc(doc(db, 'users', ownerUid, 'staff', username), payload, { merge: true }),
  ]);
}

export function subscribeStaffPermsConfig(ownerUid, onChange) {
  if (!ownerUid) return () => {};
  if (_staffPermsUnsub) { _staffPermsUnsub(); _staffPermsUnsub = null; }
  try {
    const ref = doc(db, 'shops', ownerUid, 'settings', 'staffPerms');
    _staffPermsUnsub = onSnapshot(
      ref,
      snap => {
        _staffPermsConfig = snap.exists() ? snap.data() : null;
        if (typeof onChange === 'function') onChange(_staffPermsConfig);
      },
      err => console.warn('[auth] staffPerms listener:', err?.code || err?.message),
    );
  } catch (e) {
    console.warn('[auth] staffPerms listener attach failed:', e?.message);
  }
  return () => { if (_staffPermsUnsub) { _staffPermsUnsub(); _staffPermsUnsub = null; } };
}

// FEATURE-003: per-session/per-staff override layer.
// Merges role-effective perms (FEATURE-001 layer) with the staff doc's
// `permissions` object snapshotted onto the session at login time.
// Per-staff override values: true=allow, false=deny, null/undefined=fall back.
export function getEffectiveSessionPerms(session) {
  const s = session || _currentStaffSession;
  if (!s) return null;
  const rolePerms = getEffectiveRolePerms(s.role);
  const ov = s.permissions || {};
  return {
    ...rolePerms,
    canEdit:     typeof ov.canEdit     === 'boolean' ? ov.canEdit     : rolePerms.canEdit,
    canVoid:     typeof ov.canVoid     === 'boolean' ? ov.canVoid     : rolePerms.canVoid,
    canDelete:   typeof ov.canDelete   === 'boolean' ? ov.canDelete   : rolePerms.canDelete,
    canDiscount: typeof ov.canDiscount === 'boolean' ? ov.canDiscount : rolePerms.canDiscount,
    // null is a meaningful value (= unlimited) so we accept it explicitly.
    maxDiscount: ov.maxDiscount === null || typeof ov.maxDiscount === 'number'
      ? ov.maxDiscount : rolePerms.maxDiscount,
  };
}

// D.3.4a discount policy reader. Returns {canDiscount, maxDiscount}
// resolved from the currently logged-in actor. Owner mode (no staff
// session) defaults to unlimited — Owner is always allowed to discount.
// Staff mode reads from session perms (role default ∘ per-staff override).
export function getDiscountPolicy() {
  if (!_currentStaffSession) return { canDiscount: true, maxDiscount: null };
  const perms = getEffectiveSessionPerms(_currentStaffSession);
  return {
    canDiscount: !!perms?.canDiscount,
    maxDiscount: perms?.maxDiscount ?? null,
  };
}

// D.3.5 deposits. Used to hide the "Pay it back" button rather than let
// someone press it and be refused. assertPermission('payBackDeposit') is
// still the gate on the action itself, since hiding a button is not security.
export function canPayBackDeposit() {
  if (!_currentStaffSession) return true; // owner
  return !!getEffectiveSessionPerms(_currentStaffSession)?.canPayBackDeposit;
}

export function getStaffPermissions() {
  if (!_currentStaffSession) return null;
  return getEffectiveSessionPerms(_currentStaffSession);
}

// ── Permission gate for destructive client-side actions (B2.3) ──
// Returns true if the current actor (owner or staff) can perform `action`.
// Owner always passes. For staff, maps action → ROLE_PERMISSIONS flag.
// Shows a toast on deny so the user understands why nothing happened.
// Server-side Firestore rules remain the real enforcement; this catches
// accidental misuse and DevTools probing.
export function assertPermission(action) {
  if (!_currentStaffSession) return true; // owner
  const perms = getEffectiveSessionPerms(_currentStaffSession);
  let allowed = false;
  switch (action) {
    case 'addItem':
    case 'editItem':    allowed = perms.tabs.includes('inventory'); break;
    case 'deleteItem':  allowed = !!perms.canDelete; break;
    case 'voidSale':    allowed = !!perms.canVoid;   break;
    case 'editSale':    allowed = !!perms.canEdit;   break;
    case 'deleteSale':  allowed = !!perms.canDelete; break;
    case 'deleteBorrower': allowed = !!perms.canDelete; break;
    // Owner never reaches here (no staff session). Admin only, by role.
    case 'payBackDeposit': allowed = !!perms.canPayBackDeposit; break;
    default:
      console.warn('[auth] assertPermission: unknown action:', action);
      allowed = false;
  }
  if (!allowed) toast(`⚠️ Your role cannot perform this action (${action})`, 'err');
  return allowed;
}

export function applyStaffMode() {
  const session = _currentStaffSession;
  if (!session) {
    document.getElementById('staffLoginBtn')?.style &&
      (document.getElementById('staffLoginBtn').style.display = '');
    return;
  }

  const perms     = getEffectiveSessionPerms(session);
  const roleLabel = session.role.charAt(0).toUpperCase() + session.role.slice(1);

  const slBtn = document.getElementById('staffLoginBtn');
  if (slBtn) slBtn.style.display = 'none';

  // D.3.2b: show the user-chip with role-coloured avatar instead of
  // hiding the auth button. Cashier = green avatar; manager/admin = gold.
  // Clicking the chip opens the user-menu dropdown (Sign Out lives
  // there now that #staffModeBar has been removed).
  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    authBtn.style.display = '';
    authBtn.setAttribute('data-role', session.role || 'cashier');
    const lbl    = document.getElementById('authLabel');
    const tag    = document.getElementById('authRoleTag');
    const circle = document.getElementById('userAvatarCircle');
    const av     = document.getElementById('userAvatar');
    const dispName = session.displayName || session.staffUsername || roleLabel;
    if (lbl)    lbl.textContent = dispName.split(' ')[0] || dispName;
    if (tag)    { tag.textContent = (session.role || 'cashier').toUpperCase(); tag.style.display = 'inline-block'; }
    if (circle) { circle.textContent = (dispName.trim()[0] || '?').toUpperCase(); circle.style.display = 'inline-flex'; }
    if (av)     av.style.display = 'none';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const allowed = perms.tabs.some(tab => onclick.includes(tab));
    if (!allowed) btn.style.display = 'none';
  });

  setTimeout(() => {
    const firstTab = perms.tabs[0];
    const tabBtn   = document.querySelector(`.tab-btn[onclick*="${firstTab}"]`);
    window.__switchTab?.(firstTab, tabBtn);
  }, 100);

  // data-mode flags the cashier UI variant (cashier role only). Bundle 3 hides
  // cost from VIEW for cost-blind roles (manager + cashier) via body.pk-cost-blind
  // — render-gating only; NO role's data is stripped anymore.
  document.documentElement.setAttribute('data-mode', session.role === 'cashier' ? 'cashier' : 'staff');
  document.body.classList.toggle('pk-cost-blind', isCostBlindRole(session.role));
  // Staff IS signed in → reveal the privacy toggle (default-hidden in markup for
  // the signed-out state). The body.pk-cost-blind rule above still hides it for
  // manager/cashier; admin (not cost-blind) sees it.
  const priv = document.getElementById('pkPrivacyToggle');
  if (priv) priv.style.display = '';
  window._staffPerms = perms;
}

// ── Load owner data for staff ────────────────────────────────
let _staffUnsubs = [];
export function stopStaffListeners() {
  _staffUnsubs.forEach(u => u());
  _staffUnsubs = [];
  if (_staffPermsUnsub) { _staffPermsUnsub(); _staffPermsUnsub = null; }
}

// ── Cost visibility (Bundle 3 · UI-level gating) ─────────────
// The old B2.2 data-layer strip (stripItemCosts / stripSaleCosts /
// hideCostsForCurrentRole) was REMOVED: cost data now stays in EVERY staff
// session (manager + cashier), so sales always compute real profit — no more
// revenue-as-profit fabrication. Cost is hidden from VIEW only, for cost-blind
// roles, via the body.pk-cost-blind hook + per-surface checks. This is
// render-gating, NOT devtools-proof — an accepted (tier-3) risk; see MISSION §7.
export function isCostBlindRole(role) {
  return role === 'manager' || role === 'cashier';
}
// Convenience: is the current actor cost-blind? Owner (no staff session) = no.
export function costBlindForCurrentRole() {
  return !!_currentStaffSession && isCostBlindRole(_currentStaffSession.role);
}

// Manual refresh path for staff (toolbar ↻ button). Loads owner data as-is —
// Bundle 3 no longer strips cost for any role (cost is hidden in the UI only),
// so the refresh just mirrors the live snapshot listeners below.
export async function refetchOwnerDataForStaff(ownerUid) {
  if (!ownerUid) return;
  const [salesSnap, itemsSnap] = await Promise.all([
    getDocs(collection(db, 'shops', ownerUid, 'sales')),
    getDocs(collection(db, 'shops', ownerUid, 'items')),
  ]);
  window._pkSales = normalizeSales(salesSnap.docs.map(d => d.data()));
  window._pkItems = itemsSnap.docs.map(d => d.data());
  saveLocal();
}

export async function loadOwnerDataForStaff(ownerUid) {
  try {
    stopStaffListeners(); // Prevent duplicate listeners on re-login

    // Load owner-configurable staff perms before perms-dependent decisions
    await loadStaffPermsConfig(ownerUid);
    subscribeStaffPermsConfig(ownerUid, () => {
      // role-level perms changed live — re-apply UI mode so tabs/visibility refresh
      const eff = getEffectiveSessionPerms(_currentStaffSession);
      if (eff) {
        // Bundle 3: keep data-mode (cashier UI variant) and the
        // body.pk-cost-blind view hook in sync on a live perms change.
        document.documentElement.setAttribute('data-mode', _currentStaffSession.role === 'cashier' ? 'cashier' : 'staff');
        document.body.classList.toggle('pk-cost-blind', isCostBlindRole(_currentStaffSession.role));
        window._staffPerms = eff;
      }
      window.__PK?.renderTradeTable?.();
    });

    // BUG-010: per-staff overrides (FEATURE-003 — e.g. a discount cap raised
    // for one cashier) were snapshotted onto the session only at login, so an
    // owner's change in Settings → Staff didn't take effect until the staff
    // member logged out and back in. Listen on the staff's own doc and keep
    // _currentStaffSession.permissions live — getDiscountPolicy() and friends
    // already read straight from that object, so no other call site changes.
    if (_currentStaffSession?.staffUsername) {
      _staffUnsubs.push(onSnapshot(
        doc(db, 'shops', ownerUid, 'staff', _currentStaffSession.staffUsername),
        snap => {
          if (!snap.exists() || !_currentStaffSession) return;
          _currentStaffSession.permissions = snap.data().permissions || null;
          const eff = getEffectiveSessionPerms(_currentStaffSession);
          if (eff) window._staffPerms = eff;
          window.__PK?.renderTradeTable?.();
        },
        err => console.warn('[auth] staff-doc perms listener:', err?.code || err?.message),
      ));
    }

    const [itemsSnap, custsSnap, salesSnap, borrsSnap] = await Promise.all([
      getDocs(collection(db, 'shops', ownerUid, 'items')),
      getDocs(collection(db, 'shops', ownerUid, 'customers')),
      getDocs(collection(db, 'shops', ownerUid, 'sales')),
      getDocs(collection(db, 'shops', ownerUid, 'borrowers')),
    ]);
    window._pkItems       = itemsSnap.docs.map(d => d.data());
    window._pkWholesale   = custsSnap.docs.map(d => d.data());
    window._pkSales       = normalizeSales(salesSnap.docs.map(d => d.data()));
    window._pkBorrowers   = borrsSnap.docs.map(d => d.data());
    window._staffOwnerUid = ownerUid;
    saveLocal();

    // Dashboard live-refresh: only re-render the Dashboard when it's
    // the active page (avoids wasted innerHTML churn on every write).
    const _refreshDashIfActive = () => {
      const dash = document.getElementById('page-dashboard');
      if (dash && dash.classList.contains('active')) {
        window.__PK?.renderDashboard?.();
      }
    };

    _staffUnsubs.push(onSnapshot(query(collection(db, 'shops', ownerUid, 'items')), snap => {
      window._pkItems = snap.docs.map(d => d.data());
      saveLocal();
      window.__PK?.renderItems?.();
      _refreshDashIfActive();
    }));
    _staffUnsubs.push(onSnapshot(query(collection(db, 'shops', ownerUid, 'sales')), snap => {
      window._pkSales = normalizeSales(snap.docs.map(d => d.data()));
      saveLocal();
      window.__PK?.renderTradeTable?.();
      _refreshDashIfActive();
    }));
    _staffUnsubs.push(onSnapshot(query(collection(db, 'shops', ownerUid, 'customers')), snap => {
      if (window._pkContactsActive) return;
      window._pkWholesale = snap.docs.map(d => d.data());
      saveLocal();
      window.__PK?.populateTradeCustSelect?.();
    }));
    _staffUnsubs.push(onSnapshot(query(collection(db, 'shops', ownerUid, 'borrowers')), snap => {
      if (window._pkContactsActive) return;
      window._pkBorrowers = snap.docs.map(d => d.data());
      saveLocal();
    }));

    // Expenses: admin records and sees them (MISSION §7, v1.18). Other roles
    // get an empty list, so a shared device never shows them whatever
    // expenses the last session left in localStorage.
    window._pkExpenses = [];
    saveLocal();
    if (_currentStaffSession?.role === 'admin') {
      _staffUnsubs.push(onSnapshot(query(collection(db, 'shops', ownerUid, 'expenses')), snap => {
        window._pkExpenses = snap.docs.map(d => d.data());
        saveLocal();
        _refreshDashIfActive();
      }, err => console.warn('[auth] staff expenses listener:', err?.code || err?.message)));
    }

    // Shop profile (name/phone/address) — so staff see the owner's current
    // shop name on this device, and a name change made by the owner reaches
    // them live. Read-only for staff (rules allow staff read of settings/).
    _staffUnsubs.push(onSnapshot(doc(db, 'shops', ownerUid, 'settings', 'profile'), snap => {
      if (snap.exists()) window.applyShopProfile?.(snap.data());
    }, err => console.error('[shopProfile] staff listen failed:', err)));

    const { startContactListener: _startCL } = await import('./contacts.js');
    _startCL(ownerUid);

  } catch (err) {
    console.error('Failed to load owner data:', err);
    toast('⚠️ Could not load shop data. Check Firestore rules for the shops/ path.', 'err');
  }
}

// ── Window functions ─────────────────────────────────────────
window.showStaffLogin = function() {
  const modal = document.getElementById('staffLoginModal');
  if (modal) modal.style.display = 'flex';

  // Inject shop name into black header
  const shopNameEl = document.getElementById('sl2ShopName');
  if (shopNameEl) shopNameEl.textContent = localStorage.getItem('pkAppName') || 'PriceKeeper';

  // Clear PIN digits and error on open
  ['slPinD1','slPinD2','slPinD3','slPinD4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errEl = document.getElementById('slError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

  // Wire up 4-digit auto-advance (idempotent: skip if already wired)
  if (!modal._sl2Wired) {
    modal._sl2Wired = true;
    const digits = ['slPinD1','slPinD2','slPinD3','slPinD4'];
    digits.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (el.value.length === 1 && i < digits.length - 1)
          document.getElementById(digits[i + 1])?.focus();
        if (el.value.length === 1 && i === digits.length - 1)
          document.getElementById('slSubmitBtn')?.focus();
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !el.value && i > 0)
          document.getElementById(digits[i - 1])?.focus();
        if (e.key === 'Enter') window.staffLogin();
      });
      // Allow pasting a full 4-digit PIN into the first box
      if (i === 0) {
        el.addEventListener('paste', e => {
          const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,4);
          if (text.length === 4) {
            e.preventDefault();
            digits.forEach((did, di) => {
              const d = document.getElementById(did);
              if (d) d.value = text[di] || '';
            });
            document.getElementById('slSubmitBtn')?.focus();
          }
        });
      }
    });
  }

  const remembered = getRememberedBizCode();
  const codeField  = document.getElementById('slBizCodeField');
  const rememberEl = document.getElementById('slRemembered');
  const codeEl     = document.getElementById('slRememberedCode');
  if (remembered && codeField && rememberEl && codeEl) {
    codeField.style.display = 'none';
    rememberEl.style.display = 'block';
    codeEl.textContent = remembered;
    setTimeout(() => document.getElementById('slUsername')?.focus(), 100);
  } else {
    setTimeout(() => document.getElementById('slBusinessCode')?.focus(), 100);
  }
};

// "Not your shop?" escape hatch — clears the cached code and reveals the
// Business Code field again for this login attempt.
window.slChangeShop = function() {
  const codeField  = document.getElementById('slBizCodeField');
  const rememberEl = document.getElementById('slRemembered');
  const subtitle   = document.getElementById('slSubtitle');
  if (codeField)  codeField.style.display = '';
  if (rememberEl) rememberEl.style.display = 'none';
  if (subtitle)   subtitle.style.display = '';
  setTimeout(() => document.getElementById('slBusinessCode')?.focus(), 50);
};

window.staffLogin = async function() {
  const remembered = getRememberedBizCode();
  const codeFieldHidden = document.getElementById('slBizCodeField')?.style.display === 'none';
  const code  = (codeFieldHidden && remembered)
    ? remembered
    : document.getElementById('slBusinessCode')?.value.trim().toUpperCase();
  const user  = document.getElementById('slUsername')?.value.trim().toLowerCase();
  const pin   = ['slPinD1','slPinD2','slPinD3','slPinD4']
    .map(id => document.getElementById(id)?.value || '').join('');
  const errEl = document.getElementById('slError');

  const btn = document.getElementById('slSubmitBtn');
  if (btn) { btn.textContent = 'Logging in…'; btn.disabled = true; }

  const result = await staffLogin(code, user, pin);

  if (btn) { btn.textContent = 'Log in →'; btn.disabled = false; }

  if (!result.ok) {
    if (errEl) { errEl.textContent = result.error; errEl.style.display = 'block'; }
    return;
  }

  document.getElementById('staffLoginModal').style.display = 'none';
  toast(`✅ Welcome ${result.session.displayName}`, 'ok');
  applyStaffMode();
  await loadOwnerDataForStaff(result.session.ownerUid);
  if (window.__PK?.renderItems)  window.__PK.renderItems();
  if (window.__PK?.initTradeTab) window.__PK.initTradeTab();
  // A staff session IS signed in. The boot staff path in auth.js sets this and
  // refreshes the banner; this fresh-PIN-login path must do the same, else the
  // sync banner stays stuck on "⛔ NOT SIGNED IN" — it only hides that state
  // when _pkSignedIn is true AND refreshBanner re-evaluates. (BUG-009)
  window._pkSignedIn = true;
  localStorage.removeItem('pkWasSignedOut');
  window.syncEngine?.refreshBanner?.();
};

window.staffUpdateName = async function() {
  const input   = document.getElementById('staffNameInput');
  const newName = input?.value?.trim();
  if (!newName) return toast('⚠️ Enter a name', 'err');
  const result = await staffUpdateDisplayName(newName);
  if (result.ok) {
    toast(`✅ Name updated to ${newName}`, 'ok');
    document.getElementById('staffNameModal')?.remove();
  } else {
    toast('⚠️ ' + result.error, 'err');
  }
};

window.showStaffNameModal = function() {
  const session = _currentStaffSession;
  if (!session) return;
  document.getElementById('staffNameModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'staffNameModal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;
    align-items:center;justify-content:center;z-index:9999;padding:20px;
  `;
  modal.innerHTML = `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:16px;
                padding:24px;width:100%;max-width:340px;">
      <div style="font-family:var(--fh);font-weight:800;font-size:1rem;color:var(--text);margin-bottom:5px;">
        Update Your Name
      </div>
      <div style="font-size:.74rem;color:var(--muted);margin-bottom:16px;">
        This name appears on all trades and actions you carry out.
      </div>
      <input id="staffNameInput" type="text" placeholder="Your display name"
        value="${session.displayName}"
        style="width:100%;background:var(--s3);border:1px solid var(--border);border-radius:9px;
               padding:11px 13px;color:var(--text);font-size:.88rem;box-sizing:border-box;margin-bottom:12px;">
      <div style="display:flex;gap:8px;">
        <button onclick="document.getElementById('staffNameModal').remove()"
          style="flex:1;background:var(--s3);border:1px solid var(--border);color:var(--muted);
                 border-radius:9px;padding:10px;font-family:var(--fh);font-weight:700;
                 font-size:.78rem;cursor:pointer;">
          Cancel
        </button>
        <button onclick="window.staffUpdateName()"
          style="flex:2;background:var(--accent);border:none;color:#080a0f;border-radius:9px;
                 padding:10px;font-family:var(--fh);font-weight:800;font-size:.78rem;cursor:pointer;">
          Save Name ✓
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('staffNameInput')?.focus(), 100);
};

// ── Staff Change-Own-PIN modal (FEATURE-005) ─────────────────
window.showStaffPinModal = function() {
  if (!_currentStaffSession) return;
  document.getElementById('staffPinModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'staffPinModal';
  modal.className = 'pk-pin-overlay';
  modal.innerHTML = `
    <div class="pk-pin-modal">
      <div class="pk-pin-title">🔑 Change Your PIN</div>
      <div class="pk-pin-sub">Enter your current PIN, then choose a new 4-digit PIN.</div>
      <div class="pk-pin-field">
        <label class="pk-pin-lbl">Current PIN</label>
        <input id="staffPinCurrent" type="password" maxlength="4" inputmode="numeric"
          placeholder="••••" class="pk-pin-input">
      </div>
      <div class="pk-pin-field">
        <label class="pk-pin-lbl">New PIN</label>
        <input id="staffPinNew" type="password" maxlength="4" inputmode="numeric"
          placeholder="••••" class="pk-pin-input">
      </div>
      <div class="pk-pin-field">
        <label class="pk-pin-lbl">Confirm New PIN</label>
        <input id="staffPinConfirm" type="password" maxlength="4" inputmode="numeric"
          placeholder="••••" class="pk-pin-input">
      </div>
      <div class="pk-pin-actions">
        <button class="pk-pin-cancel" onclick="document.getElementById('staffPinModal').remove()">Cancel</button>
        <button class="pk-pin-save" id="staffPinSaveBtn" onclick="window._staffPinSave()">Update PIN ✓</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('staffPinCurrent')?.focus(), 80);
};

window._staffPinSave = async function() {
  const cur  = document.getElementById('staffPinCurrent')?.value.trim() || '';
  const nw   = document.getElementById('staffPinNew')?.value.trim() || '';
  const conf = document.getElementById('staffPinConfirm')?.value.trim() || '';
  const btn  = document.getElementById('staffPinSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
  const result = await staffChangeOwnPin(cur, nw, conf);
  if (btn) { btn.disabled = false; btn.textContent = 'Update PIN ✓'; }
  if (!result.ok) return toast('⚠️ ' + result.error, 'err');
  document.getElementById('staffPinModal')?.remove();
  toast('✅ PIN updated', 'ok');
};

// ── Logout confirmation modal handlers ───────────────────────
// The bar button in index.html calls showStaffLogoutConfirm() to open the
// modal; the modal's confirm button calls staffLogoutConfirm() which adds a
// loading state before delegating to staffLogout(). The modal HTML + CSS live
// in index.html and css/main.css.
window.showStaffLogoutConfirm = function () {
  if (!_currentStaffSession) return;
  const modal = document.getElementById('staffLogoutModal');
  if (!modal) return;
  // Reset confirm button in case a previous attempt left it disabled.
  const btn = document.getElementById('staffLogoutConfirmBtn');
  if (btn) { btn.textContent = 'Sign Out'; btn.disabled = false; }
  // Signing in needs the internet. Offline, signing out locks the phone
  // until it comes back, so say so before they tap.
  const offline = window._pkOnlineState === false;
  const title = modal.querySelector('.pk-logout-title');
  const body  = modal.querySelector('.pk-logout-body');
  if (title) title.textContent = offline ? 'You are offline. Sign out anyway?' : 'End shift and sign out?';
  if (body) body.textContent = offline
    ? 'Nobody can sign in on this phone until the internet is back. Sales you made are saved and will send then. To keep selling, tap Cancel.'
    : "Your session will close. You'll need your business code and PIN to sign back in.";
  modal.style.display = 'flex';
};

window.closeStaffLogoutConfirm = function () {
  const modal = document.getElementById('staffLogoutModal');
  if (modal) modal.style.display = 'none';
};

window.staffLogoutConfirm = async function () {
  const btn = document.getElementById('staffLogoutConfirmBtn');
  if (btn) { btn.textContent = 'Signing out…'; btn.disabled = true; }
  // staffLogout() ends with window.location.reload(), so control normally
  // doesn't return here. If it throws before reload, leave the modal visible
  // so the user can retry or cancel.
  await staffLogout();
};

window.staffLogout = staffLogout;
