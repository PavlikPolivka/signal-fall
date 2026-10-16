import { FX_ONE, Rng, TERRAIN, TERRAIN_BUILDABLE, TERRAIN_SPEED_PCT, fdiv, idiv, ilength, xxh32Words, type MapData } from '@signal-fall/sim';
import { makeSymmetry, type Symmetry, type SymmetryKind } from './symmetry';

export type MapSize = 'S' | 'M' | 'L';
export type Biome = 'city' | 'wasteland' | 'crystal';
export type Resources = 'low' | 'normal' | 'rich';
export type TerrainStyle = 'open' | 'normal' | 'choke';

export interface MapParams {
  seed: number;
  size: MapSize;
  players: number;
  biome: Biome;
  resources: Resources;
  terrain: TerrainStyle;
}

export const SIZES: Record<MapSize, number> = { S: 96, M: 128, L: 160 };
/** Side of the guaranteed flat build area around each start. */
export const BUILD_AREA = 24;

/** Cosmetic decoration per tile (renderer only). */
export const DECO = { none: 0, rubble: 1, wreck: 2, outcrop: 3, deadTree: 4, crater: 5 } as const;
/** Cosmetic ground surface per tile (renderer only; terrain decides movement). */
export const SURFACE = { none: 0, road: 1, ford: 2, plaza: 3 } as const;
/** Landmark kind per footprint tile; footprint tiles are impassable rock. */
export const LANDMARK = { none: 0, tower: 1, building: 2, crashed: 3, monolith: 4 } as const;
/** Square footprint side per landmark kind. */
export const LANDMARK_SIZE: readonly number[] = [0, 2, 3, 3, 2];

export interface GeneratedMap extends MapData {
  params: MapParams;
  /** Seed that produced a valid map (params.seed, or a later one after retries). */
  seedUsed: number;
  symmetry: SymmetryKind;
  biome: Biome;
  decoration: Uint8Array;
  surface: Uint8Array;
  landmark: Uint8Array;
  hash: number;
}

const BIOME_OBSTACLE: Record<Biome, [number, number]> = {
  // [primary, secondary] impassable terrain
  city: [TERRAIN.ruins, TERRAIN.rock],
  wasteland: [TERRAIN.cliff, TERRAIN.rock],
  crystal: [TERRAIN.cliff, TERRAIN.rock],
};
/** Height above which tiles become impassable, out of 1024. */
const OBSTACLE_THRESHOLD: Record<TerrainStyle, number> = { open: 700, normal: 640, choke: 585 };
/** Moisture below which tiles become water, out of 1024. */
const WATER_THRESHOLD: Record<Biome, number> = { city: 330, wasteland: 300, crystal: 310 };
/** [field radius, crystals at the center] per resource level. */
const FIELD: Record<Resources, [number, number]> = { low: [4, 10], normal: [5, 12], rich: [6, 14] };
const DECO_PCT: Record<Biome, number> = { city: 9, wasteland: 5, crystal: 6 };
/** Chance of a river (2- and 4-player maps). */
const RIVER_PCT: Record<Biome, number> = { city: 45, wasteland: 35, crystal: 45 };
/** Landmarks flanking the routes, per biome. */
const FLANK_LANDMARKS: Record<Biome, number[]> = {
  city: [LANDMARK.building, LANDMARK.tower],
  wasteland: [LANDMARK.crashed, LANDMARK.tower],
  crystal: [LANDMARK.monolith, LANDMARK.tower],
};

/** Generate a valid map: tries params.seed, then seed+1, ... until validation passes. */
export function generateMap(params: MapParams, maxAttempts = 64): GeneratedMap {
  let last: string[] = [];
  for (let i = 0; i < maxAttempts; i++) {
    const seed = (params.seed + i) >>> 0;
    const map = generateOnce(params, seed);
    last = validateMap(map);
    if (last.length === 0) return map;
  }
  throw new Error(`no valid map after ${maxAttempts} seeds from ${params.seed}: ${last.join('; ')}`);
}

function pickSymmetry(players: number, rng: Rng): SymmetryKind {
  if (players === 2) return (['mirrorH', 'mirrorV', 'mirrorD', 'rotate180'] as const)[rng.int(4)]!;
  if (players === 4) return 'quad';
  return 'radial';
}

/** One generation attempt with an exact seed (may fail validation). */
export function generateOnce(params: MapParams, seed: number): GeneratedMap {
  if (params.players < 2 || params.players > 8) throw new Error(`players must be 2..8, got ${params.players}`);
  const n = SIZES[params.size];
  const rng = Rng.derive(seed, 3);
  const symKind = pickSymmetry(params.players, rng);
  const sym = makeSymmetry(symKind, n, params.players);
  const g = new Grid(n, sym);

  // 1. Terrain from symmetric value noise.
  const heightSeed = rng.nextU32();
  const moistSeed = rng.nextU32();
  const mixSeed = rng.nextU32();
  const [primary, secondary] = BIOME_OBSTACLE[params.biome];
  const rockT = OBSTACLE_THRESHOLD[params.terrain];
  const waterT = WATER_THRESHOLD[params.biome];
  const heights = g.noiseField(heightSeed);
  const moisture = g.noiseField(moistSeed);
  const mix = g.noiseField(mixSeed);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const h = heights[y * n + x]!;
      const m = moisture[y * n + x]!;
      let t: number = TERRAIN.ground;
      if (h > rockT) t = mix[y * n + x]! > 600 ? secondary : primary;
      else if (m < waterT) t = TERRAIN.water;
      else if (h > rockT - 70) t = TERRAIN.rough;
      g.terrain[y * n + x] = t;
    }
  }
  g.smooth(primary);

  // 2. Start positions (sector 0, then images).
  const margin = Math.max(BUILD_AREA >> 1, idiv(n * 15, 100)) + 2;
  const c = n >> 1;
  const jitter = idiv(n, 8);
  let sx: number;
  let sy: number;
  switch (symKind) {
    case 'mirrorH':
      sx = margin;
      sy = c + rng.range(-jitter, jitter);
      break;
    case 'mirrorV':
      sx = c + rng.range(-jitter, jitter);
      sy = margin;
      break;
    case 'mirrorD':
      sx = margin + rng.range(0, jitter);
      sy = n - 1 - margin;
      break;
    case 'rotate180':
      sx = margin;
      sy = margin + rng.range(0, jitter);
      break;
    case 'quad':
      sx = margin;
      sy = margin;
      break;
    case 'radial':
      sx = c;
      sy = margin;
      break;
  }
  const starts = Array.from({ length: params.players }, (_, k) => {
    const [x, y] = sym.image(sx, sy, k);
    return { x, y };
  });

  // Unit vector (Q10) from start 0 toward the map center, and its perpendicular.
  const toC = unit(c - sx, c - sy);
  const perp = { x: -toC.y, y: toC.x };
  const along = (dist: number, side: number) => ({
    x: clampIn(sx + ((toC.x * dist + perp.x * side) >> 10), n, 5),
    y: clampIn(sy + ((toC.y * dist + perp.y * side) >> 10), n, 5),
  });

  // Raw (unclamped) point relative to start 0, for features that run off the map.
  const rawAlong = (dist: number, side: number) => ({
    x: sx + ((toC.x * dist + perp.x * side) >> 10),
    y: sy + ((toC.y * dist + perp.y * side) >> 10),
  });
  const dC = ilength(c - sx, c - sy);

  // 2b. A river between the players: across the center on 2-player maps, a cross on 4-player maps.
  const river = symKind !== 'radial' && rng.chance(RIVER_PCT[params.biome]);
  const crossings: [{ x: number; y: number }, { x: number; y: number }][] = [];
  if (river) {
    const wobble = rng.nextU32();
    if (symKind === 'quad') {
      g.river([{ x: c, y: -2 }, { x: c, y: c }], wobble, 1);
      g.river([{ x: -2, y: c }, { x: c, y: c }], wobble + 1, 1);
      const q = c >> 1;
      crossings.push([{ x: c - 6, y: q }, { x: c + 5, y: q }], [{ x: q, y: c - 6 }, { x: q, y: c + 5 }]);
    } else {
      // Along the mirror axis (rotations: any line through the center), so the river is its own image.
      const [a, b] =
        symKind === 'mirrorH'
          ? [{ x: c, y: -2 }, { x: c, y: n + 1 }]
          : symKind === 'mirrorV'
            ? [{ x: -2, y: c }, { x: n + 1, y: c }]
            : symKind === 'mirrorD'
              ? [{ x: -2, y: -2 }, { x: n + 1, y: n + 1 }]
              : [rawAlong(dC, -n), rawAlong(dC, n)];
      const pts = [];
      for (let k = 0; k <= 8; k++) pts.push({ x: a.x + idiv((b.x - a.x) * k, 8), y: a.y + idiv((b.y - a.y) * k, 8) });
      g.river(pts, wobble, 1);
      // Two flank crossings, a quarter of the way out from the center, square across the river.
      const nrm = unit(a.y - b.y, b.x - a.x);
      for (const k of [2, 6]) {
        const p = pts[k]!;
        const off = (d: number) => ({ x: clampIn(p.x + ((nrm.x * d) >> 10), n, 3), y: clampIn(p.y + ((nrm.y * d) >> 10), n, 3) });
        crossings.push([off(-6), off(6)]);
      }
    }
  }
  const wasWater = g.terrain.map((t) => (t === TERRAIN.water ? 1 : 0));

  // 3. Echo fields: main next to the base, a natural expansion, contested toward the center.
  const [radius, amount] = FIELD[params.resources];
  const half = BUILD_AREA >> 1;
  // On radial maps the axis-aligned build square meets the field at varying angles; stay past its corners.
  const mainDist = symKind === 'radial' ? ((half * 3) >> 1) + radius + 2 : half + radius + 1;
  const main = along(mainDist, 0);
  const lateral = rng.chance(50) ? 1 : -1;
  // Radial sectors are narrow: keep the expansion on the sector's center line, beyond the main field.
  const expansion = symKind === 'radial' ? along(mainDist + 2 * radius + 6, 0) : along(half + 6, lateral * (half + 14));
  const contestedDist = Math.max(half + 20, idiv(ilength(c - sx, c - sy) * 62, 100));
  const contested = along(contestedDist, -lateral * rng.range(4, 10));
  const fields = symKind === 'radial' ? [main, expansion] : [main, expansion, contested];
  if (symKind !== 'radial' && rng.chance(50)) fields.push(along(contestedDist + 10, lateral * rng.range(8, 14)));

  // 4. Routes: two roads from the base to the center, plus one to the expansion.
  const width = params.terrain === 'choke' ? 1 : 2;
  const mid = idiv(dC, 2);
  const spread = idiv(n, 6);
  g.carve(sx, sy, along(mid, spread).x, along(mid, spread).y, width, 1);
  g.carve(along(mid, spread).x, along(mid, spread).y, c, c, width, 1);
  g.carve(sx, sy, along(mid, -spread).x, along(mid, -spread).y, width, 1);
  g.carve(along(mid, -spread).x, along(mid, -spread).y, c, c, width, 1);
  g.carve(sx, sy, expansion.x, expansion.y, width, 0);
  for (const f of fields) g.carve(f.x, f.y, along(mid, 0).x, along(mid, 0).y, 1);
  for (const [a, b] of crossings) g.carve(a.x, a.y, b.x, b.y, 1, 1);

  // Center plaza with the old relay tower, when no river runs through the middle.
  if (!river && symKind !== 'radial') g.plaza(c, c, 5, true);

  // A paved apron beside the natural expansion, room for a refinery.
  if (symKind !== 'radial') {
    const pad = along(half + 6, lateral * (half + 9 - radius));
    g.plaza(pad.x, pad.y, 3, false);
  }

  // Fields go in after carving so corridors don't erase them; build areas last so nothing intrudes.
  for (const f of fields) g.field(f.x, f.y, radius, amount, rng);
  // Many-player maps share one contested field in the exact center: equally far from everyone.
  if (symKind === 'radial') g.centerField(c, radius + 1, amount);
  // Every start gets its own axis-aligned build area (radial images of a square are rotated).
  for (const s of starts) g.clearSquare(s.x, s.y, half + 1, false);

  // 5. Landmarks: the relay tower at the center plaza, biome landmarks flanking the routes.
  if (!river && symKind !== 'radial') g.placeLandmark(c - 1, c - 1, LANDMARK.tower, starts, half);
  const flank = FLANK_LANDMARKS[params.biome];
  for (let k = 0; k < 2; k++) {
    const kind = flank[(k + rng.int(2)) % 2]!;
    const p = along(mid + rng.range(2, 8), (k === 0 ? 1 : -1) * (spread + rng.range(7, 12)));
    g.placeLandmark(p.x, p.y, kind, starts, half);
  }

  // Crossings: tiles that were water and are now passable read as fords (bridges in the city).
  for (let i = 0; i < n * n; i++) if (wasWater[i] && g.terrain[i] === TERRAIN.ground && g.echo[i] === 0) g.surface[i] = SURFACE.ford;

  // 6. Decoration on open ground away from bases and fields.
  const decoSeed = rng.nextU32();
  const decoTypes: number[] =
    params.biome === 'city'
      ? [DECO.rubble, DECO.wreck, DECO.crater]
      : params.biome === 'crystal'
        ? [DECO.outcrop, DECO.rubble, DECO.crater]
        : [DECO.deadTree, DECO.wreck, DECO.rubble, DECO.crater];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (g.terrain[i] !== TERRAIN.ground || g.echo[i]! > 0 || g.surface[i] === SURFACE.plaza || g.surface[i] === SURFACE.ford) continue;
      if (starts.some((s) => Math.abs(s.x - x) <= half + 1 && Math.abs(s.y - y) <= half + 1)) continue;
      const r = g.symmetricHash(decoSeed, x, y);
      if (r % 100 < DECO_PCT[params.biome]) g.deco[i] = decoTypes[idiv(r, 100) % decoTypes.length]!;
    }
  }

  const words = new Int32Array(n * n * 2 + starts.length * 2);
  for (let i = 0; i < n * n; i++) {
    words[i] = g.terrain[i]!;
    words[n * n + i] = g.echo[i]!;
  }
  starts.forEach((s, k) => {
    words[2 * n * n + 2 * k] = s.x;
    words[2 * n * n + 2 * k + 1] = s.y;
  });
  return {
    width: n,
    height: n,
    terrain: g.terrain,
    echo: g.echo,
    starts,
    params,
    seedUsed: seed,
    symmetry: symKind,
    biome: params.biome,
    decoration: g.deco,
    surface: g.surface,
    landmark: g.landmark,
    hash: xxh32Words(words),
  };
}

function unit(dx: number, dy: number): { x: number; y: number } {
  const len = ilength(dx, dy);
  return len === 0 ? { x: FX_ONE, y: 0 } : { x: idiv(dx * FX_ONE, len), y: idiv(dy * FX_ONE, len) };
}

function clampIn(v: number, n: number, margin: number): number {
  return v < margin ? margin : v > n - 1 - margin ? n - 1 - margin : v;
}

/** Map layers plus symmetric painting helpers. Every write goes to the whole orbit. */
class Grid {
  readonly terrain: Uint8Array;
  readonly echo: Uint8Array;
  readonly deco: Uint8Array;
  readonly surface: Uint8Array;
  readonly landmark: Uint8Array;
  /** orbits[i * K .. i * K + K) = tile indices equivalent to tile i, padded with -1. */
  private readonly orbits: Int32Array;
  private readonly K: number;

  constructor(
    readonly n: number,
    readonly sym: Symmetry,
  ) {
    this.terrain = new Uint8Array(n * n);
    this.echo = new Uint8Array(n * n);
    this.deco = new Uint8Array(n * n);
    this.surface = new Uint8Array(n * n);
    this.landmark = new Uint8Array(n * n);
    this.K = sym.players;
    this.orbits = new Int32Array(n * n * this.K).fill(-1);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const o = sym.orbit(x, y);
        for (let k = 0; k < o.length; k++) this.orbits[(y * n + x) * this.K + k] = o[k]![1] * n + o[k]![0];
      }
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.n && y < this.n;
  }

  paint(x: number, y: number, fn: (i: number) => void): void {
    if (!this.inside(x, y)) return;
    const base = (y * this.n + x) * this.K;
    for (let k = 0; k < this.K; k++) {
      const j = this.orbits[base + k]!;
      if (j < 0) break;
      fn(j);
    }
  }

  /** Value noise (0..1023) for every tile, averaged over each symmetry orbit: symmetric and smooth. */
  noiseField(seed: number): Int32Array {
    const n = this.n;
    const raw = valueNoiseGrid(seed, n);
    const out = new Int32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      let sum = 0;
      let count = 0;
      for (let k = 0; k < this.K; k++) {
        const j = this.orbits[i * this.K + k]!;
        if (j < 0) break;
        sum += raw[j]!;
        count++;
      }
      out[i] = idiv(sum, count);
    }
    return out;
  }

  /** Hash of the orbit's canonical (lowest-index) tile: identical for every image. */
  symmetricHash(seed: number, x: number, y: number): number {
    let best = 0x7fffffff;
    const base = (y * this.n + x) * this.K;
    for (let k = 0; k < this.K; k++) {
      const j = this.orbits[base + k]!;
      if (j < 0) break;
      if (j < best) best = j;
    }
    return hash2(seed, best, 0) >>> 0;
  }

  /** One cellular-automaton pass: drop lone obstacles, fill pinholes. Symmetric in, symmetric out. */
  smooth(fill: number): void {
    const n = this.n;
    const src = this.terrain.slice();
    const blocked = (x: number, y: number) => !this.inside(x, y) || TERRAIN_SPEED_PCT[src[y * n + x]!] === 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && blocked(x + dx, y + dy)) k++;
        const i = y * n + x;
        if (blocked(x, y) && k <= 1) this.terrain[i] = TERRAIN.ground;
        else if (!blocked(x, y) && k >= 7) this.terrain[i] = fill;
      }
    }
  }

  /** Clear a corridor of passable ground between two points (and all their images). */
  carve(x0: number, y0: number, x1: number, y1: number, width: number, road = -1): void {
    if (this.sym.kind === 'radial') {
      for (let k = 0; k < this.sym.players; k++) {
        const [ax, ay] = this.sym.image(x0, y0, k);
        const [bx, by] = this.sym.image(x1, y1, k);
        this.line(ax, ay, bx, by, width, false, road);
      }
      return;
    }
    this.line(x0, y0, x1, y1, width, true, road);
  }

  /** A river through the given points (sector 0 coordinates, may run off the map), wobbling sideways. */
  river(pts: { x: number; y: number }[], seed: number, width: number): void {
    const water = (i: number) => {
      this.terrain[i] = TERRAIN.water;
    };
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      // Interior vertices wobble by up to 2 tiles; the ends stay put so segments join.
      const wob = (p: { x: number; y: number }, j: number, end: boolean) =>
        end ? p : { x: p.x + ((hash2(seed, j, 1) % 5) - 2), y: p.y + ((hash2(seed, j, 2) % 5) - 2) };
      const p = wob(a, k, k === 0);
      const q = wob(b, k + 1, k + 1 === pts.length - 1);
      this.stroke(p.x, p.y, q.x, q.y, width, water);
    }
  }

  /** Paint `fn` along a thick line, symmetric images included. */
  private stroke(x0: number, y0: number, x1: number, y1: number, width: number, fn: (i: number) => void): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const stepX = x1 > x0 ? 1 : -1;
    const stepY = y1 > y0 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      for (let oy = -width; oy <= width; oy++) for (let ox = -width; ox <= width; ox++) this.paintAll(x + ox, y + oy, fn);
      if (x === x1 && y === y1) return;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += stepX;
      }
      if (e2 < dx) {
        err += dx;
        y += stepY;
      }
    }
  }

  /** paint() for orbit symmetries; per-sector images for radial. */
  private paintAll(x: number, y: number, fn: (i: number) => void): void {
    if (this.sym.kind !== 'radial') return this.paint(x, y, fn);
    for (let k = 0; k < this.sym.players; k++) {
      const [ix, iy] = this.sym.image(x, y, k);
      if (this.inside(ix, iy)) fn(iy * this.n + ix);
    }
  }

  /** A round paved, cleared area. */
  plaza(cx: number, cy: number, r: number, symmetric: boolean): void {
    const pave = (i: number) => {
      this.terrain[i] = TERRAIN.ground;
      this.echo[i] = 0;
      this.surface[i] = SURFACE.plaza;
    };
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + 1) continue;
        if (symmetric) this.paint(cx + x, cy + y, pave);
        else this.paintAll(cx + x, cy + y, pave);
      }
  }

  /**
   * A landmark with its top-left corner at (x, y), if its footprint and a one-tile ring
   * around it are open ground away from bases, fields and roads. All images or none.
   */
  placeLandmark(x: number, y: number, kind: number, starts: { x: number; y: number }[], half: number): boolean {
    const size = LANDMARK_SIZE[kind]!;
    const n = this.n;
    const images: [number, number][] =
      this.sym.kind === 'radial' ? Array.from({ length: this.sym.players }, (_, k) => this.sym.image(x, y, k)) : [[x, y]];
    for (const [ix, iy] of images)
      for (let ty = iy - 1; ty <= iy + size; ty++)
        for (let tx = ix - 1; tx <= ix + size; tx++) {
          if (tx < 2 || ty < 2 || tx >= n - 2 || ty >= n - 2) return false;
          const i = ty * n + tx;
          if (this.terrain[i] !== TERRAIN.ground || this.echo[i] !== 0 || this.landmark[i] !== 0) return false;
          const inside = tx >= ix && ty >= iy && tx < ix + size && ty < iy + size;
          if (this.surface[i] === SURFACE.road && inside) return false;
          if (starts.some((s) => Math.abs(s.x - tx) <= half + 3 && Math.abs(s.y - ty) <= half + 3)) return false;
        }
    const put = (i: number) => {
      this.terrain[i] = TERRAIN.rock;
      this.landmark[i] = kind;
      this.deco[i] = 0;
      this.surface[i] = SURFACE.none;
    };
    for (const [ix, iy] of images)
      for (let ty = iy; ty < iy + size; ty++)
        for (let tx = ix; tx < ix + size; tx++) {
          if (this.sym.kind === 'radial') put(ty * n + tx);
          else this.paint(tx, ty, put);
        }
    return true;
  }

  private line(x0: number, y0: number, x1: number, y1: number, width: number, symmetric: boolean, road: number): void {
    let onRoad = false;
    const open = (i: number) => {
      if (TERRAIN_SPEED_PCT[this.terrain[i]!] === 0) this.terrain[i] = TERRAIN.ground;
      if (onRoad && this.landmark[i] === 0) {
        // Roads are graded: rough ground on the road becomes ground.
        if (this.terrain[i] === TERRAIN.rough) this.terrain[i] = TERRAIN.ground;
        this.surface[i] = SURFACE.road;
      }
    };
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const stepX = x1 > x0 ? 1 : -1;
    const stepY = y1 > y0 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      for (let oy = -width; oy <= width; oy++)
        for (let ox = -width; ox <= width; ox++) {
          onRoad = Math.abs(ox) <= road && Math.abs(oy) <= road;
          if (symmetric) this.paint(x + ox, y + oy, open);
          else if (this.inside(x + ox, y + oy)) open((y + oy) * this.n + x + ox);
        }
      if (x === x1 && y === y1) return;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += stepX;
      }
      if (e2 < dx) {
        err += dx;
        y += stepY;
      }
    }
  }

  /** An Echo field: a ragged blob, richest in the middle, on cleared ground. */
  field(cx: number, cy: number, r: number, amount: number, rng: Rng): void {
    const salt = rng.nextU32();
    if (this.sym.kind === 'radial') {
      // Rotating tiles one by one collides after rounding; draw a fresh blob around each sector's center.
      for (let k = 0; k < this.sym.players; k++) {
        const [ix, iy] = this.sym.image(cx, cy, k);
        this.blob(ix, iy, r, amount, salt, false);
      }
      return;
    }
    this.blob(cx, cy, r, amount, salt, true);
  }

  private blob(cx: number, cy: number, r: number, amount: number, salt: number, symmetric: boolean): void {
    for (let y = -r - 1; y <= r + 1; y++) {
      for (let x = -r - 1; x <= r + 1; x++) {
        const d2 = x * x + y * y;
        const edge = r * r + (hash2(salt, x + 16, y + 16) % (r + 1));
        if (d2 > edge + 2 * r) continue;
        const inField = d2 <= edge;
        const v = Math.max(2, amount - fdiv(d2 * amount, edge + 1));
        const put = (i: number) => {
          this.terrain[i] = TERRAIN.ground;
          if (inField) this.echo[i] = v;
        };
        if (symmetric) this.paint(cx + x, cy + y, put);
        else if (this.inside(cx + x, cy + y)) put((cy + y) * this.n + cx + x);
      }
    }
  }

  /** A round field centered on the map: identical under any rotation. */
  centerField(c: number, r: number, amount: number): void {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d2 = x * x + y * y;
        if (d2 > r * r) continue;
        const i = (c + y) * this.n + c + x;
        this.terrain[i] = TERRAIN.ground;
        this.echo[i] = Math.max(2, amount - fdiv(d2 * amount, r * r + 1));
      }
  }

  /** Flat, buildable, crystal-free square of half-size `h` around (cx, cy); `symmetric` paints all images. */
  clearSquare(cx: number, cy: number, h: number, symmetric = true): void {
    const clear = (i: number) => {
      this.terrain[i] = TERRAIN.ground;
      this.echo[i] = 0;
      this.deco[i] = 0;
      this.landmark[i] = 0;
    };
    for (let y = cy - h; y <= cy + h; y++)
      for (let x = cx - h; x <= cx + h; x++) {
        if (symmetric) this.paint(x, y, clear);
        else if (this.inside(x, y)) clear(y * this.n + x);
      }
  }
}

function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(x + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(y + 0x2545f491, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Bilinear value noise of lattice spacing s over an n x n grid, 0..1023, added into `out` with weight w. */
function addOctave(out: Int32Array, seed: number, n: number, s: number, w: number): void {
  // Lattice values are hashed once per lattice point, not per tile.
  const cells = idiv(n, s) + 2;
  const lat = new Int32Array(cells * cells);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lat[j * cells + i] = hash2(seed, i, j) & 1023;
  const ss = s * s;
  for (let y = 0; y < n; y++) {
    const y0 = idiv(y, s);
    const fy = y - y0 * s;
    for (let x = 0; x < n; x++) {
      const x0 = idiv(x, s);
      const fx = x - x0 * s;
      const k = y0 * cells + x0;
      const top = lat[k]! * (s - fx) + lat[k + 1]! * fx;
      const bot = lat[k + cells]! * (s - fx) + lat[k + cells + 1]! * fx;
      out[y * n + x]! += w * idiv(top * (s - fy) + bot * fy, ss);
    }
  }
}

/** Three octaves (16, 8, 4 tiles), stretched back to roughly 0..1023. */
function valueNoiseGrid(seed: number, n: number): Int32Array {
  const sum = new Int32Array(n * n);
  addOctave(sum, seed, n, 16, 4);
  addOctave(sum, seed + 1, n, 8, 2);
  addOctave(sum, seed + 2, n, 4, 1);
  for (let i = 0; i < n * n; i++) {
    // sum ranges 0..7161 but clusters around the middle; stretch so thresholds bite.
    const centered = idiv(sum[i]!, 7) - 512;
    const v = 512 + idiv(centered * 17, 10);
    sum[i] = v < 0 ? 0 : v > 1023 ? 1023 : v;
  }
  return sum;
}

// --- validation ---

/** Problems with a generated map; empty when it is fair and playable. */
export function validateMap(map: GeneratedMap): string[] {
  const errors: string[] = [];
  const n = map.width;
  const passable = (i: number) => TERRAIN_SPEED_PCT[map.terrain[i]!]! > 0;
  const half = BUILD_AREA >> 1;

  for (let i = 0; i < n * n; i++) if (map.echo[i]! > 0 && !passable(i)) errors.push(`echo on impassable tile ${i}`);

  map.starts.forEach((s, k) => {
    for (let y = s.y - half; y < s.y + half; y++)
      for (let x = s.x - half; x < s.x + half; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) {
          errors.push(`start ${k} build area off map`);
          return;
        }
        const i = y * n + x;
        if (!TERRAIN_BUILDABLE[map.terrain[i]!] || map.echo[i]! > 0) {
          errors.push(`start ${k} build area not flat at ${x},${y}`);
          return;
        }
      }
  });

  // Ground reachability and path length between starts (4-neighbour BFS).
  const dist = bfs(map, map.starts[0]!);
  // Neighbours sit closer on many-player maps.
  const minLen = map.starts.length === 2 ? idiv(n, 2) : idiv(n, 4);
  const maxLen = n * 3;
  for (let k = 1; k < map.starts.length; k++) {
    const s = map.starts[k]!;
    const d = dist[s.y * n + s.x]!;
    if (d < 0) errors.push(`start ${k} unreachable from start 0`);
    else if (d < minLen || d > maxLen) errors.push(`start ${k} path length ${d} outside ${minLen}..${maxLen}`);
  }

  // Equal resources: each Echo tile belongs to its nearest start; shared ties are skipped.
  const totals = map.starts.map(() => 0);
  for (let i = 0; i < n * n; i++) {
    if (map.echo[i] === 0) continue;
    const x = i % n;
    const y = idiv(i, n);
    let best = -1;
    let bestD = 0x7fffffff;
    let tie = false;
    map.starts.forEach((s, k) => {
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < bestD) {
        bestD = d;
        best = k;
        tie = false;
      } else if (d === bestD) tie = true;
    });
    if (!tie) totals[best]! += map.echo[i]!;
  }
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  // Exact symmetries must be exactly fair; rounded radial maps get 15% slack.
  const slack = map.symmetry === 'radial' ? idiv(hi * 15, 100) : 0;
  if (hi - lo > slack) errors.push(`unequal resources ${totals.join('/')}`);
  if (lo === 0) errors.push('a player has no Echo');

  // Every Echo field must be reachable by ground from start 0.
  for (let i = 0; i < n * n; i++) {
    if (map.echo[i] === 0) continue;
    if (dist[i]! < 0) {
      errors.push(`echo tile ${i} unreachable`);
      break;
    }
  }
  return errors;
}

function bfs(map: GeneratedMap, from: { x: number; y: number }): Int32Array {
  const n = map.width;
  const dist = new Int32Array(n * n).fill(-1);
  const queue = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  const start = from.y * n + from.x;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % n;
    const y = idiv(i, n);
    const d = dist[i]! + 1;
    const visit = (j: number) => {
      if (dist[j]! >= 0 || TERRAIN_SPEED_PCT[map.terrain[j]!] === 0) return;
      dist[j] = d;
      queue[tail++] = j;
    };
    if (x > 0) visit(i - 1);
    if (x < n - 1) visit(i + 1);
    if (y > 0) visit(i - n);
    if (y < n - 1) visit(i + n);
  }
  return dist;
}
