import { ARMOR } from '@signal-fall/data';
import { FX_ONE, iatan2, idiv, pct } from '../fx';
import { KIND } from '../entities';
import { armorOf, canTarget, costOf, distToBody, inWeaponRange, isAir, teamOf, weaponOf } from '../query';
import { removeEntity } from '../spawn';
import { spawnWreck } from './economy';
import type { Projectile, World } from '../world';

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
    const t = e.resolve(e.target[s]!);
    if (t < 0) continue;
    if (!canTarget(world, s, weapon, t) || !inWeaponRange(world, s, weapon, t)) continue;
    // Moving units do not fire; behavior clears the goal once a target is in range.
    if (e.kind[s] === KIND.unit && e.hasGoal[s] === 1) continue;
    e.facing[s] = iatan2(e.y[t]! - e.y[s]!, e.x[t]! - e.x[s]!);
    if (e.cooldown[s]! > 0) continue;
    e.cooldown[s] = weapon.cooldown;
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
      damage: pct(weapon.damage, 100 + vetPct * e.rank[s]!),
      type: weapon.type,
      splash: weapon.splash,
      hitsGround: weapon.targetsGround,
      hitsAir: weapon.targetsAir,
      ticks,
    });
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
  if (primary >= 0) damage(world, primary, p.damage, p.type, p.source);
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
  if (e.alive[victim] !== 1 || e.hp[victim]! <= 0) return;
  const mult = world.rules.damageMatrix[type * ARMOR_COUNT + armorOf(world, victim)]!;
  if (mult <= 0) return;
  let dmg = pct(base, mult);
  if (dmg < 1) dmg = 1;
  const absorbed = Math.min(e.shields[victim]!, dmg);
  e.shields[victim]! -= absorbed;
  e.hp[victim]! -= dmg - absorbed;
  e.lastHitTick[victim] = world.tick;
  e.lastAttacker[victim] = attacker;
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
    spawnWreck(world, s);
    removeEntity(world, s);
  }
}

function promote(world: World, s: number): void {
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
