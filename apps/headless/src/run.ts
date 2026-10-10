import { defaultRules, factionIndex, FACTIONS, type FactionId } from '@signal-fall/data';
import { HASH_INTERVAL, Sim } from '@signal-fall/sim';

export interface RunOptions {
  seed: number;
  ticks: number;
  factions: FactionId[];
  size: number;
}

export interface RunResult {
  ticks: number;
  finalHash: number;
  hashes: number[];
  ms: number;
}

/** Run a headless match with no commands and report the periodic state hashes. */
export function runMatch(opts: RunOptions): RunResult {
  const sim = new Sim({
    rules: defaultRules(),
    seed: opts.seed,
    width: opts.size,
    height: opts.size,
    players: opts.factions.map((f, team) => ({ faction: factionIndex(f), team })),
  });
  const hashes: number[] = [];
  const start = performance.now();
  for (let t = 0; t < opts.ticks; t++) {
    sim.step();
    if (sim.tick % HASH_INTERVAL === 0) hashes.push(sim.hash());
  }
  return { ticks: sim.tick, finalHash: sim.hash(), hashes, ms: performance.now() - start };
}

export function parseFactions(s: string): FactionId[] {
  const list = s.split(',').map((x) => x.trim());
  for (const f of list) if (!(FACTIONS as readonly string[]).includes(f)) throw new Error(`unknown faction ${f}`);
  return list as FactionId[];
}
