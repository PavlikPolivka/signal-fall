import type { FactionIdx, Rules } from '@signal-fall/data';
import { IntWriter } from './hash';
import { Rng } from './rng';

export interface PlayerSetup {
  faction: FactionIdx;
  team: number;
}

export interface PlayerState {
  index: number;
  faction: FactionIdx;
  team: number;
  credits: number;
  defeated: boolean;
  surrendered: boolean;
}

/** Derived PRNG stream ids. */
export const STREAM = { combat: 1, ai: 100 } as const;

export interface World {
  rules: Rules;
  seed: number;
  tick: number;
  width: number;
  height: number;
  players: PlayerState[];
  rng: Rng;
  /** One stream per AI player, indexed by player index. */
  aiRng: Rng[];
}

export function createWorld(rules: Rules, seed: number, width: number, height: number, players: PlayerSetup[]): World {
  return {
    rules,
    seed: seed >>> 0,
    tick: 0,
    width,
    height,
    players: players.map((p, index) => ({
      index,
      faction: p.faction,
      team: p.team,
      credits: rules.constants.startCredits,
      defeated: false,
      surrendered: false,
    })),
    rng: Rng.derive(seed, STREAM.combat),
    aiRng: players.map((_, i) => Rng.derive(seed, STREAM.ai + i)),
  };
}

/** Serialize the full sim state into w, in a fixed order. */
export function serializeWorld(world: World, w: IntWriter): void {
  w.push(world.seed);
  w.push(world.tick);
  w.push(world.width);
  w.push(world.height);
  w.pushArray(world.rng.s);
  w.push(world.players.length);
  for (const p of world.players) {
    w.push(p.faction);
    w.push(p.team);
    w.push(p.credits);
    w.push(p.defeated ? 1 : 0);
    w.push(p.surrendered ? 1 : 0);
  }
  for (const r of world.aiRng) w.pushArray(r.s);
}
