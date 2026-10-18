import { defaultRules, FACTIONS, type FactionId } from '@signal-fall/data';
import { attachAi, type Difficulty } from '@signal-fall/ai';
import { generateMap, type Biome, type MapSize } from '@signal-fall/mapgen';
import { createMatch } from '@signal-fall/sim';

export interface Side {
  faction: FactionId;
  difficulty: Difficulty;
}

export interface MatchSpec {
  seed: number;
  size: MapSize;
  biome: Biome;
  sides: [Side, Side];
  /** Swap start positions (removes positional bias across a batch). */
  swap: boolean;
  maxMinutes: number;
  /** Capture points on the map. */
  points?: 'none' | 'some';
  /** Crates drop now and then. */
  crates?: boolean;
}

export interface MatchOutcome {
  seed: number;
  /** Index into spec.sides of the winner, or -1 for a draw/timeout. */
  winner: number;
  minutes: number;
  harvested: [number, number];
  /** "unit:count" pairs per side, most built first. */
  units: [string, string];
  /** The strategy each side's AI picked. */
  strategies: [string, string];
}

const BIOMES: Biome[] = ['wasteland', 'city', 'crystal'];

/** Play one AI vs AI match headless to the end (or the time limit). */
export function playMatch(spec: MatchSpec): MatchOutcome {
  const rules = defaultRules();
  const map = generateMap({ seed: spec.seed, size: spec.size, players: 2, biome: spec.biome, resources: 'normal', terrain: 'normal', points: spec.points });
  // Player slot k plays side order[k].
  const order = spec.swap ? [1, 0] : [0, 1];
  const sim = createMatch({
    rules,
    seed: spec.seed,
    map,
    players: order.map((side, team) => ({ faction: FACTIONS.indexOf(spec.sides[side]!.faction), team })),
    crates: spec.crates,
  });
  const ais = order.map((side, slot) => attachAi(sim, slot, spec.sides[side]!.difficulty, map.starts));
  const limit = spec.maxMinutes * 1200;
  const w = sim.world;
  while (!w.ended && sim.tick < limit) sim.run(200);
  const slotOf = (side: number) => order.indexOf(side);
  const usage = (slot: number) =>
    w.players[slot]!.trained
      .map((n, i) => [rules.units[i]!.id, n] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id}:${n}`)
      .join(' ');
  return {
    seed: spec.seed,
    winner: w.winnerTeam < 0 ? -1 : order[w.winnerTeam]!,
    minutes: Math.round((sim.tick / 1200) * 10) / 10,
    harvested: [w.players[slotOf(0)]!.harvested, w.players[slotOf(1)]!.harvested],
    units: [usage(slotOf(0)), usage(slotOf(1))],
    strategies: [ais[slotOf(0)]!.strategy.name, ais[slotOf(1)]!.strategy.name],
  };
}

export function batchSpecs(opts: { matches: number; sides: [Side, Side]; size: MapSize; seed: number; maxMinutes: number; points?: 'none' | 'some'; crates?: boolean }): MatchSpec[] {
  return Array.from({ length: opts.matches }, (_, i) => ({
    seed: opts.seed + i,
    size: opts.size,
    biome: BIOMES[i % BIOMES.length]!,
    sides: opts.sides,
    swap: i % 2 === 1,
    maxMinutes: opts.maxMinutes,
    points: opts.points,
    crates: opts.crates,
  }));
}

export function toCsv(sides: [Side, Side], outcomes: MatchOutcome[]): string {
  const name = (s: Side) => `${s.faction}:${s.difficulty}`;
  const rows = [['seed', 'side_a', 'side_b', 'winner', 'minutes', 'harvested_a', 'harvested_b', 'units_a', 'units_b', 'strategy_a', 'strategy_b'].join(',')];
  for (const o of outcomes) {
    rows.push(
      [o.seed, name(sides[0]), name(sides[1]), o.winner < 0 ? 'draw' : name(sides[o.winner]!), o.minutes, o.harvested[0], o.harvested[1], `"${o.units[0]}"`, `"${o.units[1]}"`, o.strategies[0], o.strategies[1]].join(','),
    );
  }
  return rows.join('\n') + '\n';
}

export function summarize(sides: [Side, Side], outcomes: MatchOutcome[]): { winsA: number; winsB: number; draws: number; avgMinutes: number } {
  const winsA = outcomes.filter((o) => o.winner === 0).length;
  const winsB = outcomes.filter((o) => o.winner === 1).length;
  const avg = outcomes.reduce((t, o) => t + o.minutes, 0) / Math.max(1, outcomes.length);
  void sides;
  return { winsA, winsB, draws: outcomes.length - winsA - winsB, avgMinutes: Math.round(avg * 10) / 10 };
}
