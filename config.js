// config.js — Central configuration for the AR Character Experience
window.CONFIG = {
  // ─── API Keys & Endpoints ──────────────────────────────────────────────────
  // Note: Actual API keys are now securely stored in .env and accessed via Vercel serverless functions
  GEMINI_MODEL: "gemini-2.5-flash",
  ELEVENLABS_VOICE_ID: "ErXwobaYiN019PkySvjV", // Antoni (Male, Free)
  
  // Vercel Serverless Endpoints (or local proxy)
  GEMINI_API_ENDPOINT: "/api/gemini",
  ELEVENLABS_API_ENDPOINT: "/api/elevenlabs",

  // Set to true to use browser's free built-in speech synthesis instead of ElevenLabs
  USE_NATIVE_TTS: true,

  // ─── AR Backend ───────────────────────────────────────────────────────────────
  // 'auto' = WebXR (Three.js) on Android | model-viewer on iOS Safari/Chrome
  // 'webxr' = Three.js WebXR only | 'model-viewer' = model-viewer everywhere on mobile
  AR_BACKEND: "auto",
  USE_MODEL_VIEWER_ON_ANDROID: true,
  CHARACTER_MODEL: "assets/models/rpm_fullbody_opt.glb",

  // ─── Character Settings ──────────────────────────────────────────────────────
  CHARACTER_SCALE: 1.8,
  CHARACTER_Y_OFFSET: 0,

  // ─── Presentation Settings ───────────────────────────────────────────────────
  PRESENTATION_FILE: "assets/presentation.pdf",

  // ─── Mode: 'presentation' | 'ai' ────────────────────────────────────────────
  ACTIVE_MODE: "presentation",

  // ─── Animation Crossfade Durations (seconds) ─────────────────────────────────
  CROSSFADE_IDLE_TALKING: 0.3,
  CROSSFADE_GESTURE: 0.1,

  // ─── Gesture interval during presentation (ms) ───────────────────────────────
  GESTURE_INTERVAL_MIN: 20000,
  GESTURE_INTERVAL_MAX: 30000,
};

const CONFIG = window.CONFIG;
