// ============================================================
//  user-menu.js — dropdown anchored to the top-nav user-chip.
//  Replaces the legacy #staffModeBar Sign Out button.
//
//  Shows the signed-in display name + role, then a Sign Out
//  action. Click-outside and Esc close it. PIN + Edit Name are
//  intentionally NOT here — those rare actions live in Settings.
// ============================================================

let _bound = false;

export function initUserMenu() {
  if (_bound) return;
  _bound = true;
  document.addEventListener('click', e => {
    const menu = document.getElementById('pkUserMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target)) return;
    if (document.getElementById('authBtn')?.contains(e.target)) return;
    closeUserMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeUserMenu();
  });
}

export function toggleUserMenu(event) {
  event?.stopPropagation();
  const menu    = document.getElementById('pkUserMenu');
  const authBtn = document.getElementById('authBtn');
  if (!menu || !authBtn) return;
  // Signed-out state has no data-role on the chip — route straight to sign-in.
  const role = authBtn.getAttribute('data-role') || '';
  if (!role) {
    window.__PK?.handleAuth?.();
    return;
  }
  if (menu.hidden) _openUserMenu();
  else closeUserMenu();
}

function _openUserMenu() {
  const menu = document.getElementById('pkUserMenu');
  if (!menu) return;
  const name = document.getElementById('authLabel')?.textContent?.trim() || '';
  const role = document.getElementById('authRoleTag')?.textContent?.trim()
            || (document.getElementById('authBtn')?.getAttribute('data-role') || '').toUpperCase();
  const nameEl = menu.querySelector('.pk-user-menu-name');
  const roleEl = menu.querySelector('.pk-user-menu-role');
  if (nameEl) nameEl.textContent = name ? `Signed in as ${name}` : 'Signed in';
  if (roleEl) roleEl.textContent = role ? `${role} · Session active` : 'Session active';
  // Settings is owner-only (MISSION §7). Staff sessions carry _staffOwnerUid;
  // an owner Google session does not — hide Settings for any staff session.
  const setEl = document.getElementById('pkMenuSettings');
  if (setEl) setEl.style.display = window._staffOwnerUid ? 'none' : '';
  refreshThemeMenuLabel();
  menu.hidden = false;
  document.getElementById('authBtn')?.setAttribute('aria-expanded', 'true');
}

// Theme toggle item label reflects the action you'd take next.
export function refreshThemeMenuLabel() {
  const el = document.getElementById('pkThemeMenuLabel');
  if (!el) return;
  let light = false;
  try { light = localStorage.getItem('pkTheme') === 'light'; } catch (_) {}
  el.textContent = light ? 'Switch to dark' : 'Switch to light';
}

export function closeUserMenu() {
  const menu = document.getElementById('pkUserMenu');
  if (!menu) return;
  menu.hidden = true;
  document.getElementById('authBtn')?.setAttribute('aria-expanded', 'false');
}

// Sign Out item routes by session type:
//   staff session  → existing confirm modal (showStaffLogoutConfirm)
//   owner session  → existing handleAuth() which signs out Google
export function userMenuSignOut() {
  closeUserMenu();
  if (window._staffOwnerUid) {
    window.showStaffLogoutConfirm?.();
  } else {
    window.__PK?.handleAuth?.();
  }
}
