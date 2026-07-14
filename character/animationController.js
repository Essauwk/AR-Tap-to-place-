// character/animationController.js — Animation state machine with crossfades (ES Module)

import * as THREE from 'three';

console.log('[AnimationController] Module loaded.');

export class AnimationController {
  /**
   * @param {THREE.AnimationMixer} mixer
   * @param {Map<string, THREE.AnimationClip>} animations
   */
  constructor(mixer, animations) {
    this._mixer       = mixer;
    this._animations  = animations;
    this._actions     = new Map();
    this._current     = null;
    this._isGesturing = false;

    // Pre-warm all actions
    for (const [name, clip] of animations) {
      const action = mixer.clipAction(clip);
      action.enabled = false;
      action.setEffectiveWeight(0);
      action.play();
      this._actions.set(name, action);
    }

    console.log('[AnimationController] Actions ready:', [...this._actions.keys()]);
  }

  /**
   * Called after lazy-loaded animations are added to the animations Map.
   * Registers any new clips that don't yet have actions.
   */
  _registerNewActions() {
    for (const [name, clip] of this._animations) {
      if (!this._actions.has(name)) {
        const action = this._mixer.clipAction(clip);
        action.enabled = false;
        action.setEffectiveWeight(0);
        action.play();
        this._actions.set(name, action);
        console.log('[AnimationController] Registered lazy action:', name);
      }
    }
  }

  playIdle() {
    if (this._isGesturing) return;
    this._crossfadeTo('idle', CONFIG.CROSSFADE_IDLE_TALKING, THREE.LoopRepeat);
  }

  playTalking() {
    if (this._isGesturing) return;
    this._crossfadeTo('talking', CONFIG.CROSSFADE_IDLE_TALKING, THREE.LoopRepeat);
  }

  /**
   * Play gesture once, then return to idle or talking.
   * @param {string} returnTo — 'idle' | 'talking'
   */
  playGesture(returnTo = 'idle') {
    if (!this._actions.has('gesture') || this._isGesturing) return;
    this._isGesturing = true;

    const gestureAction = this._actions.get('gesture');
    gestureAction.setLoop(THREE.LoopOnce, 1);
    gestureAction.clampWhenFinished = true;
    gestureAction.reset();

    this._crossfadeTo('gesture', CONFIG.CROSSFADE_GESTURE, THREE.LoopOnce);

    const onFinished = (e) => {
      if (e.action === gestureAction) {
        this._mixer.removeEventListener('finished', onFinished);
        this._isGesturing = false;
        if (returnTo === 'talking') {
          this._crossfadeTo('talking', CONFIG.CROSSFADE_GESTURE, THREE.LoopRepeat);
        } else {
          this._crossfadeTo('idle', CONFIG.CROSSFADE_GESTURE, THREE.LoopRepeat);
        }
      }
    };
    this._mixer.addEventListener('finished', onFinished);
  }

  update(deltaTime) {
    this._mixer.update(deltaTime);
  }

  get currentAnimation() { return this._current; }

  _crossfadeTo(name, duration, loop) {
    if (!this._actions.has(name) || this._current === name) return;

    const prevAction = this._current ? this._actions.get(this._current) : null;
    const nextAction = this._actions.get(name);

    nextAction.enabled = true;
    nextAction.setLoop(loop, Infinity);
    nextAction.setEffectiveWeight(1);
    nextAction.setEffectiveTimeScale(1);

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, duration, true);
    } else {
      nextAction.reset().play();
    }

    console.log(`[AnimController] ${this._current} → ${name}`);
    this._current = name;
  }
}
