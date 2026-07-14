// modes/presentationMode.js — PPTX → Gemini script → ElevenLabs TTS → character presents

import { analyzePPTX }                   from '../services/geminiService.js';
import { textToSpeech }                  from '../services/ttsService.js';
import { initAudioPlayer, playAudio }    from '../services/audioPlayer.js';
import { showSlideOverlay, hideSlideOverlay }  from '../ui/presentationUI.js';
import { showPresentationComplete }      from '../ui/presentationUI.js';
import { showToast }                     from '../ui/loadingScreen.js';

console.log('[PresentationMode] Module loaded.');

let _character      = null;
let _animController = null;
let _gestureTimer   = null;

export const presentationMode = {

  /**
   * Start presentation mode.
   * @param {THREE.Object3D} character
   * @param {AnimationController} animController
   */
  async start(character, animController) {
    _character      = character;
    _animController = animController;

    console.log('[PresentationMode] Starting...');

    // Init audio player (requires user gesture — tap already happened)
    initAudioPlayer(character, animController);

    try {
      // ── Step 1: Analyze PPTX with Gemini ────────────────────────────────
      showToast('Analyzing presentation...');
      console.log('[PresentationMode] Analyzing PPTX:', CONFIG.PRESENTATION_FILE);
      const scriptData = await analyzePPTX(CONFIG.PRESENTATION_FILE);

      // ── Step 2: Generate TTS for full script ─────────────────────────────
      showToast('Generating voice...');
      console.log('[PresentationMode] Sending fullScript to ElevenLabs...');
      const { audioBlob, visemes, wordTimings } = await textToSpeech(scriptData.fullScript);

      // ── Step 3: Playback ─────────────────────────────────────────────────
      showToast('');
      console.log('[PresentationMode] Starting playback...');

      // Start gesture timer
      scheduleGesture('talking');

      // Show first slide title immediately
      if (scriptData.script && scriptData.script.length > 0) {
        showSlideOverlayForSegments(scriptData.script, wordTimings);
      }

      // Play audio + lip sync
      await playAudio(audioBlob, visemes, 'idle', () => {
        clearGestureTimer();
        hideSlideOverlay();
        _animController.playIdle();
        showPresentationComplete();
        console.log('[PresentationMode] Presentation complete.');
      });

    } catch (err) {
      console.error('[PresentationMode] Error:', err);
      clearGestureTimer();
      _animController.playIdle();
      showToast('Error: ' + err.message);
    }
  },

  stop() {
    clearGestureTimer();
    hideSlideOverlay();
    console.log('[PresentationMode] Stopped.');
  }
};

// ─── Slide Title Overlay Sequencer ───────────────────────────────────────────
// Approximates which slide segment is being spoken based on elapsed audio time
function showSlideOverlayForSegments(script, wordTimings) {
  let currentSlide = 0;
  const startTime  = performance.now();

  // Build per-slide approximate start times based on duration
  const slideTimes = [];
  let cumulative   = 0;
  for (const seg of script) {
    slideTimes.push(cumulative);
    cumulative += (seg.duration || 30);
  }

  console.log('[PresentationMode] Slide timing:', slideTimes);

  function checkSlide() {
    const elapsed = (performance.now() - startTime) / 1000;
    let activeSlide = 0;
    for (let i = 0; i < slideTimes.length; i++) {
      if (elapsed >= slideTimes[i]) activeSlide = i;
    }

    if (activeSlide !== currentSlide) {
      currentSlide = activeSlide;
      const seg = script[activeSlide];
      if (seg) {
        showSlideOverlay(
          String(seg.slideNumber).padStart(2, '0'),
          seg.title
        );
        console.log('[PresentationMode] Slide overlay → Slide', seg.slideNumber, ':', seg.title);
      }
    }

    // Keep checking while presentation might still be running
    if (elapsed < cumulative + 5) {
      setTimeout(checkSlide, 500);
    }
  }

  // Show first slide immediately
  const firstSeg = script[0];
  if (firstSeg) {
    showSlideOverlay(
      String(firstSeg.slideNumber).padStart(2, '0'),
      firstSeg.title
    );
  }

  setTimeout(checkSlide, 500);
}

// ─── Random Gesture Timer ─────────────────────────────────────────────────────
function scheduleGesture(returnAnim) {
  // Disabled random gesture (hands on hips)
  return;
}

function clearGestureTimer() {
  if (_gestureTimer) {
    clearTimeout(_gestureTimer);
    _gestureTimer = null;
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
