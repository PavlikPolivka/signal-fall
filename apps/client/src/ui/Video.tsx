import { useEffect, useRef, useState } from 'preact/hooks';

const BASE = import.meta.env.BASE_URL;
const SEEN_KEY = 'signalfall.introSeen';

/** Does a video file exist (and the browser can fetch it)? */
async function exists(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'HEAD' });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('video/');
  } catch {
    return false;
  }
}

/**
 * Looping, muted video behind the menus (assets/video/menu-loop.webm or .mp4).
 * Renders nothing when there is no video; the key art stays as the backdrop.
 * Respects reduced motion.
 */
export function MenuVideo() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void (async () => {
      for (const f of ['assets/video/menu-loop.webm', 'assets/video/menu-loop.mp4']) {
        if (await exists(f)) return setSrc(`${BASE}${f}`);
      }
    })();
  }, []);
  if (!src) return null;
  return <video class="menu-video" src={src} autoplay muted loop playsinline aria-hidden="true" />;
}

/** Full-screen cutscene with a skip button; calls onDone when it ends or is skipped. */
export function Cutscene({ src, onDone }: { src: string; onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') onDone();
    };
    window.addEventListener('keydown', onKey);
    void ref.current?.play().catch(() => undefined);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="cutscene" data-testid="cutscene">
      <video ref={ref} src={src} playsinline onEnded={onDone} onError={onDone} />
      <button class="skip" onClick={onDone}>
        Skip <kbd>Esc</kbd>
      </button>
    </div>
  );
}

/** The intro cutscene's URL if there is one, seen or not (for the replay button). */
export async function introUrl(): Promise<string | null> {
  for (const f of ['assets/video/intro.webm', 'assets/video/intro.mp4']) if (await exists(f)) return `${BASE}${f}`;
  return null;
}

/** The intro cutscene, if there is one and the player has not seen it yet. */
export async function introToPlay(): Promise<string | null> {
  try {
    if (localStorage.getItem(SEEN_KEY)) return null;
  } catch {
    // No storage: play it.
  }
  for (const f of ['assets/video/intro.webm', 'assets/video/intro.mp4']) if (await exists(f)) return `${BASE}${f}`;
  return null;
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Not remembered; it plays again next time.
  }
}
