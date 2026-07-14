// ar/tapHandler.js — Stub for WebXR mode
// In the WebXR flow, tap-to-place is handled directly in arSetup.js via hit-test.
// This module is kept for import compatibility.

import { showTapPrompt, hideTapPrompt } from '../ui/tapPrompt.js';

export function initTapHandler() {
  console.log('[TapHandler] WebXR mode — tap-to-place handled in arSetup.js.');
}

export { showTapPrompt, hideTapPrompt };
