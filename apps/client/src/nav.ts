/**
 * Moving between screens (menu, match, campaign) loads a new page, and browsers leave fullscreen on
 * every page load. So in fullscreen the page that holds it stays, stops its own game, and shows the
 * next screens in a frame covering the window: the frame can load page after page while the window
 * stays fullscreen.
 */
const embedded = (() => {
  try {
    return window.parent !== window && window.parent.location.origin === location.origin;
  } catch {
    return false;
  }
})();

/** Runs before the page hands over to the frame (stop the match, the sound and the worker). */
let leaving: (() => void) | null = null;
export function onLeave(fn: () => void): void {
  leaving = fn;
}

/** Go to another screen (a URL of this app), keeping fullscreen. */
export function go(url: string): void {
  if (embedded) {
    // Keep the address bar in step, so a reload lands on the same screen.
    window.parent.history.replaceState(null, '', url);
    location.href = url;
    return;
  }
  if (!document.fullscreenElement) {
    location.href = url;
    return;
  }
  leaving?.();
  leaving = null;
  history.replaceState(null, '', url);
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.allow = 'fullscreen; autoplay';
  frame.dataset.testid = 'screen-frame';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:#000';
  document.body.replaceChildren(frame);
  frame.addEventListener('load', () => frame.contentWindow?.focus());
}

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/**
 * How this device can play fullscreen: the browser's fullscreen, or (iPad and iPhone, where Safari only
 * fullscreens videos) by running the game from the home screen; 'app' when it already runs that way.
 */
export function fullscreenMode(): 'api' | 'home-screen' | 'app' {
  // (Browser fullscreen also reports display-mode: fullscreen; a home-screen app does without being in it.)
  const app = matchMedia('(display-mode: standalone)').matches || (matchMedia('(display-mode: fullscreen)').matches && !isFullscreen());
  if (app || (navigator as Navigator & { standalone?: boolean }).standalone) return 'app';
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (apple) return 'home-screen';
  const doc = topDocument() as WebkitDocument;
  return doc.fullscreenEnabled || doc.webkitFullscreenEnabled ? 'api' : 'home-screen';
}

/** The document to put in fullscreen: the outer page when we are its frame. */
export function toggleFullscreen(): Promise<void> {
  const doc = topDocument() as WebkitDocument;
  if (doc.fullscreenElement) return doc.exitFullscreen();
  if (doc.webkitFullscreenElement) {
    doc.webkitExitFullscreen?.();
    return Promise.resolve();
  }
  const root = doc.documentElement as WebkitElement;
  if (!root.requestFullscreen && root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
    return Promise.resolve();
  }
  return root.requestFullscreen().then(async () => {
    // Keyboard Lock lets the game receive Ctrl+W/T/N-style chords in fullscreen (Chromium).
    const kb = ((embedded ? window.parent.navigator : navigator) as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard;
    await kb?.lock?.().catch(() => undefined);
  });
}

/** The page that holds fullscreen (the outer one when we are its frame). */
function topDocument(): Document {
  return embedded ? window.parent.document : document;
}

export function isFullscreen(): boolean {
  const doc = topDocument() as WebkitDocument;
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Call `fn` whenever fullscreen turns on or off; returns the unsubscribe. */
export function onFullscreenChange(fn: () => void): () => void {
  const doc = topDocument();
  doc.addEventListener('fullscreenchange', fn);
  doc.addEventListener('webkitfullscreenchange', fn);
  return () => {
    doc.removeEventListener('fullscreenchange', fn);
    doc.removeEventListener('webkitfullscreenchange', fn);
  };
}
