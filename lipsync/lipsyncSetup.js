// lipsync/lipsyncSetup.js — Full AR + Real-time Lipsync
// Mirrors arSetup.js flow (tap-to-place) with SmartLipSync integrated.
// Works on: WebXR Android, Safari iOS camera AR, Desktop 3D preview.

import * as THREE from 'three';
import { GLTFLoader }     from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }    from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { SmartLipSync }   from './smartLipSync.js';

console.log('[LipsyncSetup] Module loaded.');

// ─── State ────────────────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
let mixer = null;
let lipSync = null;
let characterRoot  = null;
let idleAction     = null;
let talkAction     = null;
let gestureAction  = null;
let currentAnim    = null;
let placed         = false;
let isSpeaking     = false;
let isBusy         = false;
let gestureTimer   = null;

// XR
let xrSession    = null;
let hitTestSource = null;
let reticleGroup  = null;
let reticleVisible = false;

// Conversation history for Gemini
const _history = [];

// ─── Boot ─────────────────────────────────────────────────────────────────────
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
    const webxr = await supportsWebXRAR();

    if (webxr) {
      showStartBtn('START AR LIPSYNC', startWebXRSession);
    } else if (isIOS() && isSecure()) {
      showStartBtn('START AR LIPSYNC', startSafariARSession);
    } else if (isMobile() && isSecure()) {
      showStartBtn('START AR LIPSYNC', startWebXRSession);
    } else {
      // Desktop / no WebXR → 3D preview immediately
      startDesktopPreview();
    }

  } catch (err) {
    console.error('[LipsyncSetup] Boot error:', err);
    document.getElementById('loader-status').textContent = '⚠ Error: ' + err.message;
    document.getElementById('loader-status').style.color = '#ff6b6b';
  }
}

// ─── Scene init ───────────────────────────────────────────────────────────────
function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;

  document.getElementById('canvas-wrap').appendChild(renderer.domElement);

  scene  = new THREE.Scene();
  clock  = new THREE.Clock();
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

// ─── Load character ───────────────────────────────────────────────────────────
async function loadCharacter() {
  const loader = new GLTFLoader();
  const draco  = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);

  const characterModelPath = window.CONFIG?.CHARACTER_MODEL || 'assets/models/character.glb';
  const [charGLTF, idleGLTF] = await Promise.all([
    loadGLTF(loader, characterModelPath,  p => setStatus(`Loading character… ${p}%`, 35 + p * 0.3)),
    loadGLTF(loader, 'assets/models/idle.glb',       p => setStatus(`Loading animations… ${p}%`, 65 + p * 0.15)),
  ]);

  characterRoot = charGLTF.scene;

  // (Removed VRM 180 deg rotation)

  // Auto-scale to ~1.0m (smaller for lipsync view)
  characterRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(characterRoot);
  const h   = box.max.y - box.min.y;
  const s   = h > 0.001 ? 1.7 / h : 0.0076;
  characterRoot.scale.setScalar(s);

  // Foot on ground
  characterRoot.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(characterRoot);
  characterRoot.position.y = -box2.min.y;

  // Hide helmet/headwear mesh so face is visible
  characterRoot.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Hide helmet/headwear
      if (obj.name && (obj.name.toLowerCase().includes('headwear') || obj.name.toLowerCase().includes('helmet'))) {
        obj.visible = false;
      }
    }
  });

  characterRoot.visible = false; // hidden until placed
  scene.add(characterRoot);

  // Animations
  mixer = new THREE.AnimationMixer(characterRoot);
  const idleClip = idleGLTF.animations?.[0];
  if (idleClip) {
    idleClip.tracks = idleClip.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale') && !t.name.includes('Hips.quaternion') && !t.name.includes('Head') && !t.name.includes('Neck'));
    idleClip.tracks.forEach(t => t.name = t.name.replace(/mixamorig:?/g, ''));
    idleClip.name = 'idle';
    idleAction = mixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.setEffectiveWeight(0);
    idleAction.play();
  }

  // SmartLipSync — created here, activated after placement
  lipSync = new SmartLipSync(characterRoot);

  // Lazy-load talking + gesture
  loadExtraAnims(loader);

  console.log('[LipsyncSetup] Character loaded. Scale:', s.toFixed(5));
}

async function loadExtraAnims(loader) {
  try {
    const [talkG, gestG] = await Promise.all([
      loadGLTF(loader, 'assets/models/talking.glb'),
      loadGLTF(loader, 'assets/models/gesture.glb'),
    ]);
    const tc = talkG.animations?.[0], gc = gestG.animations?.[0];
    if (tc) {
      tc.tracks = tc.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale') && !t.name.includes('Hips.quaternion') && !t.name.includes('Head') && !t.name.includes('Neck'));
      tc.tracks.forEach(t => t.name = t.name.replace(/mixamorig:?/g, ''));
      tc.name = 'talking';
      talkAction = mixer.clipAction(tc);
      talkAction.setLoop(THREE.LoopRepeat, Infinity);
      talkAction.setEffectiveWeight(0); talkAction.play();
    }
    if (gc) {
      gc.tracks = gc.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale') && !t.name.includes('Hips.quaternion') && !t.name.includes('Head') && !t.name.includes('Neck'));
      gc.tracks.forEach(t => t.name = t.name.replace(/mixamorig:?/g, ''));
      gc.name = 'gesture';
      gestureAction = mixer.clipAction(gc);
      gestureAction.setLoop(THREE.LoopOnce, 1);
      gestureAction.clampWhenFinished = true;
      gestureAction.setEffectiveWeight(0); gestureAction.play();
    }
    console.log('[LipsyncSetup] Extra animations loaded.');
  } catch (e) {
    console.warn('[LipsyncSetup] Extra anims:', e.message);
  }
}

// ─── Animation helpers ────────────────────────────────────────────────────────
function playIdle() {
  if (!idleAction || currentAnim === 'idle') return;
  const prev = getAction(currentAnim);
  fadeTo(prev, idleAction, 0.5);
  currentAnim = 'idle';
}
function playTalking() {
  if (!talkAction || currentAnim === 'talking') return;
  fadeTo(getAction(currentAnim), talkAction, 0.3);
  currentAnim = 'talking';
}
function getAction(name) {
  if (name === 'idle')    return idleAction;
  if (name === 'talking') return talkAction;
  if (name === 'gesture') return gestureAction;
  return null;
}
function fadeTo(from, to, dur) {
  if (!to) return;
  to.reset(); to.enabled = true; to.setEffectiveWeight(1);
  if (from && from !== to) from.crossFadeTo(to, dur, true);
  else to.play();
}
function scheduleGesture() {
  clearTimeout(gestureTimer);
  gestureTimer = setTimeout(() => {
    if (!isSpeaking || !gestureAction || !talkAction) return;
    gestureAction.reset(); gestureAction.setEffectiveWeight(1);
    talkAction.crossFadeTo(gestureAction, 0.15, true);
    currentAnim = 'gesture';
    const done = e => {
      if (e.action === gestureAction) {
        mixer.removeEventListener('finished', done);
        if (isSpeaking) playTalking(); else playIdle();
      }
    };
    mixer.addEventListener('finished', done);
  }, 3500 + Math.random() * 2500);
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function startRenderLoop() {
  renderer.setAnimationLoop((timestamp, frame) => {
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);

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

// ─── WebXR Session ────────────────────────────────────────────────────────────
async function startWebXRSession() {
  try {
    document.getElementById('ls-start-btn').classList.add('hidden');
    document.getElementById('ls-scan-prompt').style.display = 'block';
    document.getElementById('ls-reticle').style.display     = 'block';

    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures:  ['hit-test'],
      optionalFeatures:  ['dom-overlay', 'light-estimation'],
      domOverlay: { root: document.body },
    });

    renderer.xr.setSession(xrSession);

    xrSession.addEventListener('end', () => {
      hitTestSource = null; xrSession = null;
    });

    const refSpace = await xrSession.requestReferenceSpace('viewer');
    hitTestSource  = await xrSession.requestHitTestSource({ space: refSpace });

    // Build reticle (ring)
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

    // Tap to place
    xrSession.addEventListener('select', onARTap);

    startRenderLoop();
    setUIState('idle');

    // Show tap prompt
    document.getElementById('ls-tap-prompt').style.display = 'flex';

    console.log('[LipsyncSetup] WebXR session started.');
  } catch (err) {
    console.error('[LipsyncSetup] WebXR error:', err);
    showToast('AR error: ' + err.message);
    startDesktopPreview();
  }
}

function onARTap() {
  if (placed || !reticleVisible || !reticleGroup) return;
  placed = true;

  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  reticleGroup.matrix.decompose(pos, rot, scl);

  characterRoot.position.copy(pos);
  characterRoot.visible = true;
  reticleGroup.visible  = false;

  scene.remove(reticleGroup);
  hitTestSource?.cancel();
  hitTestSource = null;

  document.getElementById('ls-tap-prompt').style.display  = 'none';
  document.getElementById('ls-scan-prompt').style.display = 'none';
  document.getElementById('ls-reticle').style.display     = 'none';

  onPlaced();
}

// ─── Safari iOS AR ────────────────────────────────────────────────────────────
let _safariStream = null;
let _safariVideoEl = null;

async function startSafariARSession() {
  document.getElementById('ls-start-btn').classList.add('hidden');
  document.getElementById('ls-scan-prompt').style.display = 'block';

  // iOS 13+ requires explicit permission for DeviceOrientationEvent
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Device orientation denied');
    }
  } catch (e) {
    console.warn('[SafariAR] DeviceOrientation permission error:', e);
  }

  // Request rear camera
  try {
    _safariStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (err) {
    showToast('Camera access denied. Enable in Safari Settings → Privacy → Camera.');
    return;
  }

  // Full-screen camera video behind the Three.js canvas
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
  await _safariVideoEl.play().catch(() => {});

  // Make canvas transparent
  document.getElementById('canvas-wrap').style.zIndex = '1';
  scene.background = null;

  // Camera at standing eye-level
  camera.position.set(0, 1.2, 0);
  camera.rotation.order = 'YXZ';

  // Build reticle if not built
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

  // Device orientation
  const _devEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _devQ1    = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
  const _screenQ  = new THREE.Quaternion();
  const _screenZ  = new THREE.Vector3(0, 0, 1);

  window.addEventListener('deviceorientation', (e) => {
    const alpha  = THREE.MathUtils.degToRad(e.alpha ?? 0);
    const beta   = THREE.MathUtils.degToRad(e.beta  ?? 0);
    const gamma  = THREE.MathUtils.degToRad(e.gamma ?? 0);
    const orient = THREE.MathUtils.degToRad(window.screen?.orientation?.angle ?? 0);
    _devEuler.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(_devEuler);
    camera.quaternion.multiply(_devQ1);
    _screenQ.setFromAxisAngle(_screenZ, -orient);
    camera.quaternion.multiply(_screenQ);
  });

  // loadExtras(); // Disabled for experimental model

  document.getElementById('ls-tap-prompt').style.display = 'flex';

  // Raycasting
  const _rayDir  = new THREE.Vector3();
  const _floorPt = new THREE.Vector3();
  let   _lastValidFloor = null;
  let   _currentT       = 2.0;

  // Tap to place
  const tapOnce = () => {
    if (placed) return;
    placed = true;
    reticleGroup.visible = false;
    document.getElementById('ls-tap-prompt').style.display  = 'none';
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
    // Point character at camera on Y axis
    const lookPos = camera.position.clone(); lookPos.y = pos.y;
    characterRoot.lookAt(lookPos);
    
    characterRoot.visible = true;
    onPlaced();
  };
  document.body.addEventListener('click', tapOnce, { once: true });

  // Render loop
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);

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

    renderer.render(scene, camera);
  });
}

// ─── Desktop / 3D preview ─────────────────────────────────────────────────────
function startDesktopPreview() {
  scene.background = new THREE.Color(0x080c20);

  // Subtle ground plane
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.5 })
  );
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
  scene.add(g);

  // Camera: frame from waist up (face visible)
  camera.position.set(0, 1.4, 2.1);
  camera.lookAt(0, 1.1, 0);

  characterRoot.visible = true;
  placed = true;

  startRenderLoop();
  onPlaced();
}

// ─── After placement ──────────────────────────────────────────────────────────
function onPlaced() {
  playIdle();

  // Show chat UI
  document.getElementById('chat-ui').style.display = 'flex';

  // Show scale controls
  initScaleControls();

  // Init speech recognition
  initSpeechRecognition();

  // Greeting
  setTimeout(() => greet(), 600);

  console.log('[LipsyncSetup] Character placed. Lipsync active.');
}

// ─── Pinch-to-Scale ───────────────────────────────────────────────────────────
let _baseScale   = 1;
let _scaleMulti  = 1;

function initScaleControls() {
  // Hide the old button UI (we use pinch now)
  const controls = document.getElementById('scale-controls');
  if (controls) controls.style.display = 'none';

  if (!characterRoot) return;
  _baseScale  = characterRoot.scale.x;
  _scaleMulti = 1;

  let _pinchStartDist = null;
  let _pinchStartMulti = 1;

  const getDistance = (t1, t2) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const canvas = renderer.domElement;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      _pinchStartDist  = getDistance(e.touches[0], e.touches[1]);
      _pinchStartMulti = _scaleMulti;
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && _pinchStartDist) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      const ratio = dist / _pinchStartDist;
      _scaleMulti = Math.max(0.15, Math.min(4.0, _pinchStartMulti * ratio));
      if (characterRoot) characterRoot.scale.setScalar(_baseScale * _scaleMulti);
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) _pinchStartDist = null;
  });

  console.log('[Scale] Pinch-to-scale active. Base:', _baseScale.toFixed(4));
}

// ─── Greeting ─────────────────────────────────────────────────────────────────
async function greet() {
  const msg = "Hi! I can speak and you'll see my head move with the words. Ask me anything!";
  setTranscript(msg);
  await speakWithLipsync(msg);
}

// ─── TTS + Lipsync ────────────────────────────────────────────────────────────
function speakWithLipsync(text) {
  return new Promise(resolve => {
    if (!window.speechSynthesis) { resolve(); return; }

    window.speechSynthesis.cancel();
    isSpeaking = true;

    const utter   = new SpeechSynthesisUtterance(text);
    utter.lang    = 'en-US';
    utter.rate    = 0.82;
    utter.pitch   = 1.2;
    utter.volume  = 1.0;

    const voice = pickBestVoice();
    if (voice) { utter.voice = voice; console.log('[LS] Voice:', voice.name); }

    const estimatedMs = SmartLipSync.estimateDuration(text);

    let _speechDone = false;
    let _backupTimer = null;

    const finishSpeech = () => {
      if (_speechDone) return;
      _speechDone = true;
      clearTimeout(_backupTimer);
      isSpeaking = false;
      lipSync?.stop();
      clearTimeout(gestureTimer);
      setTimeout(() => playIdle(), 300);
      setUIState('idle');
      resolve();
    };

    utter.onstart = () => {
      const t0 = performance.now();
      lipSync?.startForText(text, t0, estimatedMs);
      playTalking();
      scheduleGesture();
      setUIState('speaking');
      // Backup: finish after estimated duration + 2s buffer (fixes premature stop bug)
      _backupTimer = setTimeout(finishSpeech, estimatedMs + 2000);
    };

    utter.onboundary = e => {
      lipSync?.onBoundary(e, text);
    };

    utter.onend = () => finishSpeech();
    utter.onerror = e => {
      console.error('[LS] Speech error:', e.error);
      finishSpeech();
    };

    window.speechSynthesis.speak(utter);
  });
}

function stopSpeaking() {
  window.speechSynthesis?.cancel();
  isSpeaking = false;
  lipSync?.stop();
  clearTimeout(gestureTimer);
  playIdle();
  setUIState('idle');
}

function pickBestVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Prefer female English voices
  const FEMALE = ['Samantha','Victoria','Karen','Moira','Fiona','Tessa','Veena','Allison','Ava','Susan','Zira','Hazel','Catherine','Helena','Laura','Amelie','Google UK English Female','Microsoft Zira','Microsoft Libby','Microsoft Hazel','Google US English'];
  for (const name of FEMALE) {
    const v = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (v) return v;
  }
  // Fallback to any English female voice
  const femaleVoice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
  if (femaleVoice) return femaleVoice;
  return voices.find(v => v.lang.startsWith('en')) || null;
}

// ─── Gemini AI ────────────────────────────────────────────────────────────────
async function askGemini(userText) {
  _history.push({ role: 'user', parts: [{ text: userText }] });

  const model = window.CONFIG?.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await fetch(
    `${window.CONFIG?.GEMINI_API_ENDPOINT}?model=${model}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a friendly, engaging AR character assistant. Keep your responses natural and conversational, but VERY concise (1 to 3 sentences maximum). Avoid unnecessary details so you can reply quickly.' }] },
        contents: _history,
        generationConfig: { temperature: 0.7 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data  = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Hmm, I'm not sure what to say!";

  _history.push({ role: 'model', parts: [{ text: reply }] });
  return reply;
}

// ─── Process input ────────────────────────────────────────────────────────────
async function processInput(text) {
  if (isBusy || !text.trim() || !placed) return;
  isBusy = true;

  stopSpeaking();
  setTranscript('You: ' + text, 'user');
  setUIState('thinking');

  try {
    const reply = await askGemini(text);
    setTranscript(reply);
    await speakWithLipsync(reply);
  } catch (err) {
    console.error('[LS] Error:', err);
    const fb = "Sorry, something went wrong. But look — my head still moves as I talk!";
    setTranscript(fb);
    await speakWithLipsync(fb);
  } finally {
    isBusy = false;
    setUIState('idle');
  }
}

// ─── Speech recognition ────────────────────────────────────────────────────────
let recognition = null, isListening = false;

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('[LS] No SpeechRecognition'); return; }

  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart  = () => { isListening = true; setUIState('listening'); };
  recognition.onresult = e => {
    const result = e.results[e.results.length - 1];
    const text   = result[0].transcript;
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
  if (isListening)  return;
  stopSpeaking();
  try { recognition.start(); } catch {}
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────
function setupInteractiveUI() {
  // Back
  document.getElementById('ls-back-btn')?.addEventListener('click', () => {
    stopSpeaking();
    xrSession?.end();
    window.location.href = 'index.html';
  });

  // Mic
  const micBtn = document.getElementById('ls-mic-btn');
  micBtn?.addEventListener('click', () => {
    if (isListening) { recognition?.abort(); } else { startListening(); }
  });

  // Send
  const input   = document.getElementById('ls-text-input');
  const sendBtn = document.getElementById('ls-send-btn');
  const submit  = () => {
    const v = input?.value.trim();
    if (v) { input.value = ''; processInput(v); }
  };
  sendBtn?.addEventListener('click', submit);
  input?.addEventListener('keypress', e => { if (e.key === 'Enter') submit(); });

  // Stop
  document.getElementById('ls-stop-btn')?.addEventListener('click', () => stopSpeaking());

  // Safari voices
  if (window.speechSynthesis?.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {};
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
  const micBtn   = document.getElementById('ls-mic-btn');
  const micLabel = document.getElementById('ls-mic-label');
  const stopBtn  = document.getElementById('ls-stop-btn');
  const dot      = document.getElementById('ls-dot');
  const txt      = document.getElementById('ls-status-text');

  const MAP = {
    idle:      { mic: true,  micTxt: 'SPEAK',     stop: false, dot: 'idle',      status: 'Ready' },
    listening: { mic: true,  micTxt: 'STOP',      stop: false, dot: 'listening', status: 'Listening…' },
    thinking:  { mic: false, micTxt: 'SPEAK',     stop: true,  dot: 'thinking',  status: 'Thinking…' },
    speaking:  { mic: false, micTxt: 'SPEAK',     stop: true,  dot: 'speaking',  status: 'Speaking…' },
  };

  const s = MAP[state] || MAP.idle;
  if (micBtn)   { micBtn.disabled = !s.mic; micBtn.classList.toggle('listening', state === 'listening'); }
  if (micLabel) micLabel.textContent = s.micTxt;
  if (stopBtn)  stopBtn.classList.toggle('visible', s.stop);
  if (dot)      dot.className = `status-dot ${s.dot}`;
  if (txt)      txt.textContent = s.status;
}

function setTranscript(text, role = 'assistant') {
  const el = document.getElementById('ls-transcript');
  if (!el) return;
  el.textContent = text;
  if (role === 'user')        el.style.color = 'rgba(180,210,255,0.9)';
  else if (role === 'user-interim') { el.style.color = 'rgba(180,210,255,0.55)'; return; }
  else                        el.style.color = 'rgba(255,255,255,0.92)';
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

// ─── Loader UI ─────────────────────────────────────────────────────────────────
function setStatus(text, pct) {
  const el  = document.getElementById('loader-status');
  const bar = document.getElementById('ls-bar');
  if (el)  el.textContent  = text;
  if (bar) bar.style.width = (pct || 0) + '%';
}

function hideLoader() {
  const el = document.getElementById('loader');
  if (!el) return;
  el.style.opacity    = '0';
  el.style.transition = 'opacity 0.5s ease';
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

// ─── GLTF helper ──────────────────────────────────────────────────────────────
function loadGLTF(loader, path, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      resolve,
      xhr => { if (xhr.total > 0 && onProgress) onProgress(Math.round(xhr.loaded / xhr.total * 100)); },
      err => reject(new Error(`GLTF load failed: ${path} — ${err?.message ?? err}`))
    );
  });
}

// ─── Platform helpers ─────────────────────────────────────────────────────────
async function supportsWebXRAR() {
  try { return await navigator.xr?.isSessionSupported('immersive-ar'); } catch { return false; }
}
function isIOS()    { return /iPad|iPhone|iPod/.test(navigator.userAgent); }
function isMobile() { return /Android|iPhone|iPad|iPod/.test(navigator.userAgent); }
function isSecure() { return location.protocol === 'https:' || location.hostname === 'localhost'; }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

// ─── Boot ─────────────────────────────────────────────────────────────────────
setupInteractiveUI();
boot();
