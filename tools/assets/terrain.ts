/**
 * Seamless terrain textures per biome, generated procedurally (no external art).
 *
 *   pnpm --filter @signal-fall/assets terrain
 *
 * Writes apps/client/public/assets/terrain/<biome>/water.png plus the shared blend noise. The ground, rough,
 * road, plaza and cliff textures are photo textures now (terrain-photo.ts); PROCEDURAL=1 writes the old
 * generated ones as <slot>.png too.
 * (512x512, tileable; cliff is 512x256, tileable horizontally) plus a shared blend-noise texture. Gritty look: layered
 * periodic noise, pebbles, cracks and stains.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'apps/client/public/assets/terrain');
const N = 512;

type RGB = [number, number, number];

/** Deterministic hash -> [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise: wraps every `period` cells, so the texture tiles seamlessly. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const fx = (x / N) * period;
  const fy = (y / N) * period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function fbm(x: number, y: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(x, y, base << o, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h: string): RGB => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Look {
  dark: string;
  base: string;
  light: string;
  stain: string;
  pebble: string;
  /** Pebbles per 1000 px. */
  pebbles: number;
  cracks: number;
}

interface Extra {
  road: Look;
  /** Paving: [joint, slab dark, slab light]. */
  plaza: [string, string, string];
  /** Cliff face strata: [dark, base, light, vein]. */
  cliff: [string, string, string, string];
}

const EXTRA: Record<string, Extra> = {
  wasteland: {
    road: { dark: '7a6748', base: '8a7652', light: '98835e', stain: '6a5a40', pebble: 'a08c68', pebbles: 6, cracks: 0.2 },
    plaza: ['3a352c', '6a655a', '868072'],
    cliff: ['4a3826', '6e5638', '94784e', '3a2c1e'],
  },
  city: {
    road: { dark: '232427', base: '2b2c30', light: '35363a', stain: '1a1b1d', pebble: '45464a', pebbles: 3, cracks: 1.2 },
    plaza: ['2e2e2e', '6b6862', '85827a'],
    cliff: ['3e3c39', '57544f', '737069', '2e2c2a'],
  },
  crystal: {
    road: { dark: '55555f', base: '63636e', light: '72727e', stain: '4a4a54', pebble: '84849a', pebbles: 8, cracks: 0.2 },
    plaza: ['26252e', '4c4a58', '625f70'],
    cliff: ['28252f', '3a3546', '544c66', '9a72e0'],
  },
};

const BIOMES: Record<string, Record<'ground' | 'ground2' | 'rough', Look> & { water: [string, string] }> = {
  wasteland: {
    ground: { dark: '4a3e2a', base: '6b5a3c', light: '86724c', stain: '3b3122', pebble: '9a8a6a', pebbles: 4, cracks: 0.35 },
    ground2: { dark: '55452e', base: '75613f', light: '8f7a52', stain: '46392a', pebble: 'a59474', pebbles: 2, cracks: 0.6 },
    rough: { dark: '3f382e', base: '5d5244', light: '7a6d5a', stain: '2e2922', pebble: '8b8070', pebbles: 30, cracks: 0.1 },
    water: ['1e3a48', '3a6070'],
  },
  city: {
    ground: { dark: '3a3c3f', base: '505357', light: '676a6e', stain: '2c2d2f', pebble: '7b7e82', pebbles: 6, cracks: 0.8 },
    ground2: { dark: '3f3d39', base: '57534c', light: '6e695f', stain: '302e2a', pebble: '807a70', pebbles: 4, cracks: 0.5 },
    rough: { dark: '35332f', base: '4f4b44', light: '6a645a', stain: '25231f', pebble: '8a8478', pebbles: 40, cracks: 0.3 },
    water: ['1b2f3d', '355062'],
  },
  crystal: {
    ground: { dark: '2c3330', base: '3d4744', light: '525d58', stain: '22302a', pebble: '7a6aa0', pebbles: 3, cracks: 0.2 },
    ground2: { dark: '34333f', base: '474659', light: '5d5b72', stain: '28273a', pebble: '9a86c8', pebbles: 3, cracks: 0.3 },
    rough: { dark: '302d3a', base: '484258', light: '615a74', stain: '231f2c', pebble: 'a08ad0', pebbles: 26, cracks: 0.15 },
    water: ['1a3448', '2f6680'],
  },
};

async function ground(look: Look, seed: number, file: string): Promise<void> {
  const px = Buffer.alloc(N * N * 3);
  const dark = hex(look.dark);
  const base = hex(look.base);
  const light = hex(look.light);
  const stain = hex(look.stain);
  const pebble = hex(look.pebble);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x, y, 4, 6, seed);
      let c = n < 0.5 ? mix(dark, base, smooth(0.25, 0.5, n)) : mix(base, light, smooth(0.5, 0.78, n));
      // Large stains (old fuel, scorch, damp).
      const s = fbm(x, y, 2, 3, seed + 101);
      c = mix(c, stain, smooth(0.62, 0.8, s) * 0.55);
      // Fine grain.
      const g = hash(x, y, seed + 7) - 0.5;
      c = [c[0] + g * 14, c[1] + g * 12, c[2] + g * 10];
      // Cracks: thin dark lines where a ridged noise is near zero.
      const r = Math.abs(fbm(x, y, 6, 4, seed + 303) - 0.5);
      if (r < 0.007 * look.cracks * 2) c = mix(c, stain, 0.4);
      const i = (y * N + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
  }
  // Pebbles: small lit/shadowed blobs, placed so they wrap around edges.
  const count = Math.round((look.pebbles * N * N) / 1000 / 10);
  for (let k = 0; k < count; k++) {
    const cx = Math.floor(hash(k, 1, seed) * N);
    const cy = Math.floor(hash(k, 2, seed) * N);
    const r = 0.7 + hash(k, 3, seed) * 1.3;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const x = (cx + dx + N) % N;
        const y = (cy + dy + N) % N;
        const i = (y * N + x) * 3;
        // Top-left lit, bottom-right shadowed.
        const lit = (-dx - dy) / (2 * r);
        const under: RGB = [px[i]!, px[i + 1]!, px[i + 2]!];
        const col = mix(mix(under, pebble, 0.55), lit > 0 ? [255, 250, 235] : [0, 0, 0], Math.abs(lit) * 0.25);
        px[i] = col[0];
        px[i + 1] = col[1];
        px[i + 2] = col[2];
      }
    }
    // Contact shadow below-right of the pebble.
    const sx = (cx + Math.ceil(r) + 1) % N;
    const sy = (cy + Math.ceil(r)) % N;
    const si = (sy * N + sx) * 3;
    for (let k = 0; k < 3; k++) px[si + k] = Math.round(px[si + k]! * 0.7);
  }
  await sharp(px, { raw: { width: N, height: N, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file);
}

async function water(colors: [string, string], seed: number, file: string): Promise<void> {
  const px = Buffer.alloc(N * N * 3);
  const deep = hex(colors[0]);
  const shallow = hex(colors[1]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(x, y, 3, 5, seed);
      // Ripple streaks along one diagonal.
      const ripple = Math.pow(Math.abs(Math.sin(((x + y) / N) * Math.PI * 24 + n * 8)), 12);
      let c = mix(deep, shallow, smooth(0.3, 0.75, n) * 0.6);
      c = mix(c, [200, 220, 225], ripple * 0.18);
      const i = (y * N + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
  }
  await sharp(px, { raw: { width: N, height: N, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file);
}

/** Paving slabs on a 4x4 grid (one texture = 4x4 tiles when sampled in tile space, so 1 slab per tile). */
async function plaza(cols: [string, string, string], seed: number, file: string): Promise<void> {
  const px = Buffer.alloc(N * N * 3);
  const [joint, dark, light] = cols.map(hex) as [RGB, RGB, RGB];
  const cell = N / 4;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      // Each slab has its own tone; some are cracked or stained.
      const tone = hash(cx, cy, seed);
      let c = mix(dark, light, 0.25 + tone * 0.5);
      const n = fbm(x, y, 8, 4, seed + 5);
      c = mix(c, dark, smooth(0.55, 0.8, n) * 0.5);
      const g = hash(x, y, seed + 9) - 0.5;
      c = [c[0] + g * 10, c[1] + g * 10, c[2] + g * 10];
      const r = Math.abs(fbm(x, y, 6, 4, seed + 31) - 0.5);
      if (tone > 0.7 && r < 0.01) c = mix(c, joint, 0.6);
      const jx = x % cell;
      const jy = y % cell;
      if (jx < 3 || jy < 3) c = mix(c, joint, jx < 2 || jy < 2 ? 0.8 : 0.4);
      else if (jx < 6 || jy < 6) c = mix(c, [255, 250, 240], 0.06);
      const i = (y * N + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
  }
  await sharp(px, { raw: { width: N, height: N, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file);
}

/** Cliff face: horizontal strata, vertical fractures, a lit lip on top and a dark foot. Tiles horizontally. */
async function cliff(cols: [string, string, string, string], seed: number, file: string): Promise<void> {
  const H = N / 2;
  const px = Buffer.alloc(N * H * 3);
  const [dark, base, light, vein] = cols.map(hex) as [RGB, RGB, RGB, RGB];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < N; x++) {
      const v = y / H;
      // Strata: banding by height, warped sideways by noise.
      const warp = fbm(x, y, 4, 3, seed) * 0.25;
      const band = fbm(0, (v + warp) * N * 0.5, 16, 3, seed + 7);
      let c = band < 0.5 ? mix(dark, base, smooth(0.2, 0.5, band)) : mix(base, light, smooth(0.5, 0.85, band));
      // Vertical fractures.
      const f = Math.abs(fbm(x, y * 0.25, 12, 3, seed + 13) - 0.5);
      if (f < 0.02) c = mix(c, dark, 0.7);
      else if (f < 0.035) c = mix(c, light, 0.2);
      // Mineral veins (crystal biome glows).
      const vn = Math.abs(fbm(x, y, 5, 4, seed + 21) - 0.5);
      if (vn < 0.008) c = mix(c, vein, 0.8);
      const g = hash(x, y, seed + 3) - 0.5;
      c = [c[0] + g * 16, c[1] + g * 14, c[2] + g * 12];
      // Lit lip at the top, shadowed foot.
      if (v < 0.07) c = mix(c, light, 0.55 * (1 - v / 0.07));
      c = mix(c, [0, 0, 0], smooth(0.6, 1, v) * 0.45);
      const i = (y * N + x) * 3;
      px[i] = Math.max(0, Math.min(255, c[0]));
      px[i + 1] = Math.max(0, Math.min(255, c[1]));
      px[i + 2] = Math.max(0, Math.min(255, c[2]));
    }
  }
  await sharp(px, { raw: { width: N, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file);
}

/** Grey noise used by the terrain shader to break up blend edges. */
async function blendNoise(file: string): Promise<void> {
  const px = Buffer.alloc(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) px[y * N + x] = Math.round(fbm(x, y, 8, 4, 999) * 255);
  await sharp(px, { raw: { width: N, height: N, channels: 1 } }).png({ compressionLevel: 9 }).toFile(file);
}

const ALL = process.env.PROCEDURAL === '1';
let seed = 1;
for (const [biome, looks] of Object.entries(BIOMES)) {
  const dir = join(OUT, biome);
  mkdirSync(dir, { recursive: true });
  // Seeds advance either way, so water comes out the same.
  const s0 = seed;
  seed += 7;
  if (ALL) await ground(looks.ground, s0, join(dir, 'ground.png'));
  if (ALL) await ground(looks.ground2, s0 + 1, join(dir, 'ground2.png'));
  if (ALL) await ground(looks.rough, s0 + 2, join(dir, 'rough.png'));
  await water(looks.water, s0 + 3, join(dir, 'water.png'));
  const extra = EXTRA[biome]!;
  if (ALL) await ground(extra.road, s0 + 4, join(dir, 'road.png'));
  if (ALL) await plaza(extra.plaza, s0 + 5, join(dir, 'plaza.png'));
  if (ALL) await cliff(extra.cliff, s0 + 6, join(dir, 'cliff.png'));
  console.log('terrain', biome);
}
await blendNoise(join(OUT, 'noise.png'));
console.log('done');
