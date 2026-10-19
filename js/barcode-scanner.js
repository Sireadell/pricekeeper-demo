// ============================================================
//  barcode-scanner.js
//  Shared camera barcode scanner used by Add Item (single-shot)
//  and the New Trade cart (continuous). Native BarcodeDetector
//  where the browser has it (Chromium/Android Chrome); falls
//  back to the Sec-ant/barcode-detector WASM ponyfill (loaded
//  from jsDelivr, only when actually needed) for Safari/Firefox.
// ============================================================

import { toast } from './utils.js';

const PONYFILL_URL = 'https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js';
const REPEAT_COOLDOWN_MS = 1200;

let _DetectorClass = null;
let _stream         = null;
let _rafId           = null;
let _closeHandler    = null;
let _lastCode         = null;
let _lastCodeAt       = 0;

// Escape always releases the camera, regardless of which entry point opened it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('barcodeScannerOverlay');
  if (overlay && overlay.style.display !== 'none' && overlay.style.display !== '') closeBarcodeScanner();
});

async function _resolveDetectorClass() {
  if (_DetectorClass) return _DetectorClass;
  if ('BarcodeDetector' in window) {
    _DetectorClass = window.BarcodeDetector;
    return _DetectorClass;
  }
  const mod = await import(PONYFILL_URL);
  _DetectorClass = mod.BarcodeDetector;
  return _DetectorClass;
}

function _overlayEls() {
  return {
    overlay: document.getElementById('barcodeScannerOverlay'),
    video:   document.getElementById('bcsVideo'),
    flash:   document.getElementById('bcsFlash'),
  };
}

export function closeBarcodeScanner() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = null;
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  const { overlay, video } = _overlayEls();
  if (video) video.srcObject = null;
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  _lastCode = null; _lastCodeAt = 0;
  const cb = _closeHandler; _closeHandler = null;
  cb?.();
}

function _flashHit(msg) {
  const { flash } = _overlayEls();
  if (!flash) return;
  flash.textContent = msg;
  flash.style.display = 'block';
  flash.classList.remove('bcs-flash-pop'); void flash.offsetWidth;
  flash.classList.add('bcs-flash-pop');
}

export async function openBarcodeScanner({ continuous = false, onDetect, onClose } = {}) {
  if (_stream) return; // already open — ignore a double-tap on the scan button
  const { overlay, video } = _overlayEls();
  if (!overlay || !video) return;

  let DetectorClass;
  try {
    DetectorClass = await _resolveDetectorClass();
  } catch (e) {
    console.error('[barcode-scanner] detector unavailable:', e);
    toast('Couldn’t load the barcode scanner — check your connection and try again', 'err');
    return;
  }

  try {
    _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    console.error('[barcode-scanner] camera unavailable:', e);
    toast('Couldn’t open the camera — check your browser’s camera permission', 'err');
    return;
  }

  const detector = new DetectorClass({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });

  video.srcObject = _stream;
  await video.play().catch(() => {});
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _closeHandler = onClose || null;

  const tick = async () => {
    if (!_stream) return; // closed mid-loop
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const value = codes[0].rawValue;
        const now = Date.now();
        const isRepeat = value === _lastCode && (now - _lastCodeAt) < REPEAT_COOLDOWN_MS;
        if (!isRepeat) {
          _lastCode = value; _lastCodeAt = now;
          if (continuous) {
            onDetect?.(value);
          } else {
            onDetect?.(value);
            closeBarcodeScanner();
            return;
          }
        }
      }
    } catch (e) {
      // Transient per-frame decode errors are normal (blurry frame, no code in
      // view) — only log, never surface to the shop.
      console.error('[barcode-scanner] detect() error:', e);
    }
    _rafId = requestAnimationFrame(tick);
  };
  _rafId = requestAnimationFrame(tick);
}

// ── Open Food Facts lookup — best-effort name prefill for unknown barcodes.
// Any failure (offline, not found, timeout) resolves to null; callers treat
// that exactly like "not found" and fall back to manual entry.
export async function lookupBarcodeProduct(code) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status !== 1) return null;
    const name = data.product?.product_name?.trim();
    return name ? { name } : null;
  } catch (e) {
    return null;
  }
}

// ── Entry point 1: Add Item drawer (single-shot) ────────────────────────
export function scanItemBarcode() {
  openBarcodeScanner({
    continuous: false,
    onDetect: async (code) => {
      const input = document.getElementById('iBarcode');
      if (input) input.value = code;

      const existing = (window._pkItems || []).find(i => i.barcode === code);
      if (existing) {
        toast(`Already used by ${existing.name} — opening it`, 'warn');
        window.PK?.openEdit?.(existing.id);
        return;
      }

      const nameEl = document.getElementById('iName');
      if (nameEl && !nameEl.value.trim()) {
        const product = await lookupBarcodeProduct(code);
        if (product?.name) nameEl.value = product.name;
      }
    },
  });
}

// ── Entry point 2: New Trade cart (continuous) ───────────────────────────
export function scanTradeBarcode() {
  openBarcodeScanner({
    continuous: true,
    onDetect: (code) => {
      const item = (window._pkItems || []).find(i => i.barcode === code);
      if (!item) {
        toast('Not found — no item has this barcode yet', 'warn');
        return;
      }
      window.PK?.ntmAddByBarcode?.(item.id);
      _flashHit(`✓ ${item.name} ×1 added`);
    },
  });
}
