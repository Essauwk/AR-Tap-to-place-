// lipsync/talkingheadSetup.js — AR + TalkingHead Lipsync
// Uses TalkingHead for animation/lipsync, Web Speech API for audio.

import * as THREE from 'three';
import { TalkingHead } from './talkinghead_main.mjs';
import { SmartLipSync } from './smartLipSync.js';

console.log('[TalkingHeadSetup] Module loaded.');

// ─── State ───────────────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
let characterRoot = null;
let placed = false;
let isSpeaking = false;
let isBusy = false;
let lastTimestamp = 0;

// XR
let xrSession = null;
let hitTestSource = null;
let reticleGroup = null;
let reticleVisible = false;

// Conversation history for Gemini
const _history = [];

// ─── Presentation Mode State ───────────────────────────────────────────────
window.appMode = 'ai'; // 'ai' or 'presentation'
let presSprites = [];
let presActive = false;
let presRaycaster = new THREE.Raycaster();
let presMouse = new THREE.Vector2();
window.presStartTime = 0;
window.isMainPresentation = false;

// ─── Timing Logger ───────────────────────────────────────────────────────────────────
const _logs = [];
let _t0 = 0;

const _LOG_ICONS = { user: '💬', gemini: '🤖', speech: '🔊', lipsync: '👄', error: '❌', info: 'ℹ️' };

function _log(type, msg) {
  const now = performance.now();
  const elapsed = _t0 ? Math.round(now - _t0) : 0;
  const entry = {
    type, icon: _LOG_ICONS[type] || 'ℹ️', msg, elapsed,
    ts: new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  _logs.push(entry);
  console.log(`[LOG][${type}] +${elapsed}ms — ${msg}`);
  _renderLogs();
}

function _renderLogs() {
  const container = document.getElementById('logs-entries');
  const summary = document.getElementById('logs-summary-text');
  if (!container) return;
  const entry = _logs[_logs.length - 1];
  const el = document.createElement('div');
  el.className = 'log-entry ev-' + entry.type;
  el.innerHTML =
    '<span class="log-icon">' + entry.icon + '</span>' +
    '<span class="log-msg">' + entry.msg + '</span>' +
    '<span class="log-time">' + entry.ts + '<br>+' + entry.elapsed + 'ms</span>';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  if (!summary) return;
  const gEntry = [..._logs].reverse().find(l => l.type === 'gemini');
  const sEntry = [..._logs].reverse().find(l => l.type === 'speech');
  const lEntry = [..._logs].reverse().find(l => l.type === 'lipsync');
  const lines = [];
  if (gEntry) lines.push('Gemini reply:    +' + gEntry.elapsed + 'ms');
  if (sEntry) lines.push('Speech start:    +' + sEntry.elapsed + 'ms');
  if (lEntry) lines.push('Lipsync start:   +' + lEntry.elapsed + 'ms');
  if (sEntry && gEntry) lines.push('TTS lag vs Gemini: ' + (sEntry.elapsed - gEntry.elapsed) + 'ms');
  summary.textContent = lines.join('\n') || 'Waiting for first interaction...';
}

// ─── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    setStatus('Setting up…', 15);
    initScene();

    setStatus('Loading character…', 35);
    await loadCharacter();

    setStatus('Ready!', 100);
    await sleep(300);
    hideLoader();

    setUIState('idle');

    // Decide AR mode
    if (isMobile() && isSecure()) {
      // The user explicitly requested Android to use the exact same AR tech as iPhone
      // which is our custom SafariAR session (DeviceOrientation + getUserMedia).
      showStartBtn('START AR LIPSYNC', startSafariARSession);
    } else {
      // Desktop / no camera → 3D preview immediately
      startDesktopPreview();
    }

  } catch (err) {
    console.error('[TalkingHeadSetup] Boot error:', err);
    document.getElementById('loader-status').textContent = '⚠ Error: ' + err.message;
    document.getElementById('loader-status').style.color = '#ff6b6b';
  }
}

// ─── Scene init ──────────────────────────────────────────────────────────────
function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;

  document.getElementById('canvas-wrap').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  clock = new THREE.Clock();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

  // Lighting
  scene.add(new THREE.AmbientLight(0x8899bb, 0.7));

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(1.5, 3, 2); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const fill1 = new THREE.DirectionalLight(0x6688ff, 0.5);
  fill1.position.set(-2, 2, 1);
  scene.add(fill1);

  const fill2 = new THREE.DirectionalLight(0xffeedd, 0.35);
  fill2.position.set(0, 2, -3);
  scene.add(fill2);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ─── Load character ──────────────────────────────────────────────────────────
async function loadCharacter() {
  // TalkingHead in avatarOnly mode — we control the scene/camera/renderer
  window.th = new TalkingHead(document.body, {
    avatarOnly: true,
    avatarOnlyScene: scene,
    avatarOnlyCamera: camera,

    // ── Lipsync ────────────────────────────────────────────────────────────
    lipsyncModules: ['en'],   // English phoneme engine

    // ── Audio ──────────────────────────────────────────────────────────────
    avatarMute: false,
    ttsEndpoint: '',          // no Google TTS; we use SpeechSynthesis ourselves
    ttsTrimStart: 0,
    ttsTrimEnd: 300,          // trim 300ms silence from end of audio buffers

    // ── Animation quality ──────────────────────────────────────────────────
    modelFPS: 60,             // smooth 60fps animation
    modelMovementFactor: 0.8, // slightly calmer body sway (less distraction)

    // ── Eye contact & head movement ────────────────────────────────────────
    avatarMood: 'neutral',
    avatarIdleEyeContact: 0.3,       // relaxed idle gaze
    avatarIdleHeadMove: 0.4,         // subtle idle head movement
    avatarSpeakingEyeContact: 0.7,   // confident eye contact while speaking
    avatarSpeakingHeadMove: 0.6,     // natural head nod while talking
  });

  await window.th.showAvatar({
    url: window.CONFIG?.CHARACTER_MODEL || 'assets/models/rpm_fullbody.glb',
    body: 'M',
    lipsyncLang: 'en',
    ttsLang: 'en-US',
    ttsVoice: 'en-US-Standard-B',
    // Mood while idle vs speaking is controlled from setUIState()
    avatarMood: 'neutral',
    avatarIdleEyeContact: 0.3,
    avatarSpeakingEyeContact: 0.7,
  });

  characterRoot = window.th.armature;

  if (!characterRoot) {
    throw new Error('characterRoot (armature) is null after showAvatar');
  }

  // Auto-scale to ~1.7m
  characterRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(characterRoot);
  const h = box.max.y - box.min.y;
  const s = h > 0.001 ? 1.7 / h : 0.0076;
  characterRoot.scale.setScalar(s);
  characterRoot.userData.baseScale = s;

  // Foot on ground
  characterRoot.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(characterRoot);
  characterRoot.position.y = -box2.min.y;

  characterRoot.visible = false; // hidden until placed
  console.log('[TalkingHeadSetup] Character loaded. Scale:', s.toFixed(5));
}



// ─── Shared per-frame presentation logic (runs in ALL render loops) ───────────
function runPresFrame() {
  // ── HTML Icon Overlay: position icons around character on screen ──
  if (presSprites.length > 0 && characterRoot && camera) {
    const time = performance.now() * 0.002;

    // Get best available camera for projection
    let projCam = camera;
    if (renderer.xr && renderer.xr.isPresenting) {
      const xrCam = renderer.xr.getCamera();
      projCam = (xrCam.cameras && xrCam.cameras.length > 0) ? xrCam.cameras[0] : xrCam;
    }

    // Project character shoulder to screen
    const charWorld = new THREE.Vector3();
    characterRoot.getWorldPosition(charWorld);
    const shoulderWorld = charWorld.clone();
    shoulderWorld.y += characterRoot.scale.y * 0.5;
    const ndcChar = shoulderWorld.clone().project(projCam);

    const isVisible = ndcChar.z < 1;
    const cx = isVisible ? ((ndcChar.x + 1) / 2) * window.innerWidth  : window.innerWidth  * 0.5;
    const cy = isVisible ? ((1 - ndcChar.y) / 2) * window.innerHeight : window.innerHeight * 0.4;

    presSprites.forEach((item, i) => {
      if (!item.el) return;
      const side    = item.worldPos.x >= 0 ? 1 : -1;
      const tier    = item.worldPos.y > 1.4 ? 0 : 1;
      const spreadX = side * Math.min(window.innerWidth  * 0.28, 160);
      const spreadY = (tier === 0 ? -1 : 0.5) * Math.min(window.innerHeight * 0.18, 100);
      const float   = Math.sin(time + i * 1.7) * 7;

      item.el.style.display = 'flex';
      item.el.style.left = (cx + spreadX) + 'px';
      item.el.style.top  = (cy + spreadY + float) + 'px';
    });
  }

  // ── Presentation Timeline ──
  if (window.appMode === 'presentation' && presActive && window.isMainPresentation && window.presStartTime > 0) {
    const currentTime = (performance.now() - window.presStartTime) / 1000;
    if (window.PRESENTATION_DATA && window.PRESENTATION_DATA.events) {
      window.PRESENTATION_DATA.events.forEach((ev, idx) => {
        if (currentTime >= ev.timeSeconds && !ev.triggered) {
          ev.triggered = true;
          spawnPresentationIcon(ev, idx);
        }
      });
    }
  }
}

// ─── Main Render Loop (WebXR + Desktop) ──────────────────────────────────────
function startRenderLoop() {
  lastTimestamp = performance.now();

  renderer.setAnimationLoop((timestamp, frame) => {
    // Compute delta time in ms for TalkingHead
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Drive TalkingHead animations (pose, blinking, lipsync visemes, etc.)
    if (window.th) {
      window.th.animate(delta);
    }

    // Run shared presentation frame logic
    runPresFrame();

    // Hit-test (XR)
    if (frame && hitTestSource) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0 && !placed) {
        const pose = hits[0].getPose(renderer.xr.getReferenceSpace());
        if (pose && reticleGroup) {
          reticleGroup.visible = true;
          reticleGroup.matrix.fromArray(pose.transform.matrix);
          reticleVisible = true;
        }
      } else if (reticleGroup) {
        reticleGroup.visible = false;
        reticleVisible = false;
      }
    }

    renderer.render(scene, camera);
  });
}

// ─── WebXR Session ───────────────────────────────────────────────────────────
async function startWebXRSession() {
  try {
    document.getElementById('ls-start-btn').classList.add('hidden');
    document.getElementById('ls-scan-prompt').style.display = 'block';
    document.getElementById('ls-reticle').style.display = 'block';
    document.body.classList.add('xr-active');

    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'light-estimation'],
      domOverlay: { root: document.body },
    });

    renderer.xr.setSession(xrSession);

    xrSession.addEventListener('end', () => {
      hitTestSource = null; xrSession = null;
      document.body.classList.remove('xr-active');
    });

    const refSpace = await xrSession.requestReferenceSpace('viewer');
    hitTestSource = await xrSession.requestHitTestSource({ space: refSpace });

    // Build reticle
    reticleGroup = new THREE.Group();
    reticleGroup.matrixAutoUpdate = false;
    reticleGroup.visible = false;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.15, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    reticleGroup.add(ring);
    scene.add(reticleGroup);

    xrSession.addEventListener('select', onARTap);

    startRenderLoop();
    setUIState('idle');

    document.getElementById('ls-tap-prompt').style.display = 'flex';
    console.log('[TalkingHeadSetup] WebXR session started.');
  } catch (err) {
    console.error('[TalkingHeadSetup] WebXR error:', err);
    showToast('AR error: ' + err.message);
    startDesktopPreview();
  }
}

function onARTap(event) {
  if (!placed) {
    if (!reticleVisible || !reticleGroup) return;
    placed = true;

    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    reticleGroup.matrix.decompose(pos, rot, scl);

    characterRoot.position.copy(pos);
    
    // Rotate to face camera roughly
    const angle = Math.atan2(camera.position.x - characterRoot.position.x, camera.position.z - characterRoot.position.z);
    characterRoot.rotation.y = angle;

    characterRoot.visible = true;
    reticleGroup.visible = false;

    scene.remove(reticleGroup);
    hitTestSource?.cancel();
    hitTestSource = null;

    document.getElementById('ls-tap-prompt').style.display = 'none';
    document.getElementById('ls-scan-prompt').style.display = 'none';
    document.getElementById('ls-reticle').style.display = 'none';

    onPlaced();
  } else if (window.appMode === 'presentation' && event && event.frame) {
    // 3D Interaction in AR for presentation icons
    if (!renderer.xr.isPresenting) return;
    
    const controller = renderer.xr.getController(0);
    if (!controller) return;
    
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    presRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    presRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    
    const intersects = presRaycaster.intersectObjects(presSprites);
    if (intersects.length > 0) {
      const sprite = intersects[0].object;
      handleIconClick(sprite.userData.eventData, sprite);
    }
  }
}

// ─── Safari iOS AR ────────────────────────────────────────────────────────────
let _safariStream = null;
let _safariVideoEl = null;

async function startSafariARSession() {
  document.getElementById('ls-start-btn').classList.add('hidden');
  document.getElementById('ls-scan-prompt').style.display = 'block';

  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Device orientation denied');
    }
  } catch (e) {
    console.warn('[SafariAR] DeviceOrientation permission error:', e);
  }

  try {
    _safariStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (err) {
    showToast('Camera access denied. Enable in Safari Settings → Privacy → Camera.');
    return;
  }

  _safariVideoEl = document.createElement('video');
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
  await _safariVideoEl.play().catch(() => { });

  document.getElementById('canvas-wrap').style.zIndex = '1';
  scene.background = null;

  camera.position.set(0, 1.2, 0);
  camera.rotation.order = 'YXZ';

  if (!reticleGroup) {
    reticleGroup = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.15, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
    );
    reticleGroup.rotation.x = -Math.PI / 2;
    scene.add(reticleGroup);
  }
  reticleGroup.matrixAutoUpdate = true;
  reticleGroup.visible = false;
  reticleVisible = false;

  const _devEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _devQ1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
  const _screenQ = new THREE.Quaternion();
  const _screenZ = new THREE.Vector3(0, 0, 1);

  window.addEventListener('deviceorientation', (e) => {
    const alpha = THREE.MathUtils.degToRad(e.alpha ?? 0);
    const beta = THREE.MathUtils.degToRad(e.beta ?? 0);
    const gamma = THREE.MathUtils.degToRad(e.gamma ?? 0);
    const orient = THREE.MathUtils.degToRad(window.screen?.orientation?.angle ?? 0);
    _devEuler.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(_devEuler);
    camera.quaternion.multiply(_devQ1);
    _screenQ.setFromAxisAngle(_screenZ, -orient);
    camera.quaternion.multiply(_screenQ);
  });

  document.getElementById('ls-tap-prompt').style.display = 'flex';

  const _rayDir = new THREE.Vector3();
  const _floorPt = new THREE.Vector3();
  let _lastValidFloor = null;
  let _currentT = 2.0;

  const tapOnce = () => {
    if (placed) return;
    placed = true;
    reticleGroup.visible = false;
    document.getElementById('ls-tap-prompt').style.display = 'none';
    document.getElementById('ls-scan-prompt').style.display = 'none';

    // Warm up audio/speech in user gesture
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0; window.speechSynthesis.speak(u);
    }

    const pos = _lastValidFloor ? _lastValidFloor.clone() : (() => {
      _rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _rayDir.y = 0;
      if (_rayDir.lengthSq() < 0.001) _rayDir.set(0, 0, -1);
      _rayDir.normalize();
      return camera.position.clone().add(_rayDir.multiplyScalar(2.0)).setY(0);
    })();

    const baseScale = characterRoot.scale.x;
    const distFactor = Math.max(0.4, Math.min(2.5, Math.sqrt(2.0 / Math.max(_currentT, 0.3))));
    characterRoot.scale.setScalar(baseScale * distFactor);

    characterRoot.position.copy(pos);
    const lookPos = camera.position.clone(); lookPos.y = pos.y;
    characterRoot.lookAt(lookPos);
    characterRoot.visible = true;
    onPlaced();
  };
  document.body.addEventListener('click', tapOnce, { once: true });

  lastTimestamp = performance.now();
  renderer.setAnimationLoop((timestamp) => {
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // Drive TalkingHead animations
    if (window.th) window.th.animate(delta);

    if (!placed) {
      _rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      if (_rayDir.y < -0.01) {
        const t = -camera.position.y / _rayDir.y;
        if (t > 0.2 && t < 12) {
          _currentT = t;
          _floorPt.set(camera.position.x + t * _rayDir.x, 0, camera.position.z + t * _rayDir.z);
          reticleGroup.position.copy(_floorPt);
          reticleGroup.visible = true;
          reticleVisible = true;
          _lastValidFloor = _floorPt.clone();
          const distFactor = Math.max(0.5, Math.min(2.5, Math.sqrt(2.0 / Math.max(t, 0.3))));
          reticleGroup.scale.setScalar(1.0 * distFactor);
        } else { reticleGroup.visible = false; reticleVisible = false; }
      } else { reticleGroup.visible = false; reticleVisible = false; }
    }

    // Run shared presentation frame logic (timeline + icon overlay)
    runPresFrame();

    renderer.render(scene, camera);
  });
}

// ─── Desktop / 3D preview ────────────────────────────────────────────────────
function startDesktopPreview() {
  scene.background = new THREE.Color(0x080c20);

  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.5 })
  );
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
  scene.add(g);

  // Camera: frame from waist up
  camera.position.set(0, 1.4, 2.1);
  camera.lookAt(0, 1.1, 0);

  characterRoot.visible = true;
  placed = true;

  startRenderLoop();
  onPlaced();
}

// ─── After placement ─────────────────────────────────────────────────────────
function onPlaced() {
  // Show chat UI
  document.getElementById('chat-ui').style.display = 'flex';

  // Show scale controls
  initScaleControls();

  // Init speech recognition
  initSpeechRecognition();

  // Greeting
  setTimeout(() => greet(), 600);

  console.log('[TalkingHeadSetup] Character placed. Lipsync active.');
}

// ─── Pinch-to-Scale ──────────────────────────────────────────────────────────
let _baseScale = 1;
let _scaleMulti = 1;

function initScaleControls() {
  const controls = document.getElementById('scale-controls');
  if (controls) controls.style.display = 'none';

  if (!characterRoot) return;
  _baseScale = characterRoot.scale.x;
  _scaleMulti = 1;

  let _pinchStartDist = null;
  let _pinchStartMulti = 1;

  const getDistance = (t1, t2) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Use window to capture touches even when WebXR DOM overlay intercepts canvas touches
  window.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      _pinchStartDist = getDistance(e.touches[0], e.touches[1]);
      _pinchStartMulti = _scaleMulti;
      // Do not prevent default here so clicks/taps can still pass
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && _pinchStartDist) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      const ratio = dist / _pinchStartDist;
      _scaleMulti = Math.max(0.15, Math.min(4.0, _pinchStartMulti * ratio));
      if (characterRoot) characterRoot.scale.setScalar(_baseScale * _scaleMulti);
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('touchend', e => {
    if (e.touches.length < 2) _pinchStartDist = null;
  });

  console.log('[Scale] Pinch-to-scale active. Base:', _baseScale.toFixed(4));
}

// ─── Greeting ─────────────────────────────────────────────────────────────────
async function greet() {
  const msg = "Hi! I'm here and ready to chat. My lips will sync as I speak. Ask me anything!";
  setTranscript(msg);
  await speakWithLipsync(msg);
}

// ─── speakWithLipsync ─────────────────────────────────────────────────────────

// Arabic character → Oculus viseme map
const _AR_VISEME = {
  'ا': 'aa', 'أ': 'aa', 'آ': 'aa', 'إ': 'E', 'ى': 'E', 'ي': 'E', 'ئ': 'E',
  'و': 'ou', 'ؤ': 'ou', 'ة': 'E',
  'ب': 'PP', 'م': 'PP',
  'ف': 'FF',
  'س': 'SS', 'ص': 'SS', 'ز': 'SS', 'ض': 'SS',
  'ث': 'TH', 'ذ': 'TH', 'ظ': 'TH',
  'ش': 'CH', 'ج': 'CH',
  'ت': 'DD', 'د': 'DD', 'ط': 'DD',
  'ن': 'nn', 'ل': 'nn', 'ر': 'RR',
  'ك': 'kk', 'ق': 'kk', 'غ': 'kk', 'خ': 'kk',
  'ع': 'aa', 'ح': 'ih', 'ه': 'ih', 'ء': 'ih',
};

function _arabicVisemes(word) {
  const out = [];
  for (const ch of word) {
    const v = _AR_VISEME[ch];
    if (v && out[out.length - 1] !== v) out.push(v);
  }
  return out.length ? out : ['ih'];
}

// Timing constants — calibrated to browser TTS at rate=0.92 (~125 WPM)
// Formula: 60000ms ÷ (125 WPM × 5 chars/word) ≈ 96ms per character
const _MS_PER_CHAR  = 95;   // was 60 — actual TTS is much slower
const _WORD_MIN_MS  = 250;  // was 180
const _WORD_MAX_MS  = 650;  // was 400
const _PAUSE_COMMA  = 250;  // was 180
const _PAUSE_PERIOD = 500;  // was 350

// Adaptive TTS latency tracker (rolling average of last 3 samples)
const _ttsLatencySamples = [];
let _ttsLatencyAvg = 120;

function _recordTTSLatency(ms) {
  _ttsLatencySamples.push(ms);
  if (_ttsLatencySamples.length > 3) _ttsLatencySamples.shift();
  _ttsLatencyAvg = Math.round(_ttsLatencySamples.reduce((a, b) => a + b, 0) / _ttsLatencySamples.length);
  _log('info', 'TTS latency sample: ' + ms + 'ms | avg: ' + _ttsLatencyAvg + 'ms');
}

function speakWithLipsync(text) {
  return new Promise(async resolve => {
    isSpeaking = true;
    setUIState('speaking');
    window.speechSynthesis?.cancel();

    if (!window.th) { isSpeaking = false; setUIState('idle'); resolve(); return; }

    const estimatedDurMs = SmartLipSync.estimateDuration(text);
    const smartSync      = new SmartLipSync(window.th.armature || characterRoot);

    const _fireTalkingPose = async () => {
      try {
        const ctx = window.th.audioCtx;
        if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch (e) { } }
        const sr = ctx?.sampleRate || 22050;
        const silentBuf = (ctx || new AudioContext()).createBuffer(1, Math.max(1, Math.ceil(sr * estimatedDurMs * 1.2 / 1000)), sr);
        window.th.speakAudio({ words: ['...'], wtimes: [0], wdurations: [estimatedDurMs], audio: silentBuf });
      } catch (e) { console.warn('[TH] talking pose failed:', e); }
    };

    const isEn = window.currentLanguage === 'en';

    // ── ElevenLabs TTS (Arabic High-Quality) ──
    if (!isEn && window.CONFIG?.ELEVENLABS_API_KEY) {
      try {
        _log('speech', 'Fetching ElevenLabs TTS...');
        
        // IMPORTANT: Initialize and resume AudioContext BEFORE the async fetch
        // to bypass browser auto-play policies which require user interaction.
        let audioCtx = window.th.audioCtx;
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          window.th.audioCtx = audioCtx;
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        const voiceId = window.CONFIG?.ELEVENLABS_VOICE_ID || 'ErXwobaYiN019PkySvjV'; // Antoni (Male, Free)
        const myCallId = window.speechCallId;
        const response = await fetch(`${window.CONFIG?.ELEVENLABS_API_ENDPOINT}?voiceId=${voiceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, model_id: 'eleven_multilingual_v2' })
        });
        
        // Abort if another speech was requested or stopSpeaking was called while fetching
        if (window.speechCallId !== myCallId) return;
        
        if (response.ok) {
          const data = await response.json();
          const audioUrl = 'data:audio/mpeg;base64,' + data.audio_base64;
          const audioEl = new Audio(audioUrl);
          
          window.currentElevenLabsSource = {
            stop: () => {
              audioEl.pause();
              audioEl.currentTime = 0;
            }
          };

          audioEl.onended = () => {
            smartSync.stop();
            try {
              const sr = window.th.audioCtx?.sampleRate || 22050;
              const silentBuf = (window.th.audioCtx || new AudioContext()).createBuffer(1, 1, sr);
              window.th.speakAudio({ words: [], wtimes: [], wdurations: [], audio: silentBuf });
            } catch (e) {}
            _log('speech', 'ElevenLabs Done');
            window.currentElevenLabsSource = null;
            isSpeaking = false;
            setUIState('idle');
            resolve();
          };

          const now = performance.now();
          if (window.appMode === 'presentation' && window.isMainPresentation && window.presStartTime === 0) {
            window.presStartTime = now;
          }
          
          try {
            await audioEl.play();
          } catch(err) {
            console.error('Audio playback failed:', err);
            _log('error', 'Audio blocked by browser. Please interact with the page.');
          }
          smartSync.startForText(text, now);
          await _fireTalkingPose();

          // Feed exact ElevenLabs timestamps to smartLipSync!
          if (data.alignment && data.alignment.characters) {
            const chars = data.alignment.characters;
            const starts = data.alignment.character_start_times_seconds;
            let textIdx = 0;
            for (let i = 0; i < chars.length; i++) {
              const char = chars[i];
              const startMs = starts[i] * 1000;
              // Mimic onBoundary by firing at the start of every word
              if (char !== ' ' && (i === 0 || chars[i-1] === ' ')) {
                const boundaryIdx = textIdx;
                const mySrc = window.currentElevenLabsSource;
                setTimeout(() => {
                  if (isSpeaking && window.currentElevenLabsSource === mySrc) {
                    smartSync.onBoundary({ charIndex: boundaryIdx });
                  }
                }, startMs);
              }
              textIdx += char.length;
            }
          }
          return; // Successfully played ElevenLabs, skip native TTS
        } else {
           _log('error', 'ElevenLabs API Error: ' + response.status);
        }
      } catch(e) {
        _log('error', 'ElevenLabs failed: ' + e.message + '. Falling back to native.');
      }
    }

    // ── Native Browser TTS Fallback ──
    const utter    = new SpeechSynthesisUtterance(text);
    utter.lang     = isEn ? 'en-US' : 'ar-EG';
    utter.rate     = isEn ? 1.0 : 0.92; // Arabic TTS sounds better slightly slower
    utter.pitch    = 1.05;
    const preferred = pickMaleVoice();
    if (preferred) utter.voice = preferred;

    let _speakCalledAt = 0;

    // ── onstart: audio is playing RIGHT NOW at performance.now() ──────────
    utter.onstart = async () => {
      const now = performance.now();
      if (window.appMode === 'presentation' && window.isMainPresentation && window.presStartTime === 0) {
        window.presStartTime = now;
      }
      
      _recordTTSLatency(now - _speakCalledAt);
      _log('speech', 'TTS started (latency: ' + Math.round(now - _speakCalledAt) + 'ms)');

      // Start animation at EXACTLY the audio start time.
      // MPL=110ms ensures animation never finishes before audio.
      // onBoundary events will correct fine-grained drift.
      smartSync.startForText(text, now);

      await _fireTalkingPose();
    };

    // onboundary: TTS tells us exactly which word it's saying right now.
    // Correct any drift that has accumulated since onstart.
    utter.onboundary = (event) => {
      smartSync.onBoundary(event);
    };

    // onend: audio finished → close mouth immediately.
    utter.onend = () => {
      smartSync.stop();
      // Force TalkingHead body/head animation to stop immediately too.
      try {
        const sr = window.th.audioCtx?.sampleRate || 22050;
        const silentBuf = (window.th.audioCtx || new AudioContext()).createBuffer(1, 1, sr);
        window.th.speakAudio({ words: [], wtimes: [], wdurations: [], audio: silentBuf });
      } catch (e) {}
      _log('speech', 'Done (' + Math.round(performance.now() - _t0) + 'ms total)');
      try { if (window.th) { window.th.animQueue = []; window.th.speechQueue = []; } } catch (e) { }
      isSpeaking = false;
      setUIState('idle');
      resolve();
    };

    utter.onerror = (e) => {
      smartSync.stop();
      if (e.error === 'interrupted') { resolve(); return; }
      console.warn('[TH] Speech error:', e.error);
      isSpeaking = false; setUIState('idle'); resolve();
    };

    try {
      _speakCalledAt = performance.now();
      window.speechSynthesis.speak(utter);
    } catch (e) {
      smartSync.stop();
      console.warn('[TH] speak() failed:', e);
      isSpeaking = false; setUIState('idle'); resolve();
    }
  });
}

function pickMaleVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return null;

  const isEn = window.currentLanguage === 'en';

  if (!isEn) {
    const arVoices = voices.filter(v => v.lang.startsWith('ar'));
    
    // Priority 1: Egyptian male voice (e.g. Maged on Apple, or Google ar-EG)
    let preferredAr = arVoices.find(v => v.lang === 'ar-EG' && !v.name.toLowerCase().includes('female'));
    
    // Priority 2: Known Arabic male names (Shakir, Maged, Tarik, Naayf)
    if (!preferredAr) {
      const MALE_AR = ['Shakir', 'Hamed', 'Maged', 'Tarik', 'Naayf'];
      preferredAr = arVoices.find(v => MALE_AR.some(n => v.name.includes(n)));
    }
    
    // Priority 3: Any non-female Arabic voice
    if (!preferredAr) {
      preferredAr = arVoices.find(v => !v.name.toLowerCase().includes('female') && !v.name.toLowerCase().includes('zira'));
    }
    
    return preferredAr || arVoices[0] || null;
  }

  const MALE = ['Daniel', 'Alex', 'Tom', 'Rishi', 'Fred', 'Oliver', 'Arthur',
    'James', 'Google UK English Male', 'Microsoft David', 'Microsoft Mark',
    'Guy', 'Ryan', 'Aaron', 'Nathan', 'George', 'Christopher'];
  const FEMALE = ['Samantha', 'Karen', 'Fiona', 'Moira', 'Tessa', 'Victoria',
    'Google UK English Female', 'Microsoft Zira', 'Alice', 'Emma', 'Aria', 'Jenny'];

  for (const name of MALE) {
    const v = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (v) return v;
  }

  const enUS = voices.filter(v => v.lang === 'en-US');
  const nonFemaleUS = enUS.find(v => !FEMALE.some(f => v.name.includes(f)));
  if (nonFemaleUS) return nonFemaleUS;

  return voices.find(v => v.lang.startsWith('en') && !FEMALE.some(f => v.name.includes(f)))
    || voices.find(v => v.lang.startsWith('en'))
    || null;
}

function stopSpeaking() {
  window.speechCallId = (window.speechCallId || 0) + 1; // invalidate pending fetches
  window.speechSynthesis?.cancel();
  if (window.currentElevenLabsSource) {
    try { window.currentElevenLabsSource.stop(); } catch(e){}
    window.currentElevenLabsSource = null;
  }
  isSpeaking = false;
  setUIState('idle');
}


// ─── Gemini AI ────────────────────────────────────────────────────────────────
async function askGemini(userText) {
  // Remove AIza prefix check as some newer keys or different Google Cloud keys might start with AQ.
  _history.push({ role: 'user', parts: [{ text: userText }] });

  const model = window.CONFIG?.GEMINI_MODEL || 'gemini-2.0-flash';
  let res;
  try {
    res = await fetch(
      `${window.CONFIG?.GEMINI_API_ENDPOINT}?model=${model}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: `You are a friendly, engaging AR character assistant. Keep responses natural and concise (1-3 sentences max). You must reply in ${window.currentLanguage === 'en' ? 'English' : 'Arabic'}.` }] },
          contents: _history,
          generationConfig: { temperature: 0.7 },
        }),
      }
    );
  } catch (netErr) {
    _history.pop();
    _log('error', 'Network error: ' + netErr.message);
    throw new Error('Network error: ' + netErr.message);
  }

  if (!res.ok) {
    _history.pop();
    let errMsg = `Gemini HTTP ${res.status}`;
    try {
      const errData = await res.json();
      errMsg += ': ' + (errData?.error?.message || JSON.stringify(errData));
    } catch (e) { }
    _log('error', errMsg);
    throw new Error(errMsg);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!reply) {
    _history.pop();
    const fb = "Gemini returned an empty response!";
    _log('error', fb);
    throw new Error(fb);
  }

  _history.push({ role: 'model', parts: [{ text: reply }] });
  return reply;
}

// ─── Process input ────────────────────────────────────────────────────────────
async function processInput(text) {
  if (isBusy || !text.trim() || !placed) return;
  isBusy = true;


  // Reset timing baseline at the moment of user input
  _t0 = performance.now();
  _log('user', 'You: "' + text.substring(0, 60) + (text.length > 60 ? '...' : '') + '"');
  stopSpeaking();
  setTranscript('You: ' + text, 'user');
  setUIState('thinking');

  try {
    const _t1 = performance.now();
    const reply = await askGemini(text);
    _log('gemini', 'Gemini reply (' + Math.round(performance.now() - _t1) + 'ms): ' + reply.substring(0, 60));
    setTranscript(reply);
    await speakWithLipsync(reply);
  } catch (err) {
    console.error('[TH] Error:', err);
    _log('error', 'Error: ' + err.message);
    const fb = "Sorry, something went wrong. But look — my lips still move!";
    setTranscript(fb);
    await speakWithLipsync(fb);
  } finally {
    isBusy = false;
    setUIState('idle');
  }
}

// ─── Speech recognition ──────────────────────────────────────────────────────
let recognition = null, isListening = false;

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('[TH] No SpeechRecognition'); return; }

  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => { isListening = true; setUIState('listening'); };
  recognition.onresult = e => {
    const result = e.results[e.results.length - 1];
    const text = result[0].transcript;
    setTranscript(text, 'user-interim');
    if (result.isFinal) { isListening = false; processInput(text); }
  };
  recognition.onerror = e => {
    isListening = false; setUIState('idle');
    if (e.error !== 'aborted') showToast('Mic error: ' + e.error);
  };
  recognition.onend = () => { isListening = false; setUIState('idle'); };
}

function startListening() {
  if (!recognition) { showToast('Type your message instead (speech not supported here)'); return; }
  if (isListening) return;
  stopSpeaking();
  try {
    recognition.lang = window.currentLanguage === 'en' ? 'en-US' : 'ar-SA';
    recognition.start();
  } catch { }
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────
function setupInteractiveUI() {
  // Back
  document.getElementById('ls-back-btn')?.addEventListener('click', () => {
    stopSpeaking();
    xrSession?.end();
    window.location.href = 'index.html';
  });

  // Mode Toggle
  const modeBtn = document.getElementById('mode-btn');
  modeBtn?.addEventListener('click', () => {
    if (window.appMode === 'ai') {
      window.appMode = 'presentation';
      modeBtn.textContent = 'Mode: Presentation';
      modeBtn.style.background = 'rgba(79,142,255,0.2)';
      document.getElementById('ls-mic-btn').style.display = 'none';
      document.getElementById('ls-text-input').style.display = 'none';
      document.getElementById('ls-send-btn').style.display = 'none';
      document.getElementById('ls-status-text').textContent = 'Presentation Mode';
      
      // Resume AudioContext synchronously in user gesture (critical for iOS)
      if (window.th?.audioCtx?.state === 'suspended') window.th.audioCtx.resume();
      
      // If MP3 mode: create and play audio element synchronously in this user gesture
      const audioFile = window.PRESENTATION_DATA?.audioFile;
      if (audioFile) {
        // Create audio element and call .play() synchronously
        const _preloadedAudio = new Audio(audioFile);
        _preloadedAudio.play().then(() => {
          _preloadedAudio.pause();
          _preloadedAudio.currentTime = 0;
        }).catch(() => {});
        window._pendingPresentationAudio = _preloadedAudio;
      }
      
      startPresentation();
    } else {
      window.appMode = 'ai';
      modeBtn.textContent = 'Mode: AI';
      modeBtn.style.background = 'rgba(255,79,142,0.2)';
      document.getElementById('ls-mic-btn').style.display = 'flex';
      document.getElementById('ls-text-input').style.display = 'block';
      document.getElementById('ls-send-btn').style.display = 'flex';
      document.getElementById('ls-status-text').textContent = 'Ready';
      stopPresentation();
    }
  });

  // Language Toggle
  window.currentLanguage = 'en'; // default to English as requested in previous step
  const langBtn = document.getElementById('lang-btn');
  langBtn?.addEventListener('click', () => {
    if (window.currentLanguage === 'en') {
      window.currentLanguage = 'ar';
      langBtn.textContent = 'عربي';
      langBtn.style.background = 'rgba(255,255,255,0.08)';
    } else {
      window.currentLanguage = 'en';
      langBtn.textContent = 'English';
      langBtn.style.background = 'rgba(79,142,255,0.2)';
    }
  });

  // Presentation Panel Close
  document.getElementById('presentation-close')?.addEventListener('click', () => {
    document.getElementById('presentation-panel').style.opacity = '0';
    setTimeout(() => document.getElementById('presentation-panel').style.display = 'none', 400);
    
    // Reset all icon opacities
    presSprites.forEach(s => {
      if (s.el) { s.el.style.opacity = '1'; s.el.classList.remove('pres-icon--active'); }
    });

    stopSpeaking();
  });

  // NOTE: Icon clicks are handled by their own pointerdown listeners in spawnPresentationIcon

  // Mic
  const micBtn = document.getElementById('ls-mic-btn');
  micBtn?.addEventListener('click', () => {
    if (isListening) { recognition?.abort(); } else { startListening(); }
  });

  // Send
  const input = document.getElementById('ls-text-input');
  const sendBtn = document.getElementById('ls-send-btn');
  const submit = () => {
    const v = input?.value.trim();
    if (v) { input.value = ''; processInput(v); }
  };
  sendBtn?.addEventListener('click', submit);
  input?.addEventListener('keypress', e => { if (e.key === 'Enter') submit(); });

  // Stop
  document.getElementById('ls-stop-btn')?.addEventListener('click', () => stopSpeaking());

  // ── Logs panel ────────────────────────────────────────────────────────
  const logsBtn = document.getElementById('logs-btn');
  const logsPanel = document.getElementById('logs-panel');
  const logsClear = document.getElementById('logs-clear-btn');
  logsBtn?.addEventListener('click', () => {
    const open = logsPanel.classList.toggle('open');
    logsBtn.classList.toggle('active', open);
  });
  logsClear?.addEventListener('click', () => {
    _logs.length = 0;
    const c = document.getElementById('logs-entries');
    if (c) c.innerHTML = '';
    const s = document.getElementById('logs-summary-text');
    if (s) s.textContent = 'Cleared.';
  });

  // Warm up voices on Safari
  if (window.speechSynthesis?.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => { };
  }
}

function showStartBtn(label, onClick) {
  const btn = document.getElementById('ls-start-btn');
  btn.textContent = label;
  btn.classList.remove('hidden');
  btn.addEventListener('click', onClick, { once: true });
}

// ─── UI state ─────────────────────────────────────────────────────────────────
function setUIState(state) {
  const micBtn = document.getElementById('ls-mic-btn');
  const micLabel = document.getElementById('ls-mic-label');
  const stopBtn = document.getElementById('ls-stop-btn');
  const dot = document.getElementById('ls-dot');
  const txt = document.getElementById('ls-status-text');

  const MAP = {
    idle: { mic: true, micTxt: 'SPEAK', stop: false, dot: 'idle', status: 'Ready' },
    listening: { mic: true, micTxt: 'STOP', stop: false, dot: 'listening', status: 'Listening…' },
    thinking: { mic: false, micTxt: 'SPEAK', stop: true, dot: 'thinking', status: 'Thinking…' },
    speaking: { mic: false, micTxt: 'SPEAK', stop: true, dot: 'speaking', status: 'Speaking…' },
  };

  const s = MAP[state] || MAP.idle;
  if (micBtn) { micBtn.disabled = !s.mic; micBtn.classList.toggle('listening', state === 'listening'); }
  if (micLabel) micLabel.textContent = s.micTxt;
  if (stopBtn) stopBtn.classList.toggle('visible', s.stop);
  if (dot) dot.className = `status-dot ${s.dot}`;
  if (txt) txt.textContent = s.status;

  // Update character expression based on UI state!
  if (window.th && window.th.setMood) {
    if (state === 'speaking') {
      window.th.setMood('happy'); // Give her a friendly smile while talking
    } else if (state === 'listening') {
      window.th.setMood('neutral'); // Look attentive
    } else {
      window.th.setMood('neutral'); // Default
    }
  }
}

function setTranscript(text, role = 'assistant') {
  const el = document.getElementById('ls-transcript');
  if (!el) return;
  el.textContent = text;
  if (role === 'user') el.style.color = 'rgba(180,210,255,0.9)';
  else if (role === 'user-interim') { el.style.color = 'rgba(180,210,255,0.55)'; return; }
  else el.style.color = 'rgba(255,255,255,0.92)';
  el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    el.style.opacity = '1'; el.style.transform = 'translateY(0)';
  });
}

function showToast(msg) {
  const t = document.getElementById('ls-toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

// ─── Loader UI ────────────────────────────────────────────────────────────────
function setStatus(text, pct) {
  const el = document.getElementById('loader-status');
  const bar = document.getElementById('ls-bar');
  if (el) el.textContent = text;
  if (bar) bar.style.width = (pct || 0) + '%';
}

function hideLoader() {
  const el = document.getElementById('loader');
  if (!el) return;
  el.style.opacity = '0';
  el.style.transition = 'opacity 0.5s ease';
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

// ─── Platform helpers ─────────────────────────────────────────────────────────
async function supportsWebXRAR() {
  try { return await navigator.xr?.isSessionSupported('immersive-ar'); } catch { return false; }
}
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }
function isMobile() { return /Android|iPhone|iPad|iPod/.test(navigator.userAgent); }
function isSecure() { return location.protocol === 'https:' || location.hostname === 'localhost'; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Presentation Mode Logic ──────────────────────────────────────────────────
// ─── Play a pre-recorded MP3 with lipsync ─────────────────────────────────────
function speakWithAudioFile(url) {
  return new Promise(resolve => {
    console.log('[MP3] Loading:', url);
    isSpeaking = true;
    setUIState('speaking');
    window.speechSynthesis?.cancel();

    // Reuse the pre-unlocked audio element created synchronously in the click handler
    // This bypasses iOS autoplay restrictions
    const audioEl = window._pendingPresentationAudio || new Audio(url);
    window._pendingPresentationAudio = null;
    // NOTE: Do NOT reassign audioEl.src - it would abort the current load!
    // Just reset position to start
    try { audioEl.currentTime = 0; } catch(e) {}

    // Store reference so stop button works
    window.currentElevenLabsSource = {
      stop: () => { audioEl.pause(); audioEl.currentTime = 0; }
    };

    const startPlay = () => {
      console.log('[MP3] Duration:', audioEl.duration, 's');
      const durMs = (audioEl.duration || 10) * 1000;
      let smartSync = null;

      // Drive lipsync
      if (window.th) {
        smartSync = new SmartLipSync(window.th.armature || characterRoot);

        try {
          const ctx = window.th.audioCtx;
          const sr = ctx?.sampleRate || 22050;
          const frames = Math.max(1, Math.ceil(sr * durMs * 1.2 / 1000));
          const silentBuf = (ctx || new AudioContext()).createBuffer(1, frames, sr);
          window.th.speakAudio({ words: ['...'], wtimes: [0], wdurations: [durMs], audio: silentBuf });
        } catch (e) { console.warn('[MP3] talking pose error:', e); }

        audioEl.onended = () => {
          console.log('[MP3] Ended');
          if (smartSync) smartSync.stop();
          isSpeaking = false;
          setUIState('idle');
          resolve();
        };
      } else {
        audioEl.onended = () => { isSpeaking = false; setUIState('idle'); resolve(); };
      }

      audioEl.play().then(() => {
        console.log('[MP3] Playing! Syncing lipsync and icons now.');
        // Start lipsync EXACTLY when audio starts playing
        const now = performance.now();
        window.presStartTime = now; // Sync the presentation icons exactly to audio start
        
        if (window.th && smartSync) {
          const timestamps = window.PRESENTATION_DATA?.audioTimestamps;
          if (timestamps && timestamps.length > 0) {
            console.log('[MP3] Using exact audio waveform timestamps for perfect lipsync.');
            smartSync.startForTimestamps(timestamps, now);
          } else {
            const textToSync = window.PRESENTATION_DATA?.introText || window.PRESENTATION_DATA?.mainText || '...';
            smartSync.startForText(textToSync, now);
          }
        }
      }).catch(err => {
        console.error('[MP3] Play failed:', err);
        isSpeaking = false;
        setUIState('idle');
        resolve();
      });
    };

    // Try canplaythrough first, fallback to loadedmetadata, fallback to just play
    let played = false;
    const tryPlay = () => {
      if (played) return;
      played = true;
      startPlay();
    };

    // If already loaded (readyState 4 = HAVE_ENOUGH_DATA, 3 = HAVE_FUTURE_DATA)
    if (audioEl.readyState >= 3) {
      console.log('[MP3] Already loaded, playing immediately. readyState:', audioEl.readyState);
      tryPlay();
    } else {
      audioEl.addEventListener('canplaythrough', tryPlay, { once: true });
      audioEl.addEventListener('loadedmetadata', tryPlay, { once: true });
      audioEl.addEventListener('error', (e) => {
        console.error('[MP3] Load error:', e, audioEl.error);
        isSpeaking = false;
        setUIState('idle');
        // Fallback to TTS
        speakWithLipsync(window.PRESENTATION_DATA.mainText).then(resolve);
      }, { once: true });

      // Force load if not started
      if (audioEl.readyState === 0) audioEl.load();

      // Failsafe: if nothing fires in 3s, try anyway
      setTimeout(() => {
        if (!played) {
          console.warn('[MP3] Timeout waiting for load, playing anyway...');
          tryPlay();
        }
      }, 3000);
    }
  });
}

async function startPresentation() {
  if (!window.PRESENTATION_DATA) { showToast('No presentation data found.'); return; }
  stopSpeaking();
  stopPresentation(); // Reset
  presActive = true;
  window.isMainPresentation = true;
  window.presStartTime = 0;
  
  if (window.PRESENTATION_DATA.events) {
    window.PRESENTATION_DATA.events.forEach(e => e.triggered = false);
  }

  // Ensure AudioContext is created/resumed synchronously during this click event!
  if (window.th) {
    let audioCtx = window.th.audioCtx;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      window.th.audioCtx = audioCtx;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  showToast('Presentation Started');
  
  // Start the timeline NOW so icons appear while audio plays
  window.presStartTime = performance.now();

  // Use pre-recorded MP3 if provided, otherwise fall back to TTS
  const audioFile = window.PRESENTATION_DATA.audioFile;
  if (audioFile) {
    await speakWithAudioFile(audioFile);
  } else {
    await speakWithLipsync(window.PRESENTATION_DATA.mainText);
  }
}

function stopPresentation() {
  presActive = false;
  window.isMainPresentation = false;
  window.presStartTime = 0;
  stopSpeaking();
  
  // Remove DOM icon elements
  presSprites.forEach(item => item.el?.remove());
  presSprites = [];
  
  // Hide panel
  document.getElementById('presentation-panel').style.opacity = '0';
  setTimeout(() => document.getElementById('presentation-panel').style.display = 'none', 400);
}

function spawnPresentationIcon(ev, idx) {
  // Prevent duplicates
  if (presSprites.some(item => item.offset === idx)) return;

  console.log('[Pres] Spawning icon', idx, ev.action.title);

  // Create HTML icon element (always visible on mobile regardless of WebXR)
  const el = document.createElement('div');
  el.className = 'pres-icon';
  el.innerHTML = `<img src="${ev.iconUrl}" crossorigin="anonymous" alt="" /><div class="pres-icon-label">${ev.action.title}</div>`;
  
  // Critical: ensure visibility in WebXR DOM overlay
  el.style.cssText += '; position: fixed; z-index: 9999; pointer-events: auto;';
  el.style.display = 'none'; // hidden until first projection frame
  document.body.appendChild(el);

  // Pop-in animation
  el.style.transform = 'translate(-50%, -50%) scale(0)';
  el.style.opacity = '0';
  setTimeout(() => {
    el.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1), opacity 0.4s ease';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
    el.style.opacity = '1';
  }, 50);

  const item = {
    el,
    worldPos: ev.position,
    offset: idx,
    eventData: ev,
  };

  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    // Resume AudioContext synchronously in user gesture
    if (window.th?.audioCtx?.state === 'suspended') window.th.audioCtx.resume();
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
    handleIconClick(ev, item);
  });

  presSprites.push(item);
}

async function handleIconClick(ev, item) {
  stopSpeaking();
  window.isMainPresentation = false;

  // Ensure AudioContext is resumed
  if (window.th?.audioCtx?.state === 'suspended') window.th.audioCtx.resume();

  // Visually highlight clicked icon, dim others
  presSprites.forEach(s => {
    if (s.el) {
      s.el.classList.toggle('pres-icon--active', s === item);
      s.el.style.opacity = s === item ? '1' : '0.5';
    }
  });

  // Show UI Panel
  const panel = document.getElementById('presentation-panel');
  document.getElementById('presentation-title').textContent = ev.action.title;
  document.getElementById('presentation-desc').textContent = ev.action.description;
  panel.style.display = 'block';
  setTimeout(() => panel.style.opacity = '1', 50);

  // Speak sub-audio text
  if (ev.action.text) {
    await speakWithLipsync(ev.action.text);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
setupInteractiveUI();
boot();
