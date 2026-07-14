// services/ttsService.js — TTS: Native browser synthesis (free) or ElevenLabs (paid)

console.log('[TTSService] Module loaded. USE_NATIVE_TTS:', CONFIG.USE_NATIVE_TTS);

// ─── PUBLIC API ────────────────────────────────────────────────────────────────
/**
 * Convert text to speech.
 * If CONFIG.USE_NATIVE_TTS = true → uses browser SpeechSynthesis (free, always works).
 * Otherwise → calls ElevenLabs API.
 *
 * @param {string} text
 * @returns {Promise<{ audioBlob: Blob|null, visemes: Array, nativeTTS: boolean }>}
 */
export async function textToSpeech(text) {
  if (CONFIG.USE_NATIVE_TTS) {
    return nativeTTS(text);
  }
  return elevenLabsTTS(text);
}

// ─── Native Browser TTS (Free) ─────────────────────────────────────────────────
function nativeTTS(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Browser does not support speech synthesis.'));
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang   = 'en-US';
    utter.rate   = 0.95;
    utter.pitch  = 0.6;   // lower pitch for a deeper male voice
    utter.volume = 1.0;

    // Male-first English voice selection
    const preferred = pickMaleVoice();
    if (preferred) {
      utter.voice = preferred;
      console.log('[TTSService] Using voice:', preferred.name, preferred.lang);
    }

    utter.onend = () => {
      console.log('[TTSService] Native TTS finished.');
      resolve({ audioBlob: null, visemes: [], nativeTTS: true });
    };

    utter.onerror = (e) => {
      console.error('[TTSService] Native TTS error:', e.error);
      reject(new Error('Speech synthesis error: ' + e.error));
    };

    console.log('[TTSService] Speaking via native TTS...');
    window.speechSynthesis.speak(utter);

    // Resolve with a marker immediately so the caller can animate the character
    // The actual speech runs in the background
    resolve({ audioBlob: null, visemes: [], nativeTTS: true });
  });
}

// ─── ElevenLabs TTS (Paid) ─────────────────────────────────────────────────────
async function elevenLabsTTS(text) {
  const voiceId = CONFIG.ELEVENLABS_VOICE_ID;
  const url     = `${CONFIG.ELEVENLABS_API_ENDPOINT}?voiceId=${voiceId}`;

  console.log('[TTSService] Requesting ElevenLabs TTS via secure proxy, text length:', text.length);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      output_format: 'mp3_44100_128',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) throw new Error('ElevenLabs: Invalid API key.');
    if (response.status === 402) throw new Error('ElevenLabs: Paid plan required. Set USE_NATIVE_TTS: true in config.js');
    throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
  }

  const data      = await response.json();
  const audioBlob = base64ToBlob(data.audio_base64, 'audio/mpeg');
  const visemes   = extractVisemes(data.alignment);

  return { audioBlob, visemes, nativeTTS: false };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function extractVisemes(alignment) {
  if (!alignment?.characters) return [];
  const map = { ' ':0,'.':0,',':0,'!':0,'?':0,'p':1,'b':1,'m':1,'f':2,'v':2,'t':4,'d':4,'k':5,'g':5,'j':6,'s':7,'z':7,'n':8,'l':8,'r':9,'a':10,'e':11,'i':12,'o':13,'u':14 };
  return alignment.characters.map((c, i) => ({
    viseme_id:  map[c.toLowerCase()] ?? 0,
    start_time: alignment.character_start_times_seconds[i],
  }));
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const bytes     = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Pick the best male-sounding English voice available on this device.
 * Priority: known male iOS voices → en-US non-female → any English.
 */
function pickMaleVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Known male English voice names (iOS / macOS / Windows / Android)
  const MALE   = ['Daniel', 'Alex', 'Tom', 'Rishi', 'Fred', 'Oliver', 'Arthur',
                  'Gordon', 'George', 'Reed', 'Liam', 'Aaron', 'David', 'Mark',
                  'James', 'Google UK English Male', 'Microsoft David',
                  'Microsoft Mark', 'Microsoft James'];
  // Known female names to skip
  const FEMALE = ['Samantha', 'Karen', 'Fiona', 'Moira', 'Tessa', 'Victoria',
                  'Nicky', 'Siri', 'Zira', 'Hazel', 'Susan', 'Serena', 'Ava',
                  'Google UK English Female', 'Microsoft Zira', 'Alice', 'Emma'];

  // 1. Exact male name match
  for (const name of MALE) {
    const v = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (v) return v;
  }

  // 2. en-US voice that is NOT a known female name
  const enUS = voices.filter(v => v.lang === 'en-US');
  const nonFemaleUS = enUS.find(v => !FEMALE.some(f => v.name.includes(f)));
  if (nonFemaleUS) return nonFemaleUS;

  // 3. Any English voice
  return voices.find(v => v.lang.startsWith('en')) || null;
}

