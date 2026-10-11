import { FX_HALF, FX_ONE, FX_SHIFT, pct } from './fx';
import { upgradePct } from './systems/faction';
import { KIND } from './entities';
import { TERRAIN_SPEED_PCT, inBounds, refreshNav } from './map';
import type { World } from './world';

/** Spawn a unit at a Q10 world position. Returns its handle. */
export function spawnUnit(world: World, ruleIndex: number, owner: number, x: number, y: number): number {
  const rule = world.rules.units[ruleIndex];
  if (!rule) throw new Error(`unknown unit rule ${ruleIndex}`);
  const e = world.entities;
  const h = e.allocate();
  const s = h & 0xffff;
  e.kind[s] = KIND.unit;
  e.type[s] = ruleIndex;
  e.owner[s] = owner;
  e.x[s] = x;
  e.y[s] = y;
  e.radius[s] = rule.radius;
  // Armor and Harmonic Shields upgrades raise new units' pools too.
  const hp = pct(rule.hp, 100 + upgradePct(world, owner, 'hpPct'));
  const shields = pct(rule.shields, 100 + upgradePct(world, owner, 'shieldPct'));
  e.hp[s] = hp;
  e.maxHp[s] = hp;
  e.shields[s] = shields;
  e.maxShields[s] = shields;
  e.anchorX[s] = x;
  e.anchorY[s] = y;
  e.goalX[s] = x;
  e.goalY[s] = y;
  return h;
}

/** Spawn a unit centered on a tile. */
export function spawnUnitAtTile(world: World, ruleIndex: number, owner: number, tx: number, ty: number): number {
  return spawnUnit(world, ruleIndex, owner, (tx << FX_SHIFT) + FX_HALF, (ty << FX_SHIFT) + FX_HALF);
}

/** Can a structure with this footprint go at tile (tx, ty)? Ignores faction placement rules. */
export function footprintFree(world: World, w: number, h: number, tx: number, ty: number): boolean {
  const m = world.map;
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (!inBounds(m, x, y)) return false;
      const i = y * m.width + x;
      if (m.occupant[i] !== -1 || TERRAIN_SPEED_PCT[m.terrain[i]!] === 0) return false;
    }
  }
  return true;
}

/** Spawn a finished structure with its footprint origin at tile (tx, ty). Returns its handle, or -1 if blocked. */
export function spawnStructure(world: World, ruleIndex: number, owner: number, tx: number, ty: number): number {
  const rule = world.rules.structures[ruleIndex];
  if (!rule) throw new Error(`unknown structure rule ${ruleIndex}`);
  const fw = rule.footprintW;
  const fh = rule.footprintH;
  if (!footprintFree(world, fw, fh, tx, ty)) return -1;
  const e = world.entities;
  const h = e.allocate();
  const s = h & 0xffff;
  e.kind[s] = KIND.structure;
  e.type[s] = ruleIndex;
  e.owner[s] = owner;
  e.tileX[s] = tx;
  e.tileY[s] = ty;
  e.x[s] = (tx << FX_SHIFT) + ((fw * FX_ONE) >> 1);
  e.y[s] = (ty << FX_SHIFT) + ((fh * FX_ONE) >> 1);
  e.radius[s] = (Math.max(fw, fh) * FX_ONE) >> 1;
  e.hp[s] = rule.hp;
  e.maxHp[s] = rule.hp;
  e.anchorX[s] = e.x[s]!;
  e.anchorY[s] = e.y[s]!;
  if (rule.blocksGround) setOccupancy(world, s, tx, ty, fw, fh, s);
  return h;
}

function setOccupancy(world: World, _slot: number, tx: number, ty: number, w: number, h: number, value: number): void {
  const m = world.map;
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      const i = y * m.width + x;
      m.occupant[i] = value;
      refreshNav(m, i);
    }
  }
  m.navVersion++;
}

/** Remove an entity immediately (death, sale, deploy). */
export function removeEntity(world: World, slot: number): void {
  const e = world.entities;
  if (e.alive[slot] !== 1) return;
  if (e.kind[slot] === KIND.structure) {
    const rule = world.rules.structures[e.type[slot]!]!;
    if (rule.blocksGround) setOccupancy(world, slot, e.tileX[slot]!, e.tileY[slot]!, rule.footprintW, rule.footprintH, -1);
  }
  e.free(slot);
}
