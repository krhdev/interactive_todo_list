/**
 * pwa-install.js
 * KRHDev Interactive To-Do List — Add to Home Screen banner
 * Handles Android (beforeinstallprompt) and iOS (Safari manual guide)
 *
 * USAGE: Add to your HTML just before </body>:
 *   <script src="pwa-install.js"></script>
 *
 * No other changes needed — the banner and styles are injected automatically.
 */

(function () {
  'use strict';

  /* ─── Config ─────────────────────────────────────────────────────────── */
  const STORAGE_KEY   = 'krhdev-install-dismissed'; // localStorage key
  const DISMISS_DAYS  = 7;                           // re-show after this many days

  /* ─── State ───────────────────────────────────────────────────────────── */
  let deferredPrompt = null;

  /* ─── Inject CSS ──────────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    #krhdev-install-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 99999;
      background: #510061;
      color: #ffffff;
      font-family: inherit;
      box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.5);
      transform: translateY(100%);
      transition: transform 0.3s ease;
    }
    #krhdev-install-banner.krhdev-visible {
      transform: translateY(0);
    }
    #krhdev-install-inner {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      max-width: 680px;
      margin: 0 auto;
      padding: 12px 16px;
    }
    #krhdev-install-icon {
      font-size: 1.4rem;
      flex-shrink: 0;
    }
    #krhdev-install-msg {
      flex: 1;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    #krhdev-install-msg strong {
      font-weight: 700;
    }
    #krhdev-install-btn {
      background: #ffffff;
      color: #510061;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }
    #krhdev-install-btn:hover,
    #krhdev-install-btn:focus {
      background: #e8c8ef;
      outline: 2px solid #ffffff;
    }
    #krhdev-install-dismiss {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-radius: 50%;
      color: #ffffff;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease;
    }
    #krhdev-install-dismiss:hover,
    #krhdev-install-dismiss:focus {
      background: rgba(255, 255, 255, 0.2);
      outline: none;
    }
    /* Hide the install button on iOS — can't trigger programmatically */
    .krhdev-ios #krhdev-install-btn {
      display: none;
    }
  `;
  document.head.appendChild(style);

  /* ─── Inject HTML ─────────────────────────────────────────────────────── */
  const banner = document.createElement('div');
  banner.id = 'krhdev-install-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Install app');
  banner.innerHTML = `
    <div id="krhdev-install-inner">
      <span id="krhdev-install-icon" aria-hidden="true">📲</span>
      <span id="krhdev-install-msg"></span>
      <button id="krhdev-install-btn" type="button">Add to Home Screen</button>
      <button id="krhdev-install-dismiss" type="button" aria-label="Dismiss install prompt">✕</button>
    </div>
  `;
  document.body.appendChild(banner);

  const msgEl     = document.getElementById('krhdev-install-msg');
  const installBtn = document.getElementById('krhdev-install-btn');
  const dismissBtn = document.getElementById('krhdev-install-dismiss');

  /* ─── Helpers ─────────────────────────────────────────────────────────── */
  function wasDismissedRecently() {
    const ts = localStorage.getItem(STORAGE_KEY);
    if (!ts) return false;
    const diff = Date.now() - parseInt(ts, 10);
    return diff < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  function showBanner() {
    // Small delay so the page has painted first
    setTimeout(() => banner.classList.add('krhdev-visible'), 800);
  }

  function hideBanner() {
    banner.classList.remove('krhdev-visible');
  }

  function dismiss() {
    hideBanner();
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  }

  /* ─── Platform Detection ──────────────────────────────────────────────── */
  const ua              = navigator.userAgent.toLowerCase();
  const isIos           = /iphone|ipad|ipod/.test(ua);
  const isAndroidChrome = /android/.test(ua) && /chrome/.test(ua) && !/edg/.test(ua);
  const isStandalone    = ('standalone' in window.navigator && window.navigator.standalone)
                        || window.matchMedia('(display-mode: standalone)').matches;

  /* ─── iOS Flow ────────────────────────────────────────────────────────── */
  if (isIos && !isStandalone && !wasDismissedRecently()) {
    banner.classList.add('krhdev-ios');
    msgEl.innerHTML = `Tap <strong>Share ⬆</strong> then <strong>"Add to Home Screen"</strong> to install this app.`;
    showBanner();
  }

  /* ─── Android / Chrome Flow ───────────────────────────────────────────── */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    if (isStandalone || wasDismissedRecently()) return;

    msgEl.innerHTML = `Install <strong>To-Do List</strong> on your device for quick access — no browser needed.`;
    showBanner();
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      hideBanner();
    }
    deferredPrompt = null;
  });

  /* ─── App installed event ─────────────────────────────────────────────── */
  window.addEventListener('appinstalled', () => {
    hideBanner();
    deferredPrompt = null;
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    console.log('[KRHDev PWA] App installed successfully.');
  });

  /* ─── Dismiss button ──────────────────────────────────────────────────── */
  dismissBtn.addEventListener('click', dismiss);

})();