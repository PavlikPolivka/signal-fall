import { FX_ONE, FX_SHIFT, idiv, ilength, pct } from '../fx';
import { KIND, NO_ENTITY } from '../entities';
import { inBounds } from '../map';
import { teamOf } from '../query';
import { CREDIT_REASON, FX_EVENT, pushFx, type World } from '../world';
import type { PlayerFacts } from './economy';
import { requirementsMet } from './economy';

// Faction mechanics: research and upgrade effects, Halcyon network coverage
// (fire rate, self-repair, Recompile), Choir shield restoration and Echo
// regrowth, and the active abilities blink, phase and Override.

/** Coverage is rebuilt this often (ticks); placement checks compute it exactly. */
const COVERAGE_INTERVAL = 10;
/** Cantor shield restoration: radius (tiles) and shields per second. */
const SHIELD_AURA_RADIUS = 3 * FX_ONE;
const SHIELD_AURA_PER_SECOND = 20;
/** Chord: Echo inside its growth radius regrows this many times faster. */
const CHORD_REGROW_DIVISOR = 3;

// --- upgrades ---

/** Sum of a player's researched upgrade effects of one kind (percent). */
export function upgradePct(world: World, player: number, kind: string): number {
  const p = world.players[player];
  if (!p) return 0;
  let sum = 0;
  const ups = world.rules.upgrades;
  for (let i = 0; i < ups.length; i++) if (p.upgrades[i] === 1 && ups[i]!.effect.kind === kind) sum += ups[i]!.effect.pct;
  return sum;
}

/** Can the player start researching this upgrade now? */
export function canResearch(world: World, facts: PlayerFacts, player: number, upgrade: number): boolean {
  const u = world.rules.upgrades[upgrade];
  const p = world.players[player];
  if (!u || !p || p.upgrades[upgrade] === 1 || p.research.item >= 0) return false;
  if (u.faction >= 0 && u.faction !== p.faction) return false;
  if (!requirementsMet(facts, u.requires)) return false;
  if (u.requiresUpgrade) {
    const pre = world.rules.upgradeIndex.get(u.requiresUpgrade);
    if (pre === undefined || p.upgrades[pre] !== 1) return false;
  }
  return true;
}

/** Research at the tech center: paid continuously like construction; effects apply when done. */
export function researchSystem(world: World, facts: PlayerFacts[]): void {
  for (const p of world.players) {
    const r = p.research;
    if (p.defeated || r.item < 0) continue;
    const u = world.rules.upgrades[r.item]!;
    if (!requirementsMet(facts[p.index]!, u.requires)) continue;
    const speed = p.lowPower ? world.rules.constants.lowPowerSpeedPct : 100;
    const total = u.researchTicks * 100;
    const next = Math.min(total, r.progress + speed);
    const target = idiv(u.cost * next, total);
    if (target - r.spent > p.credits) continue;
    p.credits -= target - r.spent;
    r.spent = target;
    r.progress = next;
    if (next < total) continue;
    p.upgrades[r.item] = 1;
    r.item = -1;
    r.progress = 0;
    r.spent = 0;
    applyUpgrade(world, p.index, u.effect.kind, u.effect.pct);
  }
}

/** Upgrades that change stored stats (HP, shields) apply to everything the player already has. */
function applyUpgrade(world: World, player: number, kind: string, bonus: number): void {
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.owner[s] !== player) continue;
    const rule = world.rules.units[e.type[s]!]!;
    if (kind === 'hpPct') {
      const add = pct(rule.hp, bonus);
      e.maxHp[s]! += add;
      e.hp[s]! += add;
    } else if (kind === 'shieldPct' && rule.shields > 0) {
      const add = pct(rule.shields, bonus);
      e.maxShields[s]! += add;
      e.shields[s]! += add;
    }
  }
}

// --- Halcyon network coverage ---

/** Rebuild each coverage faction's coverage map from its structures. */
export function coverageSystem(world: World): void {
  if (world.tick % COVERAGE_INTERVAL !== 0) return;
  const m = world.map;
  const e = world.entities;
  for (const p of world.players) {
    const f = world.rules.factions[p.faction]!;
    if (f.placement !== 'coverage') continue;
    const cov = world.coverage[p.index]!;
    cov.fill(0);
    const radiusPct = 100 + upgradePct(world, p.index, 'coverageRadiusPct');
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.kind[s] !== KIND.structure || e.owner[s] !== p.index) continue;
      const rule = world.rules.structures[e.type[s]!]!;
      if (rule.coverageRadius <= 0) continue;
      const r = pct(rule.coverageRadius, radiusPct);
      const rt = (r >> FX_SHIFT) + 1;
      const cx = e.x[s]!;
      const cy = e.y[s]!;
      const tx = cx >> FX_SHIFT;
      const ty = cy >> FX_SHIFT;
      for (let y = ty - rt; y <= ty + rt; y++)
        for (let x = tx - rt; x <= tx + rt; x++) {
          if (!inBounds(m, x, y)) continue;
          const dx = (x << FX_SHIFT) + (FX_ONE >> 1) - cx;
          const dy = (y << FX_SHIFT) + (FX_ONE >> 1) - cy;
          if (ilength(dx, dy) <= r) cov[y * m.width + x] = 1;
        }
    }
  }
}

/** Is entity slot s standing inside its owner's network coverage? */
export function inCoverage(world: World, s: number): boolean {
  const e = world.entities;
  const cov = world.coverage[e.owner[s]!];
  if (!cov) return false;
  const m = world.map;
  const tx = e.x[s]! >> FX_SHIFT;
  const ty = e.y[s]! >> FX_SHIFT;
  return inBounds(m, tx, ty) && cov[ty * m.width + tx] === 1;
}

/** Weapon cooldown for a shot from s: Halcyon fires faster inside its network. */
export function cooldownFor(world: World, s: number, base: number): number {
  const f = world.rules.factions[world.players[world.entities.owner[s]!]!.faction]!;
  if (f.coverageFireRatePct <= 0 || !inCoverage(world, s)) return base;
  return Math.max(1, idiv(base * 100, 100 + f.coverageFireRatePct));
}

/** Once a second: network self-repair for units in coverage, Cantor shield restoration. */
export function sustainSystem(world: World): void {
  const tickRate = world.rules.constants.tickRate;
  if (world.tick % tickRate !== 0) return;
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit) continue;
    const f = world.rules.factions[world.players[e.owner[s]!]!.faction]!;
    if (f.coverageRegenHpPerSecond > 0 && e.hp[s]! < e.maxHp[s]! && inCoverage(world, s))
      e.hp[s] = Math.min(e.maxHp[s]!, e.hp[s]! + f.coverageRegenHpPerSecond);
    const rule = world.rules.units[e.type[s]!]!;
    if (!rule.abilities.some((a) => a.kind === 'engineer' && a.restoreShields)) continue;
    const team = teamOf(world, s);
    world.spatial.query(e.x[s]!, e.y[s]!, SHIELD_AURA_RADIUS, (n) => {
      if (e.kind[n] !== KIND.unit || teamOf(world, n) !== team || e.shields[n]! >= e.maxShields[n]!) return;
      if (ilength(e.x[n]! - e.x[s]!, e.y[n]! - e.y[s]!) > SHIELD_AURA_RADIUS) return;
      e.shields[n] = Math.min(e.maxShields[n]!, e.shields[n]! + SHIELD_AURA_PER_SECOND);
    });
  }
}

/** Halcyon Recompile: a unit lost inside its network refunds part of its cost. */
export function recompileRefund(world: World, s: number): void {
  const e = world.entities;
  if (e.kind[s] !== KIND.unit || e.homeOwner[s]! >= 0) return;
  const p = world.players[e.owner[s]!]!;
  const f = world.rules.factions[p.faction]!;
  if (f.recompileRefundPct <= 0 || !inCoverage(world, s)) return;
  // Deep Recompile replaces the base refund.
  const deep = upgradePct(world, p.index, 'recompileRefundPct');
  const refund = pct(world.rules.units[e.type[s]!]!.cost, deep > 0 ? deep : f.recompileRefundPct);
  p.credits += refund;
  pushFx(world, FX_EVENT.credits, refund, CREDIT_REASON.recompile, p.index, e.x[s]!, e.y[s]!, 0, 0);
}

/** Choir Chords: Echo near them regrows faster (runs every tick, cheap: only near Chords). */
export function chordRegrowSystem(world: World): void {
  const period = idiv(world.rules.constants.echoRegrowTicks, CHORD_REGROW_DIVISOR);
  if (period <= 0 || world.tick % period !== 0 || world.tick % world.rules.constants.echoRegrowTicks === 0) return;
  const e = world.entities;
  const m = world.map;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.structure) continue;
    const rule = world.rules.structures[e.type[s]!]!;
    if (rule.echoRegrowPct <= 0 || rule.growthRadius <= 0) continue;
    const r = rule.growthRadius;
    const rt = (r >> FX_SHIFT) + 1;
    const tx = e.x[s]! >> FX_SHIFT;
    const ty = e.y[s]! >> FX_SHIFT;
    for (let y = ty - rt; y <= ty + rt; y++)
      for (let x = tx - rt; x <= tx + rt; x++) {
        if (!inBounds(m, x, y)) continue;
        const i = y * m.width + x;
        if (m.echoCap[i]! <= m.echo[i]!) continue;
        if (ilength((x << FX_SHIFT) - e.x[s]!, (y << FX_SHIFT) - e.y[s]!) > r) continue;
        m.echo[i]!++;
      }
  }
}

// --- active abilities ---

/** Expire phase-outs and Overrides. */
export function abilitySystem(world: World): void {
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit) continue;
    if (e.homeOwner[s]! >= 0 && world.tick >= e.overrideUntil[s]!) {
      e.owner[s] = e.homeOwner[s]!;
      e.homeOwner[s] = -1;
      releaseControl(world, s);
    }
  }
}

function releaseControl(world: World, s: number): void {
  const e = world.entities;
  e.orders[s] = [];
  e.target[s] = NO_ENTITY;
  e.hasGoal[s] = 0;
  e.anchorX[s] = e.x[s]!;
  e.anchorY[s] = e.y[s]!;
  e.paths[s] = null;
  e.pathGoal[s] = -1;
  // Harvesters go back to work for whoever owns them now.
  if (e.hstate[s] !== 0) {
    e.hstate[s] = 1;
    e.htile[s] = -1;
    e.cargo[s] = 0;
  }
}

export function isPhased(world: World, s: number): boolean {
  return world.entities.phasedUntil[s]! > world.tick;
}

/**
 * Use unit s's active ability. Blink needs a point, Override a target unit,
 * phase needs nothing. Returns whether it fired (cooldown, range, immunity).
 */
export function useAbility(world: World, player: number, s: number, x: number, y: number, target: number): boolean {
  const e = world.entities;
  if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.owner[s] !== player || world.tick < e.abilityReady[s]!) return false;
  const rule = world.rules.units[e.type[s]!]!;
  for (const a of rule.abilities) {
    if (a.kind === 'blink') {
      if (x < 0 || y < 0) return false;
      let dx = x - e.x[s]!;
      let dy = y - e.y[s]!;
      const d = ilength(dx, dy);
      if (d > a.range) {
        dx = idiv(dx * a.range, d);
        dy = idiv(dy * a.range, d);
      }
      const nx = e.x[s]! + dx;
      const ny = e.y[s]! + dy;
      const m = world.map;
      let tile = (ny >> FX_SHIFT) * m.width + (nx >> FX_SHIFT);
      const air = rule.isAir;
      if (!inBounds(m, nx >> FX_SHIFT, ny >> FX_SHIFT)) return false;
      if (!air && m.nav[tile] !== 1) tile = world.paths.nearestPassable(tile, 3);
      if (tile < 0) return false;
      pushFx(world, FX_EVENT.ability, 1, e.type[s]!, player, e.x[s]!, e.y[s]!, nx, ny);
      e.x[s] = air ? nx : ((tile % m.width) << FX_SHIFT) + (FX_ONE >> 1);
      e.y[s] = air ? ny : (idiv(tile, m.width) << FX_SHIFT) + (FX_ONE >> 1);
      e.anchorX[s] = e.x[s]!;
      e.anchorY[s] = e.y[s]!;
      e.paths[s] = null;
      e.pathGoal[s] = -1;
      e.hasGoal[s] = 0;
      e.abilityReady[s] = world.tick + a.cooldown;
      return true;
    }
    if (a.kind === 'phase') {
      e.phasedUntil[s] = world.tick + a.duration;
      e.target[s] = NO_ENTITY;
      e.abilityReady[s] = world.tick + a.cooldown;
      pushFx(world, FX_EVENT.ability, 2, e.type[s]!, player, e.x[s]!, e.y[s]!, 0, 0);
      return true;
    }
    if (a.kind === 'override') {
      const t = e.resolve(target);
      if (t < 0 || e.kind[t] !== KIND.unit || teamOf(world, t) === teamOf(world, s) || e.homeOwner[t]! >= 0) return false;
      const victim = world.rules.units[e.type[t]!]!;
      // Mechanical units only: vehicles and aircraft.
      if (victim.tab === 'infantry') return false;
      const vf = world.rules.factions[world.players[e.owner[t]!]!.faction]!;
      if (vf.airGapped) return false;
      if (ilength(e.x[t]! - e.x[s]!, e.y[t]! - e.y[s]!) > a.range) return false;
      const duration = pct(a.duration, 100 - vf.overrideResistPct);
      if (duration <= 0) return false;
      e.homeOwner[t] = e.owner[t]!;
      e.owner[t] = player;
      e.overrideUntil[t] = world.tick + duration;
      releaseControl(world, t);
      e.abilityReady[s] = world.tick + a.cooldown;
      pushFx(world, FX_EVENT.ability, 3, e.type[s]!, player, e.x[s]!, e.y[s]!, e.x[t]!, e.y[t]!);
      return true;
    }
  }
  return false;
}
