import type { Rules } from '@signal-fall/data';
import { FX_HALF, FX_SHIFT, idiv } from './fx';
import { TERRAIN } from './map';
import { Rng } from './rng';
import { Sim } from './sim';
import { spawnStructure, spawnUnit } from './spawn';
import type { PlayerSetup } from './world';

export interface MapData {
  width: number;
  height: number;
  terrain: Uint8Array;
  echo: Uint8Array;
  /** Start tile per player slot. */
  starts: { x: number; y: number }[];
  /** Cosmetic ground per tile (mapgen SURFACE); roads (1) also speed vehicles up. */
  surface?: Uint8Array;
  /** Capture points (tile and POINT kind), on maps that have them. */
  points?: { x: number; y: number; kind: number }[];
}

export interface MatchSetup {
  rules: Rules;
  seed: number;
  map: MapData;
  players: PlayerSetup[];
  /** Crates drop on the map now and then. */
  crates?: boolean;
  /** Survival: this player is the horde (no construction unit, scripted waves). */
  survivalHorde?: number;
  survivalPct?: number;
  mission?: import('./systems/mission').MissionRules;
  allow?: string[];
  /** Match options: starting credits for everyone (default from the rules), and superweapons off. */
  credits?: number;
  noSuperweapons?: boolean;
  techLimit?: boolean;
  unitCap?: number;
  /** Everyone starts with a small army beside the construction unit. */
  startArmy?: boolean;
}

/** A real match: each player starts with one construction unit and the starting credits. */
export function createMatch(setup: MatchSetup): Sim {
  const { rules, map } = setup;
  const sim = new Sim({
    rules,
    seed: setup.seed,
    width: map.width,
    height: map.height,
    terrain: map.terrain,
    echo: map.echo,
    road: map.surface ? map.surface.map((v) => (v === 1 ? 1 : 0)) : undefined,
    players: setup.players,
    victoryRules: true,
    points: map.points,
    crates: setup.crates,
    survivalHorde: setup.survivalHorde,
    mission: setup.mission,
    allow: setup.allow,
    noSuperweapons: setup.noSuperweapons,
    techLimit: setup.techLimit,
    unitCap: setup.unitCap,
    survivalPct: setup.survivalPct,
  });
  setup.players.forEach((p, i) => {
    if (i === setup.survivalHorde) return;
    if (setup.credits !== undefined) sim.world.players[i]!.credits = setup.credits;
    const start = map.starts[i]!;
    const cu = rules.factions[p.faction]!.constructionUnit;
    spawnUnit(sim.world, cu, i, (start.x << FX_SHIFT) + FX_HALF, (start.y << FX_SHIFT) + FX_HALF);
    if (setup.startArmy) {
      // Four of the faction's cheapest armed infantry and two of its cheapest armed vehicles, beside the start.
      const cheapest = (tab: string) =>
        rules.units.filter((u) => u.faction === p.faction && u.tab === tab && u.weapon && !u.isAir).sort((a, b) => a.cost - b.cost || a.index - b.index)[0];
      const army: [number | undefined, number][] = [[cheapest('infantry')?.index, 4], [cheapest('vehicles')?.index, 2]];
      let k = 0;
      for (const [rule, n] of army)
        for (let j = 0; j < n && rule !== undefined; j++, k++)
          spawnUnit(sim.world, rule, i, ((start.x + 2 + (k % 3)) << FX_SHIFT) + FX_HALF, ((start.y + 2 + idiv(k, 3)) << FX_SHIFT) + FX_HALF);
    }
  });
  return sim;
}

/** Give `player` a ready-made small base at its start (passive opponent for tests and the M3 demo). */
export function grantBase(sim: Sim, player: number, start: { x: number; y: number }): void {
  const w = sim.world;
  const rules = w.rules;
  const faction = rules.factions[w.players[player]!.faction]!;
  const byRole = (role: string) => faction.structures.find((i) => rules.structures[i]!.role === role)!;
  // Remove the construction unit: the conyard replaces it.
  const e = w.entities;
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === player) e.free(s);
  const layout: [string, number, number][] = [
    ['conyard', -1, -1],
    ['power', 3, -1],
    ['refinery', -1, 3],
    ['barracks', 3, 2],
    ['defense', 6, 0],
    ['defense', 0, 7],
  ];
  for (const [role, dx, dy] of layout) spawnStructure(w, byRole(role), player, start.x + dx, start.y + dy);
}

/**
 * Hand-made two-player test map until the procedural generator (M4): open
 * ground with rock clusters, a main and an expansion Echo field per player
 * and two contested fields in the middle. Point-symmetric.
 */
export function testMap(size = 96, seed = 1): MapData {
  const n = size * size;
  const terrain = new Uint8Array(n);
  const echo = new Uint8Array(n);
  const rng = new Rng(seed);
  const set = (x: number, y: number, f: (i: number) => void) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    f(y * size + x);
    f((size - 1 - y) * size + (size - 1 - x)); // mirror (180° rotation)
  };
  // Rock clusters in the half below the main diagonal, mirrored.
  for (let k = 0; k < 14; k++) {
    const cx = rng.range(6, size - 7);
    const cy = rng.range(6, size - 7);
    if (cx + cy > size) continue;
    if (cx < 26 && cy < 26) continue; // keep start areas open
    const r = rng.range(1, 3);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1) set(cx + x, cy + y, (i) => (terrain[i] = TERRAIN.rock));
  }
  // Rough patches.
  for (let k = 0; k < 8; k++) {
    const cx = rng.range(10, size - 10);
    const cy = rng.range(10, size - 10);
    if (cx + cy > size) continue;
    for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++) set(cx + x, cy + y, (i) => terrain[i] === TERRAIN.ground && (terrain[i] = TERRAIN.rough));
  }
  const field = (cx: number, cy: number, r: number, amount: number) => {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d > r * r) continue;
        const v = Math.max(3, amount - idiv(d * amount, r * r + 1));
        set(cx + x, cy + y, (i) => {
          terrain[i] = TERRAIN.ground;
          echo[i] = v;
        });
      }
  };
  const start = { x: 12, y: 12 };
  field(start.x + 8, start.y + 4, 3, 12); // main field, visible from the start
  field(start.x + 2, start.y + 24, 3, 10); // natural expansion
  field(idiv(size, 2) - 8, idiv(size, 2) + 6, 3, 12); // contested
  return {
    width: size,
    height: size,
    terrain,
    echo,
    starts: [start, { x: size - 1 - start.x, y: size - 1 - start.y }],
  };
}
