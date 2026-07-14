// ar/modelViewerAR.js — Free model-viewer AR (WebXR on Android, Quick Look on iOS)

import { showTapPrompt, hideTapPrompt } from '../ui/tapPrompt.js';
import { showToast } from '../ui/loadingScreen.js';

let _modelViewer = null;
let _arStatusHandler = null;
let _wasPresenting = false;
let _placedHandled = false;
let _onPlacedCallback = null;
let _onExitCallback = null;

function getModelViewer() {
  if (_modelViewer) return _modelViewer;
  _modelViewer = document.getElementById('character-model-viewer');
  return _modelViewer;
}

function showLogo() {
  const logo = document.getElementById('top-logo');
  logo?.classList.remove('hidden');
  requestAnimationFrame(() => logo?.classList.add('visible'));
}

function showScanPrompt() {
  let el = document.getElementById('mv-scan-prompt');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mv-scan-prompt';
    el.innerHTML = '<p>Move your phone slowly to find the floor</p>';
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
}

function hideScanPrompt() {
  document.getElementById('mv-scan-prompt')?.classList.add('hidden');
}

function handlePlaced(inAR) {
  if (_placedHandled) return;
  _placedHandled = true;
  hideScanPrompt();
  hideTapPrompt();
  _onPlacedCallback?.({ inAR });
}

function onArStatus(event) {
  const mv = event.target;
  const status = mv.getAttribute('ar-status');
  console.log('[ModelViewer] ar-status:', status);

  if (status === 'session-started') {
    _wasPresenting = true;
    document.documentElement.classList.add('xr-active');
    document.body.classList.add('xr-active');
    document.body.classList.add('mv-active');
    document.getElementById('ar-container')?.classList.add('hidden');
    document.getElementById('mv-ar-btn')?.classList.add('hidden');

    showScanPrompt();
    showTapPrompt();
    showLogo();
  }

  if (status === 'object-placed') {
    handlePlaced(true);
  }

  if (status === 'not-presenting' && _wasPresenting) {
    _wasPresenting = false;
    document.documentElement.classList.remove('xr-active');
    document.body.classList.remove('xr-active');
    document.body.classList.remove('mv-active');
    document.getElementById('ar-container')?.classList.remove('hidden');
    document.getElementById('mv-ar-btn')?.classList.remove('hidden');

    if (!_placedHandled) handlePlaced(false);
  }

  if (status === 'failed') {
    showToast('AR failed — try again or use WebXR Viewer on iPhone.', 5000);
    stopModelViewerAR();
  }
}

/**
 * Start model-viewer AR (WebXR in Chrome, Quick Look on iOS Safari).
 * In Safari, we use the native slot="ar-button" to bypass gesture restrictions.
 */
export function startModelViewerAR({ onPlaced, onExit }) {
  const mv = getModelViewer();
  if (!mv) throw new Error('model-viewer element missing from index.html');

  const targetSrc = CONFIG.CHARACTER_MODEL || 'assets/models/character.glb';
  if (!mv.src || !mv.src.endsWith(targetSrc.split('/').pop())) {
    mv.src = targetSrc;
  }

  _onPlacedCallback = onPlaced;
  _onExitCallback = onExit;
  _wasPresenting = false;
  _placedHandled = false;

  if (!_arStatusHandler) {
    _arStatusHandler = onArStatus;
    mv.addEventListener('ar-status', _arStatusHandler);
  }
  
  // The user will tap the native button (#mv-ar-btn), which triggers Quick Look automatically.
}

export async function stopModelViewerAR() {
  const mv = getModelViewer();
  if (mv) {
    mv.classList.add('hidden');
    if (_arStatusHandler) {
      mv.removeEventListener('ar-status', _arStatusHandler);
      _arStatusHandler = null;
    }
  }

  hideScanPrompt();
  hideTapPrompt();
  document.body.classList.remove('mv-active');
  document.documentElement.classList.remove('xr-active');
  document.body.classList.remove('xr-active');
  document.getElementById('ar-container')?.classList.remove('hidden');

  _onPlacedCallback = null;
  _placedHandled = false;
  _wasPresenting = false;

  if (_onExitCallback) {
    await _onExitCallback();
    _onExitCallback = null;
  }
}
