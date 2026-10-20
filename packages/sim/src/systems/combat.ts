import { GARRISON_DAMAGE_PCT } from './garrison';
import { ARMOR, DAMAGE } from '@signal-fall/data';
import { FX_ONE, iatan2, idiv, ilength, pct } from '../fx';
import { KIND } from '../entities';
import { armorOf, canTarget, costOf, digInOf, distToBody, inWeaponRange, isAir, isDugIn, teamOf, weaponOf } from '../query';
import { removeEntity } from '../spawn';
import { spawnWreck } from './economy';
import { chorusPct, cooldownFor, isPhased, recompileRefund, upgradePct } from './faction';
import { FX_EVENT, pushFx, type Projectile, type World } from '../world';

const ENERGY = DAMAGE.indexOf('energy');
/** Chain lightning jumps to targets within this distance of the last hit. */
const CHAIN_RANGE = 3 * FX_ONE;
/** Share of the beam's damage taken by things it sweeps across. */
const SWEEP_PCT = 60;
const ARMOR_COUNT = ARMOR.length;

/** Fire weapons at current targets. Damage is delivered by projectiles (instant hits resolve this tick). */
export function weaponSystem(world: World): void {
  const e = world.entities;
  const vetPct = world.rules.constants.veterancyDamagePct;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    if (e.cooldown[s]! > 0) e.cooldown[s]!--;
    const weapon = weaponOf(world, s);
    if (!weapon) continue;
    // Powered defenses go offline in low power.
    if (e.kind[s] === KIND.structure && world.players[e.owner[s]!]!.lowPower && world.rules.structures[e.type[s]!]!.power < 0) continue;
    // Switched off by its owner.
    if (e.kind[s] === KIND.structure && e.poweredDown[s] === 1) continue;
    const t = e.resolve(e.target[s]!);
    if (t < 0) continue;
    // Phased units cannot shoot or be shot.
    if (isPhased(world, s) || isPhased(world, t)) continue;
    if (!canTarget(world, s, weapon, t) || !inWeaponRange(world, s, weapon, t)) continue;
    // Moving units do not fire; behavior clears the goal once a target is in range.
    if (e.kind[s] === KIND.unit && e.hasGoal[s] === 1) continue;
    e.facing[s] = iatan2(e.y[t]! - e.y[s]!, e.x[t]! - e.x[s]!);
    if (e.cooldown[s]! > 0) continue;
    // Overkill: if shots already in flight will kill an automatic target, hold this one for something else.
    const life = e.hp[t]! + e.shields[t]!;
    const explicit = e.kind[s] === KIND.unit && e.orders[s]![0]?.type === 'attack';
    if (!explicit && (world.pending.get(t) ?? 0) >= life) {
      e.target[s] = -1;
      continue;
    }
    e.cooldown[s] = cooldownFor(world, s, weapon.cooldown);
    const dist = distToBody(world, e.x[s]!, e.y[s]!, t);
    const ticks = weapon.projectileSpeed > 0 ? idiv(dist + weapon.projectileSpeed - 1, weapon.projectileSpeed) : 0;
    world.projectiles.push({
      owner: e.owner[s]!,
      ox: e.x[s]!,
      oy: e.y[s]!,
      total: ticks,
      source: e.handle(s),
      target: e.handle(t),
      x: e.x[t]!,
      y: e.y[t]!,
      damage: pct(weapon.damage, 100 + vetPct * e.rank[s]! + upgradePct(world, e.owner[s]!, 'damagePct') + chorusPct(world, s)),
      type: weapon.type,
      splash: weapon.splash,
      hitsGround: weapon.targetsGround,
      hitsAir: weapon.targetsAir,
      ticks,
      ...special(world, s),
    });
    pushFx(world, FX_EVENT.fire, e.kind[s]!, e.type[s]!, e.owner[s]!, e.x[s]!, e.y[s]!, e.x[t]!, e.y[t]!);
    const dealt = pct(pct(weapon.damage, 100 + vetPct * e.rank[s]!), world.rules.damageMatrix[weapon.type * ARMOR_COUNT + armorOf(world, t)]!);
    world.pending.set(t, (world.pending.get(t) ?? 0) + dealt);
  }
}

/** Advance projectiles; apply damage on impact. */
export function projectileSystem(world: World): void {
  const e = world.entities;
  const live: Projectile[] = [];
  for (const p of world.projectiles) {
    const t = e.resolve(p.target);
    if (t >= 0) {
      p.x = e.x[t]!;
      p.y = e.y[t]!;
    }
    if (p.ticks > 0) {
      p.ticks--;
      if (p.ticks > 0) {
        live.push(p);
        continue;
      }
    }
    impact(world, p, t);
  }
  world.projectiles = live;
}

function impact(world: World, p: Projectile, primary: number): void {
  const e = world.entities;
  const team = world.players[p.owner]!.team;
  pushFx(world, FX_EVENT.impact, p.type, p.splash, p.owner, p.x, p.y, 0, 0);
  if (primary >= 0) damage(world, primary, p.damage, p.type, p.source);
  if (p.chainJumps > 0) chain(world, p, primary);
  if (p.sweep > 0) sweep(world, p, primary);
  if (p.splash <= 0) return;
  // Splash hits enemies on the weapon's layer with linear falloff to 50% at the edge.
  const victims: number[] = [];
  world.spatial.query(p.x, p.y, p.splash + 2 * FX_ONE, (s) => {
    if (s === primary || e.alive[s] !== 1) return;
    if (e.kind[s] !== KIND.unit && e.kind[s] !== KIND.structure) return;
    if (teamOf(world, s) === team) return;
    if (isAir(world, s) ? !p.hitsAir : !p.hitsGround) return;
    if (distToBody(world, p.x, p.y, s) <= p.splash) victims.push(s);
  });
  for (const s of victims) {
    const d = distToBody(world, p.x, p.y, s);
    const falloff = 100 - idiv(50 * d, p.splash);
    damage(world, s, pct(p.damage, falloff), p.type, p.source);
  }
}

/** Apply typed damage through the matrix; shields absorb first. */
export function damage(world: World, victim: number, base: number, type: number, attacker: number): void {
  const e = world.entities;
  if (e.alive[victim] !== 1 || e.hp[victim]! <= 0 || isPhased(world, victim)) return;
  const mult = world.rules.damageMatrix[type * ARMOR_COUNT + armorOf(world, victim)]!;
  if (mult <= 0) return;
  let dmg = pct(base, mult);
  // Reinforced Plating: vehicles shrug off part of Energy damage.
  if (type === ENERGY && e.kind[victim] === KIND.unit && world.rules.units[e.type[victim]!]!.tab === 'vehicles') {
    const resist = upgradePct(world, e.owner[victim]!, 'vehicleEnergyResistPct');
    if (resist > 0) dmg = pct(dmg, 100 - resist);
  }
  // Dug in behind sandbags, or inside ruins.
  if (isDugIn(world, victim)) dmg = pct(dmg, digInOf(world, victim)!.damageTakenPct);
  if (e.garrison[victim]! > 0) dmg = pct(dmg, GARRISON_DAMAGE_PCT);
  if (dmg < 1) dmg = 1;
  // Shields soak damage first; energy weapons tear through shields faster.
  const shieldPct = world.rules.constants.shieldDamagePct[type]!;
  const vsShields = pct(dmg, shieldPct);
  const absorbed = Math.min(e.shields[victim]!, vsShields);
  e.shields[victim]! -= absorbed;
  // Whatever the shields did not soak goes to hull, converted back to plain damage.
  e.hp[victim]! -= absorbed === vsShields ? 0 : dmg - idiv(absorbed * 100, shieldPct);
  e.lastHitTick[victim] = world.tick;
  e.lastAttacker[victim] = attacker;
  const a = e.resolve(attacker);
  if (a >= 0) e.lastAttackerOwner[victim] = e.owner[a]!;
}

/** Remove dead entities, award veterancy to killers. */
export function deathSystem(world: World): void {
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.hp[s]! > 0) continue;
    const killer = e.resolve(e.lastAttacker[s]!);
    if (killer >= 0 && e.kind[killer] === KIND.unit && teamOf(world, killer) !== teamOf(world, s)) {
      e.xp[killer]! += costOf(world, s);
      promote(world, killer);
    }
    // Match statistics: the loss for the owner, the kill for whoever hit it last (enemies only).
    const value = costOf(world, s);
    const structure = e.kind[s] === KIND.structure;
    const loser = world.players[e.owner[s]!]!.stats;
    if (structure) loser.structuresLost++;
    else loser.unitsLost++;
    loser.valueLost += value;
    const by = e.lastAttackerOwner[s]!;
    if (by >= 0 && world.players[by] && world.players[by]!.team !== world.players[e.owner[s]!]!.team) {
      const winner = world.players[by]!.stats;
      if (structure) winner.structuresKilled++;
      else winner.unitsKilled++;
      winner.valueKilled += value;
    }
    pushFx(world, FX_EVENT.death, e.kind[s]!, e.type[s]!, e.owner[s]!, e.x[s]!, e.y[s]!, 0, 0);
    recompileRefund(world, s);
    spawnWreck(world, s);
    removeEntity(world, s);
  }
}

export function promote(world: World, s: number): void {
  const e = world.entities;
  const c = world.rules.constants;
  const cost = costOf(world, s);
  const rule = world.rules.units[e.type[s]!]!;
  while (e.rank[s]! < c.veterancyThresholdPct.length && e.xp[s]! * 100 >= cost * c.veterancyThresholdPct[e.rank[s]!]!) {
    e.rank[s]!++;
    const newMax = pct(rule.hp, 100 + c.veterancyHpPct * e.rank[s]!);
    e.hp[s]! += newMax - e.maxHp[s]!;
    e.maxHp[s] = newMax;
  }
}

/** Shields regenerate after a delay out of combat (Choir). */
export function shieldSystem(world: World): void {
  const e = world.entities;
  const tickRate = world.rules.constants.tickRate;
  if (world.tick % tickRate !== 0) return;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.maxShields[s] === 0 || e.shields[s]! >= e.maxShields[s]!) continue;
    const faction = world.rules.factions[world.players[e.owner[s]!]!.faction]!;
    if (e.lastHitTick[s]! >= 0 && world.tick - e.lastHitTick[s]! < faction.shieldRegenDelay) continue;
    e.shields[s] = Math.min(e.maxShields[s]!, e.shields[s]! + faction.shieldRegenPerSecond);
  }
}

/** Chain / sweep parameters a shooter's abilities add to its projectiles. */
function special(world: World, s: number): { chainJumps: number; chainPct: number; sweep: number } {
  const e = world.entities;
  const out = { chainJumps: 0, chainPct: 0, sweep: 0 };
  if (e.kind[s] !== KIND.unit) return out;
  for (const a of world.rules.units[e.type[s]!]!.abilities) {
    if (a.kind === 'chain') {
      out.chainJumps = a.jumps;
      out.chainPct = a.falloffPct;
    } else if (a.kind === 'sweep') out.sweep = a.width;
  }
  return out;
}

/** Can a projectile's damage land on slot s (enemy of its owner, on a layer it hits)? */
function hittable(world: World, p: Projectile, s: number, team: number): boolean {
  const e = world.entities;
  if (e.alive[s] !== 1 || (e.kind[s] !== KIND.unit && e.kind[s] !== KIND.structure)) return false;
  if (teamOf(world, s) === team) return false;
  return isAir(world, s) ? p.hitsAir : p.hitsGround;
}

/** broadcast: the hit arcs on to the nearest further enemies, weaker each jump. */
function chain(world: World, p: Projectile, primary: number): void {
  const e = world.entities;
  const team = world.players[p.owner]!.team;
  const hit = [primary];
  let x = p.x;
  let y = p.y;
  let dmg = p.damage;
  for (let j = 0; j < p.chainJumps; j++) {
    dmg = pct(dmg, p.chainPct);
    let best = -1;
    let bestD = 0;
    world.spatial.query(x, y, CHAIN_RANGE, (s) => {
      if (hit.includes(s) || !hittable(world, p, s, team)) return;
      const d = distToBody(world, x, y, s);
      if (d > CHAIN_RANGE) return;
      if (best < 0 || d < bestD || (d === bestD && s < best)) {
        best = s;
        bestD = d;
      }
    });
    if (best < 0) return;
    hit.push(best);
    pushFx(world, FX_EVENT.impact, ENERGY, 0, p.owner, e.x[best]!, e.y[best]!, x, y);
    damage(world, best, dmg, p.type, p.source);
    x = e.x[best]!;
    y = e.y[best]!;
  }
}

/** Requiem: the beam sweeps along its line, hurting everything near it (the target takes the full hit). */
function sweep(world: World, p: Projectile, primary: number): void {
  const e = world.entities;
  const team = world.players[p.owner]!.team;
  const abx = p.x - p.ox;
  const aby = p.y - p.oy;
  const len2 = abx * abx + aby * aby;
  const mx = p.ox + (abx >> 1);
  const my = p.oy + (aby >> 1);
  const reach = (ilength(abx, aby) >> 1) + p.sweep + FX_ONE;
  const victims: number[] = [];
  world.spatial.query(mx, my, reach, (s) => {
    if (s === primary || !hittable(world, p, s, team)) return;
    // Distance from the unit to the beam segment.
    const apx = e.x[s]! - p.ox;
    const apy = e.y[s]! - p.oy;
    let t = len2 > 0 ? idiv((apx * abx + apy * aby) * FX_ONE, len2) : 0;
    t = t < 0 ? 0 : t > FX_ONE ? FX_ONE : t;
    const cx = p.ox + idiv(abx * t, FX_ONE);
    const cy = p.oy + idiv(aby * t, FX_ONE);
    if (ilength(e.x[s]! - cx, e.y[s]! - cy) <= p.sweep + e.radius[s]!) victims.push(s);
  });
  for (const s of victims) damage(world, s, pct(p.damage, SWEEP_PCT), p.type, p.source);
}
