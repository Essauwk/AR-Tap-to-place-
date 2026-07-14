// ui/aiChatUI.js — Mic button + transcript display for AI chat mode

let _micCallback = null;
let _micBtn      = null;

/**
 * Show the AI chat UI and wire up the mic button.
 * @param {Function} onMicTap — called when user taps the mic button
 */
export function showAIChatUI(onMicTap) {
  const ui = document.getElementById('ai-chat-ui');
  if (!ui) return;

  _micCallback = onMicTap;
  _micBtn      = document.getElementById('mic-btn');

  // Attach tap/click handler
  if (_micBtn) {
    _micBtn.addEventListener('click',      handleMicTap);
    _micBtn.addEventListener('touchstart', handleMicTap, { passive: false });
  }

  ui.classList.remove('hidden');

  // Animate in
  ui.style.opacity = '0';
  ui.style.transform = 'translateY(20px)';
  ui.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  requestAnimationFrame(() => {
    ui.style.opacity   = '1';
    ui.style.transform = 'translateY(0)';
  });

  console.log('[AIChatUI] Shown.');
}

/**
 * Hide the AI chat UI and remove listeners.
 */
export function hideAIChatUI() {
  const ui = document.getElementById('ai-chat-ui');
  if (!ui) return;

  if (_micBtn) {
    _micBtn.removeEventListener('click',      handleMicTap);
    _micBtn.removeEventListener('touchstart', handleMicTap);
  }

  ui.classList.add('hidden');
  console.log('[AIChatUI] Hidden.');
}

/**
 * Update the transcript / response text area.
 * @param {string} text — empty string clears the box
 */
export function setTranscript(text) {
  const el = document.getElementById('transcript-text');
  if (!el) return;

  const box = document.getElementById('transcript-box');

  if (!text || text.trim() === '') {
    if (box) box.style.opacity = '0.4';
    el.textContent = 'Tap the mic and ask me anything...';
  } else {
    if (box) box.style.opacity = '1';
    el.textContent = text;
  }
}

/**
 * Set the listening state: show/hide the listening indicator + mic pulse.
 * @param {boolean} listening
 */
export function setListening(listening) {
  const indicator = document.getElementById('listening-indicator');
  const micBtn    = document.getElementById('mic-btn');

  if (indicator) {
    if (listening) {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  }

  if (micBtn) {
    if (listening) {
      micBtn.classList.add('listening');
      micBtn.style.pointerEvents = 'none';
    } else {
      micBtn.classList.remove('listening');
      micBtn.style.pointerEvents = '';
    }
  }

  console.log('[AIChatUI] Listening state:', listening);
}

/**
 * Show a "processing" / thinking state (disable mic, show subtle indicator).
 * @param {boolean} processing
 */
export function setProcessing(processing) {
  const micBtn = document.getElementById('mic-btn');
  if (!micBtn) return;

  if (processing) {
    micBtn.style.opacity        = '0.4';
    micBtn.style.pointerEvents  = 'none';
    micBtn.querySelector('.mic-label').textContent = '...';
  } else {
    micBtn.style.opacity        = '1';
    micBtn.style.pointerEvents  = '';
    micBtn.querySelector('.mic-label').textContent = 'SPEAK';
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────
function handleMicTap(e) {
  e.preventDefault();
  if (_micCallback) _micCallback();
}
