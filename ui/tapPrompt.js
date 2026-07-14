// ui/tapPrompt.js — "Tap to Place" animated UI indicator

/**
 * Show the tap-to-place prompt.
 * Adds a ripple animation to guide the user.
 */
export function showTapPrompt() {
  const el = document.getElementById('tap-prompt');
  if (!el) return;
  el.classList.remove('hidden');
  console.log('[TapPrompt] Shown.');
}

/**
 * Hide the tap-to-place prompt with a quick fade.
 */
export function hideTapPrompt() {
  const el = document.getElementById('tap-prompt');
  if (!el) return;

  el.style.transition = 'opacity 0.3s ease';
  el.style.opacity    = '0';

  setTimeout(() => {
    el.classList.add('hidden');
    el.style.opacity = '';
  }, 300);

  console.log('[TapPrompt] Hidden.');
}
