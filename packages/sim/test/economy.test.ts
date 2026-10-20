import { describe, expect, it } from 'vitest';
import { FX_ONE, FX_SHIFT } from '../src/fx';
import { HARVEST, KIND } from '../src/entities';
import { createMatch, grantBase, testMap } from '../src/match';
import { isFarSeed, placementError, worldPlacementView } from '../src/placement';
import type { Sim } from '../src/sim';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { computeFacts } from '../src/systems/economy';
import { at, makeSim, rules, structure, unit } from './helpers';

const H = rules.factions[0]!;

function newMatch(factionB = 0) {
  const map = testMap(96, 3);
  const sim = createMatch({ rules, seed: 5, map, players: [{ faction: 0, team: 0 }, { faction: factionB, team: 1 }] });
  return { sim, map };
}

function own(sim: Sim, player: number, pred: (s: number) => boolean): number[] {
  const e = sim.world.entities;
  const out: number[] = [];
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === player && pred(s)) out.push(s);
  return out;
}

const cmd = (sim: Sim, player: number, c: Parameters<Sim['schedule']>[0]['cmd']) => sim.schedule({ tick: sim.tick, player, cmd: c });

/** First valid placement spiralling out from the player's conyard. */
function findSpot(sim: Sim, player: number, ruleIndex: number): { tx: number; ty: number } | null {
  const w = sim.world;
  const e = w.entities;
  const yard = own(sim, player, (s) => e.kind[s] === KIND.structure && w.rules.structures[e.type[s]!]!.role === 'conyard')[0];
  if (yard === undefined) return null;
  const view = worldPlacementView(w, player);
  const rule = w.rules.structures[ruleIndex]!;
  const faction = w.rules.factions[w.players[player]!.faction]!;
  for (let r = 0; r < 14; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = e.tileX[yard]! + dx;
        const ty = e.tileY[yard]! + dy;
        if (placementError(view, player, faction, rule, tx, ty) === null) return { tx, ty };
      }
  return null;
}

/** Build one structure start to finish (queue, wait, place). Returns false if it can't. */
function buildAndPlace(sim: Sim, player: number, id: string, maxTicks = 20 * 60): boolean {
  const item = structure(id);
  const category = rules.structures[item]!.category!;
  cmd(sim, player, { type: 'build', category, item });
  const q = sim.world.players[player]!.build[category === 'structures' ? 0 : 1]!;
  sim.step();
  for (let t = 0; t < maxTicks && !q.ready; t++) sim.step();
  if (!q.ready) return false;
  const spot = findSpot(sim, player, item);
  if (!spot) return false;
  cmd(sim, player, { type: 'place', category, ...spot });
  sim.step();
  return q.item === -1;
}

describe('deploy and build', () => {
  it('a construction unit deploys into a yard, which builds and places structures', () => {
    const { sim } = newMatch();
    const e = sim.world.entities;
    const mcv = own(sim, 0, (s) => e.kind[s] === KIND.unit)[0]!;
    cmd(sim, 0, { type: 'deploy', units: [e.handle(mcv)] });
    sim.step();
    expect(own(sim, 0, (s) => e.kind[s] === KIND.structure)).toHaveLength(1);
    const before = sim.world.players[0]!.credits;
    expect(buildAndPlace(sim, 0, 'dynamo')).toBe(true);
    expect(sim.world.players[0]!.credits).toBe(before - 300);
    expect(sim.world.players[0]!.powerProduced).toBe(110);
  });

  it('spending is continuous and building pauses without money', () => {
    const { sim } = newMatch();
    const e = sim.world.entities;
    cmd(sim, 0, { type: 'deploy', units: [e.handle(own(sim, 0, () => true)[0]!)] });
    sim.step();
    const p = sim.world.players[0]!;
    p.credits = 100;
    cmd(sim, 0, { type: 'build', category: 'structures', item: structure('dynamo') });
    sim.run(200);
    expect(p.credits).toBeLessThan(5);
    expect(p.build[0]!.ready).toBe(false);
    const progress = p.build[0]!.progress;
    sim.run(20);
    expect(p.build[0]!.progress).toBe(progress); // stalled
    p.credits += 1000;
    sim.run(200);
    expect(p.build[0]!.ready).toBe(true);
    cmd(sim, 0, { type: 'cancelBuild', category: 'structures' });
    sim.step();
    expect(p.credits).toBe(1000 + 100 - 0); // full refund of what was spent
  });

  it('prerequisites gate building and training', () => {
    const { sim } = newMatch();
    const e = sim.world.entities;
    cmd(sim, 0, { type: 'deploy', units: [e.handle(own(sim, 0, () => true)[0]!)] });
    sim.step();
    cmd(sim, 0, { type: 'build', category: 'structures', item: structure('smelter') }); // needs power
    sim.step();
    expect(sim.world.players[0]!.build[0]!.item).toBe(-1);
  });

  it('Holdout must build next to its base', () => {
    const { sim } = newMatch();
    const e = sim.world.entities;
    cmd(sim, 0, { type: 'deploy', units: [e.handle(own(sim, 0, () => true)[0]!)] });
    sim.step();
    const view = worldPlacementView(sim.world, 0);
    const yard = own(sim, 0, (s) => e.kind[s] === KIND.structure)[0]!;
    const rule = rules.structures[structure('dynamo')]!;
    expect(placementError(view, 0, H, rule, e.tileX[yard]! + 4, e.tileY[yard]!)).toBeNull();
    expect(placementError(view, 0, H, rule, e.tileX[yard]! + 12, e.tileY[yard]!)).toBe('tooFar');
    expect(placementError(view, 0, H, rule, e.tileX[yard]!, e.tileY[yard]!)).toBe('blocked');
  });

  it('Halcyon builds inside coverage, Choir near Echo or its structures', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    spawnStructure(w, structure('kernel'), 0, 5, 5);
    const halcyon = rules.factions[1]!;
    const choir = rules.factions[2]!;
    const view = worldPlacementView(w, 0);
    const powerd = rules.structures[structure('powerd')]!;
    expect(placementError(view, 0, halcyon, powerd, 10, 6)).toBeNull();
    expect(placementError(view, 0, halcyon, powerd, 20, 6)).toBe('noCoverage');
    const bell = rules.structures[structure('bell')]!;
    expect(placementError(view, 0, choir, bell, 30, 30)).toBe('noGrowth');
    w.map.echo[33 * 40 + 33] = 5;
    // Echo far from every own structure: a far seed needs an own unit near the spot.
    expect(placementError(worldPlacementView(w, 0), 0, choir, bell, 30, 30)).toBe('noGrowth');
    spawnUnit(w, unit('grunt'), 0, 32 * FX_ONE, 32 * FX_ONE);
    const seeded = worldPlacementView(w, 0);
    expect(placementError(seeded, 0, choir, bell, 30, 30)).toBeNull();
    expect(isFarSeed(seeded, 0, choir, bell, 30, 30)).toBe(true);
    // Echo close to an own structure grows as usual.
    w.map.echo[12 * 40 + 12] = 5;
    expect(placementError(view, 0, choir, bell, 10, 10)).toBeNull();
    expect(isFarSeed(view, 0, choir, bell, 10, 10)).toBe(false);
  });

  it('a far seed starts weak and grows to full strength', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const p = w.players[1]!; // Choir
    p.credits = 10000;
    w.map.echo[33 * 40 + 33] = 5;
    spawnUnit(w, unit('grunt'), 1, 32 * FX_ONE, 32 * FX_ONE);
    const bell = structure('bell');
    const q = p.build[0]!;
    q.item = bell;
    q.ready = true;
    cmd(sim, 1, { type: 'place', category: 'structures', tx: 30, ty: 30 });
    sim.step();
    const e = w.entities;
    let s = -1;
    for (let i = 0; i < e.high; i++) if (e.alive[i] === 1 && e.kind[i] === KIND.structure && e.type[i] === bell) s = i;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(e.hp[s]!).toBeLessThan(e.maxHp[s]!);
    for (let i = 0; i < 60 * w.rules.constants.tickRate; i++) sim.step();
    expect(e.hp[s]).toBe(e.maxHp[s]);
    expect(e.repairing[s]).toBe(0);
  });
});

describe('harvesting and power', () => {
  it('a refinery comes with a harvester that brings in money', () => {
    const { sim } = newMatch();
    const e = sim.world.entities;
    cmd(sim, 0, { type: 'deploy', units: [e.handle(own(sim, 0, () => true)[0]!)] });
    sim.step();
    expect(buildAndPlace(sim, 0, 'dynamo')).toBe(true);
    expect(buildAndPlace(sim, 0, 'smelter')).toBe(true);
    const mules = own(sim, 0, (s) => e.kind[s] === KIND.unit && e.type[s] === unit('mule'));
    expect(mules).toHaveLength(1);
    const p = sim.world.players[0]!;
    const before = p.credits;
    sim.run(20 * 90);
    expect(p.harvested).toBeGreaterThanOrEqual(1400);
    expect(p.credits).toBeGreaterThan(before + 1000);
    expect(e.hstate[mules[0]!]).not.toBe(HARVEST.off);
  });

  it('low power halves production speed and shuts down powered defenses', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    spawnStructure(w, structure('holdfast'), 0, 2, 2);
    spawnStructure(w, structure('bunkhouse'), 0, 6, 2);
    spawnStructure(w, structure('pillbox'), 0, 20, 20);
    // No power plant: consumption 35 > production 10.
    const p = w.players[0]!;
    cmd(sim, 0, { type: 'train', item: unit('grunt'), count: 1 });
    sim.run(2);
    expect(p.lowPower).toBe(true);
    sim.run(80);
    expect(p.production[0]!.items).toHaveLength(1); // 4 s build takes 8 s at 50%
    sim.run(90);
    expect(p.production[0]!.items).toHaveLength(0);
    // Pillbox ignores an enemy in range.
    const enemy = spawnUnit(w, unit('grace'), 1, at(22), at(20)) & 0xffff;
    sim.run(40);
    expect(w.entities.hp[enemy]).toBe(rules.units[unit('grace')]!.hp);
  });

  it('extra factories speed up production', () => {
    const time = (barracks: number) => {
      const sim = makeSim({ size: 40, victoryRules: false });
      const w = sim.world;
      spawnStructure(w, structure('holdfast'), 0, 2, 2);
      spawnStructure(w, structure('dynamo'), 0, 6, 2);
      for (let i = 0; i < barracks; i++) spawnStructure(w, structure('bunkhouse'), 0, 2 + i * 3, 8);
      cmd(sim, 0, { type: 'train', item: unit('grunt'), count: 1 });
      sim.step();
      let t = 0;
      while (w.players[0]!.production[0]!.items.length > 0 && t < 400) {
        sim.step();
        t++;
      }
      return t;
    };
    expect(time(2)).toBeLessThan(time(1));
  });

  it('rally points send new units; sell refunds half; repair costs money', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    const e = w.entities;
    spawnStructure(w, structure('dynamo'), 0, 2, 2);
    const bh = spawnStructure(w, structure('bunkhouse'), 0, 6, 2);
    cmd(sim, 0, { type: 'rally', target: bh, x: at(20), y: at(20) });
    cmd(sim, 0, { type: 'train', item: unit('grunt'), count: 1 });
    sim.run(20 * 20);
    const grunt = own(sim, 0, (s) => e.kind[s] === KIND.unit)[0]!;
    expect(e.x[grunt]! >> FX_SHIFT).toBeGreaterThan(17);
    const p = w.players[0]!;
    e.hp[bh & 0xffff] = 500;
    const c0 = p.credits;
    cmd(sim, 0, { type: 'repair', target: bh });
    sim.run(20 * 5);
    expect(e.hp[bh & 0xffff]).toBeGreaterThan(500);
    expect(p.credits).toBeLessThan(c0);
    const c1 = p.credits;
    cmd(sim, 0, { type: 'sell', target: bh });
    sim.step();
    expect(e.resolve(bh)).toBe(-1);
    expect(p.credits).toBe(c1 + 200);
  });
});

describe('engineers and salvage', () => {
  it('an engineer captures an enemy structure', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    const target = spawnStructure(w, structure('powerd'), 1, 20, 20);
    const eng = spawnUnit(w, unit('wrench'), 0, at(14), at(20));
    sim.run(4);
    cmd(sim, 0, { type: 'attack', units: [eng], target });
    sim.run(20 * 10);
    expect(w.entities.owner[target & 0xffff]).toBe(0);
    expect(w.entities.resolve(eng)).toBe(-1);
  });

  it('dead vehicles leave wrecks Holdout can salvage', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    const e = w.entities;
    const victim = spawnUnit(w, unit('vector'), 1, at(20), at(20)) & 0xffff;
    e.hp[victim] = 0;
    sim.step();
    const wreck = own(sim, 1, (s) => e.kind[s] === KIND.wreck)[0]!;
    expect(wreck).toBeDefined();
    const wrench = spawnUnit(w, unit('wrench'), 0, at(14), at(20));
    const c0 = w.players[0]!.credits;
    cmd(sim, 0, { type: 'salvage', units: [wrench], target: e.handle(wreck) });
    sim.run(20 * 8);
    expect(w.players[0]!.credits).toBe(c0 + 150); // 15% of 1000
    expect(e.alive[wreck]).toBe(0);
  });

  it('Holdout vehicles pick up wrecks they drive past, no order needed', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    const e = w.entities;
    const victim = spawnUnit(w, unit('vector'), 1, at(20), at(20)) & 0xffff;
    e.hp[victim] = 0;
    sim.step();
    const wreck = own(sim, 1, (s) => e.kind[s] === KIND.wreck)[0]!;
    const bulldog = spawnUnit(w, unit('bulldog'), 0, at(12), at(20));
    const c0 = w.players[0]!.credits;
    cmd(sim, 0, { type: 'move', units: [bulldog], x: at(26), y: at(20) });
    sim.run(20 * 10);
    expect(w.players[0]!.credits).toBe(c0 + 150);
    expect(e.alive[wreck]).toBe(0);
  });
});

describe('comeback', () => {
  it('with no construction yard or construction unit left, a refinery builds one', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    const e = w.entities;
    spawnStructure(w, structure('smelter'), 0, 10, 10);
    w.players[0]!.credits = 5000;
    const homestead = unit('homestead');
    cmd(sim, 0, { type: 'train', item: homestead, count: 1 });
    sim.run(20 * 45); // low power (no power plant): half speed
    expect(own(sim, 0, (s) => e.kind[s] === KIND.unit && e.type[s] === homestead)).toHaveLength(1);
    // Only one: with a construction unit alive, the refinery stops.
    cmd(sim, 0, { type: 'train', item: homestead, count: 1 });
    sim.run(20 * 45); // low power (no power plant): half speed
    expect(own(sim, 0, (s) => e.kind[s] === KIND.unit && e.type[s] === homestead)).toHaveLength(1);
  });
});

describe('full match', () => {
  it('a scripted Holdout player beats a passive opponent', () => {
    const { sim, map } = newMatch(1);
    grantBase(sim, 1, map.starts[1]!);
    const w = sim.world;
    const e = w.entities;
    cmd(sim, 0, { type: 'deploy', units: [e.handle(own(sim, 0, () => true)[0]!)] });
    sim.step();
    for (const id of ['dynamo', 'smelter', 'dynamo', 'bunkhouse', 'motor_pool', 'radio_mast', 'dynamo']) {
      expect(buildAndPlace(sim, 0, id), id).toBe(true);
    }
    const enemyStart = map.starts[1]!;
    const target = { x: (enemyStart.x + 1) * FX_ONE, y: (enemyStart.y + 1) * FX_ONE };
    for (let wave = 0; wave < 12 && !w.ended; wave++) {
      cmd(sim, 0, { type: 'train', item: unit('bulldog'), count: 5 });
      cmd(sim, 0, { type: 'train', item: unit('grunt'), count: 4 });
      sim.run(20 * 50);
      const army = own(sim, 0, (s) => e.kind[s] === KIND.unit && rules.units[e.type[s]!]!.weapon !== null).map((s) => e.handle(s));
      cmd(sim, 0, { type: 'attackMove', units: army, ...target });
      sim.run(20 * 40);
    }
    expect(w.ended).toBe(true);
    expect(w.winnerTeam).toBe(0);
    expect(w.tick).toBeLessThan(20 * 60 * 20);
    expect(computeFacts(w)[1]!.roles.size).toBe(0);
  });
});

describe('harvester tile preference', () => {
  it('richest mode prefers a full tile a bit farther away over a nearly empty neighbour', async () => {
    const { findEcho } = await import('../src/systems/economy');
    const sim = makeSim({ size: 40 });
    const m = sim.world.map;
    m.echo[10 * 40 + 11] = 1; // adjacent, one crystal
    m.echo[10 * 40 + 14] = 12; // 4 tiles away, full
    expect(findEcho(sim.world, 10, 10, 6, 1)).toBe(10 * 40 + 11);
    expect(findEcho(sim.world, 10, 10, 6, 0)).toBe(10 * 40 + 14);
  });

  it('richest mode fills up faster than nearest on a picked-over field', () => {
    const run = (mode: number) => {
      const sim = makeSim({ size: 40, victoryRules: false });
      const w = sim.world;
      const e = w.entities;
      // Scattered single crystals right next to the refinery, a rich patch farther out.
      for (let y = 12; y < 20; y++) for (let x = 6; x < 20; x++) if ((x + y) % 2 === 0) w.map.echo[y * 40 + x] = 1;
      for (let y = 22; y < 25; y++) for (let x = 12; x < 15; x++) w.map.echo[y * 40 + x] = 12;
      spawnStructure(w, structure('dynamo'), 0, 2, 2);
      spawnStructure(w, structure('smelter'), 0, 8, 6);
      const mule = spawnUnit(w, unit('mule'), 0, at(9), at(10)) & 0xffff;
      e.hstate[mule] = HARVEST.toField;
      e.hmode[mule] = mode;
      sim.run(20 * 60);
      return w.players[0]!.harvested + e.cargo[mule]!;
    };
    const richest = run(0);
    const nearest = run(1);
    expect(richest).toBeGreaterThan(nearest);
  });
});

describe('reinforcements', () => {
  it('units from one barracks spread out around the rally point instead of stacking', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    spawnStructure(w, structure('holdfast'), 0, 2, 2);
    spawnStructure(w, structure('dynamo'), 0, 6, 2);
    const barracks = spawnStructure(w, structure('bunkhouse'), 0, 10, 2);
    w.players[0]!.credits = 5000;
    cmd(sim, 0, { type: 'rally', target: barracks, x: at(20), y: at(20) });
    cmd(sim, 0, { type: 'train', item: unit('grunt'), count: 8 });
    sim.run(20 * 60);
    const e = w.entities;
    const grunts: number[] = [];
    for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.kind[s] === KIND.unit && e.type[s] === unit('grunt')) grunts.push(s);
    expect(grunts).toHaveLength(8);
    for (let i = 0; i < grunts.length; i++)
      for (let j = i + 1; j < grunts.length; j++) {
        const a = grunts[i]!;
        const b = grunts[j]!;
        expect(Math.hypot(e.x[a]! - e.x[b]!, e.y[a]! - e.y[b]!)).toBeGreaterThan(FX_ONE * 0.5);
      }
    // All gathered near the rally point.
    for (const g of grunts) expect(Math.hypot(e.x[g]! - at(20), e.y[g]! - at(20))).toBeLessThan(FX_ONE * 4);
  });
});

describe('power toggle', () => {
  it('switching a building off frees its power and takes its role away; on brings both back', () => {
    const sim = makeSim();
    const w = sim.world;
    spawnStructure(w, structure('dynamo'), 0, 2, 2);
    const mast = spawnStructure(w, structure('radio_mast'), 0, 8, 2);
    sim.run(2);
    const used = w.players[0]!.powerUsed;
    expect(used).toBeGreaterThan(0);
    sim.schedule({ tick: w.tick, player: 0, cmd: { type: 'powerToggle', target: mast } });
    sim.run(2);
    expect(w.players[0]!.powerUsed).toBe(0);
    expect(computeFacts(w)[0]!.roles.get('radar') ?? 0).toBe(0);
    sim.schedule({ tick: w.tick, player: 0, cmd: { type: 'powerToggle', target: mast } });
    sim.run(2);
    expect(w.players[0]!.powerUsed).toBe(used);
    expect(computeFacts(w)[0]!.roles.get('radar')).toBe(1);
  });
});
