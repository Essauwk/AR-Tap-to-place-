// ar/arSetup.js — WebXR Hit-Test AR + Three.js Scene (ES Module)

import * as THREE                        from 'three';
import { loadCharacter, loadExtraAnimations } from './characterLoader.js';
import { initTapHandler }                from './tapHandler.js';
import { AnimationController }           from '../character/animationController.js';
import { startActiveMode }               from '../mode.js';
import { showLoadingStatus, hideLoadingScreen, showError, showToast } from '../ui/loadingScreen.js';
import {
  isMobileDevice, isSecurePage, isIOS, supportsWebXRAR,
} from './browserSupport.js';
import { showTapPrompt, hideTapPrompt } from '../ui/tapPrompt.js';
import { placeCharacterAtWorldPosition } from './placement.js';

console.log('[ARSetup] THREE r' + THREE.REVISION + ' loaded via ES module.');

// ─── Globals ──────────────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
let animController = null;
let characterRoot   = null;
let hitTestSource   = null;
let hitTestSourceRequested = false;
let reticle         = null;
let placed          = false;
let _computedCharacterScale = 1.0; // set after loadCharacter()

// Safari camera-AR state
let _safariStream            = null;
let _safariVideoEl           = null;
let _safariOrientationHandler = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    showLoadingStatus('Setting up 3D scene...');
    initThreeScene();

    // Show the AR button immediately without waiting for model
    showLoadingStatus('Ready');
    await sleep(200);
    hideLoadingScreen();
    await buildARButton();

    // Load character in background (will be ready by the time user taps START AR)
    showLoadingStatus('Loading character...');
    await loadCharacterIntoScene();

    console.log('[ARSetup] Boot complete.');
  } catch (err) {
    console.error('[ARSetup] Boot error:', err);
    showError('Initialization Failed', err.message || 'An unexpected error occurred. Check console.');
  }
}

// ─── Three.js Scene Setup ────────────────────────────────────────────────────
function initThreeScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const container = document.getElementById('ar-container');
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  scene.add(camera);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(1, 3, 2);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-2, 1, -1);
  scene.add(fill);

  clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  buildReticle();
  console.log('[ARSetup] Three.js scene initialized.');
}

// ─── Reticle ─────────────────────────────────────────────────────────────────
function buildReticle() {
  const geo = new THREE.RingGeometry(0.12, 0.14, 32);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, opacity: 0.85, transparent: true, side: THREE.DoubleSide
  });
  reticle = new THREE.Mesh(geo, mat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

// ─── AR Button ───────────────────────────────────────────────────────────────
function createStartARButton(onClick) {
  const btn = document.createElement('button');
  btn.id = 'ar-start-btn';
  btn.textContent = 'START AR';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '60px', left: '50%',
    transform: 'translateX(-50%)',
    padding: '16px 48px',
    background: '#ffffff', color: '#000000',
    border: 'none', borderRadius: '100px',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px', fontWeight: '700',
    letterSpacing: '0.12em',
    cursor: 'pointer', zIndex: '200',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    minHeight: '44px',
  });
  btn.addEventListener('click', onClick);
  document.body.appendChild(btn);

  // ── Also add the LIPSYNC button below ──────────────────────────────────────
  addLipsyncButton();

  return btn;
}

function addLipsyncButton() {
  // Remove if already exists
  document.getElementById('ar-lipsync-btn')?.remove();

  const btn = document.createElement('button');
  btn.id = 'ar-lipsync-btn';

  // Icon + text
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
    START AR LIPSYNC
  `;

  Object.assign(btn.style, {
    position: 'fixed', bottom: '16px', left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 32px',
    background: 'rgba(10,16,40,0.85)',
    color: '#ffffff',
    border: '1.5px solid rgba(79, 142, 255, 0.6)',
    borderRadius: '100px',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px', fontWeight: '700',
    letterSpacing: '0.10em',
    cursor: 'pointer', zIndex: '200',
    boxShadow: '0 4px 24px rgba(79,142,255,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
    minHeight: '44px',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    display: 'flex', alignItems: 'center', gap: '8px',
    whiteSpace: 'nowrap',
    transition: 'transform 0.15s, box-shadow 0.2s',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateX(-50%) scale(1.03)';
    btn.style.boxShadow = '0 6px 32px rgba(79,142,255,0.5), inset 0 1px 0 rgba(255,255,255,0.12)';
    btn.style.borderColor = 'rgba(79, 142, 255, 0.9)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translateX(-50%) scale(1)';
    btn.style.boxShadow = '0 4px 24px rgba(79,142,255,0.3), inset 0 1px 0 rgba(255,255,255,0.08)';
    btn.style.borderColor = 'rgba(79, 142, 255, 0.6)';
  });

  btn.addEventListener('click', () => {
    window.location.href = 'lipsync.html';
  });

  document.body.appendChild(btn);
}

async function buildARButton() {
  if (!isSecurePage() && isMobileDevice()) {
    showToast('AR requires HTTPS — open the https:// tunnel link on your phone.', 8000);
  }

  const webxr = await supportsWebXRAR();

  // WebXR supported (WebXR Viewer, Chrome Android, etc.)
  if (webxr) {
    createStartARButton(startARSession);
    console.log('[ARSetup] START AR button ready (WebXR).');
    return;
  }

  // iOS Safari without WebXR → real camera feed + device orientation AR
  if (isIOS() && isSecurePage()) {
    createStartARButton(startSafariARSession);
    console.log('[ARSetup] START AR button ready (Safari camera AR).');
    return;
  }

  // Other mobile without WebXR → try anyway
  if (isMobileDevice() && isSecurePage()) {
    createStartARButton(startARSession);
    return;
  }

  console.warn('[ARSetup] WebXR not available — falling back to 3D preview.');
  showDesktopFallback();
}

// ─── Safari Camera AR ────────────────────────────────────────────────────────
async function startSafariARSession() {
  document.getElementById('ar-start-btn')?.remove();

  // iOS 13+ requires explicit permission for DeviceOrientationEvent
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      await DeviceOrientationEvent.requestPermission();
    } catch (e) {
      console.warn('[SafariAR] DeviceOrientation permission error:', e);
    }
  }

  // Request rear camera
  try {
    _safariStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (err) {
    showToast('Camera access denied. Enable in Safari Settings → Privacy → Camera.', 7000);
    createStartARButton(startSafariARSession);
    return;
  }

  // Full-screen camera video behind the Three.js canvas
  _safariVideoEl = document.createElement('video');
  _safariVideoEl.id = 'safari-ar-video';
  _safariVideoEl.srcObject = _safariStream;
  _safariVideoEl.autoplay = true;
  _safariVideoEl.playsInline = true;
  _safariVideoEl.muted = true;
  Object.assign(_safariVideoEl.style, {
    position: 'fixed', inset: '0',
    width: '100%', height: '100%',
    objectFit: 'cover', zIndex: '0',
  });
  document.body.prepend(_safariVideoEl);
  await _safariVideoEl.play().catch(() => {});

  // Three.js canvas on top (alpha:true → transparent background)
  const container = document.getElementById('ar-container');
  container.style.zIndex = '1';
  container.classList.remove('hidden');

  // Camera at standing eye-level
  camera.position.set(0, 1.2, 0);
  camera.rotation.order = 'YXZ';

  // Switch reticle to position-based updates (not raw matrix mode used in WebXR)
  reticle.matrixAutoUpdate = true;
  reticle.visible = false;

  // Device orientation → Three.js camera  (official Three.js DeviceOrientationControls algorithm)
  const _devEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _devQ1    = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° X
  const _screenQ  = new THREE.Quaternion();
  const _screenZ  = new THREE.Vector3(0, 0, 1);

  _safariOrientationHandler = (e) => {
    const alpha  = THREE.MathUtils.degToRad(e.alpha ?? 0);
    const beta   = THREE.MathUtils.degToRad(e.beta  ?? 0);
    const gamma  = THREE.MathUtils.degToRad(e.gamma ?? 0);
    const orient = THREE.MathUtils.degToRad(window.screen?.orientation?.angle ?? 0);
    _devEuler.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(_devEuler);
    camera.quaternion.multiply(_devQ1);
    _screenQ.setFromAxisAngle(_screenZ, -orient);
    camera.quaternion.multiply(_screenQ);
  };
  window.addEventListener('deviceorientation', _safariOrientationHandler);

  document.documentElement.classList.add('xr-active');
  document.body.classList.add('xr-active');

  showTapPrompt();
  showLogo();

  // Vectors reused every frame for ray-floor intersection
  const _rayDir  = new THREE.Vector3();
  const _floorPt = new THREE.Vector3();
  let   _lastValidFloor = null; // last known good floor hit
  let   _currentT       = 2.0;  // current ray→floor distance (updated each frame)

  // Enable pinch-to-scale (same handlers used by WebXR path)
  document.body.addEventListener('touchstart', onTouchStart, { passive: true });
  document.body.addEventListener('touchmove',  onTouchMove,  { passive: true });

  // Tap → place character at reticle (floor intersection) position
  const tapOnce = () => {
    if (placed) return;
    placed = true;
    reticle.visible = false;
    hideTapPrompt();

    // ── Unlock Safari audio from within the user-gesture stack ────────────────
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { const tmp = new AC(); tmp.resume().then(() => tmp.close()); }
    } catch (_) {}
    if (window.speechSynthesis) {
      // Silent utterance warms up TTS engine for subsequent calls
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }

    // Use last known reticle floor point; fall back to 2m-ahead if unavailable
    const pos = _lastValidFloor
      ? _lastValidFloor.clone()
      : (() => {
          _rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
          _rayDir.y = 0;
          if (_rayDir.lengthSq() < 0.001) _rayDir.set(0, 0, -1);
          _rayDir.normalize();
          return camera.position.clone().add(_rayDir.multiplyScalar(2.0)).setY(0);
        })();

    // Distance-based scale: closer placement = bigger character
    // At t=2m → 1.0× base scale; at t=1m → 1.4×; at t=4m → 0.7×
    const distFactor = Math.max(0.4, Math.min(2.5, Math.sqrt(2.0 / Math.max(_currentT, 0.3))));
    const placementScale = _computedCharacterScale * distFactor;

    placeCharacterAtWorldPosition({
      characterRoot, animController, scene, camera,
      position: pos,
      computedScale: placementScale,
    });
    // placeCharacterAtWorldPosition already calls startActiveMode internally after 1s
  };
  document.body.addEventListener('click', tapOnce, { once: true });

  // ── Render loop — reticle follows ray↔floor intersection each frame ─────────
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    if (animController) animController.update(delta);

    if (!placed) {
      // Cast ray from camera center (forward direction) and intersect with y=0 floor
      _rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

      if (_rayDir.y < -0.01) {
        const t = -camera.position.y / _rayDir.y; // distance along ray to y=0
        if (t > 0.2 && t < 12) {
          _currentT = t;
          _floorPt.set(
            camera.position.x + t * _rayDir.x,
            0,
            camera.position.z + t * _rayDir.z,
          );
          reticle.position.copy(_floorPt);
          reticle.visible = true;
          _lastValidFloor = _floorPt.clone();

          // Scale ring to hint at character size: closer = bigger ring
          const distFactor = Math.max(0.5, Math.min(2.5, Math.sqrt(2.0 / Math.max(t, 0.3))));
          const pulse = 1.0 + 0.12 * Math.sin(Date.now() * 0.005);
          reticle.scale.setScalar(pulse * distFactor);
          reticle.rotation.y += 0.025;
        } else {
          reticle.visible = false;
        }
      } else {
        // Camera pointing upward / horizontal — hide ring
        reticle.visible = false;
      }
    }

    renderer.render(scene, camera);
  });

  console.log('[ARSetup] Safari camera AR started.');
}

/** WebXR via model-viewer — AI chat stays in browser DOM during AR session. */
function beginInARChat() {
  placed = true;
  showLogo();
  setTimeout(() => startActiveMode(characterRoot, animController, scene), 800);
}

/** After Quick Look on iOS — switch to Three.js preview + AI chat. */
function beginPostARChat() {
  placed = true;
  document.getElementById('character-model-viewer')?.classList.add('hidden');
  document.getElementById('ar-container')?.classList.remove('hidden');

  if (characterRoot) {
    characterRoot.visible = true;
    characterRoot.position.set(0, 0, 0);
    animController.playIdle();
    loadExtraAnimations(animController._mixer, animController._animations).then(() => {
      animController._registerNewActions();
    });
  }

  scene.background = null;
  camera.position.set(0, 1.2, 3.5);
  camera.lookAt(0, 0.9, 0);

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    if (animController) animController.update(delta);
    renderer.render(scene, camera);
  });

  showLogo();
  setTimeout(() => startActiveMode(characterRoot, animController, scene), 800);
}

// ─── Desktop / No-XR Fallback ─────────────────────────────────────────────────
function showDesktopFallback() {
  scene.background = new THREE.Color(0x111111);
  camera.position.set(0, 1.6, 8.0);
  camera.lookAt(0, 0.8, 0);

  if (characterRoot) {
    characterRoot.position.set(0, 0, 0);
    characterRoot.visible = true;
    animController.playIdle();
    loadExtraAnimations(animController._mixer, animController._animations).then(() => {
      animController._registerNewActions();
    });
  }

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    if (animController) animController.update(delta);
    renderer.render(scene, camera);
  });

  showToast('AR not supported — running in 3D preview mode', 5000);
  showLogo();
  setTimeout(() => startActiveMode(characterRoot, animController, scene), 1500);
}

// ─── WebXR Session ────────────────────────────────────────────────────────────
async function startARSession() {
  try {
    document.getElementById('ar-start-btn')?.remove();

    let xrSession;
    try {
      xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body },
      });
    } catch {
      xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
      });
    }

    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(xrSession);
    xrSession.addEventListener('end', onXRSessionEnd);

    document.documentElement.classList.add('xr-active');
    document.body.classList.add('xr-active');

    renderer.setAnimationLoop(onXRFrame);

    const { showTapPrompt } = await import('../ui/tapPrompt.js');
    showTapPrompt();

    xrSession.addEventListener('select', onScreenTap);

    document.body.addEventListener('touchstart', onTouchStart, { passive: true });
    document.body.addEventListener('touchmove', onTouchMove, { passive: true });

    showLogo();
    console.log('[ARSetup] XR session started — show reticle and wait for tap.');
  } catch (err) {
    console.error('[ARSetup] XR session failed:', err);
    showToast('Could not start AR: ' + err.message, 5000);
    await buildARButton();
  }
}

// ─── XR Frame ─────────────────────────────────────────────────────────────────
function onXRFrame(timestamp, frame) {
  const delta = clock.getDelta();
  if (animController) animController.update(delta);

  if (!frame) { renderer.render(scene, camera); return; }

  const refSpace = renderer.xr.getReferenceSpace();
  const session  = renderer.xr.getSession();

  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then(vs => {
      session.requestHitTestSource({ space: vs }).then(src => {
        hitTestSource = src;
        console.log('[ARSetup] Hit-test source ready.');
      });
    });
    hitTestSourceRequested = true;
  }

  if (hitTestSource && !placed) {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      reticle.matrixWorldNeedsUpdate = true;
    } else {
      reticle.visible = false;
    }
  }

  renderer.render(scene, camera);
}

// ─── Screen Tap (WebXR Select) ───────────────────────────────────────────────
function onScreenTap() {
  if (placed || !reticle.visible) return;

  const session = renderer.xr.getSession();
  if (session) session.removeEventListener('select', onScreenTap);

  placeCharacterAtReticle();
}

function placeCharacterAtReticle() {
  if (placed || !reticle.visible) return;
  placed = true;
  reticle.visible = false;

  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  reticle.matrix.decompose(pos, rot, scl);

  placeCharacterAtWorldPosition({
    characterRoot,
    animController,
    scene,
    camera,
    position: pos,
    computedScale: _computedCharacterScale,
  });
}

function onXRSessionEnd() {
  hitTestSource = null;
  hitTestSourceRequested = false;
  placed = false;
  if (reticle) reticle.visible = false;

  document.documentElement.classList.remove('xr-active');
  document.body.classList.remove('xr-active');

  renderer.setAnimationLoop(null);
  console.log('[ARSetup] XR session ended.');

  document.body.removeEventListener('touchstart', onTouchStart);
  document.body.removeEventListener('touchmove', onTouchMove);
}

// ─── Pinch to Zoom ────────────────────────────────────────────────────────────
let initialPinchDistance = null;
let initialScale = 1.0;

function getPinchDistance(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onTouchStart(e) {
  if (e.touches.length === 2 && placed && characterRoot) {
    initialPinchDistance = getPinchDistance(e);
    initialScale = characterRoot.scale.x;
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2 && placed && characterRoot && initialPinchDistance) {
    const currentDistance = getPinchDistance(e);
    const scaleFactor = currentDistance / initialPinchDistance;
    let newScale = initialScale * scaleFactor;

    const minScale = _computedCharacterScale * 0.1;
    const maxScale = _computedCharacterScale * 3.0;
    newScale = Math.max(minScale, Math.min(maxScale, newScale));

    characterRoot.scale.setScalar(newScale);
  }
}

// ─── Load Character ───────────────────────────────────────────────────────────
async function loadCharacterIntoScene() {
  const { root, mixer, animations } = await loadCharacter();
  characterRoot = root;
  _computedCharacterScale = root.scale.x;
  console.log('[ARSetup] Computed character scale:', _computedCharacterScale);
  characterRoot.visible = false;
  scene.add(characterRoot);
  animController = new AnimationController(mixer, animations);
  console.log('[ARSetup] Character in scene.');
}

function showLogo() {
  const logo = document.getElementById('top-logo');
  logo.classList.remove('hidden');
  requestAnimationFrame(() => logo.classList.add('visible'));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

boot();
