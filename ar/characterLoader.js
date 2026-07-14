// ar/characterLoader.js — Load character mesh + animations (ES Module)
// Loads character.glb for the mesh, extracts animation clips from separate GLBs.
// Three.js AnimationMixer matches bones by NAME so clips retarget automatically.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

console.log('[CharacterLoader] Module loaded.');

const MODEL_PATH   = window.CONFIG?.CHARACTER_MODEL || 'assets/models/character.glb';
const IDLE_PATH    = 'assets/models/idle.glb';
const TALKING_PATH = 'assets/models/talking.glb';
const GESTURE_PATH = 'assets/models/gesture.glb';

let _loader = null;

function getLoader() {
  if (!_loader) {
    _loader = new GLTFLoader();
    // Draco: for compressed geometry
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    _loader.setDRACOLoader(draco);
    // Meshopt: for geometry compressed by gltf-transform optimize
    _loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return _loader;
}

/**
 * Load character mesh + idle animation (initial load, fastest to start).
 */
export async function loadCharacter() {
  const loader = getLoader();
  console.log('[CharacterLoader] Loading character + idle...');

  const [charGLTF, idleGLTF] = await Promise.all([
    loadGLTF(loader, MODEL_PATH),
    loadGLTF(loader, IDLE_PATH),
  ]);

  const root = charGLTF.scene;

  // ── Reliable auto-scale to 1.7m ──────────────────────────────────────────────
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const height = box.max.y - box.min.y;

  let computedScale;
  if (height > 0.001) {
    computedScale = 1.3 / height; // Default height set to 1.3m (smaller than before)
    console.log(`[CharacterLoader] Model height=${height.toFixed(3)} → scale=${computedScale.toFixed(5)} (1.3m)`);
  } else {
    // Mixamo exports at 1 unit = 1cm → ~170 units tall. Adjusting fallback for ~1.3m
    computedScale = 0.0076;
    console.warn('[CharacterLoader] Zero bounding box, using fallback scale 0.0076');
  }
  root.scale.setScalar(computedScale);

  // Shift to ground so feet sit at y=0
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y = -box2.min.y;
  console.log(`[CharacterLoader] Foot offset applied: ${(-box2.min.y).toFixed(4)}`);

  // Mobile optimisations
  root.traverse(obj => {
    if (obj.isMesh) {
      obj.frustumCulled = true;
      if (obj.material?.map) obj.material.map.anisotropy = 1;
    }
  });

  const mixer     = new THREE.AnimationMixer(root);
  const animations = new Map();

  // Extract only the animation clip (ignore mesh from animation GLBs)
  const idleClip = idleGLTF.animations?.[0];
  if (idleClip) {
    idleClip.tracks = idleClip.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale') && !t.name.includes('Hips.quaternion') && !t.name.includes('Head') && !t.name.includes('Neck'));
    idleClip.tracks.forEach(t => t.name = t.name.replace(/mixamorig:?/g, ''));
    idleClip.name = 'idle';
    animations.set('idle', idleClip);
  } else {
    console.warn('[CharacterLoader] No idle animation found');
  }

  console.log('[CharacterLoader] Initial load done. Scale:', computedScale);
  return { root, mixer, animations, computedScale };
}

/**
 * Lazy-load talking + gesture clips after character is placed.
 * Called non-blocking so it doesn't delay the initial render.
 */
export async function loadExtraAnimations(mixer, animations) {
  const loader = getLoader();
  console.log('[CharacterLoader] Lazy loading talking + gesture...');
  try {
    const [talkGLTF, gestGLTF] = await Promise.all([
      loadGLTF(loader, TALKING_PATH),
      loadGLTF(loader, GESTURE_PATH),
    ]);

    const talkClip = talkGLTF.animations?.[0];
    const gestClip = gestGLTF.animations?.[0];

    if (talkClip) { 
      talkClip.tracks = talkClip.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale') && !t.name.includes('Hips.quaternion') && !t.name.includes('Head') && !t.name.includes('Neck'));
      talkClip.tracks.forEach(t => t.name = t.name.replace(/mixamorig:?/g, ''));
      talkClip.name = 'talking'; 
      animations.set('talking', talkClip); 
    }
    if (gestClip) { 
      gestClip.tracks = gestClip.tracks.filter(t => !t.name.endsWith('.position') && !t.name.endsWith('.scale') && !t.name.includes('Hips.quaternion') && !t.name.includes('Head') && !t.name.includes('Neck'));
      gestClip.tracks.forEach(t => t.name = t.name.replace(/mixamorig:?/g, ''));
      gestClip.name = 'gesture';  
      animations.set('gesture',  gestClip);  
    }

    console.log('[CharacterLoader] Extra animations loaded:', [...animations.keys()]);
  } catch (err) {
    console.warn('[CharacterLoader] Could not load extra animations:', err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadGLTF(loader, path) {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      gltf => resolve(gltf),
      xhr => {
        if (xhr.total > 0) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          const mb  = (xhr.loaded / 1048576).toFixed(1);
          const name = path.split('/').pop();
          if (pct % 10 === 0) console.log(`[Loader] ${name}: ${pct}% (${mb}MB)`);
        }
      },
      err => reject(new Error(`Failed: ${path} — ${err?.message ?? err}`))
    );
  });
}
