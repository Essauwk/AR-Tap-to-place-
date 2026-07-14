// ui/iosARGuide.js — Guide iOS Safari users to open the page in WebXR Viewer

const WEBXR_VIEWER_APP_STORE = 'https://apps.apple.com/app/webxr-viewer/id1295998056';

export function showIOSARGuide(pageUrl = window.location.href) {
  let overlay = document.getElementById('ios-ar-guide');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ios-ar-guide';
    overlay.innerHTML = `
      <div class="ios-ar-guide-card" role="dialog" aria-labelledby="ios-ar-guide-title">
        <button type="button" class="ios-ar-guide-close" aria-label="Close">&times;</button>
        <h2 id="ios-ar-guide-title">Same AR — open in WebXR Viewer</h2>
        <p class="ios-ar-guide-lead">
          Safari and Chrome on iPhone cannot run real WebXR AR in the browser. WebXR Viewer runs the <strong>exact same page</strong> with hit-test, ground reticle, tap-to-place, and AI chat.
        </p>
        <ol class="ios-ar-guide-steps">
          <li>Install <strong>WebXR Viewer</strong> from the App Store (free, by Mozilla).</li>
          <li>Copy the link below and paste it in WebXR Viewer’s address bar.</li>
          <li>Tap <strong>START AR</strong> — same reticle on the floor, tap to place, then chat.</li>
        </ol>
        <div class="ios-ar-guide-url" id="ios-ar-guide-url"></div>
        <div class="ios-ar-guide-actions">
          <button type="button" class="btn-primary" id="ios-ar-copy-btn">Copy Link</button>
          <a class="ios-ar-appstore" id="ios-ar-appstore" href="${WEBXR_VIEWER_APP_STORE}" target="_blank" rel="noopener">
            Get WebXR Viewer
          </a>
        </div>
        <p class="ios-ar-guide-note" id="ios-ar-copy-status"></p>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.ios-ar-guide-close').addEventListener('click', hideIOSARGuide);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideIOSARGuide();
    });
  }

  overlay.querySelector('#ios-ar-guide-url').textContent = pageUrl;
  overlay.querySelector('#ios-ar-copy-status').textContent = '';
  overlay.classList.remove('hidden');

  const copyBtn = overlay.querySelector('#ios-ar-copy-btn');
  copyBtn.onclick = () => copyGuideURL(pageUrl);
  copyGuideURL(pageUrl, true);
}

export function hideIOSARGuide() {
  document.getElementById('ios-ar-guide')?.classList.add('hidden');
}

async function copyGuideURL(url, silent = false) {
  const status = document.getElementById('ios-ar-copy-status');
  try {
    await navigator.clipboard.writeText(url);
    if (status) status.textContent = silent ? 'Link copied — paste it in WebXR Viewer.' : 'Copied!';
  } catch {
    if (status) status.textContent = 'Select the link above and copy it manually.';
  }
}
