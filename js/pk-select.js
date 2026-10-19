// ============================================================
//  pk-select.js — app-wide searchable / scrollable dropdowns
//
//  Progressively enhances native <select> elements into the same
//  type-to-search, scrollable picker used in the New Trade modal —
//  WITHOUT changing any consumer code. The original <select> stays
//  in the DOM (hidden) so every reader keeps its .value / change
//  contract; we just intercept programmatic value sets to keep the
//  visible label in sync and dispatch 'change' on pick.
//
//  • Auto-enhances every single <select> on load + as new ones are
//    added (modals, re-renders) via a body MutationObserver.
//  • Search box auto-shows once a list passes PK_SEARCH_THRESHOLD
//    options; tiny fixed lists (unit/sort) stay clean click lists.
//    Override per-select with data-pk-search="always" | "never".
//  • Opt a select out entirely with data-no-pk-select.
//  • The popup is fixed-position + body-appended so it never clips
//    inside an overflow:auto modal (the restock / add-item drawers).
// ============================================================

const PK_SEARCH_THRESHOLD = 6;   // show the search row once options exceed this

let _pop = null;        // the single shared popup element (reused, one open at a time)
let _active = null;     // controller of the currently-open select, or null
let _selFocusIdx = -1;  // arrow-key cursor (-1 = nothing highlighted)

// ── Shared popup (built once, reused) ─────────────────────────
function _ensurePopup() {
  if (_pop) return _pop;
  _pop = document.createElement('div');
  _pop.className = 'pk-sel-pop';
  _pop.hidden = true;
  _pop.innerHTML =
    '<div class="pk-sel-searchwrap"><svg class="pk-sel-search-ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
    '<input type="text" class="pk-sel-search" autocomplete="off" spellcheck="false" placeholder="Type to search…">' +
    '<button type="button" class="pk-sel-search-clear" aria-label="Clear search" hidden>✕</button></div>' +
    '<div class="pk-sel-list" role="listbox"></div>';
  document.body.appendChild(_pop);

  const searchEl = _pop.querySelector('.pk-sel-search');
  const clearEl  = _pop.querySelector('.pk-sel-search-clear');

  // Keep the original select's value contract intact while typing.
  searchEl.addEventListener('input', e => {
    clearEl.hidden = !e.target.value;
    if (_active) { _selFocusIdx = -1; _renderList(_active, e.target.value); }
  });
  clearEl.addEventListener('click', () => {
    searchEl.value = '';
    clearEl.hidden = true;
    if (_active) { _selFocusIdx = -1; _renderList(_active, ''); }
    searchEl.focus();
  });
  _pop.querySelector('.pk-sel-search').addEventListener('keydown', e => {
    if (!_active) return;
    if (e.key === 'Escape') { e.preventDefault(); _close(); _active?.trigger.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const opts = Array.from(_pop.querySelectorAll('.pk-sel-opt:not(.is-disabled)'));
      if (!opts.length) return;
      const n = opts.length;
      _selFocusIdx = _selFocusIdx === -1
        ? (e.key === 'ArrowDown' ? 0 : n - 1)
        : Math.max(0, Math.min(n - 1, _selFocusIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      opts.forEach((o, i) => o.classList.toggle('is-focused', i === _selFocusIdx));
      opts[_selFocusIdx]?.scrollIntoView({ block: 'nearest' });
    }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const opts = Array.from(_pop.querySelectorAll('.pk-sel-opt:not(.is-disabled)'));
      const target = _selFocusIdx >= 0 ? opts[_selFocusIdx] : opts[0];
      if (target) _pick(_active, target.dataset.value);
    }
  });
  return _pop;
}

// ── Build the option rows for a select (optionally filtered) ──
function _renderList(ctrl, query) {
  const pop  = _ensurePopup();
  const list = pop.querySelector('.pk-sel-list');
  const q    = (query || '').trim().toLowerCase();
  const cur  = ctrl.select.value;
  const rows = [];
  Array.from(ctrl.select.options).forEach(opt => {
    if (opt.hidden) return;
    const text = opt.text || '';
    if (q && !text.toLowerCase().includes(q)) return;
    const cls = 'pk-sel-opt' + (opt.value === cur ? ' is-selected' : '') + (opt.disabled ? ' is-disabled' : '');
    // textContent via a text node — escape by using a DOM write below.
    const div = document.createElement('div');
    div.className = cls;
    div.setAttribute('role', 'option');
    div.dataset.value = opt.value;
    div.textContent = text;
    rows.push(div.outerHTML);
  });
  if (!rows.length) {
    list.innerHTML = `<div class="pk-sel-empty">No match${q ? ` for “${_esc(query)}”` : ''}</div>`;
    return;
  }
  list.innerHTML = rows.join('');
  // Wire picks (delegation would also work; direct is simplest here).
  list.querySelectorAll('.pk-sel-opt:not(.is-disabled)').forEach(el => {
    el.addEventListener('click', () => _pick(ctrl, el.dataset.value));
  });
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Reflect the selected option onto the trigger label ────────
function _syncLabel(ctrl) {
  const opt = ctrl.select.options[ctrl.select.selectedIndex];
  const text = opt ? (opt.text || '') : '';
  ctrl.label.textContent = text || ctrl.placeholder;
  ctrl.label.classList.toggle('pk-sel-placeholder', !text || (opt && opt.value === ''));
  ctrl.trigger.disabled = ctrl.select.disabled;
}

// ── Selection ─────────────────────────────────────────────────
function _pick(ctrl, value) {
  // Set through the (overridden) value setter so the label updates, then
  // fire 'change' so the consumer's onchange handler runs exactly as before.
  ctrl.select.value = value;
  ctrl.select.dispatchEvent(new Event('change', { bubbles: true }));
  _close();
  ctrl.trigger.focus();
}

// ── Open / position / close ───────────────────────────────────
function _open(ctrl) {
  const pop = _ensurePopup();
  _active = ctrl;

  const count = Array.from(ctrl.select.options).filter(o => !o.hidden).length;
  const mode  = ctrl.select.dataset.pkSearch || 'auto';
  const showSearch = mode === 'always' || (mode !== 'never' && count > PK_SEARCH_THRESHOLD);
  pop.querySelector('.pk-sel-searchwrap').style.display = showSearch ? '' : 'none';
  const search = pop.querySelector('.pk-sel-search');
  search.value = '';
  const clearBtn = pop.querySelector('.pk-sel-search-clear');
  if (clearBtn) clearBtn.hidden = true;

  _renderList(ctrl, '');
  _position(ctrl);
  pop.hidden = false;
  ctrl.trigger.setAttribute('aria-expanded', 'true');
  pop.classList.add('open');

  if (showSearch) setTimeout(() => search.focus(), 0);
  pop.querySelector('.pk-sel-opt.is-selected')?.scrollIntoView({ block: 'nearest' });

  // Close on outside interaction; reposition would detach on scroll, so close.
  setTimeout(() => {
    document.addEventListener('mousedown', _onDocDown, true);
    document.addEventListener('keydown', _onDocKey, true);
    window.addEventListener('scroll', _close, true);
    window.addEventListener('resize', _close, true);
  }, 0);
}

function _position(ctrl) {
  const pop = _ensurePopup();
  const r = ctrl.trigger.getBoundingClientRect();
  pop.style.left  = r.left + 'px';
  pop.style.width = r.width + 'px';
  // Flip up when there isn't room below.
  const spaceBelow = window.innerHeight - r.bottom;
  const maxH = 300;
  if (spaceBelow < 220 && r.top > spaceBelow) {
    pop.style.top = '';
    pop.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    pop.style.maxHeight = Math.min(maxH, r.top - 12) + 'px';
  } else {
    pop.style.bottom = '';
    pop.style.top = (r.bottom + 4) + 'px';
    pop.style.maxHeight = Math.min(maxH, spaceBelow - 12) + 'px';
  }
}

function _close() {
  if (!_pop) return;
  _pop.hidden = true;
  _pop.classList.remove('open');
  if (_active) _active.trigger.setAttribute('aria-expanded', 'false');
  _active = null;
  _selFocusIdx = -1;
  document.removeEventListener('mousedown', _onDocDown, true);
  document.removeEventListener('keydown', _onDocKey, true);
  window.removeEventListener('scroll', _close, true);
  window.removeEventListener('resize', _close, true);
}

function _onDocDown(e) {
  if (_pop.contains(e.target) || (_active && _active.trigger.contains(e.target))) return;
  _close();
}
function _onDocKey(e) { if (e.key === 'Escape') _close(); }

// ── Enhance one <select> ──────────────────────────────────────
function enhance(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.multiple || select.size > 1) return;          // only single-selects
  if (select.dataset.pkenh || select.hasAttribute('data-no-pk-select')) return;
  select.dataset.pkenh = '1';

  const wrap = document.createElement('span');
  wrap.className = 'pk-sel';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'pk-sel-trigger ' + (select.className || '');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="pk-sel-label"></span><span class="pk-sel-caret" aria-hidden="true">▾</span>';

  // Mount: wrapper takes the select's place; the select lives inside, hidden.
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(trigger);
  wrap.appendChild(select);
  select.classList.add('pk-sel-native');

  const ctrl = {
    select, trigger, wrap,
    label: trigger.querySelector('.pk-sel-label'),
    placeholder: '— Select —',
  };

  // Intercept programmatic `select.value = x` so the label tracks code that
  // sets the value without dispatching change (common on edit/open).
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); _syncLabel(ctrl); },
  });

  trigger.addEventListener('click', () => {
    if (_active === ctrl) { _close(); return; }
    if (_active) _close();
    _open(ctrl);
  });
  // Consumers that set value + dispatch change (or rely on native change).
  select.addEventListener('change', () => _syncLabel(ctrl));

  // Options repopulated later (supplier/category/item lists) → refresh.
  new MutationObserver(() => {
    _syncLabel(ctrl);
    if (_active === ctrl) _renderList(ctrl, _pop.querySelector('.pk-sel-search').value);
  }).observe(select, { childList: true, subtree: true });

  _syncLabel(ctrl);
}

// ── Enhance everything under a root + watch for new selects ───
function enhanceAll(root = document) {
  root.querySelectorAll && root.querySelectorAll('select').forEach(enhance);
}

function _init() {
  enhanceAll(document);
  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'SELECT') enhance(n);
        else n.querySelectorAll && n.querySelectorAll('select').forEach(enhance);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
else _init();

window.PKSelect = { enhance, enhanceAll, close: _close };
