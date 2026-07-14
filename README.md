# AR Character Experience

## Quick Start

1. Place your files in the correct folders (already done)
2. Start the server:
   ```bash
   python3 -m http.server 8080 --bind 0.0.0.0
   ```
   Or on Windows:
   ```bash
   python -m http.server 8080 --bind 0.0.0.0
   ```
3. Open on desktop: http://localhost:8080

---

## Testing on Mobile (Same WiFi)

### Android
- Open Chrome on your phone
- Go to: `http://YOUR_PC_IP:8080`
- Allow camera permission when prompted
- To find your PC IP: run `ipconfig` in Command Prompt and look for `IPv4 Address`

**Optional — enable insecure origins on Android Chrome:**
1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add `http://YOUR_PC_IP:8080`
3. Enable the flag and relaunch Chrome

### iPhone (iOS Safari requires HTTPS)

iOS Safari blocks camera access on non-HTTPS pages. Use ngrok to create a secure tunnel:

1. Install ngrok: https://ngrok.com/download
2. Start your local server first:
   ```bash
   python -m http.server 8080 --bind 0.0.0.0
   ```
3. In a second terminal, run:
   ```bash
   ngrok http 8080
   ```
4. Open the `https://xxxx.ngrok.io` URL shown by ngrok on your iPhone.

---

## Switch Between Modes

Edit `config.js`:
```javascript
ACTIVE_MODE: "presentation"  // Shows AR character giving a presentation
// or
ACTIVE_MODE: "ai"            // Tap mic to talk to the AI character
```

---

## Replace Presentation

1. Drop your new `.pptx` file into `assets/`
2. Update `config.js`:
   ```javascript
   PRESENTATION_FILE: "assets/your-new-file.pptx",
   ```

---

## Change ElevenLabs Voice

1. Go to https://elevenlabs.io and find a voice you like
2. Copy the Voice ID from the voice settings
3. Update `config.js`:
   ```javascript
   ELEVENLABS_VOICE_ID: "your-voice-id-here",
   ```

---

## Project Structure

```
project/
├── index.html                 ← Entry point
├── style.css                  ← All styles + animations
├── config.js                  ← API keys + settings
├── mode.js                    ← Mode selector
│
├── ar/
│   ├── arSetup.js             ← MindAR + Three.js initialization
│   ├── characterLoader.js     ← GLB character + animations loader
│   └── tapHandler.js          ← Tap to place logic
│
├── character/
│   ├── animationController.js ← Animation state machine
│   └── lipSync.js             ← Viseme-based lip sync
│
├── modes/
│   ├── presentationMode.js    ← PPTX → script → TTS → character presents
│   └── aiChatMode.js          ← Mic → Gemini → TTS → character responds
│
├── services/
│   ├── geminiService.js       ← Gemini API integration
│   ├── ttsService.js          ← ElevenLabs TTS + visemes
│   ├── audioPlayer.js         ← Audio playback + lip sync trigger
│   └── speechRecognition.js  ← Web Speech API wrapper
│
├── ui/
│   ├── loadingScreen.js       ← Animated loading screen
│   ├── tapPrompt.js           ← "Tap to place" UI
│   ├── presentationUI.js      ← Slide title overlay
│   └── aiChatUI.js            ← Mic button + transcript
│
└── assets/
    ├── models/
    │   ├── character.glb
    │   ├── idle.glb
    │   ├── talking.glb
    │   └── gesture.glb
    ├── images/
    │   └── logo.png
    └── presentation.pptx
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Black screen on mobile | Make sure you're on HTTPS (use ngrok for iOS) |
| Camera permission denied | Go to site settings and allow camera |
| Character doesn't appear | Check browser console for GLB load errors |
| Audio doesn't play | Browser requires user interaction first — tap the screen |
| Presentation mode stuck | Ensure `presentation.pptx` is in `assets/` folder |
