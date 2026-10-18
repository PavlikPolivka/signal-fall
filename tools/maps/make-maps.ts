/**
 * The hand-made maps that ship with the game, drawn with a few shapes and mirrored so both (or all
 * four) sides get the same ground. Run: pnpm --filter @signal-fall/headless exec tsx ../../tools/maps/make-maps.ts
 * Writes apps/client/src/game/maps.ts (codes) after checking every map is fair and playable.
 */
import { writeFileSync } from 'node:fs';
import { customToGenerated, encodeMap, validateMap, type Biome, type CustomMap } from '../../packages/mapgen/src/index';

const T = { ground: 0, rough: 1, rock: 2, water: 3, cliff: 4, ruins: 5 };

class Draw {
  readonly terrain: Uint8Array;
  readonly echo: Uint8Array;
  constructor(
    readonly n: number,
    readonly sym: 'rot' | 'quad',
  ) {
    this.terrain = new Uint8Array(n * n);
    this.echo = new Uint8Array(n * n);
  }
  private images(x: number, y: number): [number, number][] {
    const m = this.n - 1;
    return this.sym === 'rot' ? [[x, y], [m - x, m - y]] : [[x, y], [m - y, x], [m - x, m - y], [y, m - x]];
  }
  set(x: number, y: number, t: number): void {
    for (const [a, b] of this.images(x, y)) if (a >= 0 && b >= 0 && a < this.n && b < this.n) {
      this.terrain[b * this.n + a] = t;
      if (t !== T.ground && t !== T.rough) this.echo[b * this.n + a] = 0;
    }
  }
  rect(x0: number, y0: number, x1: number, y1: number, t: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, t);
  }
  disc(cx: number, cy: number, r: number, t: number): void {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, t);
  }
  /** A thick line from (x0, y0) to (x1, y1). */
  line(x0: number, y0: number, x1: number, y1: number, w: number, t: number): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      this.disc(x, y, w, t);
    }
  }
  field(cx: number, cy: number, r: number, amount: number): void {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        // Round fields, crystals thinning toward the edge.
        const d = Math.round(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));
        if (d > r) continue;
        for (const [a, b] of this.images(x, y)) {
          const i = b * this.n + a;
          this.terrain[i] = T.ground;
          this.echo[i] = Math.max(this.echo[i]!, amount - d);
        }
      }
  }
  /**
   * Smooth value noise over the map: tiles above `threshold` (0..1) become `t`, only where the
   * ground is plain. Sampled once per symmetry orbit, so it stays mirrored.
   */
  noise(seed: number, scale: number, threshold: number, t: number): void {
    const hash = (x: number, y: number) => {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const smooth = (x: number, y: number) => {
      const fx = x / scale;
      const fy = y / scale;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const sx = fx - x0;
      const sy = fy - y0;
      const a = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
      const b = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
    const n = this.n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        // The canonical tile of the orbit decides for all of it.
        const [cx, cy] = this.images(x, y).reduce((m, p) => (p[1] * n + p[0] < m[1] * n + m[0] ? p : m));
        if (cx !== x || cy !== y) continue;
        if (smooth(x, y) < threshold) continue;
        const i = y * n + x;
        if (this.terrain[i] !== T.ground || this.echo[i] !== 0) continue;
        this.set(x, y, t);
      }
  }
  /** A start's build area: flat and clear. */
  base(x: number, y: number): void {
    this.rect(x - 12, y - 12, x + 12, y + 12, T.ground);
    for (let yy = y - 12; yy <= y + 12; yy++) for (let xx = x - 12; xx <= x + 12; xx++) for (const [a, b] of this.images(xx, yy)) this.echo[b * this.n + a] = 0;
  }
  map(name: string, biome: Biome, starts: { x: number; y: number }[]): CustomMap {
    return { name, size: this.n, biome, terrain: this.terrain, echo: this.echo, starts };
  }
}

const maps: CustomMap[] = [];

// Crossroads: two bases in opposite corners; cliff ridges leave four lanes that meet at a rich center.
{
  const d = new Draw(128, 'rot');
  d.line(30, 64, 64, 30, 2, T.cliff);
  d.line(40, 100, 64, 76, 2, T.cliff);
  d.rect(56, 56, 71, 71, T.ground);
  d.line(10, 50, 22, 50, 1, T.rock);
  d.disc(80, 40, 4, T.rock);
  d.field(64, 64, 5, 13);
  d.field(34, 82, 4, 12);
  d.field(20, 74, 3, 11);
  d.field(46, 106, 3, 10);
  d.noise(1, 7, 0.72, T.rough);
  d.noise(2, 5, 0.9, T.rock);
  d.base(18, 110);
  maps.push(d.map('Crossroads', 'wasteland', [{ x: 18, y: 110 }, { x: 109, y: 17 }]));
}

// Twin Rivers: two rivers cut the map, crossed at fords; Echo islands in the middle reward the bold.
{
  const d = new Draw(128, 'rot');
  d.line(0, 44, 84, 128, 3, T.water);
  for (const [x, y] of [[20, 64], [50, 94]]) d.disc(x!, y!, 4, T.ground);
  d.field(64, 64, 5, 14);
  d.field(42, 104, 3, 11);
  d.field(14, 92, 3, 10);
  d.disc(70, 96, 5, T.rough);
  d.rect(88, 30, 92, 50, T.rock);
  d.noise(3, 8, 0.7, T.rough);
  d.noise(4, 6, 0.88, T.cliff);
  d.base(20, 112);
  maps.push(d.map('Twin Rivers', 'crystal', [{ x: 20, y: 112 }, { x: 107, y: 15 }]));
}

// Fortress: city blocks wall each base in, with two gates; the plaza between them holds the big field.
{
  const d = new Draw(128, 'rot');
  d.rect(4, 82, 46, 86, T.ruins);
  d.rect(42, 86, 46, 124, T.ruins);
  d.rect(16, 82, 22, 86, T.ground);
  d.rect(42, 100, 46, 106, T.ground);
  d.rect(56, 40, 62, 52, T.ruins);
  d.rect(30, 56, 40, 62, T.ruins);
  d.field(64, 64, 6, 14);
  d.field(30, 100, 3, 11);
  d.field(10, 74, 3, 10);
  d.noise(5, 6, 0.75, T.rough);
  d.noise(6, 4, 0.9, T.ruins);
  d.base(20, 106);
  maps.push(d.map('Fortress', 'city', [{ x: 20, y: 106 }, { x: 107, y: 21 }]));
}

// Four Corners: four bases, a cross of cliffs, a rich heart.
{
  const d = new Draw(128, 'quad');
  d.line(64, 20, 64, 44, 2, T.cliff);
  d.disc(40, 40, 6, T.rock);
  d.field(64, 64, 5, 14);
  d.field(22, 48, 3, 11);
  d.field(48, 22, 3, 11);
  d.noise(7, 7, 0.72, T.rough);
  d.noise(8, 5, 0.9, T.rock);
  d.base(18, 18);
  maps.push(d.map('Four Corners', 'crystal', [{ x: 18, y: 18 }, { x: 109, y: 18 }, { x: 109, y: 109 }, { x: 18, y: 109 }]));
}

const out: string[] = [];
for (const m of maps) {
  const errors = validateMap(customToGenerated(m));
  if (errors.length > 0) throw new Error(`${m.name}: ${errors.slice(0, 5).join('; ')}`);
  out.push(`  { name: ${JSON.stringify(m.name)}, players: ${m.starts.length}, biome: '${m.biome}', code: '${encodeMap(m)}' },`);
}
writeFileSync(
  new URL('../../apps/client/src/game/maps.ts', import.meta.url),
  `// Generated by tools/maps/make-maps.ts: the hand-made maps that ship with the game.\nexport const HANDMADE_MAPS: { name: string; players: number; biome: string; code: string }[] = [\n${out.join('\n')}\n];\n`,
);
console.log('wrote', maps.length, 'maps');
