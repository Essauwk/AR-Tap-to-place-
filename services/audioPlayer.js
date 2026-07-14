// services/audioPlayer.js — Play audio blob, trigger lip sync, drive animations

import { LipSync } from '../character/lipSync.js';

console.log('[AudioPlayer] Module loaded.');

let _lipSync       = null;
let _animController= null;
let _audioCtx      = null;
let _analyser      = null;
let _sourceNode    = null;
let _isPlaying     = false;
let _onEndCallback = null;

/**
 * Initialize the audio player with scene references.
 * Must be called once after character is placed (requires user gesture for AudioContext).
 * @param {THREE.Object3D} characterRoot
 * @param {AnimationController} animController
 */
export function initAudioPlayer(characterRoot, animController) {
  _animController = animController;

  // AudioContext must be created on user gesture
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  _analyser = _audioCtx.createAnalyser();
  _analyser.fftSize = 256;
  _analyser.connect(_audioCtx.destination);

  _lipSync = new LipSync(characterRoot, _analyser);

  console.log('[AudioPlayer] Initialized. AudioContext state:', _audioCtx.state);
}

/**
 * Play an audio blob, driving lip sync and animations.
 * @param {Blob}   audioBlob   — MP3 audio from ElevenLabs
 * @param {Array}  visemes     — [{ viseme_id, start_time }]
 * @param {string} returnAnim  — animation to return to after audio: 'idle' | 'talking'
 * @param {Function} onEnd     — optional callback when audio finishes
 * @returns {Promise<void>} resolves when playback is complete
 */
export function playAudio(audioBlob, visemes, returnAnim = 'idle', onEnd = null) {
  return new Promise(async (resolve, reject) => {
    if (_isPlaying) {
      stopAudio();
    }

    _onEndCallback = onEnd;

    try {
      // Resume AudioContext if suspended (browser autoplay policy)
      if (_audioCtx.state === 'suspended') {
        await _audioCtx.resume();
        console.log('[AudioPlayer] AudioContext resumed.');
      }

      // Decode the audio blob
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer  = await _audioCtx.decodeAudioData(arrayBuffer);

      // Create buffer source
      _sourceNode = _audioCtx.createBufferSource();
      _sourceNode.buffer = audioBuffer;
      _sourceNode.connect(_analyser);

      // Switch to talking animation
      _animController.playTalking();
      _isPlaying = true;

      // Record start time and kick off lip sync
      const audioStartTime = performance.now();
      _lipSync.start(visemes, audioStartTime);

      // Hook into the animation loop for lip sync updates
      startLipSyncLoop();

      // On audio end
      _sourceNode.onended = () => {
        _isPlaying = false;
        _lipSync.stop();
        stopLipSyncLoop();
        _animController.playIdle();
        console.log('[AudioPlayer] Playback complete.');
        if (_onEndCallback) _onEndCallback();
        resolve();
      };

      // Start playback
      _sourceNode.start(0);
      console.log('[AudioPlayer] Playback started. Duration:', audioBuffer.duration.toFixed(1), 's');

    } catch (err) {
      _isPlaying = false;
      console.error('[AudioPlayer] Playback error:', err);
      _animController.playIdle();
      reject(err);
    }
  });
}

/**
 * Stop any currently playing audio immediately.
 */
export function stopAudio() {
  if (_sourceNode) {
    try { _sourceNode.stop(); } catch (_) {}
    _sourceNode = null;
  }
  _isPlaying = false;
  if (_lipSync) _lipSync.stop();
  stopLipSyncLoop();
  if (_animController) _animController.playIdle();
  console.log('[AudioPlayer] Stopped.');
}

/** True if audio is currently playing */
export function isPlaying() {
  return _isPlaying;
}

// ─── Lip Sync RAF Loop ────────────────────────────────────────────────────────
let _lipSyncRafId = null;
let _lastLipSyncTime = 0;

function startLipSyncLoop() {
  _lastLipSyncTime = performance.now();
  function loop(now) {
    if (!_isPlaying) return;
    const delta = (now - _lastLipSyncTime) / 1000;
    _lastLipSyncTime = now;
    if (_lipSync) _lipSync.update(delta);
    _lipSyncRafId = requestAnimationFrame(loop);
  }
  _lipSyncRafId = requestAnimationFrame(loop);
}

function stopLipSyncLoop() {
  if (_lipSyncRafId !== null) {
    cancelAnimationFrame(_lipSyncRafId);
    _lipSyncRafId = null;
  }
}
