import { ANGLE_FULL, FX_SHIFT, iatan2, icos, idiv, isin } from '@signal-fall/sim';

export type SymmetryKind = 'mirrorH' | 'mirrorV' | 'mirrorD' | 'rotate180' | 'quad' | 'radial';

/**
 * A symmetry group over the square map. `orbit` lists every tile equivalent to
 * (x, y) including itself; writing the same value to the whole orbit keeps the
 * map symmetric, and averaging a field over the orbit makes it symmetric.
 */
export interface Symmetry {
  kind: SymmetryKind;
  /** Number of players / sectors. */
  players: number;
  orbit(x: number, y: number): [number, number][];
  /** Map a point in sector 0 to sector k (the k-th player's equivalent). */
  image(x: number, y: number, k: number): [number, number];
}

export function makeSymmetry(kind: SymmetryKind, n: number, players: number): Symmetry {
  const last = n - 1;
  const two = (f: (x: number, y: number) => [number, number]): Symmetry => ({
    kind,
    players: 2,
    orbit: (x, y) => {
      const [a, b] = f(x, y);
      return a === x && b === y ? [[x, y]] : [
        [x, y],
        [a, b],
      ];
    },
    image: (x, y, k) => (k === 0 ? [x, y] : f(x, y)),
  });
  switch (kind) {
    case 'mirrorH':
      return two((x, y) => [last - x, y]);
    case 'mirrorV':
      return two((x, y) => [x, last - y]);
    case 'mirrorD':
      return two((x, y) => [y, x]);
    case 'rotate180':
      return two((x, y) => [last - x, last - y]);
    case 'quad': {
      const imgs = (x: number, y: number): [number, number][] => [
        [x, y],
        [last - x, y],
        [last - x, last - y],
        [x, last - y],
      ];
      return {
        kind,
        players: 4,
        orbit: (x, y) => dedupe(imgs(x, y)),
        image: (x, y, k) => imgs(x, y)[k]!,
      };
    }
    case 'radial': {
      // Rotation about the map center by k/players of a turn, rounded to tiles.
      const c2 = last; // center * 2, so half-tiles stay integral
      const rot = (x: number, y: number, k: number): [number, number] => {
        const a = idiv(ANGLE_FULL * k, players);
        const dx = 2 * x - c2;
        const dy = 2 * y - c2;
        const rx = (dx * icos(a) - dy * isin(a)) >> FX_SHIFT;
        const ry = (dx * isin(a) + dy * icos(a)) >> FX_SHIFT;
        return [clamp(idiv(rx + c2 + 1, 2), last), clamp(idiv(ry + c2 + 1, 2), last)];
      };
      return {
        kind,
        players,
        orbit: (x, y) => dedupe(Array.from({ length: players }, (_, k) => rot(x, y, k))),
        image: (x, y, k) => rot(x, y, k),
      };
    }
  }
}

function clamp(v: number, last: number): number {
  return v < 0 ? 0 : v > last ? last : v;
}

function dedupe(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) if (!out.some((q) => q[0] === p[0] && q[1] === p[1])) out.push(p);
  return out;
}

/** Which radial sector (0..players-1) a point is in, by angle around the center. */
export function sectorOf(x: number, y: number, n: number, players: number): number {
  const a = iatan2(2 * y - (n - 1), 2 * x - (n - 1));
  return idiv(a * players, ANGLE_FULL);
}
