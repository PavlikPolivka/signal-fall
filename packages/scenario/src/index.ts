import { defaultRules } from '@signal-fall/data';
import { Sim, createMatch, grantBase, sandbox, type ScheduledCommand } from '@signal-fall/sim';
import { generateMap, type Biome, type MapSize, type Resources, type TerrainStyle } from '@signal-fall/mapgen';
import { attachAi, type Difficulty } from '@signal-fall/ai';

/**
 * A seat played by an AI agent (an LLM or a program over the agent API) rather than a
 * person or the built-in AI. Shown in every view of the match, so nobody mistakes it
 * for a human player.
 */
export interface AgentSeat {
  /** Display name the agent chose. */
  name: string;
  /** Model or program behind it, if the agent says. */
  model?: string;
}

/** A match to set up: map, sides, AI. Deterministic: the same spec always gives the same match. */
export type ScenarioSpec =
  | {
      kind: 'skirmish';
      seed: number;
      factions: number[];
      /** AI difficulty per player slot, null for the human. */
      ai: (Difficulty | null)[];
      /** Player slots controlled by people (multiplayer); others without AI get a passive base. */
      humans?: number[];
      /** Team per slot (2v2: [0, 0, 1, 1]); default: everyone on their own team. */
      teams?: number[];
      /** Seats played by AI agents (null elsewhere); they send commands like people do. */
      agents?: (AgentSeat | null)[];
      map: { size: MapSize; biome: Biome; resources: Resources; terrain: TerrainStyle };
    }
  | { kind: 'sandbox'; unitsPerSide: number; seed: number }
  | { kind: 'stress'; unitsPerSide: number; seed: number };

export interface MapExtras {
  decoration: Uint8Array;
  surface: Uint8Array;
  landmark: Uint8Array;
  biome: Biome;
  mapSeed: number;
  /** Start position per player slot, in tiles. */
  starts: { x: number; y: number }[];
}

/** Build the sim for a scenario: map, players, AI brains. Deterministic: the same spec always gives the same match. */
export function createSim(spec: ScenarioSpec): { sim: Sim; extras: MapExtras } {
  const rules = defaultRules();
  switch (spec.kind) {
    case 'skirmish': {
      const map = generateMap({ seed: spec.seed, players: spec.factions.length, ...spec.map });
      const sim = createMatch({
        rules,
        seed: spec.seed,
        map,
        players: spec.factions.map((faction, k) => ({ faction, team: spec.teams?.[k] ?? k })),
      });
      spec.ai.forEach((difficulty, p) => {
        // A computer player without a difficulty is a passive base (sandbox/testing); people play their own.
        if (difficulty) attachAi(sim, p, difficulty, map.starts);
        else if (p !== 0 && !spec.humans?.includes(p) && !spec.agents?.[p]) grantBase(sim, p, map.starts[p]!);
      });
      return {
        sim,
        extras: { decoration: map.decoration, surface: map.surface, landmark: map.landmark, biome: map.biome, mapSeed: map.seedUsed, starts: map.starts },
      };
    }
    case 'sandbox':
    case 'stress': {
      const sim = sandbox(rules, { unitsPerSide: spec.unitsPerSide, seed: spec.seed });
      const n = sim.world.map.width * sim.world.map.height;
      return { sim, extras: { decoration: new Uint8Array(n), surface: new Uint8Array(n), landmark: new Uint8Array(n), biome: 'wasteland', mapSeed: spec.seed, starts: [] } };
    }
  }
}

/**
 * A recorded match: the scenario plus every player command with its tick.
 * AI players are part of the scenario and re-think identically on replay.
 */
export interface Replay {
  format: 'signal-fall-replay';
  version: 1;
  scenario: ScenarioSpec;
  localPlayer: number;
  commands: ScheduledCommand[];
  /** Last tick recorded and the state hash there: a replay must reach the same hash. */
  endTick: number;
  hash: number;
}

export function parseReplay(text: string): Replay {
  const r = JSON.parse(text) as Partial<Replay>;
  if (r.format !== 'signal-fall-replay' || r.version !== 1 || !r.scenario || !Array.isArray(r.commands)) throw new Error('Not a Signal Fall replay');
  return r as Replay;
}

/** Commands of a replay bucketed by tick, for feeding a sim tick by tick. */
export function commandsByTick(commands: ScheduledCommand[]): Map<number, ScheduledCommand[]> {
  const by = new Map<number, ScheduledCommand[]>();
  for (const c of commands) {
    const list = by.get(c.tick) ?? [];
    list.push(c);
    by.set(c.tick, list);
  }
  return by;
}

/** Play a replay headless to its end; returns the final hash (equal to replay.hash if it reproduces). */
export function runReplay(replay: Replay): number {
  const { sim } = createSim(replay.scenario);
  const by = commandsByTick(replay.commands);
  while (sim.tick < replay.endTick) {
    for (const c of by.get(sim.tick) ?? []) sim.schedule(c);
    sim.step();
  }
  return sim.hash();
}

/** One sample of a player's match statistics. */
export interface StatPoint {
  /** Echo harvested so far (income). */
  income: number;
  credits: number;
  /** Cost of armed units alive. */
  army: number;
  units: number;
  structures: number;
  built: number;
  unitsLost: number;
  unitsKilled: number;
  structuresLost: number;
  structuresKilled: number;
  valueLost: number;
  valueKilled: number;
}

/** Statistics over a match: one sample per player every `interval` ticks. */
export interface MatchStats {
  interval: number;
  players: { faction: number; team: number }[];
  samples: { tick: number; players: StatPoint[] }[];
}

export const STATS_INTERVAL = 200;

/** Sample every player's statistics from the sim (read-only). */
export function sampleStats(world: import('@signal-fall/sim').World): StatPoint[] {
  const e = world.entities;
  const out: StatPoint[] = world.players.map((p) => ({
    income: p.harvested,
    credits: p.credits,
    army: 0,
    units: 0,
    structures: 0,
    built: p.trained.reduce((a, b) => a + b, 0),
    unitsLost: p.stats.unitsLost,
    unitsKilled: p.stats.unitsKilled,
    structuresLost: p.stats.structuresLost,
    structuresKilled: p.stats.structuresKilled,
    valueLost: p.stats.valueLost,
    valueKilled: p.stats.valueKilled,
  }));
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const o = out[e.owner[s]!];
    if (!o) continue;
    if (e.kind[s] === 2) o.structures++;
    else if (e.kind[s] === 1) {
      o.units++;
      const rule = world.rules.units[e.type[s]!]!;
      if (rule.weapon) o.army += rule.cost;
    }
  }
  return out;
}
