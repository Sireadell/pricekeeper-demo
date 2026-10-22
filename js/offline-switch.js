// ============================================================
//  offline-switch.js — a "pretend offline" switch for automated tests
//
//  Browser test robots cannot pull the plug on the internet, so they cannot
//  check what a shop sees when the signal drops. Opening the app with
//  ?offline-switch=1 in the address shows one small button that makes the
//  app behave as if the connection was lost:
//    - the database stops talking to the server (Firestore disableNetwork),
//      so reads come from the copy on the phone and saves wait locally
//    - the sync engine treats the app as offline, so sales go into the
//      offline queue and the OFFLINE banner shows
//  Pressing it again turns the database connection back on and the queue
//  sends, exactly as when real signal returns.
//
//  Without the address flag nothing is shown and nothing changes. The flag,
//  and whether the switch is off, are remembered for the browser tab only
//  (sessionStorage), so reloading the page while "offline" keeps the database
//  off. That lets a test close and reopen the app with no connection and
//  check the sales made offline are still there. The app's own files still
//  load from the internet on reload; only the database stays cut off.
// ============================================================

import { db, disableNetwork, enableNetwork } from './firebase.js';

const FLAG   = 'offline-switch';
const KEY    = 'pkOfflineSwitch';
const KEY_ON = 'pkOfflineSwitchOff';

function _remember(off) {
  try { off ? sessionStorage.setItem(KEY_ON, '1') : sessionStorage.removeItem(KEY_ON); } catch (_) {}
}

// Runs as soon as this file loads, before the sync engine starts, so a page
// reopened while the switch is off starts offline from the first moment.
if (_wanted() && (() => { try { return sessionStorage.getItem(KEY_ON) === '1'; } catch (_) { return false; } })()) {
  window._pkForceOffline = true;
  disableNetwork(db).catch(err => console.warn('[offline-switch] could not start offline:', err));
}

function _wanted() {
  try {
    if (new URLSearchParams(location.search).has(FLAG)) {
      sessionStorage.setItem(KEY, '1');
      return true;
    }
    return sessionStorage.getItem(KEY) === '1';
  } catch (_) { return false; }
}

function _paint(btn) {
  const off = !!window._pkForceOffline;
  btn.textContent = off ? '📶 Turn internet back on (test switch)' : '📴 Go offline (test switch)';
  btn.setAttribute('aria-pressed', off ? 'true' : 'false');
  btn.style.background = off ? '#b42318' : '#344054';
}

async function _set(off, btn) {
  btn.disabled = true;
  try {
    if (off) {
      // Flag first, so every save from this moment on takes the offline path.
      window._pkForceOffline = true;
      _remember(true);
      window.dispatchEvent(new Event('offline'));
      await disableNetwork(db);
    } else {
      await enableNetwork(db);
      window._pkForceOffline = false;
      _remember(false);
      window.dispatchEvent(new Event('online'));
    }
  } catch (err) {
    console.warn('[offline-switch] could not change the connection:', err);
  } finally {
    btn.disabled = false;
    _paint(btn);
  }
}

export function initOfflineSwitch() {
  if (!_wanted() || document.getElementById('pkOfflineSwitch')) return;
  const btn = document.createElement('button');
  btn.id = 'pkOfflineSwitch';
  btn.type = 'button';
  btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;'
    + 'padding:8px 12px;border:0;border-radius:6px;color:#fff;font:600 13px system-ui,sans-serif;'
    + 'cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25)';
  btn.addEventListener('click', () => _set(!window._pkForceOffline, btn));
  _paint(btn);
  document.body.appendChild(btn);
}
