import { Container, Matrix, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';

export type TimeOfDay = 'day' | 'dusk' | 'night';

/** Ambient light per time of day (multiplied over the battlefield). */
const AMBIENT: Record<TimeOfDay, number> = { day: 0xffffff, dusk: 0xd2a892, night: 0x4f5f8c };
/** Light map resolution relative to the screen (soft light needs no detail). */
const RES = 0.5;

function glowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return Texture.from(c);
}

/**
 * Dusk and night: the battlefield is multiplied by a light map that starts at the ambient
 * color, with warm pools of light around buildings, headlights on units and a cyan glow over
 * Echo. Cosmetic only: vision and fog are unchanged.
 */
export class NightLight {
  readonly sprite = new Sprite();
  private readonly lights = new Container();
  private readonly glow = glowTexture();
  private pool: Sprite[] = [];
  private used = 0;
  private rt: RenderTexture | null = null;
  private time: TimeOfDay = 'day';

  constructor() {
    this.sprite.blendMode = 'multiply';
    this.sprite.visible = false;
  }

  setTime(time: TimeOfDay): void {
    this.time = time;
    this.sprite.visible = time !== 'day';
  }

  get active(): boolean {
    return this.time !== 'day';
  }

  /** Start a frame's lights. */
  begin(): void {
    this.used = 0;
  }

  /** A light at world (x, y) of radius r world px. */
  add(x: number, y: number, r: number, color: number, alpha = 1): void {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite(this.glow);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.pool.push(s);
      this.lights.addChild(s);
    }
    this.used++;
    s.visible = true;
    s.position.set(x, y);
    // Lights lie flat on the iso ground: twice as wide as tall.
    s.scale.set((r * 2) / 128, r / 128);
    s.tint = color;
    s.alpha = alpha;
  }

  /** Render the light map for the world rect in view and lay it over the battlefield. */
  end(renderer: Renderer, x0: number, y0: number, x1: number, y1: number, screenW: number, screenH: number): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
    if (!this.active) return;
    const w = Math.max(1, Math.ceil(screenW * RES));
    const h = Math.max(1, Math.ceil(screenH * RES));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.destroy(true);
      this.rt = RenderTexture.create({ width: w, height: h });
      this.sprite.texture = this.rt;
    }
    const sx = w / (x1 - x0);
    const sy = h / (y1 - y0);
    renderer.render({ container: this.lights, target: this.rt, clear: true, clearColor: AMBIENT[this.time], transform: new Matrix(sx, 0, 0, sy, -x0 * sx, -y0 * sy) });
    this.sprite.position.set(x0, y0);
    this.sprite.scale.set(1 / sx, 1 / sy);
  }
}
