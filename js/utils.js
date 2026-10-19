// ============================================================
//  utils.js — Shared helper functions
//  Fixes: safe(), loadLocal(), saveLocal try/catch,
//         toast clearTimeout, profit helper, btn loading
// ============================================================

// Format a number as Nigerian Naira  e.g. 5000 → ₦5,000
export const fmt = n =>
  '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });

// Same as fmt(), but wraps the ₦ glyph in a font-fallback span (.currency,
// see tokens.css) instead of leaving it in the body font. fmt() already
// includes the ₦ — only the glyph needs the span, so slice it off the
// number before re-adding it wrapped (never concat fmt() with a literal
// <span>₦</span> or it doubles up).
export const fmtSpan = n => `<span class="currency">₦</span>${fmt(n).slice(1)}`;

// Calculate profit margin percentage  e.g. pct(100, 130) → "30.0"
export const pct = (buy, sell) =>
  buy ? (((sell - buy) / buy) * 100).toFixed(1) : '0.0';

// Net profit helper  e.g. profit(100, 130, 5) → 150
export const profit = (buy, sell, qty = 1) =>
  (Number(sell || 0) - Number(buy || 0)) * Number(qty || 1);

// Bundle 3 (Stage 6): an item "needs cost" when it has NO cost in ANY of its
// cost fields. The app stores/reads cost across several fields (see
// _costPerPiece in trade-modal.js, _fixedProfit in business.js, and the
// dashboard stockValue): the priority chain is cartonBuy → buyPrice → buy →
// cost. Older/owner items commonly hold cost in `cartonBuy` or `buy` with an
// empty `buyPrice`, so checking buyPrice alone over-counts. Only flag items
// where none of these holds a positive value. Existing fields — NO new schema.
export const itemNeedsCost = it => {
  if (!it) return true;
  const positive = v => parseFloat(v) > 0;
  return !(positive(it.cartonBuy) || positive(it.buyPrice) || positive(it.buy) || positive(it.cost));
};

// v1.0 stock-tracking: tracked but stock never set (stockQty null). Distinct
// from sold-out (stockQty === 0) and from legacy untracked items (trackStock
// falsy) — so the "needs stock setup" meter counts post-ship items only.
// Existing fields — NO new schema.
export const itemNeedsStock = it => !!it && it.trackStock === true && it.stockQty == null;

// Escape user-supplied text before inserting into HTML (prevents XSS)
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
export const escapeHtml = s =>
  typeof s === 'string' ? s.replace(/[&<>"']/g, m => _escMap[m]) : '';

// Generate a unique ID for every record (cryptographically random)
export const uid = () => crypto.randomUUID();

// Human-readable date  e.g. "2 Jan 2025"
export const now = () =>
  new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

// ISO date string for today  e.g. "2025-01-02", in the shop's own time zone.
// toISOString() is UTC, which put sales made between midnight and 1am
// (Nigeria is UTC+1) on the previous day.
export const today = () => isoDate(new Date());

// Show/hide a modal overlay by ID
export function openModal(id)  { document.getElementById(id)?.classList.add('open');    }
export function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ── Toast — top-right stack, color-coded (FEATURE-004) ──────────────────────
// Backwards-compatible: legacy callers pass 'ok'/'err' which map to
// 'success'/'error'. New callers pass 'success' | 'error' | 'warning' | 'info'.
const _TOAST_TYPE_ALIAS = {
  ok:       'success',
  success:  'success',
  err:      'error',
  error:    'error',
  danger:   'error',
  warn:     'warning',
  warning:  'warning',
  info:     'info',
  '':       'info',
};

const _TOAST_ICON = {
  success: '✓',  // ✓
  error:   '✕',  // ✕
  warning: '!',
  info:    'i',
};

const _TOAST_DURATION = {
  success: 4000,
  info:    4000,
  warning: 7000,
  error:   7000,
};

function _toastStack() {
  let stack = document.getElementById('pkToastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'pkToastStack';
    stack.className = 'pk-toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function _stripEmojiPrefix(msg) {
  // Many legacy callers prefix the message with ⚠️/✅/❌/💰 etc.
  // The new toast already renders its own glyph, so strip a leading
  // emoji + space for a cleaner result. Leaves inline emojis alone.
  return String(msg || '').replace(/^\s*(?:[☀-➿-]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])+\s*/u, '');
}

export function toast(msg, type = '') {
  const kind  = _TOAST_TYPE_ALIAS[type] || 'info';
  const stack = _toastStack();
  const node  = document.createElement('div');
  node.className = `pk-toast pk-toast--${kind}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');

  const icon = document.createElement('span');
  icon.className   = 'pk-toast-icon';
  icon.textContent = _TOAST_ICON[kind];

  const body = document.createElement('span');
  body.className   = 'pk-toast-msg';
  body.textContent = _stripEmojiPrefix(msg);

  const close = document.createElement('button');
  close.className   = 'pk-toast-close';
  close.type        = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '✕';

  node.append(icon, body, close);
  stack.appendChild(node);

  // Trigger transition on next frame
  requestAnimationFrame(() => node.classList.add('show'));

  const dismiss = () => {
    if (node.dataset.leaving === '1') return;
    node.dataset.leaving = '1';
    node.classList.add('leaving');
    node.classList.remove('show');
    setTimeout(() => node.remove(), 260);
  };

  close.addEventListener('click', dismiss);
  const t = setTimeout(dismiss, _TOAST_DURATION[kind]);
  node.addEventListener('mouseenter', () => clearTimeout(t), { once: true });

  return dismiss;
}

// ── Button loading state helpers ─────────────────────────────────────────────
// selector: CSS selector OR element reference
// loading: true = disable + show spinner label, false = restore
const _btnOriginals = new WeakMap();
export function setBtnLoading(selector, loading) {
  const el = typeof selector === 'string'
    ? document.querySelector(selector)
    : selector;
  // Callers often pass document.activeElement. When nothing has focus (iPhone
  // taps, or right after a prompt box) that is the whole page, and rewriting
  // its text wiped every screen. Only ever touch a real button.
  if (!el || !el.matches?.('button, a, input, [role="button"], .ibtn')) return;
  if (loading) {
    if (!_btnOriginals.has(el)) _btnOriginals.set(el, el.textContent);
    el.disabled     = true;
    el.textContent  = '⏳ Saving...';
    el.style.opacity = '0.7';
  } else {
    el.disabled      = false;
    el.textContent   = _btnOriginals.get(el) ?? el.textContent;
    el.style.opacity = '';
    _btnOriginals.delete(el);
  }
}

// ── withLoading — wrap any async action with button loading state ────────────
// Usage: await withLoading(buttonEl, () => deleteItem(id));
export async function withLoading(btn, asyncFn) {
  setBtnLoading(btn, true);
  try { return await asyncFn(); }
  finally { setBtnLoading(btn, false); }
}

// ── findBorrowerByName — single source of truth for name-based lookup ───────
// Case-insensitive, trims whitespace. Works on any array of `{name}`-shaped
// records (borrowers, customers, etc.) — the function doesn't care about the
// shape beyond `name`. Returns the first match, or undefined.
export function findBorrowerByName(borrowers, name) {
  const target = (name || '').trim().toLowerCase();
  return (borrowers || []).find(b => (b.name || '').trim().toLowerCase() === target);
}

// ── Safe JSON parse (never throws) ──────────────────────────────────────────
export function safe(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
export function saveLocal() {
  try {
    localStorage.setItem('pkItems',     JSON.stringify(window._pkItems     || []));
    localStorage.setItem('pkWholesale', JSON.stringify(window._pkWholesale || []));
    localStorage.setItem('pkSales',     JSON.stringify(window._pkSales     || []));
    localStorage.setItem('pkBorrowers', JSON.stringify(window._pkBorrowers || []));
    localStorage.setItem('pkExpenses',  JSON.stringify(window._pkExpenses  || []));
    localStorage.setItem('pkContacts', JSON.stringify(window._pkContacts || []));
  } catch (e) {
    toast('⚠️ Offline save failed — storage full', 'err');
  }
}
// ── Read the user's global markup % setting ───────────────────────────────────
export const getMarkup = () =>
  parseFloat(document.getElementById('globalMarkup')?.value || 30);

// Default low-stock alert percentage. Owners set this in Settings → Defaults.
// A tracked item with no explicit per-item threshold gets its reorder point
// derived as this % of the stock total (on add and on every restock), so the
// alert fires when stock falls to this share of what was last stocked.
// Falls back to 15 when unset/invalid. Clamped to a sane 1–90 range.
export const lowStockPct = () => {
  const v = parseFloat(localStorage.getItem('pkLowStockPct'));
  return Number.isFinite(v) && v >= 1 && v <= 90 ? v : 15;
};

// Derive a low-stock threshold (in pieces) from a stock total (in pieces)
// using the configured default percentage. Always at least 1 piece so a
// tracked item never has a zero/blank reorder point.
export const lowThresholdFromPct = (stockQtyPcs, pct = lowStockPct()) =>
  Math.max(1, Math.round((parseFloat(stockQtyPcs) || 0) * pct / 100));

// ── ISO date for an arbitrary Date object ─────────────────────────────────────
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Compact number formatter (K/M/B) ─────────────────────────────────────────
// K threshold: 1,000. Has B suffix. Single source of truth — replaces private
// _fmtCompact copies in business.js (K=1K) and trade-table.js (K=10K).
export function fmtCompact(n) {
  const v = Number(n || 0);
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return new Intl.NumberFormat('en-NG').format(Math.round(v));
}

// ── App settings (pkSettings localStorage object) ────────────────────────────
export function getAppSetting(k, def) {
  try {
    const s = JSON.parse(localStorage.getItem('pkSettings') || '{}');
    return s[k] !== undefined ? s[k] : def;
  } catch { return def; }
}
export function setAppSetting(k, v) {
  try {
    const s = JSON.parse(localStorage.getItem('pkSettings') || '{}');
    s[k] = v;
    localStorage.setItem('pkSettings', JSON.stringify(s));
  } catch {}
}

// ── Time display helpers ──────────────────────────────────────────────────────
// nullFallback: returned when ts is falsy. Default '' (empty string).
export function daysAgo(ts, nullFallback = '') {
  if (!ts) return nullFallback;
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

// ── Unit labels ───────────────────────────────────────────────────────────────
const _UNIT_SHORT_MAP = { carton: 'ctn', row: 'row', piece: 'pc' };
export function unitShort(u) { return _UNIT_SHORT_MAP[u] || u || 'unit'; }
// ── Spreadsheet export ───────────────────────────────────────
// Quoted cell. A text value starting with = + - @ would run as a formula in
// Excel or Sheets, so it gets a leading apostrophe. Plain numbers are untouched.
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
// Byte-order mark so Excel reads the file as UTF-8 (names with accents, ₦).
export const CSV_BOM = '﻿';
