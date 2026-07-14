// modes/aiChatMode.js — Mic input → Gemini → TTS → character responds (with real free lip-sync)

import { sendChatMessage, resetConversation }  from '../services/geminiService.js';
import { textToSpeech }                        from '../services/ttsService.js';
import { initAudioPlayer, playAudio, isPlaying, stopAudio } from '../services/audioPlayer.js';
import {
  initSpeechRecognition,
  startListening,
  stopListening,
  abortListening,
  isSpeechRecognitionSupported,
} from '../services/speechRecognition.js';
import { showAIChatUI, hideAIChatUI, setTranscript, setListening, setProcessing } from '../ui/aiChatUI.js';
import { showToast } from '../ui/loadingScreen.js';
import { SmartLipSync } from '../lipsync/smartLipSync.js';


console.log('[AIChatMode] Module loaded.');

let _character      = null;
let _animController = null;
let _gestureTimer   = null;
let _smartLipSync   = null;   // real-time free lip-sync engine
let _isBusy         = false;  // true while processing/speaking — don't allow new input


export const aiChatMode = {

  /**
   * Start AI chat mode.
   * @param {THREE.Object3D} character
   * @param {AnimationController} animController
   */
  start(character, animController) {
    _character      = character;
    _animController = animController;

    console.log('[AIChatMode] Starting...');

    // Init audio player (user gesture already happened at tap-to-place)
    initAudioPlayer(character, animController);

    // Init SmartLipSync engine for real-time free lip-sync
    _smartLipSync = new SmartLipSync(character);
    console.log('[AIChatMode] SmartLipSync initialized.');

    // Reset conversation history
    resetConversation();

    document.getElementById('ai-chat-ui').classList.remove('hidden');
    
    // Add text input listeners
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    
    if (chatInput && sendBtn) {
      sendBtn.onclick = () => {
        const val = chatInput.value.trim();
        if (val) { processInput(val); chatInput.value = ''; }
      };
      chatInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
          const val = chatInput.value.trim();
          if (val) { processInput(val); chatInput.value = ''; }
        }
      };
    }

    // Check Speech Recognition support
    if (!isSpeechRecognitionSupported()) {
      showToast('Speech recognition not supported in this browser.');
      console.warn('[AIChatMode] Web Speech API not available.');
      setTranscript('Speech recognition not supported. Try Chrome or Safari.');
    }

    // Init speech recognition engine
    initSpeechRecognition({
      onStart:  handleListenStart,
      onResult: handleSpeechResult,
      onError:  handleSpeechError,
      onEnd:    handleListenEnd,
    });

    // Show the chat UI with mic button
    showAIChatUI(onMicTap);

    // Play a short greeting after a brief pause
    setTimeout(() => playGreeting(), 800);
  },

  stop() {
    abortListening();
    stopAudio();
    clearGestureTimer();
    hideAIChatUI();
    console.log('[AIChatMode] Stopped.');
  }
};

// ─── Greeting ─────────────────────────────────────────────────────────────────
async function playGreeting() {
  const greeting = "Hello! I'm your AR assistant. Tap the microphone and ask me anything — I'm here to help!";
  await speakText(greeting);
}

// ─── Mic Button Handler ───────────────────────────────────────────────────────
function onMicTap() {
  if (_isBusy) {
    console.log('[AIChatMode] Busy — ignoring mic tap.');
    return;
  }
  if (isPlaying()) {
    stopAudio();
  }
  console.log('[AIChatMode] Mic tapped — starting listening.');
  startListening();
}

// ─── Speech Recognition Callbacks ─────────────────────────────────────────────
function handleListenStart() {
  setListening(true);
  setTranscript('');
  console.log('[AIChatMode] Listening...');
}

async function handleSpeechResult(transcript) {
  console.log('[AIChatMode] Got transcript:', transcript);
  await processInput(transcript);
}

// ─── Core: Process any text input (from mic OR text box) ──────────────────────
async function processInput(text) {
  if (_isBusy) { console.log('[AIChatMode] Busy — ignoring.'); return; }
  _isBusy = true;
  setListening(false);
  setTranscript('You: ' + text);

  try {
    setProcessing(true);
    console.log('[AIChatMode] Sending to Gemini...');
    const reply = await sendChatMessage(text);
    console.log('[AIChatMode] Gemini reply:', reply.substring(0, 80) + '...');
    setTranscript(reply);
    await speakText(reply);
  } catch (err) {
    console.error('[AIChatMode] Error:', err);
    showToast('Error: ' + err.message);
    _animController.playIdle();
  } finally {
    _isBusy = false;
    setProcessing(false);
  }
}

function handleSpeechError(errorMessage) {
  setListening(false);
  _isBusy = false;
  console.warn('[AIChatMode] Speech error:', errorMessage);
  if (errorMessage !== 'Listening was cancelled.') {
    showToast(errorMessage);
  }
}

function handleListenEnd() {
  setListening(false);
  console.log('[AIChatMode] Listening ended.');
}

// ─── TTS + Speak ──────────────────────────────────────────────────────────────
async function speakText(text) {
  if (!text || text.trim().length === 0) return;

  try {
    console.log('[AIChatMode] Generating TTS for:', text.substring(0, 60) + '...');
    const result = await textToSpeech(text);

    scheduleGesture('idle');

    if (result.nativeTTS) {
      // ── Real free lip-sync via SmartLipSync + onboundary events ──────────────
      _animController.playTalking ? _animController.playTalking() : _animController.playIdle();

      await new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang   = 'en-US';
        utter.rate   = 0.95;
        utter.pitch  = 0.92;
        utter.volume = 1.0;

        utter.onstart = () => {
          const startTime = performance.now();
          // Kick off real lip-sync with phoneme-based keyframes
          _smartLipSync?.startForText(text, startTime);
          console.log('[AIChatMode] SmartLipSync started with native TTS.');
        };

        utter.onboundary = (event) => {
          // Real-time recalibration using actual speech timing
          _smartLipSync?.onBoundary(event, text);
        };

        utter.onend = () => {
          _smartLipSync?.stop();
          clearGestureTimer();
          _animController.playIdle();
          resolve();
        };

        utter.onerror = (e) => {
          console.error('[AIChatMode] Utterance error:', e.error);
          _smartLipSync?.stop();
          _animController.playIdle();
          resolve();
        };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      });

    } else {
      // ElevenLabs path: full viseme-driven lip-sync (already works perfectly)
      await playAudio(result.audioBlob, result.visemes, 'idle', () => {
        clearGestureTimer();
        _animController.playIdle();
      });
    }

  } catch (err) {
    console.error('[AIChatMode] TTS/playback error:', err);
    showToast('Voice error: ' + err.message);
    _animController.playIdle();
    clearGestureTimer();
  }
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
