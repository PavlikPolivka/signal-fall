import type { FactionRule, StructureRule } from '@signal-fall/data';
import { FX_ONE, FX_SHIFT, ilength, pct } from './fx';
import { KIND } from './entities';
import { TERRAIN_BUILDABLE } from './map';
import type { World } from './world';
import { upgradePct } from './systems/faction';

/** How far from an Echo tile Choir may grow structures, in tiles. */
export const CHOIR_ECHO_RANGE = 3;

export interface PlacedStructure {
  owner: number;
  rule: StructureRule;
  tx: number;
  ty: number;
}

/**
 * Everything placement needs to know, so the same rules run in the sim and in
 * the client's placement preview (built from a snapshot).
 */
export interface PlacementView {
  width: number;
  height: number;
  terrain: Uint8Array;
  echo: Uint8Array;
  structures: PlacedStructure[];
  /** True if a ground unit stands on the tile (ignoring `ignoreUnit`). */
  unitOn(tx: number, ty: number): boolean;
  /** Percent multiplier on network coverage radius (Extended Relays). */
  coveragePct: number;
}

export type PlacementError = 'blocked' | 'tooFar' | 'noCoverage' | 'noGrowth';

export const PLACEMENT_MESSAGES: Record<PlacementError, string> = {
  blocked: 'Blocked',
  tooFar: 'Must be built next to your base',
  noCoverage: 'Must be inside network coverage',
  noGrowth: 'Must grow near Echo or Choir structures',
};

/** Why `rule` cannot go with its footprint origin at (tx, ty), or null if it can. */
/** True if the footprint at (tx, ty) is off-map, unbuildable, on Echo, on a unit or on a structure. */
export function footprintBlocked(view: PlacementView, rule: StructureRule, tx: number, ty: number): boolean {
  const w = rule.footprintW;
  const h = rule.footprintH;
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (x < 0 || y < 0 || x >= view.width || y >= view.height) return true;
      const i = y * view.width + x;
      if (!TERRAIN_BUILDABLE[view.terrain[i]!] || view.echo[i]! > 0 || view.unitOn(x, y)) return true;
    }
  }
  for (const s of view.structures) {
    if (tx < s.tx + s.rule.footprintW && s.tx < tx + w && ty < s.ty + s.rule.footprintH && s.ty < ty + h) return true;
  }
  return false;
}

/** Why `rule` cannot go with its footprint origin at (tx, ty), or null if it can. */
export function placementError(
  view: PlacementView,
  player: number,
  faction: FactionRule,
  rule: StructureRule,
  tx: number,
  ty: number,
): PlacementError | null {
  if (footprintBlocked(view, rule, tx, ty)) return 'blocked';
  const w = rule.footprintW;
  const h = rule.footprintH;
  const cx = (tx << FX_SHIFT) + ((w * FX_ONE) >> 1);
  const cy = (ty << FX_SHIFT) + ((h * FX_ONE) >> 1);
  const own = view.structures.filter((s) => s.owner === player);
  const centerDist = (s: PlacedStructure) =>
    ilength(cx - ((s.tx << FX_SHIFT) + ((s.rule.footprintW * FX_ONE) >> 1)), cy - ((s.ty << FX_SHIFT) + ((s.rule.footprintH * FX_ONE) >> 1)));

  switch (faction.placement) {
    case 'adjacent': {
      for (const s of own) {
        const gapX = Math.max(0, s.tx - (tx + w), tx - (s.tx + s.rule.footprintW));
        const gapY = Math.max(0, s.ty - (ty + h), ty - (s.ty + s.rule.footprintH));
        if (Math.max(gapX, gapY) <= faction.adjacencyRange) return null;
      }
      return 'tooFar';
    }
    case 'coverage': {
      for (const s of own) {
        if (s.rule.coverageRadius <= 0) continue;
        const r = pct(s.rule.coverageRadius, view.coveragePct);
        if (centerDist(s) <= r) return null;
      }
      return 'noCoverage';
    }
    case 'growth': {
      for (const s of own) if (s.rule.growthRadius > 0 && centerDist(s) <= s.rule.growthRadius) return null;
      const r = CHOIR_ECHO_RANGE;
      for (let y = ty - r; y < ty + h + r; y++) {
        for (let x = tx - r; x < tx + w + r; x++) {
          if (x < 0 || y < 0 || x >= view.width || y >= view.height) continue;
          if (view.echo[y * view.width + x]! > 0) return null;
        }
      }
      return 'noGrowth';
    }
  }
}

/** Placement view of the live sim world. `ignoreUnit` lets a deploying unit stand on its own spot. */
export function worldPlacementView(world: World, player: number, ignoreUnit = -1): PlacementView {
  const e = world.entities;
  const m = world.map;
  const structures: PlacedStructure[] = [];
  const units = new Uint8Array(m.width * m.height);
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    if (e.kind[s] === KIND.structure) {
      structures.push({ owner: e.owner[s]!, rule: world.rules.structures[e.type[s]!]!, tx: e.tileX[s]!, ty: e.tileY[s]! });
    } else if (e.kind[s] === KIND.unit && s !== ignoreUnit && !world.rules.units[e.type[s]!]!.isAir) {
      const tx = e.x[s]! >> FX_SHIFT;
      const ty = e.y[s]! >> FX_SHIFT;
      if (tx >= 0 && ty >= 0 && tx < m.width && ty < m.height) units[ty * m.width + tx] = 1;
    }
  }
  return {
    width: m.width,
    height: m.height,
    terrain: m.terrain,
    echo: m.echo,
    structures,
    unitOn: (x, y) => units[y * m.width + x] === 1,
    coveragePct: coveragePctFor(world, player),
  };
}

/** Coverage radius multiplier for a player: 100 plus Extended Relays. */
export function coveragePctFor(world: World, player: number): number {
  return 100 + upgradePct(world, player, 'coverageRadiusPct');
}
