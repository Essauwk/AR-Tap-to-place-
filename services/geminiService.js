// services/geminiService.js — Gemini API: PPTX analysis + AI conversation

console.log('[GeminiService] Module loaded.');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// ─── Conversation history for AI chat mode ────────────────────────────────────
let _conversationHistory = [];

// ─── Document Analysis ────────────────────────────────────────────────────────────

/**
 * Load the PDF file, convert to base64, and send to Gemini for script generation.
 * @param {string} docPath — URL path to the .pdf file
 * @returns {Promise<Object>} — parsed JSON with script array and fullScript string
 */
export async function analyzePPTX(docPath) {
  console.log('[GeminiService] Fetching Document:', docPath);

  // Fetch the file
  let arrayBuffer;
  try {
    const response = await fetch(docPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    arrayBuffer = await response.arrayBuffer();
  } catch (err) {
    throw new Error(`Failed to load presentation file: ${err.message}`);
  }

  // Convert to base64
  const base64 = arrayBufferToBase64(arrayBuffer);
  console.log('[GeminiService] Document loaded, size:', Math.round(base64.length / 1024), 'KB. Sending to Gemini...');

  const prompt = `You are analyzing a presentation document (PDF) to create a natural speaking script for an AR character presenter.

Analyze each page/slide and generate:
1. A natural, engaging spoken script (as if a human presenter is explaining it)
2. Keep it conversational, not robotic
3. Include natural transitions between slides
4. Total script should be 2-5 minutes when spoken

Return ONLY a valid JSON object with NO markdown formatting, NO code blocks, just raw JSON:
{
  "totalSlides": <number>,
  "script": [
    {
      "slideNumber": <number>,
      "title": "<slide title>",
      "spokenText": "<what the character will say for this slide>",
      "duration": <estimated seconds as number>
    }
  ],
  "fullScript": "<Complete script as one string for TTS>"
}`;

  const requestBody = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: 'application/pdf',
            data: base64,
          }
        },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    }
  };

  const result = await callGemini(requestBody);
  console.log('[GeminiService] Gemini analysis complete.');

  // Parse JSON from response
  try {
    // Strip any accidental markdown fences
    const cleaned = result.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    const parsed  = JSON.parse(cleaned);
    console.log('[GeminiService] Script parsed:', parsed.totalSlides, 'slides,', parsed.script?.length, 'segments');
    return parsed;
  } catch (err) {
    console.error('[GeminiService] JSON parse error. Raw response:', result);
    // Return a minimal fallback so the app doesn't crash
    return {
      totalSlides: 1,
      script: [{ slideNumber: 1, title: 'Presentation', spokenText: result, duration: 60 }],
      fullScript: result,
    };
  }
}

// ─── AI Chat ─────────────────────────────────────────────────────────────────

/**
 * Send user message to Gemini, maintain conversation context.
 * @param {string} userText
 * @returns {Promise<string>} — Gemini text response
 */
export async function sendChatMessage(userText) {
  console.log('[GeminiService] Chat message:', userText);

  const SYSTEM_PROMPT = `You are a friendly, engaging AR character assistant. 
You are currently standing in front of the user in augmented reality.
Keep responses concise (2-4 sentences max) and conversational.
Be warm, helpful, and slightly enthusiastic.
Do not use markdown, asterisks, or formatting in your responses — speak naturally.`;

  // Add user message to history
  _conversationHistory.push({
    role: 'user',
    parts: [{ text: userText }]
  });

  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: _conversationHistory,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 512,
    }
  };

  const responseText = await callGemini(requestBody);

  // Add assistant response to history (keep last 10 turns to avoid token overflow)
  _conversationHistory.push({
    role: 'model',
    parts: [{ text: responseText }]
  });

  if (_conversationHistory.length > 20) {
    _conversationHistory = _conversationHistory.slice(-20);
  }

  console.log('[GeminiService] Gemini response:', responseText.substring(0, 100) + '...');
  return responseText;
}

/** Reset conversation history */
export function resetConversation() {
  _conversationHistory = [];
  console.log('[GeminiService] Conversation history reset.');
}

// ─── Core Gemini API Call ─────────────────────────────────────────────────────
async function callGemini(requestBody) {
  // Use the secure Vercel serverless function endpoint instead of exposing the API key
  const url = `${CONFIG.GEMINI_API_ENDPOINT}?model=${CONFIG.GEMINI_MODEL}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(`Gemini network error: ${err.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GeminiService] API error:', response.status, errorText);
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Extract text from response
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates.');

  const text = candidate.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty text.');

  return text;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer) {
  const bytes  = new Uint8Array(buffer);
  let binary   = '';
  const chunk  = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
