// lipsync/smartLipSync.js — v9: Pre-computed timeline + boundary correction
//
// Core design:
//  - Pre-computes a phoneme timeline from text at startup.
//  - Animation starts BEFORE audio (offset by predicted TTS latency) so they align.
//  - onBoundary() corrects any drift in real-time.
//  - onBoundary missing/sparse = OK, timeline runs on its own.
//  - Pause frames (. , ! ?) close mouth and are unlocked by the next boundary OR
//    by a timeout (for browsers that don't send onboundary reliably).

import * as THREE from 'three';

console.log('[SmartLipSync v9] Loaded.');

const VISEMES = ['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','I','O','U'];

const OPENNESS = {
  sil:0, PP:0.08, FF:0.15, TH:0.22, DD:0.28,
  kk:0.22, CH:0.32, SS:0.12, nn:0.22, RR:0.32,
  aa:1.0, E:0.62, I:0.52, O:0.88, U:0.72,
};

// ─── Letter → Viseme ──────────────────────────────────────────────────────────
function letterToViseme(c, prev, next) {
  const cl    = c || '';
  const prevl = (prev || '').toLowerCase();
  const nextl = (next || '').toLowerCase();
  const cl_l  = cl.toLowerCase();

  if (cl_l === 'h' && (prevl === 't' || prevl === 'c' || prevl === 's')) return null;
  if (cl_l === 't' && nextl === 'h') return 'TH';
  if (cl_l === 'c' && nextl === 'h') return 'CH';
  if (cl_l === 's' && nextl === 'h') return 'CH';

  if ('pbm'.includes(cl_l))  return 'PP';
  if ('fv'.includes(cl_l))   return 'FF';
  if ('td'.includes(cl_l))   return 'DD';
  if ('kg'.includes(cl_l))   return 'kk';
  if ('sz'.includes(cl_l))   return 'SS';
  if ('nl'.includes(cl_l))   return 'nn';
  if (cl_l === 'r')          return 'RR';
  if (cl_l === 'j')          return 'CH';

  if ('aA'.includes(cl))     return 'aa';
  if ('eE'.includes(cl))     return 'E';
  if ('iI'.includes(cl))     return 'I';
  if ('oO'.includes(cl))     return 'O';
  if ('uU'.includes(cl))     return 'U';

  if ('بم'.includes(cl))     return 'PP';
  if ('ف'.includes(cl))      return 'FF';
  if ('تطدضذ'.includes(cl))  return 'DD';
  if ('كقغخ'.includes(cl))   return 'kk';
  if ('سصز'.includes(cl))    return 'SS';
  if ('نل'.includes(cl))     return 'nn';
  if ('ر'.includes(cl))      return 'RR';
  if ('شج'.includes(cl))     return 'CH';
  if ('ثظ'.includes(cl))     return 'TH';
  if ('اأإآعاىءح'.includes(cl)) return 'aa';
  if ('هة'.includes(cl))     return 'E';
  if ('يئ'.includes(cl))     return 'I';
  if ('وؤ'.includes(cl))     return 'U';

  if ('.?!؟'.includes(cl))   return 'PAUSE_LONG';
  if ('،,;:-'.includes(cl))  return 'PAUSE_SHORT';

  if (/\p{L}/u.test(cl))     return 'E';
  return null;
}

// ─── Build phoneme timeline from text ─────────────────────────────────────────
// MPL = ms per phoneme. Pause frames get durationMs = 9999 (infinite wall)
// and are unlocked by onBoundary re-anchoring the timeline past them.
function textToFrames(text) {
  const frames    = [];
  let   currentMs = 0;
  const MPL       = 86; // ms per phoneme — tightly calibrated to Chrome TTS

  // Split by [number] pattern for custom pauses, e.g. [2.5] or [1]
  const chunks = text.split(/(\[\d+(?:\.\d+)?\])/g);
  
  let globalCharIdx = 0;

  for (const chunk of chunks) {
    if (!chunk) continue;
    
    // Custom explicit pause
    if (chunk.startsWith('[') && chunk.endsWith(']')) {
      const sec = parseFloat(chunk.slice(1, -1));
      if (!isNaN(sec) && sec > 0) {
        const durationMs = sec * 1000;
        frames.push({ charIdx: globalCharIdx, viseme: 'sil', startMs: currentMs, durationMs });
        currentMs += durationMs;
      }
      globalCharIdx += chunk.length;
      continue;
    }

    // Regular text processing
    for (let i = 0; i < chunk.length; i++) {
      const c    = chunk[i];
      const prev = i > 0             ? chunk[i - 1] : '';
      const next = i < chunk.length-1 ? chunk[i + 1] : '';
      const v    = letterToViseme(c, prev, next);

      let hasMoreLetters = false;
      for (let j = i + 1; j < chunk.length; j++) {
        if (/\p{L}/u.test(chunk[j])) { hasMoreLetters = true; break; }
      }

      if (!hasMoreLetters && (v === 'PAUSE_LONG' || v === 'PAUSE_SHORT')) {
        globalCharIdx++;
        continue;
      }

      if (v === 'PAUSE_LONG') {
        if (frames.length > 0) frames[frames.length - 1].durationMs += 50;
        currentMs += 50;
        frames.push({ charIdx: globalCharIdx, viseme: 'sil', startMs: currentMs, durationMs: 300 });
        currentMs += 300;
      } else if (v === 'PAUSE_SHORT') {
        if (frames.length > 0) frames[frames.length - 1].durationMs += 50;
        currentMs += 50;
        frames.push({ charIdx: globalCharIdx, viseme: 'sil', startMs: currentMs, durationMs: 120 });
        currentMs += 120;
      } else if (v === null) {
        // null viseme
      } else if (c === ' ') {
        frames.push({ charIdx: globalCharIdx, viseme: 'E', startMs: currentMs, durationMs: MPL * 0.4 });
        currentMs += MPL * 0.4;
      } else {
        frames.push({ charIdx: globalCharIdx, viseme: v, startMs: currentMs, durationMs: MPL });
        currentMs += MPL;
      }
      globalCharIdx++;
    }
  }
  // NO terminal sil frame — mouth stays open until onend fires stop()
  return frames;
}

// ─── SmartLipSync ─────────────────────────────────────────────────────────────
export class SmartLipSync {
  constructor(model) {
    this.model = model;

    this._morphMeshes = [];
    this._hasMorphs   = false;
    this._jawBone     = null;
    this._headBone    = null;
    this._neckBone    = null;
    this._eyeMesh     = null;
    this._lashMesh    = null;

    this._active     = false;
    this._rafId      = null;
    this._lastTick   = 0;
    this._startTime  = 0;
    this._frames     = [];

    // Pause state
    this._pauseEnteredAt  = -1;
    this._pauseTimeoutMs  = 9999;
    this._frozenAtMs      = -1;
    this._pendingReanchor = null; // { targetMs, triggerAt } — deferred jump after a pause

    this._influences = {};
    VISEMES.forEach(v => this._influences[v] = 0);

    // Blink
    this._blinkTimer    = 0;
    this._isBlinking    = false;
    this._blinkT        = 0;
    this._blinkCooldown = 3.0;

    this._headRestX = 0; this._headRestZ = 0;
    this._neckRestX = 0;

    this._initTargets();
  }

  _initTargets() {
    this.model.traverse(obj => {
      if (obj.isMesh && obj.morphTargetDictionary) {
        if ('viseme_sil' in obj.morphTargetDictionary || 'sil' in obj.morphTargetDictionary) {
          this._morphMeshes.push({ mesh: obj, dict: obj.morphTargetDictionary });
          this._hasMorphs = true;
        }
      }
      if (obj.isBone) {
        const nl = obj.name.toLowerCase();
        if (nl.includes('jaw')) this._jawBone = obj;
        if (nl.includes('head') && !nl.includes('top')) {
          this._headBone  = obj;
          this._headRestX = obj.rotation.x;
          this._headRestZ = obj.rotation.z;
        }
        if (nl.includes('neck')) { this._neckBone = obj; this._neckRestX = obj.rotation.x; }
      }
      if (obj.isMesh) {
        const nl = obj.name.toLowerCase();
        if ((nl.includes('eye') || nl.includes('eyes')) && !nl.includes('lash')) this._eyeMesh  = obj;
        if (nl.includes('lash')) this._lashMesh = obj;
      }
    });
    if      (this._hasMorphs) console.log('[SmartLipSync v9] Morph mode.');
    else if (this._jawBone)   console.log('[SmartLipSync v9] Jaw bone mode:', this._jawBone.name);
    else if (this._headBone)  console.log('[SmartLipSync v9] Head nod mode:', this._headBone.name);
    else                      console.warn('[SmartLipSync v9] No animation targets!');
  }

  // ── Public: start ──────────────────────────────────────────────────────────
  // audioStartMs = the exact performance.now() moment the TTS audio will begin.
  startForText(text, audioStartMs) {
    this.stop();
    this._frames          = textToFrames(text);
    this._startTime       = audioStartMs;   // t=0 of timeline = audio start
    this._frozenAtMs      = -1;
    this._pauseEnteredAt  = -1;
    this._pastEnd         = false;
    this._pendingReanchor = null;
    this._active          = true;
    this._lastTick        = performance.now();
    this._timeScale       = 1.0;
    this._offsetMs        = 70; // Push timeline 70ms into the future to compensate for mouth opening lerp time
    this._lastBoundaryTime= audioStartMs;
    this._lastMatchMs     = 0;
    this._startTime       = audioStartMs - (this._offsetMs / this._timeScale);
    console.log(`[SmartLipSync v9] ${this._frames.length} frames.`);
    this._loop();
  }

  // Uses pre-computed timestamps from audio waveform analysis for PERFECT sync
  startForTimestamps(timestamps, audioStartMs) {
    this.stop();
    const frames = [];
    const visemes = ['A', 'E', 'O', 'u', 'i', 's', 'A', 'E'];
    let vIdx = 0;
    for (const t of timestamps) {
      const startMs = t.start * 1000;
      const durMs = t.duration * 1000;
      const syllables = Math.ceil(durMs / 120);
      for (let i = 0; i < syllables; i++) {
        frames.push({
          charIdx: 0,
          viseme: visemes[vIdx++ % visemes.length],
          startMs: startMs + (i * 120),
          durationMs: Math.min(120, durMs - (i * 120))
        });
      }
    }
    this._frames          = frames;
    this._startTime       = audioStartMs;
    this._frozenAtMs      = -1;
    this._pauseEnteredAt  = -1;
    this._pastEnd         = false;
    this._pendingReanchor = null;
    this._active          = true;
    this._lastTick        = performance.now();
    this._timeScale       = 1.0;
    this._offsetMs        = 70;
    this._lastBoundaryTime= audioStartMs;
    this._lastMatchMs     = 0;
    this._startTime       = audioStartMs - (this._offsetMs / this._timeScale);
    console.log(`[SmartLipSync v9] Perfect Sync Mode: ${this._frames.length} frames.`);
    this._loop();
  }

  // ── Public: correct startTime once real audio latency is known ───────────
  reAnchor(realAudioStartMs) {
    if (!this._active) return;
    const shift = realAudioStartMs - this._startTime;
    this._startTime = realAudioStartMs;
    this._frozenAtMs = -1;
    this._pauseEnteredAt = -1;
    console.log(`[SmartLipSync v9] reAnchor shift=${Math.round(shift)}ms`);
  }

  // ── Public: boundary correction ──────────────────────────────────────────
  // Called from utter.onboundary. Re-anchors timeline to real TTS position.
  onBoundary(event) {
    if (!this._active || !event) return;
    const charIdx = event.charIndex || 0;
    const now     = performance.now();

    // Find the frame matching this word's charIndex
    let matchMs  = 0;
    let matchIdx = -1;
    for (let i = 0; i < this._frames.length; i++) {
      if (this._frames[i].charIdx >= charIdx) {
        matchMs  = this._frames[i].startMs;
        matchIdx = i;
        break;
      }
    }
    if (matchIdx === -1) return;

    // Dynamically calculate timeScale to match TTS speed
    if (this._lastBoundaryTime > 0 && this._lastMatchMs >= 0) {
      const realDuration = now - this._lastBoundaryTime;
      const timelineDuration = matchMs - this._lastMatchMs;
      
      // Prevent pauses from poisoning the timeScale calculation.
      // If there's a punctuation pause between the last word and this word,
      // the realDuration includes the TTS pause, which skews the math.
      let hasPause = false;
      for (let i = 0; i < this._frames.length; i++) {
        const f = this._frames[i];
        if (f.startMs >= this._lastMatchMs && f.startMs < matchMs && f.viseme === 'sil' && f.durationMs >= 200) {
          hasPause = true;
          break;
        }
      }

      // Only adjust if the chunk is continuous speech
      if (!hasPause && timelineDuration > 100 && realDuration > 100) {
        let scale = realDuration / timelineDuration;
        scale = Math.min(Math.max(scale, 0.75), 1.35);
        this._timeScale = (this._timeScale * 0.5) + (scale * 0.5); // Smooth
      }
    }

    this._lastBoundaryTime = now;
    this._lastMatchMs      = matchMs;

    // Normal re-anchor — sync exactly to the TTS word boundary + visual offset
    const oldElapsed = (now - this._startTime) / this._timeScale;
    const drift      = matchMs - oldElapsed;
    this._startTime      = now - ((matchMs + this._offsetMs) * this._timeScale);
    this._frozenAtMs     = -1;
    this._pauseEnteredAt = -1;
    this._pendingReanchor = null;

    if (Math.abs(drift) > 10) {
      console.log(`[SmartLipSync v9] boundary ch=${charIdx} drift=${Math.round(drift)}ms corrected`);
    }
  }

  // ── Public: stop ───────────────────────────────────────────────────────────
  stop() {
    this._active = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this._resetAll();
  }

  // ── Animation loop ─────────────────────────────────────────────────────────
  _loop() {
    if (!this._active) return;
    const now = performance.now();

    // Apply pending re-anchor (deferred jump to word position after a pause)
    if (this._pendingReanchor && now >= this._pendingReanchor.triggerAt) {
      this._startTime      = now - this._pendingReanchor.targetMs;
      this._frozenAtMs     = -1;
      this._pauseEnteredAt = -1;
      this._pendingReanchor = null;
    }

    const delta = (now - this._lastTick) / 1000;
    this._lastTick = now;

    const elapsed = (now - this._startTime) / this._timeScale;
    this._tick(elapsed, now, delta);
    this._updateBlink(delta);

    this._rafId = requestAnimationFrame(() => this._loop());
  }

  // ── Per-frame: pick viseme ─────────────────────────────────────────────────
  _tick(elapsedMs, now, delta) {
    let targetViseme = 'sil';
    let targetWeight = 0;

    if (elapsedMs < 0) {
      // Audio hasn't started yet — keep closed
      targetViseme = 'sil';
      targetWeight = 0;
    } else if (elapsedMs >= this._frames[this._frames.length - 1].startMs + this._frames[this._frames.length - 1].durationMs) {
      if (!this._pastEnd) {
        console.log(`[SmartLipSync v9] Timeline ended naturally at ${Math.round(elapsedMs)}ms. Forcing TalkingHead to stop body animation.`);
        this._pastEnd = true;
        // The TTS audio has effectively finished here. Chrome's utter.onend often fires 1-2s late.
        // Force TalkingHead to stop its jaw/head animation immediately so it doesn't look like
        // the character is still talking silently.
        try {
          if (window.th && window.th.audioCtx) {
            const sr = window.th.audioCtx.sampleRate || 22050;
            const silentBuf = window.th.audioCtx.createBuffer(1, 1, sr);
            window.th.speakAudio({ words: [], wtimes: [], wdurations: [], audio: silentBuf });
          }
        } catch (e) {}
      }
      targetViseme = 'sil';
      targetWeight = 0;
    } else {
      let speechFrame = null;

      for (let i = 0; i < this._frames.length; i++) {
        const f = this._frames[i];
        if (f.startMs > elapsedMs) break;

        if (elapsedMs < f.startMs + f.durationMs) {
          speechFrame = f;
        } else {
          if (speechFrame && speechFrame.startMs < f.startMs) speechFrame = null;
        }
      }

      if (speechFrame) {
        targetViseme = speechFrame.viseme;
        const t = (elapsedMs - speechFrame.startMs) / Math.max(speechFrame.durationMs, 1);
        targetWeight = Math.pow(Math.sin(Math.min(t, 1) * Math.PI), 0.55);
      } else {
        // Between frames — gentle neutral open (not fully closed between words)
        targetViseme = 'E';
        targetWeight = 0.2;
      }
    }

    this._applyViseme(targetViseme, targetWeight, delta);
  }

  // ── Apply viseme to model ──────────────────────────────────────────────────
  _applyViseme(targetViseme, targetWeight, delta) {
    const isSilent  = targetWeight < 0.05;
    // Fast open so mouth snaps open with word, slower close for natural feel
    const openSpeed = isSilent ? 0.20 : 0.88;

    if (this._hasMorphs) {
      for (const v of VISEMES) {
        const goal = v === targetViseme ? Math.min(1, targetWeight * 1.3) : 0;
        const spd  = goal > this._influences[v] ? openSpeed : openSpeed * 0.45;
        this._influences[v] = THREE.MathUtils.lerp(this._influences[v], goal, spd);
        for (const { mesh, dict } of this._morphMeshes) {
          const idx = dict[`viseme_${v}`] ?? dict[v] ?? -1;
          if (idx >= 0 && mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = this._influences[v];
        }
      }
    } else if (this._jawBone) {
      const openness = (OPENNESS[targetViseme] ?? 0) * targetWeight;
      this._jawBone.rotation.x = THREE.MathUtils.lerp(this._jawBone.rotation.x, openness * 0.5, openSpeed);
    } else if (this._headBone) {
      const openness = (OPENNESS[targetViseme] ?? 0) * targetWeight;
      const t        = performance.now() * 0.001;
      const nod      = openness * 0.1  * Math.sin(t * 3.5);
      const shake    = openness * 0.04 * Math.cos(t * 2.8);
      this._headBone.rotation.x = THREE.MathUtils.lerp(this._headBone.rotation.x, this._headRestX + nod,   0.16);
      this._headBone.rotation.z = THREE.MathUtils.lerp(this._headBone.rotation.z, this._headRestZ + shake, 0.16);
      if (this._neckBone) {
        this._neckBone.rotation.x = THREE.MathUtils.lerp(this._neckBone.rotation.x, this._neckRestX - openness * 0.04, 0.16);
      }
    }
  }

  // ── Blink ─────────────────────────────────────────────────────────────────
  _updateBlink(delta) {
    if (!this._eyeMesh && !this._lashMesh) return;
    this._blinkTimer += delta;
    if (!this._isBlinking && this._blinkTimer >= this._blinkCooldown) {
      this._isBlinking = true; this._blinkT = 0; this._blinkTimer = 0;
      this._blinkCooldown = 2.0 + Math.random() * 5.0;
    }
    if (this._isBlinking) {
      this._blinkT += delta * 11;
      const phase  = Math.min(this._blinkT, 2);
      const scaleY = Math.max(0.02, phase <= 1 ? 1 - phase : phase - 1);
      if (this._eyeMesh)  this._eyeMesh.scale.y  = scaleY;
      if (this._lashMesh) this._lashMesh.scale.y = scaleY;
      if (this._blinkT >= 2) {
        this._isBlinking = false;
        if (this._eyeMesh)  this._eyeMesh.scale.y  = 1;
        if (this._lashMesh) this._lashMesh.scale.y = 1;
      }
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  _resetAll() {
    VISEMES.forEach(v => {
      this._influences[v] = 0;
      for (const { mesh, dict } of this._morphMeshes) {
        const idx = dict[`viseme_${v}`] ?? dict[v] ?? -1;
        if (idx >= 0 && mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = 0;
      }
    });
    if (this._jawBone)  this._jawBone.rotation.x = 0;
    if (this._headBone) { this._headBone.rotation.x = this._headRestX; this._headBone.rotation.z = this._headRestZ; }
    if (this._neckBone) this._neckBone.rotation.x = this._neckRestX;
    if (this._eyeMesh)  this._eyeMesh.scale.y = 1;
    if (this._lashMesh) this._lashMesh.scale.y = 1;
  }

  // v8 compat stubs
  startTalking()  { /* no-op — use startForText */ }
  stopTalking()   { setTimeout(() => this.stop(), 150); }
  static estimateDuration(text) { return Math.max(2000, text.length * 120); }
}
