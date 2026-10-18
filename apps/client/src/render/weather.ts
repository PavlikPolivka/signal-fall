import { Container, Sprite, Texture } from 'pixi.js';

/** Soft round dot for motes and flakes. */
function dotTexture(size: number): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

interface Style {
  count: number;
  tint: number[];
  alpha: [number, number];
  scale: [number, number];
  /** Drift in world px per second (wind x, fall y). */
  vx: [number, number];
  vy: [number, number];
  add: boolean;
}

/** What hangs in the air, per biome: blown dust, falling ash, rising crystal motes. */
const STYLES: Record<string, Style> = {
  wasteland: { count: 90, tint: [0xd8c39a, 0xc9ae7e, 0xe6d6b4], alpha: [0.15, 0.4], scale: [0.08, 0.2], vx: [40, 90], vy: [-6, 10], add: false },
  city: { count: 80, tint: [0x9a9590, 0x7c7873, 0xb7b1aa], alpha: [0.2, 0.5], scale: [0.06, 0.14], vx: [-14, 14], vy: [14, 30], add: false },
  crystal: { count: 70, tint: [0xc58cff, 0x9f7bff, 0x7fe9ff], alpha: [0.25, 0.7], scale: [0.06, 0.13], vx: [-8, 8], vy: [-22, -8], add: true },
};

interface Mote {
  sprite: Sprite;
  vx: number;
  vy: number;
  phase: number;
  alpha: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Ambient weather drifting over the battlefield around the camera. Purely cosmetic and
 * cheap (under a hundred sprites); off with Reduced effects.
 */
export class Weather {
  readonly layer = new Container();
  private readonly tex = dotTexture(32);
  private motes: Mote[] = [];
  private style: Style | null = null;
  private last = performance.now();

  setBiome(biome: string): void {
    for (const m of this.motes) m.sprite.destroy();
    this.motes = [];
    this.style = STYLES[biome] ?? null;
  }

  set enabled(on: boolean) {
    this.layer.visible = on;
  }

  /** Keep motes inside the visible world rect, wrapping them around its edges. */
  update(x0: number, y0: number, x1: number, y1: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const st = this.style;
    if (!st || !this.layer.visible) return;
    const w = x1 - x0;
    const h = y1 - y0;
    // More of the map in view (zoomed out): more motes, up to double.
    const want = Math.round(st.count * Math.min(2, Math.max(0.5, (w * h) / (1600 * 1000))));
    while (this.motes.length < want) {
      const s = new Sprite(this.tex);
      s.anchor.set(0.5);
      s.tint = st.tint[Math.floor(Math.random() * st.tint.length)]!;
      s.scale.set(rand(st.scale[0], st.scale[1]));
      s.blendMode = st.add ? 'add' : 'normal';
      s.position.set(rand(x0, x1), rand(y0, y1));
      this.layer.addChild(s);
      this.motes.push({ sprite: s, vx: rand(st.vx[0], st.vx[1]), vy: rand(st.vy[0], st.vy[1]), phase: Math.random() * 6.28, alpha: rand(st.alpha[0], st.alpha[1]) });
    }
    while (this.motes.length > want) this.motes.pop()!.sprite.destroy();
    const t = now / 1000;
    for (const m of this.motes) {
      const p = m.sprite.position;
      p.x += (m.vx + Math.sin(t * 0.7 + m.phase) * 6) * dt;
      p.y += m.vy * dt;
      if (p.x < x0) p.x += w;
      else if (p.x > x1) p.x -= w;
      if (p.y < y0) p.y += h;
      else if (p.y > y1) p.y -= h;
      // Twinkle gently.
      m.sprite.alpha = m.alpha * (0.7 + 0.3 * Math.sin(t * 1.3 + m.phase * 3));
    }
  }
}
