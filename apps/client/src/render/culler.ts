import type { Container } from 'pixi.js';

/** World px per culling chunk side. */
const CHUNK = 512;
/** Extra world px kept around the view, so tall sprites anchored off screen still show. */
const MARGIN = 320;

interface Entry {
  sprite: Container;
  layer: Container;
}

/**
 * Keeps static map sprites (props, their shadows, Echo crystals) out of the scene graph unless they
 * are near the screen. The unit layer is depth-sorted, and every moving unit dirties that sort: with
 * thousands of props in it, each frame re-sorted and rebuilt them all. Sprites are grouped in chunks
 * and only attached or detached when the set of chunks in view changes.
 */
export class Culler {
  private readonly chunks = new Map<number, Set<Entry>>();
  private readonly byChild = new Map<Container, Entry>();
  private readonly attached = new Set<number>();
  private view = '';

  private key(x: number, y: number): number {
    // Iso world x can be negative; offset so keys stay unique.
    return (Math.floor(y / CHUNK) + 512) * 4096 + Math.floor(x / CHUNK) + 2048;
  }

  /** Register a sprite placed at world (x, y); it is attached right away if its chunk is in view. */
  add(sprite: Container, layer: Container, x: number, y: number): void {
    const k = this.key(x, y);
    let set = this.chunks.get(k);
    if (!set) this.chunks.set(k, (set = new Set()));
    const e = { sprite, layer };
    set.add(e);
    this.byChild.set(sprite, e);
    (sprite as Container & { cullKey?: number }).cullKey = k;
    if (this.attached.has(k)) layer.addChild(sprite);
  }

  /** Forget a sprite (and detach it). The caller destroys it. */
  remove(sprite: Container): void {
    const e = this.byChild.get(sprite);
    if (!e) return;
    this.byChild.delete(sprite);
    this.chunks.get((sprite as Container & { cullKey?: number }).cullKey!)?.delete(e);
    sprite.removeFromParent();
  }

  /** Detach and destroy everything. */
  clear(): void {
    for (const e of this.byChild.values()) e.sprite.destroy();
    this.chunks.clear();
    this.byChild.clear();
    this.attached.clear();
    this.view = '';
  }

  /** Attach the chunks overlapping the world rect [x0, x1] x [y0, y1] (plus a margin), detach the rest. */
  update(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.floor((x0 - MARGIN) / CHUNK);
    const cx1 = Math.floor((x1 + MARGIN) / CHUNK);
    const cy0 = Math.floor((y0 - MARGIN) / CHUNK);
    const cy1 = Math.floor((y1 + MARGIN) / CHUNK);
    const view = `${cx0},${cx1},${cy0},${cy1}`;
    if (view === this.view) return;
    this.view = view;
    const want = new Set<number>();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) want.add(this.key(cx * CHUNK, cy * CHUNK));
    for (const k of this.attached)
      if (!want.has(k)) {
        for (const e of this.chunks.get(k) ?? []) e.sprite.removeFromParent();
        this.attached.delete(k);
      }
    for (const k of want)
      if (!this.attached.has(k)) {
        this.attached.add(k);
        for (const e of this.chunks.get(k) ?? []) e.layer.addChild(e.sprite);
      }
  }
}
