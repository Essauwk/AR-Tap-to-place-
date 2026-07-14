// ui/presentationUI.js — Slide title overlay + presentation complete screen

let _overlayTimer = null;

/**
 * Show the slide title overlay bar at the bottom of the screen.
 * Auto-hides after 3 seconds.
 * @param {string} slideNum  — e.g. "01"
 * @param {string} title     — slide title text
 */
export function showSlideOverlay(slideNum, title) {
  const overlay  = document.getElementById('slide-overlay');
  const numEl    = document.getElementById('slide-num');
  const titleEl  = document.getElementById('slide-title');

  if (!overlay || !numEl || !titleEl) return;

  // Clear any running hide timer
  if (_overlayTimer) {
    clearTimeout(_overlayTimer);
    _overlayTimer = null;
  }

  numEl.textContent  = slideNum;
  titleEl.textContent = title;

  // Reset animation so it plays again even if already visible
  overlay.classList.remove('hidden');
  overlay.style.animation = 'none';
  // Force reflow to restart animation
  void overlay.offsetWidth;
  overlay.style.animation = '';

  console.log('[PresentationUI] Slide overlay:', slideNum, title);

  // Auto-hide after 3 s
  _overlayTimer = setTimeout(() => {
    hideSlideOverlay();
  }, 3000);
}

/**
 * Hide the slide overlay immediately.
 */
export function hideSlideOverlay() {
  const overlay = document.getElementById('slide-overlay');
  if (!overlay) return;

  overlay.style.transition = 'opacity 0.4s ease';
  overlay.style.opacity    = '0';

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.style.opacity    = '';
    overlay.style.transition = '';
  }, 400);
}

/**
 * Show the "Presentation Complete" pill at the bottom of the screen.
 * Auto-hides after 5 seconds.
 */
export function showPresentationComplete() {
  const el = document.getElementById('presentation-complete');
  if (!el) return;

  el.classList.remove('hidden');
  console.log('[PresentationUI] Presentation complete shown.');

  setTimeout(() => {
    el.style.transition = 'opacity 0.5s ease';
    el.style.opacity    = '0';
    setTimeout(() => {
      el.classList.add('hidden');
      el.style.opacity    = '';
      el.style.transition = '';
    }, 500);
  }, 5000);
}
