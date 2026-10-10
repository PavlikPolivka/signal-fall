import { idiv } from './fx';
import type { GameMap } from './map';

const ORTHO = 10;
const DIAG = 14;
export const UNREACHABLE = 0x7fffffff;

// Neighbor offsets: E, W, S, N, SE, SW, NE, NW.
const DX = [1, -1, 0, 0, 1, -1, 1, -1];
const DY = [0, 0, 1, -1, 1, 1, -1, -1];

/** Min-heap of (key, value) int pairs with deterministic tie-breaking on value. */
class Heap {
  keys = new Int32Array(1024);
  vals = new Int32Array(1024);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a]!;
    const kb = this.keys[b]!;
    return ka < kb || (ka === kb && this.vals[a]! < this.vals[b]!);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const v = this.vals[a]!;
    this.vals[a] = this.vals[b]!;
    this.vals[b] = v;
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Int32Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Pop the minimum and return its value. Key of the popped item is in lastKey. */
  lastKey = 0;
  pop(): number {
    const val = this.vals[0]!;
    this.lastKey = this.keys[0]!;
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size]!;
      this.vals[0] = this.vals[this.size]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return val;
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx > dy ? ORTHO * dx + (DIAG - ORTHO) * dy : ORTHO * dy + (DIAG - ORTHO) * dx;
}

export class Pathfinder {
  private readonly map: GameMap;
  private readonly g: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;
  private readonly heap = new Heap();
  private readonly flowCache = new Map<number, { version: number; dist: Int32Array }>();

  constructor(map: GameMap) {
    this.map = map;
    const n = map.width * map.height;
    this.g = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /** Can a ground unit step from tile i in direction d (no corner cutting)? */
  private canStep(x: number, y: number, d: number): boolean {
    const m = this.map;
    const nx = x + DX[d]!;
    const ny = y + DY[d]!;
    if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) return false;
    if (m.nav[ny * m.width + nx] !== 1) return false;
    if (d >= 4) {
      if (m.nav[y * m.width + nx] !== 1 || m.nav[ny * m.width + x] !== 1) return false;
    }
    return true;
  }

  /** Nearest passable tile to `goal` (by ring search), or -1 if none within maxRadius. */
  nearestPassable(goal: number, maxRadius = 16): number {
    const m = this.map;
    if (m.nav[goal] === 1) return goal;
    const gx = goal % m.width;
    const gy = idiv(goal, m.width);
    for (let r = 1; r <= maxRadius; r++) {
      let best = -1;
      let bestD = UNREACHABLE;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
          const i = y * m.width + x;
          if (m.nav[i] !== 1) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD || (d === bestD && i < best)) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * A* from tile `start` to tile `goal`. Returns waypoint tiles (excluding the
   * start, pruned to direction changes, always ending at the reached tile), or
   * null if there is nowhere to go. When the goal is unreachable the path leads
   * to the explored tile closest to it.
   */
  findPath(start: number, goal: number, maxNodes = 12000): Int32Array | null {
    const m = this.map;
    const w = m.width;
    const target = this.nearestPassable(goal);
    if (target < 0 || target === start) return null;
    const tx = target % w;
    const ty = idiv(target, w);

    const id = ++this.search;
    const heap = this.heap;
    heap.clear();
    const sx = start % w;
    const sy = idiv(start, w);
    this.g[start] = 0;
    this.parent[start] = -1;
    this.seen[start] = id;
    heap.push(octile(sx, sy, tx, ty), start);
    let best = start;
    let bestH = octile(sx, sy, tx, ty);
    let expanded = 0;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === id) continue;
      this.closed[cur] = id;
      if (cur === target) {
        best = cur;
        break;
      }
      const cx = cur % w;
      const cy = idiv(cur, w);
      const h = octile(cx, cy, tx, ty);
      if (h < bestH || (h === bestH && cur < best)) {
        bestH = h;
        best = cur;
      }
      if (++expanded > maxNodes) break;
      const gc = this.g[cur]!;
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, d)) continue;
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        const n = ny * w + nx;
        if (this.closed[n] === id) continue;
        const ng = gc + (d >= 4 ? DIAG : ORTHO);
        if (this.seen[n] === id && ng >= this.g[n]!) continue;
        this.seen[n] = id;
        this.g[n] = ng;
        this.parent[n] = cur;
        heap.push(ng + octile(nx, ny, tx, ty), n);
      }
    }
    if (best === start) return null;
    return this.reconstruct(best, start);
  }

  private reconstruct(end: number, start: number): Int32Array {
    const w = this.map.width;
    const tiles: number[] = [];
    for (let t = end; t !== start && t >= 0; t = this.parent[t]!) tiles.push(t);
    tiles.reverse();
    // Keep only tiles where the direction changes, plus the last one.
    const out: number[] = [];
    let prev = start;
    let pdx = 0;
    let pdy = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      const dx = (t % w) - (prev % w);
      const dy = idiv(t, w) - idiv(prev, w);
      if (i > 0 && (dx !== pdx || dy !== pdy)) out.push(prev);
      pdx = dx;
      pdy = dy;
      prev = t;
    }
    out.push(end);
    return Int32Array.from(out);
  }

  /**
   * Distance field (in ORTHO/DIAG units) from every tile to `goal`. Cached per
   * goal until the nav grid changes, so the result is always a pure function
   * of (goal, nav).
   */
  flowField(goal: number): Int32Array {
    const m = this.map;
    const cached = this.flowCache.get(goal);
    if (cached && cached.version === m.navVersion) return cached.dist;
    if (this.flowCache.size > 32) {
      // Evict the oldest entry (Map preserves insertion order).
      const first = this.flowCache.keys().next();
      if (!first.done) this.flowCache.delete(first.value);
    }
    const w = m.width;
    const dist = cached?.dist ?? new Int32Array(w * m.height);
    dist.fill(UNREACHABLE);
    const heap = this.heap;
    heap.clear();
    const target = this.nearestPassable(goal);
    if (target >= 0) {
      dist[target] = 0;
      heap.push(0, target);
    }
    while (heap.size > 0) {
      const cur = heap.pop();
      const dc = heap.lastKey;
      if (dc > dist[cur]!) continue;
      const cx = cur % w;
      const cy = idiv(cur, w);
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, d)) continue;
        const n = (cy + DY[d]!) * w + cx + DX[d]!;
        const nd = dc + (d >= 4 ? DIAG : ORTHO);
        if (nd < dist[n]!) {
          dist[n] = nd;
          heap.push(nd, n);
        }
      }
    }
    this.flowCache.delete(goal);
    this.flowCache.set(goal, { version: m.navVersion, dist });
    return dist;
  }

  /** Next tile to step to from `tile` following a flow field, or -1 if stuck/arrived. */
  flowStep(dist: Int32Array, tile: number): number {
    const w = this.map.width;
    const x = tile % w;
    const y = idiv(tile, w);
    let best = -1;
    let bestD = dist[tile]!;
    for (let d = 0; d < 8; d++) {
      if (!this.canStep(x, y, d)) continue;
      const n = (y + DY[d]!) * w + x + DX[d]!;
      const nd = dist[n]!;
      if (nd < bestD) {
        bestD = nd;
        best = n;
      }
    }
    return best;
  }

  /** True if a ground unit can walk the straight line between two tiles (supercover, no corner cutting). */
  lineClear(a: number, b: number): boolean {
    const m = this.map;
    const w = m.width;
    let x = a % w;
    let y = idiv(a, w);
    const x1 = b % w;
    const y1 = idiv(b, w);
    const dx = Math.abs(x1 - x);
    const dy = Math.abs(y1 - y);
    const sx = x1 > x ? 1 : -1;
    const sy = y1 > y ? 1 : -1;
    let err = dx - dy;
    for (let n = dx + dy; n > 0; n--) {
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) {
        // Diagonal step: both orthogonal neighbours must be open.
        if (m.nav[y * w + x + sx] !== 1 || m.nav[(y + sy) * w + x] !== 1) return false;
        err += dx - dy;
        x += sx;
        y += sy;
        n--;
      } else if (e2 > -dy) {
        err -= dy;
        x += sx;
      } else {
        err += dx;
        y += sy;
      }
      if (m.nav[y * w + x] !== 1) return false;
    }
    return true;
  }
}
