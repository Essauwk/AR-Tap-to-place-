/**
 * Arabic Lipsync Engine — Real phoneme-accurate mouth movements
 * Maps every Arabic letter to its correct Oculus Viseme with proper duration
 * weights based on IPA articulation phonetics.
 */

// ─── Arabic letter → Oculus Viseme + duration weight ─────────────────────────
//
// Oculus Visemes used by TalkingHead:
//   'sil' = silent/closed
//   'PP'  = bilabial stop/nasal  (ب م)
//   'FF'  = labiodental          (ف)
//   'TH'  = dental               (ث ذ ظ)
//   'DD'  = alveolar stop        (د ت ط)
//   'kk'  = velar stop           (ك ق)
//   'CH'  = palatal              (ج)
//   'SS'  = sibilant             (س ص ز ش ض)
//   'nn'  = nasal                (ن ل ر)
//   'RR'  = rhotic               (ر)
//   'ih'  = lax open (short)     (ِ kasra, ي short, هـ)
//   'E'   = front mid            (ي ة إ)
//   'aa'  = open wide            (ا أ آ)
//   'oh'  = mid-back             (و short)
//   'ou'  = close-back round     (و long)
//   'U'   = close front-round    (ضمة)
//
// Duration weights: higher = viseme held longer (in relative units)
// Arabic has long vowels (حركات طويلة) that should be held ~1.5x

const ARABIC_VISEME_MAP = {
  // Vowels — open mouth shapes
  'ا': { v: 'aa',  d: 1.0 }, // alef — long open 'aah'
  'أ': { v: 'aa',  d: 0.9 }, // alef hamza above — 'ah'
  'إ': { v: 'E',   d: 0.9 }, // alef hamza below — 'ih'
  'آ': { v: 'aa',  d: 1.2 }, // alef madda — long 'aaah'
  'ى': { v: 'E',   d: 0.9 }, // alef maqsura — 'ee'
  'ي': { v: 'E',   d: 1.0 }, // ya — 'ee' (front spread)
  'ئ': { v: 'E',   d: 0.8 }, // ya with hamza — 'ee'
  'و': { v: 'ou',  d: 1.0 }, // waw — 'oo' (round lips)
  'ؤ': { v: 'ou',  d: 0.8 }, // waw with hamza
  'ة': { v: 'E',   d: 0.7 }, // ta marbuta — soft 'eh'

  // Bilabials — lips press together
  'ب': { v: 'PP',  d: 0.9 }, // ba
  'م': { v: 'PP',  d: 1.0 }, // meem — held nasal
  'و': { v: 'PP',  d: 0.7 }, // waw as consonant at start of syllable — rounded

  // Labiodental
  'ف': { v: 'FF',  d: 1.0 }, // fa — teeth on lip

  // Dental / Interdental
  'ث': { v: 'TH',  d: 1.0 }, // tha — tongue between teeth
  'ذ': { v: 'TH',  d: 1.0 }, // dhal — voiced dental
  'ظ': { v: 'TH',  d: 1.0 }, // dha — emphatic dental

  // Alveolar stops — tongue tip up
  'ت': { v: 'DD',  d: 0.8 }, // ta — alveolar stop
  'د': { v: 'DD',  d: 0.8 }, // dal — alveolar stop
  'ط': { v: 'DD',  d: 1.0 }, // emphatic ta
  'ض': { v: 'SS',  d: 1.0 }, // emphatic dad — pharyngeal sibilant

  // Sibilants — teeth close, air flows
  'س': { v: 'SS',  d: 1.0 }, // seen — 's'
  'ص': { v: 'SS',  d: 1.1 }, // sad — emphatic 's'
  'ز': { v: 'SS',  d: 0.9 }, // zain — 'z'
  'ش': { v: 'SS',  d: 1.1 }, // sheen — 'sh' — soft SS with more lip spread

  // Nasals / Laterals — tongue up, soft sounds
  'ن': { v: 'nn',  d: 0.9 }, // noon — nasal
  'ل': { v: 'nn',  d: 0.8 }, // lam — lateral
  'ر': { v: 'RR',  d: 0.9 }, // ra — rhotic (slight lip rounding)

  // Velars
  'ك': { v: 'kk',  d: 0.8 }, // kaf
  'غ': { v: 'kk',  d: 1.0 }, // ghain — uvular fricative (closest to kk)
  'خ': { v: 'kk',  d: 1.0 }, // kha — velar fricative
  'ق': { v: 'kk',  d: 0.9 }, // qaf — uvular stop

  // Palatal
  'ج': { v: 'CH',  d: 1.0 }, // jeem — palatal affricate

  // Pharyngeals / Glottals — open throat, slight jaw drop
  'ع': { v: 'aa',  d: 1.0 }, // ain — deep pharyngeal open vowel
  'ح': { v: 'ih',  d: 0.9 }, // ha — pharyngeal fricative, soft open
  'ه': { v: 'ih',  d: 0.7 }, // ha — glottal, very short
  'ء': { v: 'ih',  d: 0.5 }, // hamza — glottal stop, very brief

  // Connectors / spelling chars (no mouth shape)
  '\u0640': { v: 'sil', d: 0.1 }, // tatweel — just hold
};

// Base duration for one viseme in milliseconds
const BASE_MS = 90;

/**
 * Convert an Arabic word to a list of viseme events.
 * Returns { visemes: [], times: [], durations: [] } — same structure as lipsync-en.mjs
 *
 * @param {string} word  Arabic word
 * @returns {{ visemes: string[], times: number[], durations: number[] }}
 */
export function arabicWordToVisemes(word) {
  const visemes = [];
  const times = [];
  const durations = [];
  let t = 0;

  const chars = [...word]; // Handle multi-byte correctly

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const entry = ARABIC_VISEME_MAP[ch];
    if (!entry) continue; // skip unknown / diacritics

    const v   = entry.v;
    const dur = BASE_MS * entry.d;

    // Coalesce identical consecutive visemes (reduces flutter)
    if (visemes.length > 0 && visemes[visemes.length - 1] === v) {
      // Extend the previous viseme slightly instead of adding a duplicate
      durations[durations.length - 1] += dur * 0.5;
      t += dur * 0.5;
    } else {
      visemes.push(v);
      times.push(t);
      durations.push(dur);
      t += dur;
    }
  }

  // If the word had no recognized chars, return a soft open mouth
  if (visemes.length === 0) {
    return { visemes: ['ih'], times: [0], durations: [BASE_MS] };
  }

  return { visemes, times, durations };
}

/**
 * Build the word-timing arrays for th.speakAudio()
 * Uses onboundary charIndex events for real-time re-sync.
 *
 * @param {string} text Full Arabic text
 * @returns {{ words: string[], wtimes: number[], wdurations: number[], totalMs: number }}
 */
export function arabicTextToWordTimings(text) {
  // Split into tokens (words + punctuation)
  const tokens = text.split(/(\s+|[,.?!؟،:;]+)/);

  const words     = [];
  const wtimes    = [];
  const wdurations = [];
  let currentTime = 0;

  for (const token of tokens) {
    if (!token || /^\s+$/.test(token)) {
      // Space — tiny gap
      currentTime += 40;
      continue;
    }

    if (/^[,.?!؟،:;]+$/.test(token)) {
      // Punctuation — forced mouth-close pause
      words.push(token);
      wtimes.push(currentTime);
      const pauseMs = /[.!?؟]/.test(token) ? 350 : 180;
      wdurations.push(pauseMs);
      currentTime += pauseMs;
      continue;
    }

    // Regular Arabic word — estimate duration from phoneme count
    const { visemes } = arabicWordToVisemes(token);
    const estimatedMs = Math.max(150, visemes.length * BASE_MS * 1.2);

    words.push(token);
    wtimes.push(currentTime);
    wdurations.push(estimatedMs);
    currentTime += estimatedMs + 30; // small gap between words
  }

  return {
    words,
    wtimes,
    wdurations,
    totalMs: currentTime + 300,
  };
}
