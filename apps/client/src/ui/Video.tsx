import { useEffect, useRef } from 'preact/hooks';

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

/** Seconds of crossfade between the end of the loop and its start. */
const LOOP_FADE = 1.2;

/**
 * The backdrop behind every menu screen: the key art, and the looping menu
 * video (assets/video/menu-loop.webm or .mp4) when there is one. It lives
 * outside the Preact tree, so moving between menu screens never restarts or
 * blinks it. Two video elements crossfade at the loop point instead of
 * cutting from the last frame to the first. Respects reduced motion.
 */
class MenuBackdrop {
  private el: HTMLDivElement | null = null;
  private videos: HTMLVideoElement[] = [];
  private active = 0;
  private users = 0;
  private timer: number | null = null;

  acquire(): void {
    this.users++;
    if (!this.el) this.build();
    this.el!.classList.remove('hidden');
    for (const v of this.videos) if (v.classList.contains('on')) void v.play().catch(() => undefined);
    this.timer ??= window.setInterval(() => this.watchLoop(), 100);
  }

  release(): void {
    this.users--;
    // Screens swap by unmounting one and mounting the next: only hide if nobody took over.
    window.setTimeout(() => {
      if (this.users > 0 || !this.el) return;
      this.el.classList.add('hidden');
      for (const v of this.videos) v.pause();
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
    }, 0);
  }

  private build(): void {
    const el = document.createElement('div');
    el.className = 'menu-backdrop';
    el.setAttribute('aria-hidden', 'true');
    document.body.prepend(el);
    this.el = el;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void (async () => {
      for (const f of ['assets/video/menu-loop.webm', 'assets/video/menu-loop.mp4']) {
        if (!(await exists(f))) continue;
        this.videos = [0, 1].map(() => {
          const v = document.createElement('video');
          v.src = `${BASE}${f}`;
          v.muted = true;
          v.playsInline = true;
          v.preload = 'auto';
          el.appendChild(v);
          return v;
        });
        const first = this.videos[0]!;
        // Fade in once the first frame is there, rather than popping over the key art.
        first.addEventListener('playing', () => first.classList.add('on'), { once: true });
        if (this.users > 0) void first.play().catch(() => undefined);
        return;
      }
    })();
  }

  /** Near the end of the active video, start the other one from the top and crossfade. */
  private watchLoop(): void {
    const cur = this.videos[this.active];
    if (!cur || !cur.duration || cur.paused) return;
    if (cur.duration - cur.currentTime > LOOP_FADE) return;
    const next = this.videos[1 - this.active]!;
    next.currentTime = 0;
    void next.play().catch(() => undefined);
    next.classList.add('on');
    cur.classList.remove('on');
    this.active = 1 - this.active;
    window.setTimeout(() => cur.pause(), LOOP_FADE * 1000 + 100);
  }
}

const backdrop = new MenuBackdrop();

/** Mount in a menu screen to show the shared backdrop behind it. */
export function MenuVideo() {
  useEffect(() => {
    backdrop.acquire();
    return () => backdrop.release();
  }, []);
  return null;
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
