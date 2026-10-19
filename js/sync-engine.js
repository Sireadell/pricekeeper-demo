// ============================================================
//  sync-engine.js — D.8.2a queue drainer + online detection + banner
//
//  window.syncEngine = { start, drain, forceDrain, getStatus, clearNeedsReview }
//
//  Drains pendingWrites sequentially in createdAt order, one at a time.
//  Exponential backoff on failure (1/2/4/8s within a 5-attempt budget,
//  schedule capped at 30s); after 5 attempts → needs_review and the
//  queue moves on (a single bad write never blocks the rest).
//
//  Online state is authoritative via window._pkOnlineState, computed from
//  navigator.onLine AND a 30s reachability ping (navigator.onLine lies).
//
//  Scope D.8.2a: only sales writes flow through the queue (see
//  write-gateway.js / trade-payment.js). No conflict resolution (D.8.4).
//
//  BUG-014 — queue entries can also be op:'batch' (from gwWriteLinked): a
//  group of sub-writes that must replay together as one atomic writeBatch,
//  not as separate entries that could land at different times. See the
//  'batch' branch in _processEntry and the doc comment atop write-gateway.js.
// ============================================================

import * as offlineStore from './offline-store.js';
import { directFirestoreWrite, directFirestoreBatch } from './write-gateway.js';
import { escapeHtml } from './utils.js';

const MAX_ATTEMPTS  = 5;
const BACKOFFS      = [1000, 2000, 4000, 8000, 16000, 30000]; // schedule, capped at 30s
const PING_INTERVAL = 30000;
const DRAIN_BATCH   = 50;

let _started        = false;
let _draining       = false;
let _drainAgain     = false;
let _pingTimer      = null;
let _flashTimer     = null;
let _status = { online: true, pendingCount: 0, syncingCount: 0, needsReviewCount: 0, lastSyncAt: null };

// ── session / online ──────────────────────────────────────────
async function _activeUid() {
  if (window._staffOwnerUid) return window._staffOwnerUid;
  try { const { currentUser } = await import('./auth.js'); return currentUser?.uid || null; }
  catch (_) { return null; }
}
function _navOnline() { return navigator.onLine && !window._pkForceOffline; }

// Reachability ping: no-cors GET to the Firestore host resolves (opaque)
// when reachable, rejects on network failure. Not a document read → no
// Firestore read billing. 5s timeout.
async function _ping() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch('https://firestore.googleapis.com/', { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch (_) { return false; }
}

async function _recomputeOnline() {
  const online = !_navOnline() ? false : await _ping();
  const was = window._pkOnlineState;
  window._pkOnlineState = online;
  _status.online = online;
  if (was !== online) { try { window.dispatchEvent(new CustomEvent('pkConnChange', { detail: { online } })); } catch (_) {} }
  // Self-heal: every tick re-reads the real queue when online, so the
  // banner reconciles to the truth even if a prior drain left a stale
  // count. _recountQueue() re-renders; offline just re-renders.
  if (online) await _recountQueue(); else _renderBanner();
  if (online && was === false) drain();   // network returned → drain
}

// ── status ────────────────────────────────────────────────────
async function _recountQueue() {
  const entries = await offlineStore.readAll('pendingWrites');
  // D.8.2b sub-step 0 — banner counts only the ACTIVE owner's entries.
  // Parked foreign-owner entries would otherwise show as perpetually
  // "pending" to an owner who can never drain them. No session yet →
  // count everything (boot-time status quo; drain bails on no uid anyway).
  const uid = await _activeUid();
  const mine = uid ? entries.filter(e => !e.ownerUid || e.ownerUid === uid) : entries;
  _status.pendingCount     = mine.filter(e => e.status !== 'needs_review').length;
  _status.needsReviewCount = mine.filter(e => e.status === 'needs_review').length;
  _renderBanner();
}
function getStatus() { return { ..._status }; }

// ── drain ─────────────────────────────────────────────────────
async function drain() {
  // Concurrency guard. A write queued while a drain is running must not sit
  // until the next 30s ping, so remember the request and run again after.
  if (_draining) { _drainAgain = true; return; }
  _draining = true;                            // set BEFORE any await so two
                                               // near-simultaneous triggers
                                               // (online event + ping) can't
                                               // both replay the queue →
                                               // duplicate writes.
  let ran = false;
  try {
    if (!window._pkOnlineState) return;
    const uid = await _activeUid();
    if (!uid) return;                          // no session → wait (don't burn attempts)
    ran = true;
    const all = await offlineStore.readAll('pendingWrites');
    const ready = all
      .filter(e => e.status !== 'needs_review')
      // D.8.2b sub-step 0 — owner guard: an entry stamped for a DIFFERENT
      // owner is PARKED — not written, not deleted — until its owner signs
      // back in. Legacy entries with no ownerUid stamp are treated as the
      // current owner's (pre-stamp behavior; production has a single owner,
      // and a fresh install has no unstamped entries).
      .filter(e => !e.ownerUid || e.ownerUid === uid)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(0, DRAIN_BATCH);
    for (const entry of ready) {
      if (!window._pkOnlineState) break;                                   // went offline mid-drain
      if (entry.nextAttemptAt && Date.now() < entry.nextAttemptAt) continue; // backoff not elapsed
      await _processEntry(entry);
    }
  } finally {
    _draining = false;
    // Sent saves have left the queue: stop laying them over the database copy.
    try { window.dispatchEvent(new CustomEvent('pkQueueChanged')); } catch (_) {}
  }
  if (_drainAgain) { _drainAgain = false; if (window._pkOnlineState) setTimeout(drain, 0); }
  if (!ran) return;                            // bailed early (offline / no uid)
  await _recountQueue();
  if (_status.pendingCount === 0 && _status.needsReviewCount === 0) _flashSynced();
}

// Known single-write ops (see write-gateway.js gwWrite doc comment). Anything
// else — including a malformed/unrecognized entry, e.g. an 'batch' entry
// enqueued by a newer app version being drained by a STALE service-worker
// copy of this file that doesn't know 'batch' — goes straight to
// needs_review instead of burning 5 retry attempts on a write that can
// never succeed. This is a real-money queue: a bad entry should surface to
// the owner immediately, not sit "pending" for a backoff cycle it can't win.
const KNOWN_SINGLE_OPS = new Set(['create', 'update', 'set', 'delete']);

async function _processEntry(entry) {
  entry.status = 'syncing';
  _status.syncingCount = 1; _renderBanner();
  try {
    if (entry.op === 'batch') {
      // BUG-014 — a linked write group (e.g. a trade payment + its Credit
      // Account ledger entry): replay as ONE atomic writeBatch, same as it
      // was enqueued, so the two sub-writes always land together.
      await directFirestoreBatch(entry.subWrites, entry.ownerUid || null);
    } else if (KNOWN_SINGLE_OPS.has(entry.op)) {
      // D.8.2b sub-step 0 — replay to the entry's own stamped owner path, not
      // re-derived from the live session (the drain guard already ensures they
      // match; this makes the write path structurally incapable of drifting).
      await directFirestoreWrite(entry.op, entry.collection, entry.docId, entry.payload, entry.options, entry.ownerUid || null);
    } else {
      throw Object.assign(new Error(`unrecognized queue entry op "${entry.op}"`), { code: 'unrecognized-op' });
    }
    await offlineStore.removeMirror('pendingWrites', entry.id);
    _status.lastSyncAt = Date.now();
    await _log({ result: 'synced', collection: entry.collection, docId: entry.docId });
  } catch (err) {
    if (err && err.code === 'unrecognized-op') {
      entry.status = 'needs_review';
      entry.lastError = err.message;
      await offlineStore.putMirror('pendingWrites', entry);
      await _log({ result: 'needs_review', collection: entry.collection, docId: entry.docId, error: entry.lastError });
      return;
    }
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.status = 'needs_review';
      entry.lastError = String(err?.code || err?.message || err);
      await offlineStore.putMirror('pendingWrites', entry);
      await _log({ result: 'needs_review', collection: entry.collection, docId: entry.docId, error: entry.lastError });
    } else {
      entry.status = 'pending';
      const backoff = BACKOFFS[Math.min(entry.attempts - 1, BACKOFFS.length - 1)];
      entry.nextAttemptAt = Date.now() + backoff;
      await offlineStore.putMirror('pendingWrites', entry);
      setTimeout(() => { if (window._pkOnlineState) drain(); }, backoff);  // non-blocking retry
    }
  } finally {
    _status.syncingCount = 0;
  }
}

function forceDrain() { return drain(); }

async function clearNeedsReview() {
  const all = await offlineStore.readAll('pendingWrites');
  // D.8.2b sub-step 0 — only the entry's own owner may clear it. Without
  // this, owner B clearing their review list would DELETE owner A's parked
  // entries, breaking the "parked until its owner returns" guarantee.
  const uid = await _activeUid();
  const bad = all.filter(e => e.status === 'needs_review' && (!e.ownerUid || e.ownerUid === uid));
  for (const e of bad) await offlineStore.removeMirror('pendingWrites', e.id);
  try { window.dispatchEvent(new CustomEvent('pkQueueChanged')); } catch (_) {}
  await _log({ result: 'cleared_needs_review', count: bad.length });
  await _recountQueue();
  return bad.length;
}

// ── sync log ──────────────────────────────────────────────────
async function _log(partial) {
  try {
    const id = `sl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await offlineStore.putMirror('syncLog', { id, at: Date.now(), ...partial });
  } catch (_) {}
}
async function _readLog(limit = 10) {
  const all = await offlineStore.readAll('syncLog');
  return all.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
}

// ── banner UI ─────────────────────────────────────────────────
function _ensureBanner() {
  if (document.getElementById('obxBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'obxBanner';
  bar.className = 'obx-banner';
  bar.style.display = 'none';
  bar.innerHTML = `<div class="obx-msg" id="obxMsg"></div><div class="obx-panel" id="obxPanel" hidden></div>`;
  bar.addEventListener('click', _togglePanel);
  document.body.appendChild(bar);
}
function _bannerState() {
  // Highest priority: not signed in at all. A sale made now would persist only
  // to localStorage and be erased by the next cloud snapshot (June-8 loss), so
  // shout about it. `=== false` only — undefined (auth not resolved yet at
  // boot) must NOT flash this.
  if (window._pkSignedIn === false)  return 'loggedout';
  if (_status.needsReviewCount > 0) return 'review';
  if (!window._pkOnlineState)       return 'offline';
  if (_status.pendingCount > 0)     return 'syncing';
  return 'hidden';
}
function _renderBanner() {
  const bar = document.getElementById('obxBanner');
  if (!bar) return;
  const msg = document.getElementById('obxMsg');
  const state = _bannerState();
  bar.classList.remove('obx-offline', 'obx-syncing', 'obx-review', 'obx-loggedout');
  if (state === 'hidden') {
    if (bar.classList.contains('obx-synced')) return;   // let the synced flash linger
    bar.style.display = 'none';
    document.body.classList.remove('obx-banner-on');
    const panel = document.getElementById('obxPanel'); if (panel) panel.hidden = true;
    return;
  }
  bar.classList.remove('obx-synced');
  bar.style.display = '';
  document.body.classList.add('obx-banner-on');
  if (state === 'offline') {
    bar.classList.add('obx-offline');
    const n = _status.pendingCount;
    if (msg) msg.textContent = n > 0
      ? `⚠ OFFLINE — ${n} change${n !== 1 ? 's' : ''} pending sync`
      : `⚠ OFFLINE — works as normal, will sync when back online`;
  } else if (state === 'syncing') {
    bar.classList.add('obx-syncing');
    if (msg) msg.textContent = `⟳ Syncing — ${_status.pendingCount} remaining`;
  } else if (state === 'review') {
    bar.classList.add('obx-review');
    const n = _status.needsReviewCount;
    if (msg) msg.textContent = `⚠ ${n} sync${n !== 1 ? 's' : ''} need owner review · tap to view`;
  } else if (state === 'loggedout') {
    bar.classList.add('obx-loggedout');
    if (msg) msg.textContent = '⛔ NOT SIGNED IN — sales will NOT be saved. Log in before selling.';
  }
}
function _flashSynced() {
  const bar = document.getElementById('obxBanner');
  if (!bar) return;
  bar.classList.remove('obx-offline', 'obx-syncing', 'obx-review', 'obx-loggedout');
  bar.classList.add('obx-synced');
  bar.style.display = '';
  document.body.classList.add('obx-banner-on');
  const msg = document.getElementById('obxMsg');
  if (msg) msg.textContent = '✓ All synced';
  clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => { bar.classList.remove('obx-synced'); _renderBanner(); }, 3000);
}
async function _togglePanel() {
  const panel = document.getElementById('obxPanel');
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  const log = await _readLog(10);
  panel.innerHTML = log.length
    ? log.map(e => `<div class="obx-log-row">
        <span class="obx-log-res obx-log-res--${e.result}">${escapeHtml(e.result || '')}</span>
        <span class="obx-log-doc">${escapeHtml((e.collection || '') + (e.docId ? ' · ' + e.docId : ''))}</span>
        <span class="obx-log-at">${new Date(e.at).toLocaleTimeString()}</span>
      </div>`).join('')
    : `<div class="obx-log-empty">No sync events yet</div>`;
  panel.hidden = false;
}

// ── start ─────────────────────────────────────────────────────
function start() {
  if (_started) return;
  _started = true;
  window._pkOnlineState = _navOnline();
  _ensureBanner();
  window.addEventListener('online',  _recomputeOnline);
  window.addEventListener('offline', _recomputeOnline);
  window.addEventListener('pkOfflineWrite', () => { _recountQueue().then(() => { if (window._pkOnlineState) drain(); }); });
  _pingTimer = setInterval(_recomputeOnline, PING_INTERVAL);
  // Initial: count the queue, confirm real connectivity, drain if pending.
  _recountQueue().then(_recomputeOnline).then(() => { if (window._pkOnlineState) drain(); });
}

// refreshBanner — re-evaluate banner state on demand (auth.js calls this when
// sign-in/out changes, so the "not signed in" warning appears/clears live).
function refreshBanner() { _ensureBanner(); _renderBanner(); }
window.syncEngine = { start, drain, forceDrain, getStatus, clearNeedsReview, refreshBanner };

export { start, drain, forceDrain, getStatus, clearNeedsReview };
