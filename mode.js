// mode.js — Mode selector: launch 'presentation' or 'ai' based on CONFIG.ACTIVE_MODE

import { presentationMode } from './modes/presentationMode.js';
import { aiChatMode }       from './modes/aiChatMode.js';

console.log('[Mode] Active mode:', CONFIG.ACTIVE_MODE);

/**
 * Start the active mode after character has been placed.
 * @param {THREE.Object3D}       character       — the placed character root
 * @param {AnimationController}  animController  — animation state machine
 * @param {THREE.Scene}          scene           — Three.js scene (for future use)
 */
export function startActiveMode(character, animController, scene) {
  console.log('[Mode] Starting mode:', CONFIG.ACTIVE_MODE);

  if (CONFIG.ACTIVE_MODE === 'presentation') {
    presentationMode.start(character, animController);
  } else if (CONFIG.ACTIVE_MODE === 'ai') {
    aiChatMode.start(character, animController);
  } else {
    console.error('[Mode] Unknown ACTIVE_MODE in config.js:', CONFIG.ACTIVE_MODE);
    console.error('[Mode] Valid values are: "presentation" | "ai"');
  }
}

/**
 * Stop whichever mode is currently running (for cleanup).
 */
export function stopActiveMode() {
  if (CONFIG.ACTIVE_MODE === 'presentation') {
    presentationMode.stop();
  } else if (CONFIG.ACTIVE_MODE === 'ai') {
    aiChatMode.stop();
  }
}
