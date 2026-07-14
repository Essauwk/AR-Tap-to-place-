// ar/browserSupport.js — device / browser AR capability detection

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia('(max-width: 1024px)').matches);
}

export function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isSecurePage() {
  return window.isSecureContext === true;
}

export async function supportsWebXRAR() {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/** Legacy wxrv:// scheme — not reliable in WebXR Viewer v2 / Safari. */
export function getWebXRViewerURL(pageUrl = window.location.href) {
  return pageUrl.replace(/^https?:\/\//i, 'wxrv://');
}

export const WEBXR_VIEWER_APP_STORE = 'https://apps.apple.com/app/webxr-viewer/id1295998056';

export function canOpenWebXRViewer() {
  return isIOS() && isSecurePage();
}

/** Use free model-viewer when WebXR is unavailable (iOS Safari/Chrome). */
export function shouldUseModelViewer(webxrSupported = false) {
  if (!isMobileDevice() || !isSecurePage()) return false;
  if (CONFIG.AR_BACKEND === 'model-viewer') return true;
  if (CONFIG.AR_BACKEND === 'webxr') return false;
  // auto: Three.js WebXR on Android; model-viewer on iOS without in-browser WebXR
  if (isIOS()) return !webxrSupported;
  return CONFIG.USE_MODEL_VIEWER_ON_ANDROID === true;
}
