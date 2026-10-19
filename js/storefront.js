// ============================================================
//  storefront.js — owner side of the public WhatsApp storefront
//
//  Builds a SANITIZED snapshot of sellable items (name + sell prices +
//  a stock badge only — never cost, profit, supplier, or exact stock)
//  and publishes it to shops/{uid}/public/storefront via db.js. The raw
//  items collection is never made public; the public page (shop.html)
//  reads only this clean doc.
//
//  Slice 1: shareable read-only storefront + WhatsApp ordering (orders
//  arrive as a WhatsApp message to the owner — no stored-orders inbox yet).
// ============================================================

import { publishStorefront, claimStorefrontSlug, storefrontSlugTaken } from './db.js';
import { currentUser }       from './auth.js';
import { toast, escapeHtml } from './utils.js';

const SETTINGS_KEY = 'pkStorefrontSettings';
const _defaults = { live: false, showOut: false, showBulk: true };

function _settings() {
  try { return { ..._defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ..._defaults }; }
}
function _saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function _uid() { return currentUser?.uid || window._staffOwnerUid || null; }
// Clean URL when a slug is claimed; otherwise the always-works ?u= fallback.
function _link(uid) {
  const slug = _settings().slug;
  return slug ? `${location.origin}/shop/${slug}` : `${location.origin}/shop.html?u=${uid}`;
}
// Normalise free text into a safe slug: lowercase, a-z0-9, single hyphens.
function _slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Stock badge — mirrors inventory's getStockSummary/_itemStockState exactly.
function _state(it) {
  if (it.trackStock && it.stockQty != null && (parseFloat(it.stockQty) || 0) <= 0) return 'out';
  if (it.low) return 'low';
  return 'in';
}

// The clean payload. ONLY name + sell prices + badge leave the building.
function _buildPayload() {
  const s = _settings();
  let profile = {}; try { profile = JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch (_) {}
  const items = window._pkItems || [];

  const products = items
    .map(it => {
      const pc = parseFloat(it.sell) || 0;
      if (pc <= 0) return null;                       // not priced → not sellable
      const state = _state(it);
      const p = { name: it.name, pc, state };
      if (s.showBulk) {
        const row = parseFloat(it.rowSell) || 0;
        const ctn = parseFloat(it.cartonSell) || 0;
        if (row > 0) p.row = row;
        if (ctn > 0) { p.ctn = ctn; p.ctnLabel = it.buyUnit === 'row' ? 'pack' : 'carton'; }
      }
      return p;
    })
    .filter(Boolean)
    .filter(p => s.showOut ? true : p.state !== 'out');

  return {
    shop: {
      name:     localStorage.getItem('pkAppName') || 'My Shop',
      phone:    profile.phone   || '',
      location: profile.address || '',
      slug:     s.slug || '',
    },
    live: !!s.live,
    products,
  };
}

async function publishNow(silent = false) {
  const uid = _uid();
  if (!uid) { if (!silent) toast('⚠️ Sign in to publish your storefront', 'err'); return; }
  try {
    await publishStorefront(uid, _buildPayload());
    if (!silent) toast('✅ Storefront updated', 'ok');
    _renderInto();   // refresh "last updated" + counts
  } catch (e) {
    console.error('[storefront] publish failed:', e);
    if (!silent) toast('⚠️ Could not update storefront — try again online', 'err');
  }
}

// Re-publish on inventory changes if the storefront is live (called from the
// item save path so the public page stays current without manual republish).
window.__pkRepublishStorefront = function () {
  if (_settings().live && _uid()) publishNow(true);
};

// ── Owner page render ─────────────────────────────────────────────────────────
export function renderStorefront() { _renderInto(); }

function _renderInto() {
  const area = document.getElementById('storefrontArea');
  if (!area) return;
  const uid = _uid();
  const s   = _settings();
  const link = uid ? _link(uid) : '—';
  const count = _buildPayload().products.length;
  let profile = {}; try { profile = JSON.parse(localStorage.getItem('pkShopProfile') || '{}'); } catch (_) {}
  const hasPhone = !!(profile.phone || '').trim();

  const toggle = (key, label, desc) => `
    <div class="setting-row">
      <div class="setting-info"><div class="setting-label">${label}</div><div class="setting-desc">${desc}</div></div>
      <label class="toggle"><input type="checkbox" ${s[key] ? 'checked' : ''} onchange="window.bizStorefrontToggle('${key}', this.checked)"><span class="slider"></span></label>
    </div>`;

  area.innerHTML = `
    <div class="panel-scroll" style="padding:18px;">

      ${!hasPhone ? `<div class="biz-debtbox owing" style="margin-bottom:14px;padding:11px 14px;">
        <div class="biz-debt-lbl" style="color:var(--a2);">⚠ Add your WhatsApp number first</div>
        <div style="font-size:.78rem;color:var(--text2);margin-top:4px;line-height:1.5;">Orders open a WhatsApp chat to you — set your phone in <b>Settings → Shop Profile</b> so customers can reach you.</div>
      </div>` : ''}

      <div class="settings-section">
        <div class="settings-section-title">Your shop link</div>
        <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div class="setting-desc">Pick a short link name customers will see.</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:.74rem;color:var(--muted);white-space:nowrap;">${escapeHtml(location.host)}/shop/</span>
            <input class="setting-input" id="sfSlug" placeholder="${escapeHtml(_slugify(localStorage.getItem('pkAppName')||'') || 'your-shop-name')}" value="${escapeHtml(s.slug || '')}" style="flex:1;min-width:0;font-size:.78rem;">
            <button class="btn-secondary" style="font-size:.74rem;padding:8px 12px;flex-shrink:0;" onclick="window.bizStorefrontSaveSlug()">Save</button>
          </div>
          <input class="setting-input" id="sfLink" readonly value="${escapeHtml(link)}" style="width:100%;font-size:.78rem;margin-top:2px;" onclick="this.select()">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn-secondary" style="font-size:.74rem;padding:8px 14px;" onclick="window.bizStorefrontCopy()">Copy link</button>
            <button class="btn-secondary" style="font-size:.74rem;padding:8px 14px;background:#25D366;color:#04210f;border-color:#25D366;" onclick="window.bizStorefrontShare()">Share on WhatsApp</button>
            <button class="btn-secondary" style="font-size:.74rem;padding:8px 14px;" onclick="window.bizStorefrontOpen()">Preview</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Visibility</div>
        ${toggle('live', 'Storefront is live', 'Turn off to take the link offline anytime')}
        ${toggle('showBulk', 'Show carton / row prices', 'Let customers see bulk prices, not just per-piece')}
        ${toggle('showOut', 'Show out-of-stock items', 'Off = sold-out items are hidden from customers')}
        <div class="setting-row">
          <div class="setting-info"><div class="setting-label">Never shows cost or profit</div><div class="setting-desc">Locked on — customers only ever see your sell prices and a stock badge.</div></div>
          <span style="font-size:.7rem;color:var(--green);font-weight:600;">🔒 Always</span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Publish</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">${count} item${count === 1 ? '' : 's'} on your storefront</div>
            <div class="setting-desc">Updates publish automatically when your prices or stock change. You can also refresh it now.</div>
          </div>
          <button class="btn-secondary" style="font-size:.75rem;padding:8px 14px;flex-shrink:0;" onclick="window.bizStorefrontPublish()">Update now</button>
        </div>
        <div class="setting-row">
          <div class="setting-info"><div class="setting-label">How orders reach you</div><div class="setting-desc">When a customer taps “Order on WhatsApp”, it opens a chat to you with their list ready — you confirm and record it as a normal trade. (A built-in orders inbox is coming next.)</div></div>
        </div>
      </div>

    </div>`;
}

// ── Window handlers ───────────────────────────────────────────────────────────
window.bizStorefrontToggle = function (key, val) {
  const s = _settings(); s[key] = !!val; _saveSettings(s);
  publishNow(true);          // reflect the change publicly right away
  _renderInto();
};
window.bizStorefrontPublish = function () { publishNow(false); };
window.bizStorefrontSaveSlug = async function () {
  const uid = _uid(); if (!uid) { toast('⚠️ Sign in first', 'err'); return; }
  const slug = _slugify(document.getElementById('sfSlug')?.value);
  if (slug.length < 2) { toast('⚠️ Use at least 2 letters or numbers', 'err'); return; }
  try {
    if (await storefrontSlugTaken(slug, uid)) { toast('⚠️ That link name is taken — try another', 'err'); return; }
    await claimStorefrontSlug(uid, slug);
    const s = _settings(); s.slug = slug; _saveSettings(s);
    await publishNow(true);
    toast('✅ Shop link saved', 'ok');
    _renderInto();
  } catch (e) {
    console.error('[storefront] slug claim failed:', e);
    toast('⚠️ Could not save link name — try again', 'err');
  }
};
window.bizStorefrontCopy = function () {
  const uid = _uid(); if (!uid) return;
  publishNow(true);   // make sure the link resolves to a published doc
  navigator.clipboard.writeText(_link(uid)).then(() => toast('📋 Link copied', 'ok'))
    .catch(() => toast('⚠️ Could not copy — long-press the link to copy', 'err'));
};
window.bizStorefrontShare = function () {
  const uid = _uid(); if (!uid) return;
  const link = _link(uid);
  const text = `Shop from ${localStorage.getItem('pkAppName') || 'my shop'} — see prices & order on WhatsApp: ${link}`;
  // Publish first so the shared link is current.
  publishNow(true);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};
window.bizStorefrontOpen = function () {
  const uid = _uid(); if (!uid) return;
  publishNow(true);
  window.open(_link(uid), '_blank');
};
