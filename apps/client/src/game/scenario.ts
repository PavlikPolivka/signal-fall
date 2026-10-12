import { defaultRules } from '@signal-fall/data';
import { Sim, createMatch, grantBase, sandbox, type ScheduledCommand } from '@signal-fall/sim';
import { generateMap, type Biome } from '@signal-fall/mapgen';
import { attachAi } from '@signal-fall/ai';
import type { ScenarioSpec } from '../protocol';

export interface MapExtras {
  decoration: Uint8Array;
  surface: Uint8Array;
  landmark: Uint8Array;
  biome: Biome;
  mapSeed: number;
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
        players: spec.factions.map((faction, team) => ({ faction, team })),
      });
      spec.ai.forEach((difficulty, p) => {
        // A computer player without a difficulty is a passive base (sandbox/testing); people play their own.
        if (difficulty) attachAi(sim, p, difficulty, map.starts);
        else if (p !== 0 && !spec.humans?.includes(p)) grantBase(sim, p, map.starts[p]!);
      });
      return { sim, extras: { decoration: map.decoration, surface: map.surface, landmark: map.landmark, biome: map.biome, mapSeed: map.seedUsed } };
    }
    case 'sandbox':
    case 'stress': {
      const sim = sandbox(rules, { unitsPerSide: spec.unitsPerSide, seed: spec.seed });
      const n = sim.world.map.width * sim.world.map.height;
      return { sim, extras: { decoration: new Uint8Array(n), surface: new Uint8Array(n), landmark: new Uint8Array(n), biome: 'wasteland', mapSeed: spec.seed } };
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
