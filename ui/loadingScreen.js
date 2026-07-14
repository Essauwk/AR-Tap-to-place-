// ui/loadingScreen.js — Loading screen control + toast + error screen

// ─── Loading Screen ────────────────────────────────────────────────────────────

/**
 * Update the status text shown below the logo during loading.
 * @param {string} message
 */
export function showLoadingStatus(message) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = message;
}

/**
 * Hide the loading screen with a smooth fade-out.
 */
export function hideLoadingScreen() {
  const screen = document.getElementById('loading-screen');
  if (!screen) return;

  screen.style.transition = 'opacity 0.5s ease';
  screen.style.opacity    = '0';
  setTimeout(() => {
    screen.classList.add('hidden');
    screen.style.opacity = '';
  }, 500);

  console.log('[LoadingScreen] Hidden.');
}

// ─── Error Screen ──────────────────────────────────────────────────────────────

/**
 * Show the error screen with a title and descriptive message.
 * Also hides the loading screen.
 * @param {string} title
 * @param {string} message
 */
export function showError(title, message) {
  // Hide loading screen first
  const loading = document.getElementById('loading-screen');
  if (loading) loading.classList.add('hidden');

  // Populate and show error screen
  const errorScreen = document.getElementById('error-screen');
  const titleEl     = document.getElementById('error-title');
  const msgEl       = document.getElementById('error-message');

  if (titleEl) titleEl.textContent = title;
  if (msgEl)   msgEl.textContent   = message;
  if (errorScreen) errorScreen.classList.remove('hidden');

  console.error('[LoadingScreen] Error shown:', title, '—', message);
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

let _toastTimer = null;

/**
 * Show a brief toast notification at the top of the screen.
 * @param {string} message — empty string to hide immediately
 * @param {number} duration — ms to show (default 3000), 0 = permanent until next call
 */
export function showToast(message, duration = 3000) {
  const toast   = document.getElementById('toast');
  const toastMsg= document.getElementById('toast-msg');
  if (!toast || !toastMsg) return;

  // Clear any running timer
  if (_toastTimer) {
    clearTimeout(_toastTimer);
    _toastTimer = null;
  }

  if (!message) {
    toast.classList.add('hidden');
    return;
  }

  toastMsg.textContent = message;
  toast.classList.remove('hidden');

  if (duration > 0) {
    _toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }

  console.log('[Toast]', message);
}
