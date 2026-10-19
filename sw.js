// PriceKeeper offline file saver (service worker).
// Keeps a copy of the app's own files on the phone so the app still opens
// with no internet. Shop data is not handled here: the database keeps its
// own copy on the phone, and saves made offline wait in the offline queue.
//
// Internet first: every file is fetched fresh so updates show straight away,
// and the saved copy is only used when there is no internet or the
// connection takes longer than NET_WAIT_MS. Files not listed below are saved
// the first time the app loads them, so new files are covered too.

const CACHE = 'pk-app-v1';
const NET_WAIT_MS = 4000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.json',
  'icons/pricekeeper-logo-v2.png',
  'icons/money-bag.svg',
  'js/app.js',
  'js/auth.js',
  'js/barcode-scanner.js',
  'js/borrowers.js',
  'js/business.js',
  'js/contacts.js',
  'js/customers.js',
  'js/db.js',
  'js/firebase.js',
  'js/history.js',
  'js/insights-engine.js',
  'js/insights.js',
  'js/inventory-math.js',
  'js/inventory.js',
  'js/ledger.js',
  'js/offline-store.js',
  'js/onboarding.js',
  'js/one-record.js',
  'js/pending-overlay.js',
  'js/pk-select.js',
  'js/profit.js',
  'js/reports.js',
  'js/restock-modal.js',
  'js/router.js',
  'js/sale-derive.js',
  'js/staff-auth.js',
  'js/storefront.js',
  'js/supplier-modal.js',
  'js/suppliers-store.js',
  'js/suppliers-view.js',
  'js/sync-engine.js',
  'js/trade-modal.js',
  'js/trade-payment.js',
  'js/trade-receipt.js',
  'js/trade-table.js',
  'js/trade.js',
  'js/user-menu.js',
  'js/utils.js',
  'js/wholesale.js',
  'js/write-gateway.js',
  'css/barcode-scanner.css',
  'css/business.css',
  'css/cards.css',
  'css/inventory-d33.css',
  'css/main.css',
  'css/mobile-fix.css',
  'css/offline-banner.css',
  'css/pages-session4.css',
  'css/pages.css',
  'css/pk-select.css',
  'css/profit-additions.css',
  'css/restock-modal.css',
  'css/suppliers-d9.css',
  'css/tokens.css',
  'css/trade-d34a.css',
  'css/trade-d34b.css',
  'css/trade.css',
];

// Outside files the app needs to start: the database and sign-in code, fonts.
const OUTSIDE = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
];
const OUTSIDE_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not stop the rest from being saved.
    await Promise.all([...APP_FILES, ...OUTSIDE].map(u =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function _handled(url) {
  if (url.origin === self.location.origin) return true;
  if (!OUTSIDE_HOSTS.includes(url.hostname)) return false;
  // Only the Firebase code files on gstatic, never anything else there.
  return url.hostname !== 'www.gstatic.com' || url.pathname.startsWith('/firebasejs/');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!_handled(url)) return;
  event.respondWith(_internetFirst(req, url));
});

async function _internetFirst(req, url) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise(r => setTimeout(() => r(null), NET_WAIT_MS));
  const fromNet = await Promise.race([net.catch(() => null), timeout]);
  if (fromNet) return fromNet;
  const saved = await _saved(cache, req, url);
  if (saved) return saved;
  return net;   // nothing saved: keep waiting for the internet
}

async function _saved(cache, req, url) {
  const hit = await cache.match(req, { ignoreSearch: url.origin === self.location.origin });
  if (hit) return hit;
  // Opening the app (or a #/ screen link) falls back to the saved main page.
  if (req.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.startsWith('/shop')) {
    return (await cache.match('index.html')) || (await cache.match('./'));
  }
  return null;
}
