// services/speechRecognition.js — Web Speech API wrapper for mic input

console.log('[SpeechRecognition] Module loaded.');

const SpeechRecognitionAPI =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let _recognition = null;
let _isListening = false;
let _onResult    = null;
let _onError     = null;
let _onStart     = null;
let _onEnd       = null;

/**
 * Check if speech recognition is supported by this browser.
 * @returns {boolean}
 */
export function isSpeechRecognitionSupported() {
  return SpeechRecognitionAPI !== null;
}

/**
 * Initialize speech recognition engine.
 * @param {Object} handlers
 * @param {Function} handlers.onResult(transcript: string) — called with final transcript
 * @param {Function} handlers.onError(error: string)       — called on recognition error
 * @param {Function} handlers.onStart()                    — called when listening begins
 * @param {Function} handlers.onEnd()                      — called when listening ends
 */
export function initSpeechRecognition({ onResult, onError, onStart, onEnd }) {
  if (!SpeechRecognitionAPI) {
    console.error('[SpeechRecognition] Web Speech API not supported in this browser.');
    return;
  }

  _onResult = onResult;
  _onError  = onError;
  _onStart  = onStart;
  _onEnd    = onEnd;

  _recognition = new SpeechRecognitionAPI();
  _recognition.lang = 'en-US';
  _recognition.interimResults = false;   // Final results only
  _recognition.maxAlternatives = 1;
  _recognition.continuous = false;

  _recognition.onstart = () => {
    _isListening = true;
    console.log('[SpeechRecognition] Listening started.');
    if (_onStart) _onStart();
  };

  _recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const confidence = event.results[0][0].confidence;
    console.log(`[SpeechRecognition] Result: "${transcript}" (confidence: ${confidence.toFixed(2)})`);
    if (_onResult) _onResult(transcript);
  };

  _recognition.onerror = (event) => {
    _isListening = false;
    console.error('[SpeechRecognition] Error:', event.error);

    let message = 'Speech recognition error.';
    switch (event.error) {
      case 'no-speech':
        message = 'No speech detected. Please try again.';
        break;
      case 'audio-capture':
        message = 'Microphone not available. Check permissions.';
        break;
      case 'not-allowed':
        message = 'Microphone permission denied.';
        break;
      case 'network':
        message = 'Network error during speech recognition.';
        break;
      case 'aborted':
        message = 'Listening was cancelled.';
        break;
    }

    if (_onError) _onError(message);
  };

  _recognition.onend = () => {
    _isListening = false;
    console.log('[SpeechRecognition] Listening ended.');
    if (_onEnd) _onEnd();
  };

  console.log('[SpeechRecognition] Engine initialized.');
}

/**
 * Start listening for speech.
 */
export function startListening() {
  if (!_recognition) {
    console.error('[SpeechRecognition] Not initialized. Call initSpeechRecognition() first.');
    return;
  }
  if (_isListening) {
    console.warn('[SpeechRecognition] Already listening.');
    return;
  }
  try {
    _recognition.start();
    console.log('[SpeechRecognition] Start requested.');
  } catch (err) {
    console.error('[SpeechRecognition] Start error:', err);
    if (_onError) _onError('Could not start listening: ' + err.message);
  }
}

/**
 * Stop listening.
 */
export function stopListening() {
  if (!_recognition || !_isListening) return;
  try {
    _recognition.stop();
    console.log('[SpeechRecognition] Stop requested.');
  } catch (err) {
    console.error('[SpeechRecognition] Stop error:', err);
  }
}

/**
 * Abort any active listening session.
 */
export function abortListening() {
  if (!_recognition) return;
  try {
    _recognition.abort();
  } catch (_) {}
  _isListening = false;
}

/** True if currently listening */
export function getIsListening() {
  return _isListening;
}
