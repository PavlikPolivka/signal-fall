import { FX_ONE, FX_SHIFT, idiv, ilength, pct } from '../fx';
import { KIND, NO_ENTITY } from '../entities';
import { inBounds } from '../map';
import { teamOf } from '../query';
import { removeEntity, spawnUnit } from '../spawn';
import { CREDIT_REASON, FX_EVENT, pushFx, type World } from '../world';
import type { PlayerFacts } from './economy';
import { requirementsMet } from './economy';

// Faction mechanics: research and upgrade effects, Halcyon network coverage
// (fire rate, self-repair, Recompile), Choir shield restoration and Echo
// regrowth, and the active abilities blink, phase and Override.

/** Coverage is rebuilt this often (ticks); placement checks compute it exactly. */
const COVERAGE_INTERVAL = 10;
/** How much shorter Override is on air-gapped (Holdout) machines, percent. */
const AIR_GAPPED_OVERRIDE_RESIST = 50;
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
  // Doctrines: the other choice, once researched, closes this one.
  if (u.excludes) {
    const other = world.rules.upgradeIndex.get(u.excludes);
    if (other !== undefined && p.upgrades[other] === 1) return false;
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
      const cx = e.x[s]!;
      const cy = e.y[s]!;
      markCoverage(world, cov, cx, cy, r);
    }
    // Uplinked units carry a bubble of network with them.
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.owner[s] !== p.index || e.uplinkUntil[s]! <= world.tick) continue;
      const up = world.rules.units[e.type[s]!]!.abilities.find((a) => a.kind === 'uplink');
      if (up && up.kind === 'uplink') markCoverage(world, cov, e.x[s]!, e.y[s]!, up.radius);
    }
  }
}

function markCoverage(world: World, cov: Uint8Array, cx: number, cy: number, r: number): void {
  const m = world.map;
  const rt = (r >> FX_SHIFT) + 1;
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
  let cd = base;
  if (f.coverageFireRatePct > 0 && inCoverage(world, s)) cd = Math.max(1, idiv(cd * 100, 100 + f.coverageFireRatePct));
  // Jammed: fires slower (the jamming faction's power sets how much).
  if (world.entities.jammedUntil[s]! > world.tick) cd = idiv(cd * 100, Math.max(1, 100 - jamSlowPct(world)));
  return cd;
}

/** How much slower jammed weapons fire, percent (from whichever faction jams). */
function jamSlowPct(world: World): number {
  for (const f of world.rules.factions) if (f.power?.kind === 'jam') return f.power.fireRatePct;
  return 0;
}

/** Awaken works on fields within this distance of one of the caster's structures. */
export const AWAKEN_HOME_RANGE = 14 * FX_ONE;

export function nearOwnStructure(world: World, player: number, x: number, y: number, range: number): boolean {
  const e = world.entities;
  for (let s = 0; s < e.high; s++)
    if (e.alive[s] === 1 && e.kind[s] === KIND.structure && e.owner[s] === player && ilength(e.x[s]! - x, e.y[s]! - y) <= range) return true;
  return false;
}

/** Does the player own a working (powered) structure of this role? */
function hasRole(world: World, player: number, role: string): boolean {
  const e = world.entities;
  for (let s = 0; s < e.high; s++)
    if (e.alive[s] === 1 && e.kind[s] === KIND.structure && e.owner[s] === player && world.rules.structures[e.type[s]!]!.role === role) return true;
  return false;
}

/** Can the player cast its support power now (owns the building, cooldown over, power on)? */
export function powerReady(world: World, player: number): boolean {
  const p = world.players[player]!;
  const power = world.rules.factions[p.faction]!.power;
  return power !== null && !p.lowPower && world.tick >= p.powerReady && hasRole(world, player, power.requires);
}

/**
 * Support power state for the UI: -2 the faction has none, -1 not available (no building or no
 * power), 0 ready, otherwise ticks until ready.
 */
export function powerStatus(world: World, player: number): number {
  const p = world.players[player]!;
  const power = world.rules.factions[p.faction]!.power;
  if (!power) return -2;
  if (p.lowPower || !hasRole(world, player, power.requires)) return -1;
  return Math.max(0, p.powerReady - world.tick);
}

/** Cast the player's support power at (x, y). */
export function usePower(world: World, player: number, x: number, y: number): boolean {
  if (!powerReady(world, player) || !inBounds(world.map, x >> FX_SHIFT, y >> FX_SHIFT)) return false;
  const p = world.players[player]!;
  const power = world.rules.factions[p.faction]!.power!;
  const e = world.entities;
  if (power.kind === 'jam') {
    const team = p.team;
    world.spatial.query(x, y, power.radius + FX_ONE, (s) => {
      if (e.alive[s] !== 1 || (e.kind[s] !== KIND.unit && e.kind[s] !== KIND.structure) || teamOf(world, s) === team) return;
      // Air-gapped machines and soldiers have no network to jam.
      if (world.rules.factions[world.players[e.owner[s]!]!.faction]!.airGapped) return;
      if (ilength(e.x[s]! - x, e.y[s]! - y) <= power.radius) e.jammedUntil[s] = world.tick + power.duration;
    });
    pushFx(world, FX_EVENT.power, 1, power.radius, player, x, y, 0, 0);
  } else {
    // Awaken: needs Echo near the point, on our own ground; crystals rise as guardians for a while.
    if (!nearOwnStructure(world, player, x, y, AWAKEN_HOME_RANGE)) return false;
    const m = world.map;
    const r = power.reach >> FX_SHIFT;
    const cx = x >> FX_SHIFT;
    const cy = y >> FX_SHIFT;
    const tiles: number[] = [];
    for (let ty = cy - r; ty <= cy + r; ty++)
      for (let tx = cx - r; tx <= cx + r; tx++) if (inBounds(m, tx, ty) && m.echo[ty * m.width + tx]! > 0) tiles.push(ty * m.width + tx);
    if (tiles.length === 0) return false;
    let cost = power.echoCost;
    for (let k = 0; cost > 0 && k < tiles.length * 12; k++) {
      const t = tiles[k % tiles.length]!;
      if (m.echo[t]! > 0) {
        m.echo[t]!--;
        cost--;
      }
    }
    for (let k = 0; k < power.count; k++) {
      const t = tiles[idiv(k * tiles.length, power.count)]!;
      const h = spawnUnit(world, power.unit, player, ((t % m.width) << FX_SHIFT) + (FX_ONE >> 1), (idiv(t, m.width) << FX_SHIFT) + (FX_ONE >> 1));
      if (h >= 0) e.expires[h & 0xffff] = world.tick + power.duration;
    }
    pushFx(world, FX_EVENT.power, 2, power.reach, player, x, y, 0, 0);
  }
  p.powerReady = world.tick + power.cooldown;
  return true;
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
  const chorus = world.tick % CHORUS_INTERVAL === 0;
  const autocast = world.tick % AUTOCAST_INTERVAL === 0;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit) continue;
    if (e.homeOwner[s]! >= 0 && world.tick >= e.overrideUntil[s]!) {
      e.owner[s] = e.homeOwner[s]!;
      e.homeOwner[s] = -1;
      releaseControl(world, s);
    }
    // Summoned units (Awaken) fade when their time is up.
    if (e.expires[s]! > 0 && world.tick >= e.expires[s]!) {
      removeEntity(world, s);
      continue;
    }
    if (chorus) updateChorus(world, s);
    if (autocast) autocastEscape(world, s);
  }
}

const CHORUS_INTERVAL = 10;
const AUTOCAST_INTERVAL = 4;
/** Autocast escapes fire below this share of life (hull + shields), percent, while under fire. */
const ESCAPE_LIFE_PCT = 35;

/** Chorus: count own armed units of the same faction within range (capped). */
function updateChorus(world: World, s: number): void {
  const e = world.entities;
  const f = world.rules.factions[world.players[e.owner[s]!]!.faction]!;
  if (f.chorusPct <= 0 || !world.rules.units[e.type[s]!]!.weapon) {
    e.chorus[s] = 0;
    return;
  }
  let n = 0;
  const owner = e.owner[s]!;
  world.spatial.query(e.x[s]!, e.y[s]!, f.chorusRadius, (o) => {
    if (o === s || n >= f.chorusMax || e.kind[o] !== KIND.unit || e.owner[o] !== owner || !world.rules.units[e.type[o]!]!.weapon) return;
    if (ilength(e.x[o]! - e.x[s]!, e.y[o]! - e.y[s]!) <= f.chorusRadius) n++;
  });
  e.chorus[s] = n;
}

/** Extra damage percent from Chorus. */
export function chorusPct(world: World, s: number): number {
  const n = world.entities.chorus[s]!;
  if (n === 0) return 0;
  return n * world.rules.factions[world.players[world.entities.owner[s]!]!.faction]!.chorusPct;
}

/**
 * Autocast for everyone, players and AI alike: a badly hurt unit under fire uses its escape
 * (phase out, or blink away from whoever hit it last) as soon as it is ready.
 */
function autocastEscape(world: World, s: number): void {
  const e = world.entities;
  if (world.tick < e.abilityReady[s]! || e.lastHitTick[s]! < 0 || world.tick - e.lastHitTick[s]! > 20) return;
  const life = e.hp[s]! + e.shields[s]!;
  if (life * 100 >= (e.maxHp[s]! + e.maxShields[s]!) * ESCAPE_LIFE_PCT) return;
  const rule = world.rules.units[e.type[s]!]!;
  const a = rule.abilities.find((x) => x.kind === 'phase' || x.kind === 'blink');
  if (!a) return;
  if (a.kind === 'phase') {
    useAbility(world, e.owner[s]!, s, -1, -1, -1);
    return;
  }
  if (a.kind !== 'blink') return;
  const from = e.resolve(e.lastAttacker[s]!);
  let dx = from >= 0 ? e.x[s]! - e.x[from]! : 0;
  let dy = from >= 0 ? e.y[s]! - e.y[from]! : 0;
  const d = ilength(dx, dy);
  if (d === 0) return;
  dx = idiv(dx * a.range, d);
  dy = idiv(dy * a.range, d);
  useAbility(world, e.owner[s]!, s, e.x[s]! + dx, e.y[s]! + dy, -1);
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
    if (a.kind === 'uplink') {
      e.uplinkUntil[s] = world.tick + a.duration;
      e.abilityReady[s] = world.tick + a.cooldown;
      pushFx(world, FX_EVENT.ability, 5, e.type[s]!, player, e.x[s]!, e.y[s]!, 0, 0);
      return true;
    }
    if (a.kind === 'digIn') {
      // Toggle: dig in where it stands (ready after the setup time), or pack up.
      if (e.dugInAt[s]! > 0) e.dugInAt[s] = 0;
      else {
        e.dugInAt[s] = world.tick + a.setup;
        e.orders[s] = [];
        e.paths[s] = null;
        e.pathGoal[s] = -1;
        e.hasGoal[s] = 0;
        e.anchorX[s] = e.x[s]!;
        e.anchorY[s] = e.y[s]!;
        pushFx(world, FX_EVENT.ability, 4, e.type[s]!, player, e.x[s]!, e.y[s]!, 0, 0);
      }
      e.abilityReady[s] = world.tick + world.rules.constants.tickRate;
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
      if (ilength(e.x[t]! - e.x[s]!, e.y[t]! - e.y[s]!) > a.range) return false;
      // Air-gapped machines have no network to hold on to: Override lasts half as long.
      const resist = Math.max(vf.overrideResistPct, vf.airGapped ? AIR_GAPPED_OVERRIDE_RESIST : 0);
      const duration = pct(a.duration, 100 - resist);
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
