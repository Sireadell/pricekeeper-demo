// ============================================================
//  onboarding.js — First-launch experience
//  Shows once, cinematic, teaches 4 core concepts
//  Sets shop name + optional sample data on completion
// ============================================================

import { saveLocal, toast } from './utils.js';
import { today }     from './utils.js';
const STEPS = [
  {
    emoji: '📦',
    title: 'Your Market,\nDigitised.',
    sub: 'Add any item the way you bought it. Carton, row, or piece. The app does the maths so you always know your cost and your profit.',
    demo: 'demo-inventory',
  },
  {
    emoji: '💼',
    title: 'Sell Fast.\nNo Stress.',
    sub: 'Tap an item, pick how many, done. Your receipt is ready before the customer finishes counting the money.',
    demo: 'demo-trade',
  },
  {
    emoji: '💸',
    title: 'Nobody\nRuns Away.',
    sub: 'Every person that owes you is here. Every naira. Every day. Send them a WhatsApp reminder without leaving the app.',
    demo: 'demo-borrowers',
  },
  {
    emoji: '🏪',
    title: 'Make It\nYours.',
    sub: 'Type your shop name below. It will show on every receipt you print or share with customers.',
    demo: 'demo-setup',
  },
];

const SAMPLE_ITEMS = [
  { name: 'Indomie (Carton)', buyUnit: 'carton', buyPrice: 4800, buy: 40, sell: 55, cartonSell: 6600, piecesPerCarton: 120, rowsPerCarton: 10, piecesPerRow: 12, cat: 'Food & Grains', qty: '5', low: false, note: '' },
  { name: 'Peak Milk (Carton)', buyUnit: 'carton', buyPrice: 7200, buy: 60, sell: 80, cartonSell: 9600, piecesPerCarton: 120, rowsPerCarton: 10, piecesPerRow: 12, cat: 'Beverages', qty: '3', low: false, note: '' },
  { name: 'Omo Detergent', buyUnit: 'row', buyPrice: 1500, buy: 125, sell: 160, rowSell: 1920, piecesPerRow: 12, cat: 'Household', qty: '24', low: true, note: 'Buy from Alhaji Musa' },
];

let _currentStep = 0;
let _overlay     = null;

export function checkOnboarding() {
  if (localStorage.getItem('pkOnboardingDone')) return;
  _show();
}
function _show() {
  if (_overlay) return;
  
  // Inject styles directly — guarantees they load with the overlay
  if (!document.getElementById('ob-styles')) {
    const style = document.createElement('style');
    style.id = 'ob-styles';
    style.textContent = `
      #onboardingOverlay{position:fixed;inset:0;z-index:99999;background:#080a0f;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s ease;font-family:'Syne',sans-serif;}
      #onboardingOverlay.ob-visible{opacity:1;}
      #onboardingOverlay.ob-outro{opacity:0;transform:scale(1.04);transition:opacity .5s ease,transform .5s ease;}
      .ob-shell{width:100%;max-width:420px;height:100%;max-height:100dvh;display:flex;flex-direction:column;padding:0;position:relative;overflow:hidden;}
      .ob-skip{position:absolute;top:18px;right:18px;background:none;border:none;color:#5a6480;font-family:'Syne',sans-serif;font-size:.78rem;font-weight:700;cursor:pointer;z-index:10;padding:6px 10px;letter-spacing:.04em;transition:color .2s;}
      .ob-skip:hover{color:#e8ecf4;}
      .ob-stage{flex:1;display:flex;align-items:center;justify-content:center;padding:60px 24px 24px;transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s ease;}
      .ob-stage.ob-exit-left{transform:translateX(-40px);opacity:0;}
      .ob-stage.ob-exit-right{transform:translateX(40px);opacity:0;}
      .ob-stage.ob-enter-right{transform:translateX(40px);opacity:0;}
      .ob-stage.ob-enter-left{transform:translateX(-40px);opacity:0;}
      .ob-step{width:100%;display:flex;flex-direction:column;gap:0;}
      .ob-emoji{font-size:2.8rem;margin-bottom:18px;line-height:1;filter:drop-shadow(0 0 20px rgba(245,200,66,.3));animation:ob-float 3s ease-in-out infinite;}
      @keyframes ob-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}
      .ob-title{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(1.9rem,7vw,2.4rem);line-height:1.1;letter-spacing:-.03em;color:#fff;margin-bottom:14px;background:linear-gradient(135deg,#ffffff 0%,#c8d0e8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
      .ob-sub{font-size:.88rem;color:#5a6480;line-height:1.6;margin-bottom:28px;max-width:320px;}
      .ob-demo-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;width:100%;backdrop-filter:blur(8px);box-sizing:border-box;}
      .ob-demo-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      .ob-demo-label{font-family:'Syne',sans-serif;font-weight:700;font-size:.82rem;color:#e8ecf4;}
      .ob-demo-tag{font-size:.68rem;font-family:'Syne',sans-serif;font-weight:700;background:rgba(245,200,66,.12);color:#f5c842;border:1px solid rgba(245,200,66,.2);border-radius:10px;padding:2px 8px;}
      .ob-tag-row{background:rgba(77,142,240,.12)!important;color:#4d8ef0!important;border-color:rgba(77,142,240,.2)!important;}
      .ob-demo-prices{display:flex;gap:6px;flex-wrap:wrap;}
      .ob-price-chip{font-size:.7rem;font-family:'Syne',sans-serif;font-weight:700;border-radius:8px;padding:4px 10px;border:1px solid transparent;}
      .ob-price-chip.cost{background:rgba(90,100,128,.2);color:#8892a8;border-color:rgba(90,100,128,.3);}
      .ob-price-chip.sell{background:rgba(77,142,240,.12);color:#4d8ef0;border-color:rgba(77,142,240,.25);}
      .ob-price-chip.profit{background:rgba(46,204,113,.12);color:#2ecc71;border-color:rgba(46,204,113,.25);}
      .ob-trade-item{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.82rem;}
      .ob-trade-item span:first-child{color:#c8d0e8;font-family:'Syne',sans-serif;font-weight:600;}
      .ob-trade-chip{font-size:.68rem;font-family:'Syne',sans-serif;font-weight:700;background:rgba(245,200,66,.1);color:#f5c842;border-radius:8px;padding:2px 8px;}
      .ob-trade-amt{font-family:'Syne',sans-serif;font-weight:800;color:#2ecc71;font-size:.82rem;}
      .ob-trade-divider{height:1px;background:rgba(245,200,66,.2);margin:10px 0;}
      .ob-trade-total{display:flex;justify-content:space-between;font-family:'Syne',sans-serif;font-weight:800;font-size:.95rem;color:#fff;}
      .ob-trade-cta{margin-top:10px;text-align:center;font-size:.75rem;color:#f5c842;font-family:'Syne',sans-serif;font-weight:700;background:rgba(245,200,66,.08);border-radius:8px;padding:8px;border:1px solid rgba(245,200,66,.15);animation:ob-pulse 2s ease-in-out infinite;}
      @keyframes ob-pulse{0%,100%{opacity:.7;}50%{opacity:1;}}
      .ob-borr-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);}
      .ob-borr-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:800;font-size:.82rem;flex-shrink:0;}
      .ob-borr-row.red .ob-borr-avatar{background:rgba(255,71,87,.2);color:#ff4757;}
      .ob-borr-row.amber .ob-borr-avatar{background:rgba(255,165,0,.15);color:#ffa500;}
      .ob-borr-row.green .ob-borr-avatar{background:rgba(46,204,113,.15);color:#2ecc71;}
      .ob-borr-name{font-family:'Syne',sans-serif;font-weight:700;font-size:.8rem;color:#e8ecf4;}
      .ob-borr-sub{font-size:.68rem;color:#5a6480;margin-top:1px;}
      .ob-borr-bal{margin-left:auto;font-family:'Syne',sans-serif;font-weight:800;font-size:.82rem;color:#ff4757;}
      .ob-borr-bal.ob-settled{color:#2ecc71;}
      .ob-wa-hint{margin-top:10px;font-size:.72rem;color:#25d366;background:rgba(37,211,102,.08);border-radius:8px;padding:7px 10px;border:1px solid rgba(37,211,102,.15);text-align:center;font-family:'Syne',sans-serif;font-weight:700;}
      .ob-setup-wrap{width:100%;display:flex;flex-direction:column;gap:16px;}
      .ob-setup-field{display:flex;flex-direction:column;gap:6px;}
      .ob-setup-label{font-family:'Syne',sans-serif;font-weight:700;font-size:.78rem;color:#5a6480;text-transform:uppercase;letter-spacing:.08em;}
      .ob-setup-input{background:rgba(255,255,255,.06);border:1.5px solid rgba(245,200,66,.25);border-radius:12px;color:#fff;font-family:'Syne',sans-serif;font-weight:700;font-size:1.1rem;padding:14px 16px;outline:none;transition:border-color .2s,box-shadow .2s;width:100%;box-sizing:border-box;}
      .ob-setup-input:focus{border-color:#f5c842;box-shadow:0 0 0 3px rgba(245,200,66,.12);}
      .ob-setup-input::placeholder{color:rgba(255,255,255,.2);font-weight:400;}
      .ob-setup-hint{font-size:.72rem;color:#5a6480;}
      .ob-sample-toggle{display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:.8rem;color:#8892a8;line-height:1.5;}
      .ob-sample-toggle input{display:none;}
      .ob-sample-box{width:18px;height:18px;border-radius:5px;flex-shrink:0;margin-top:1px;border:2px solid rgba(245,200,66,.3);background:rgba(245,200,66,.05);transition:all .2s;position:relative;}
      .ob-sample-toggle input:checked+.ob-sample-box{background:#f5c842;border-color:#f5c842;}
      .ob-sample-toggle input:checked+.ob-sample-box::after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#080a0f;font-weight:900;}
      .ob-footer{padding:20px 24px 32px;display:flex;align-items:center;justify-content:space-between;gap:16px;}
      .ob-dots{display:flex;gap:6px;align-items:center;}
      .ob-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.15);transition:all .3s ease;}
      .ob-dot.active{width:22px;border-radius:3px;background:#f5c842;box-shadow:0 0 8px rgba(245,200,66,.4);}
      .ob-dot.done{background:rgba(245,200,66,.3);}
      .ob-next-btn{background:#f5c842;color:#080a0f;border:none;border-radius:50px;font-family:'Syne',sans-serif;font-weight:800;font-size:.88rem;padding:13px 28px;cursor:pointer;letter-spacing:.02em;transition:transform .15s ease,box-shadow .15s ease;box-shadow:0 4px 20px rgba(245,200,66,.25);}
      .ob-next-btn:hover{transform:translateY(-1px);box-shadow:0 6px 28px rgba(245,200,66,.4);}
    `;
    document.head.appendChild(style);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'onboardingOverlay';
  _overlay.innerHTML = _buildHTML();
  document.body.appendChild(_overlay);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _overlay.classList.add('ob-visible');
      _renderStep(0);
    });
  });

  let _touchX = 0;
  _overlay.addEventListener('touchstart', e => { _touchX = e.touches[0].clientX; }, { passive: true });
  _overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _touchX;
    if (Math.abs(dx) > 60) dx < 0 ? _next() : _prev();
  }, { passive: true });
}
function _buildHTML() {
  return `
  <div class="ob-shell">
    <button class="ob-skip" onclick="window._obSkip()">Skip →</button>
    <div class="ob-stage" id="obStage"></div>
    <div class="ob-footer">
      <div class="ob-dots" id="obDots"></div>
      <button class="ob-next-btn" id="obNextBtn" onclick="window._obNext()">Continue</button>
    </div>
  </div>`;
}

function _renderStep(idx, direction = 'forward') {
  _currentStep = idx;
  const step  = STEPS[idx];
  const stage = document.getElementById('obStage');
  const dots  = document.getElementById('obDots');
  const btn   = document.getElementById('obNextBtn');
  if (!stage) return;

  // Dots
  if (dots) {
    dots.innerHTML = STEPS.map((_, i) =>
      `<div class="ob-dot ${i === idx ? 'active' : i < idx ? 'done' : ''}"></div>`
    ).join('');
  }

  // Button label
  if (btn) btn.textContent = idx === STEPS.length - 1 ? "Let's Go →" : 'Continue';

  // Animate out old content
  stage.classList.add(direction === 'forward' ? 'ob-exit-left' : 'ob-exit-right');

  setTimeout(() => {
    stage.innerHTML = _buildStep(step, idx);
    stage.className = 'ob-stage ' + (direction === 'forward' ? 'ob-enter-right' : 'ob-enter-left');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => stage.classList.remove('ob-enter-right', 'ob-enter-left'));
    });
    if (idx === 3) _focusSetupInput();
  }, 220);
}

function _buildStep(step, idx) {
  const demos = {
    'demo-inventory': `
      <div class="ob-demo-card">
        <div class="ob-demo-row"><span class="ob-demo-label">Indomie Carton</span><span class="ob-demo-tag">120 pcs</span></div>
        <div class="ob-demo-prices">
          <div class="ob-price-chip cost">Cost <span class="currency">₦</span>40</div>
          <div class="ob-price-chip sell">Sell <span class="currency">₦</span>55</div>
          <div class="ob-price-chip profit">+<span class="currency">₦</span>15 profit</div>
        </div>
        <div class="ob-demo-row" style="margin-top:8px"><span class="ob-demo-label">Peak Milk</span><span class="ob-demo-tag ob-tag-row">Row · 12 pcs</span></div>
        <div class="ob-demo-prices">
          <div class="ob-price-chip cost">Cost <span class="currency">₦</span>60</div>
          <div class="ob-price-chip sell">Sell <span class="currency">₦</span>80</div>
          <div class="ob-price-chip profit">+<span class="currency">₦</span>20 profit</div>
        </div>
      </div>`,
    'demo-trade': `
      <div class="ob-demo-card ob-demo-trade">
        <div class="ob-trade-item"><span>Indomie</span><span class="ob-trade-chip">2 ctn</span><span class="ob-trade-amt"><span class="currency">₦</span>13,200</span></div>
        <div class="ob-trade-item"><span>Peak Milk</span><span class="ob-trade-chip">1 row</span><span class="ob-trade-amt"><span class="currency">₦</span>960</span></div>
        <div class="ob-trade-divider"></div>
        <div class="ob-trade-total"><span>Total</span><span><span class="currency">₦</span>14,160</span></div>
        <div class="ob-trade-cta">🧾 Receipt ready</div>
      </div>`,
    'demo-borrowers': `
      <div class="ob-demo-card">
        <div class="ob-borr-row red"><div class="ob-borr-avatar">A</div><div><div class="ob-borr-name">Alhaji Musa</div><div class="ob-borr-sub">Last: 3 days ago</div></div><div class="ob-borr-bal"><span class="currency">₦</span>12,500</div></div>
        <div class="ob-borr-row amber"><div class="ob-borr-avatar">C</div><div><div class="ob-borr-name">Chioma Obi</div><div class="ob-borr-sub">Last: today</div></div><div class="ob-borr-bal"><span class="currency">₦</span>4,000</div></div>
        <div class="ob-borr-row green"><div class="ob-borr-avatar">E</div><div><div class="ob-borr-name">Emeka Nwosu</div><div class="ob-borr-sub">Settled</div></div><div class="ob-borr-bal ob-settled">✅</div></div>
        <div class="ob-wa-hint">📲 Send WhatsApp reminder in one tap</div>
      </div>`,
    'demo-setup': `
      <div class="ob-setup-wrap">
        <div class="ob-setup-field">
          <label class="ob-setup-label">Your Shop Name</label>
          <input id="obShopName" class="ob-setup-input" type="text"
            placeholder="e.g. Mama Titi Store"
            value="${localStorage.getItem('pkAppName') || ''}"
            oninput="window._obNameInput(this.value)">
          <div class="ob-setup-hint">This appears on every receipt you print</div>
        </div>
        <label class="ob-sample-toggle">
          <input type="checkbox" id="obLoadSample" checked>
          <span class="ob-sample-box"></span>
          <span>Load sample inventory (3 items) so you can explore first</span>
        </label>
      </div>`,
  };

  return `
    <div class="ob-step">
      <div class="ob-emoji">${step.emoji}</div>
      <div class="ob-title">${step.title.replace('\n', '<br>')}</div>
      <div class="ob-sub">${step.sub}</div>
      ${demos[step.demo] || ''}
    </div>`;
}

function _focusSetupInput() {
  setTimeout(() => document.getElementById('obShopName')?.focus(), 300);
}

function _next() {
  if (_currentStep < STEPS.length - 1) {
    _renderStep(_currentStep + 1, 'forward');
  } else {
    _finish();
  }
}

function _prev() {
  if (_currentStep > 0) _renderStep(_currentStep - 1, 'backward');
}

function _finish() {
  // Save shop name
  const nameEl = document.getElementById('obShopName');
  const name   = nameEl?.value.trim();
  if (name && name.length > 60) {
    toast('⚠️ Shop name must be 60 characters or less', 'err');
    return;
  }
  if (name) {
    localStorage.setItem('pkAppName', name);
    document.querySelectorAll('.app-name-label').forEach(el => el.textContent = name);
    document.title = name;
  }

  // Load sample data if checked
  const loadSample = document.getElementById('obLoadSample')?.checked;
  if (loadSample && !(window._pkItems || []).length) {
    const { uid, now } = { uid: () => crypto.randomUUID(), now: () => new Date().toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}) };
    window._pkItems = SAMPLE_ITEMS.map(item => ({
      ...item, id: uid(), addedDate: today(), updatedAt: now(), updatedTs: Date.now(), history: [],
      piecesPerCarton: item.piecesPerCarton || 1,
    }));
    saveLocal();
    if (window.__PK?.renderItems) window.__PK.renderItems();
    if (window.__PK?.updateSummary) window.__PK.updateSummary();
  }

  // Mark done
  localStorage.setItem('pkOnboardingDone', '1');

  // Animate out
  _overlay.classList.add('ob-outro');
  setTimeout(() => {
    _overlay?.remove();
    _overlay = null;
  }, 500);
}

window._obNext  = _next;
window._obSkip  = _finish;
window._obNameInput = (val) => {
  // live preview — update header as they type
  if (val.trim()) {
    document.querySelectorAll('.app-name-label').forEach(el => el.textContent = val.trim());
  }
};