// character/lipSync.js — Viseme-based lip sync (ES Module)
// Morph target path + jaw bone fallback when morph targets are absent.

import * as THREE from 'three';

console.log('[LipSync] Module loaded.');

const VISEME_MAP = {
  0:  'viseme_sil',
  1:  'viseme_PP',
  2:  'viseme_FF',
  3:  'viseme_TH',
  4:  'viseme_DD',
  5:  'viseme_kk',
  6:  'viseme_CH',
  7:  'viseme_SS',
  8:  'viseme_nn',
  9:  'viseme_RR',
  10: 'viseme_aa',
  11: 'viseme_E',
  12: 'viseme_I',
  13: 'viseme_O',
  14: 'viseme_U',
};

export class LipSync {
  constructor(characterRoot, analyser = null) {
    this._root      = characterRoot;
    this._analyser  = analyser;
    this._morphMesh = null;
    this._jawBone   = null;
    this._hasMorphs = false;
    this._visemes   = [];
    this._startTime = 0;
    this._active    = false;
    this._detectMorphsAndJaw();
  }

  _detectMorphsAndJaw() {
    this._root.traverse(obj => {
      if (obj.isMesh && obj.morphTargetDictionary && !this._morphMesh) {
        const keys = Object.keys(obj.morphTargetDictionary);
        if (keys.some(k => k.startsWith('viseme_'))) {
          this._morphMesh = obj;
          this._hasMorphs = true;
          console.log('[LipSync] Morph targets found on:', obj.name);
          return;
        }
      }
      if (!this._jawBone && obj.isBone) {
        const n = obj.name.toLowerCase();
        if (n.includes('jaw') || n.includes('chin') || n.includes('mandible')) {
          this._jawBone = obj;
          console.log('[LipSync] Jaw bone found:', obj.name);
        }
      }
    });

    if (!this._hasMorphs) {
      console.log(this._jawBone
        ? '[LipSync] No morph targets — using jaw bone fallback.'
        : '[LipSync] No morph targets and no jaw bone — amplitude-only fallback.'
      );
    }
  }

  start(visemeData, audioStartTime) {
    this._visemes   = (visemeData || []).sort((a, b) => a.start_time - b.start_time);
    this._startTime = audioStartTime;
    this._active    = true;
    console.log(`[LipSync] Started with ${this._visemes.length} keyframes.`);
  }

  stop() {
    this._active = false;
    this._resetAll();
  }

  update(delta) {
    if (!this._active) return;
    const elapsed = (performance.now() - this._startTime) / 1000;
    if (this._hasMorphs) {
      this._updateMorphTargets(elapsed);
    } else {
      this._updateJawFallback(elapsed);
    }
  }

  _updateMorphTargets(elapsed) {
    if (!this._morphMesh?.morphTargetInfluences) return;
    const influences = this._morphMesh.morphTargetInfluences;
    for (let i = 0; i < influences.length; i++) {
      influences[i] = THREE.MathUtils.lerp(influences[i], 0, 0.25);
    }
    const { current, next } = this._getVisemePair(elapsed);
    if (!current) return;
    const morphName = VISEME_MAP[current.viseme_id];
    if (!morphName || morphName === 'viseme_sil') return;
    const morphIdx = this._morphMesh.morphTargetDictionary[morphName];
    if (morphIdx === undefined) return;
    let weight = 1.0;
    if (next) {
      const seg = next.start_time - current.start_time;
      if (seg > 0) weight = Math.sin(Math.min((elapsed - current.start_time) / seg, 1) * Math.PI);
    }
    influences[morphIdx] = THREE.MathUtils.lerp(influences[morphIdx], weight, 0.4);
  }

  _updateJawFallback(elapsed) {
    if (!this._jawBone) return;
    let amplitude = 0;
    if (this._analyser) {
      const buf = new Uint8Array(this._analyser.frequencyBinCount);
      this._analyser.getByteFrequencyData(buf);
      amplitude = buf.reduce((s, v) => s + v, 0) / buf.length / 255;
    } else {
      const { current } = this._getVisemePair(elapsed);
      if (current && current.viseme_id !== 0) {
        amplitude = [10,11,12,13,14].includes(current.viseme_id) ? 0.7 : 0.35;
      }
    }
    this._jawBone.rotation.x = THREE.MathUtils.lerp(this._jawBone.rotation.x, -(amplitude * 0.28), 0.3);
  }

  _getVisemePair(elapsed) {
    let current = null, next = null;
    for (let i = 0; i < this._visemes.length; i++) {
      if (this._visemes[i].start_time <= elapsed) {
        current = this._visemes[i];
        next    = this._visemes[i + 1] || null;
      } else break;
    }
    return { current, next };
  }

  _resetAll() {
    if (this._hasMorphs && this._morphMesh?.morphTargetInfluences) {
      this._morphMesh.morphTargetInfluences.fill(0);
    }
    if (this._jawBone) this._jawBone.rotation.x = 0;
  }
}
