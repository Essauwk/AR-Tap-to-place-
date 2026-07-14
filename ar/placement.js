// ar/placement.js — Shared tap-to-place logic (WebXR + 8th Wall)

import * as THREE from 'three';
import { loadExtraAnimations } from './characterLoader.js';
import { startActiveMode } from '../mode.js';

/**
 * Place the character at a world position with scale-up animation and start AI/presentation mode.
 */
export function placeCharacterAtWorldPosition({
  characterRoot,
  animController,
  scene,
  camera,
  position,
  computedScale,
  onPlaced,
}) {
  characterRoot.position.copy(position);
  characterRoot.position.y += CONFIG.CHARACTER_Y_OFFSET;

  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  camPos.y = characterRoot.position.y;
  characterRoot.lookAt(camPos);

  const targetScale = computedScale;
  characterRoot.scale.setScalar(0);
  characterRoot.visible = true;

  import('../ui/tapPrompt.js').then(({ hideTapPrompt }) => hideTapPrompt());

  const dur = 500;
  const start = performance.now();

  function animAppear() {
    const t = Math.min((performance.now() - start) / dur, 1);
    const e = 1 - Math.pow(1 - t, 3);
    characterRoot.scale.setScalar(e * targetScale);
    if (t < 1) {
      requestAnimationFrame(animAppear);
    } else {
      characterRoot.scale.setScalar(targetScale);
      animController.playIdle();
      loadExtraAnimations(animController._mixer, animController._animations).then(() => {
        animController._registerNewActions();
      });
      setTimeout(() => startActiveMode(characterRoot, animController, scene), 1000);
      onPlaced?.();
    }
  }
  requestAnimationFrame(animAppear);
}
