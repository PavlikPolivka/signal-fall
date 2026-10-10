import { defaultRules, factionIndex, FACTIONS, type FactionId } from '@signal-fall/data';
import { HASH_INTERVAL, Sim, bigBattle, countUnits } from '@signal-fall/sim';

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
    // No starting units until M3, so nobody can be defeated yet.
    victoryRules: false,
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

export interface BenchResult {
  units: number;
  ticks: number;
  avgMs: number;
  maxMs: number;
  finalHash: number;
}

/** Tick the 400-unit benchmark battle and report per-tick timings. */
export function runBench(ticks: number, unitsPerSide = 200): BenchResult {
  const { sim } = bigBattle(defaultRules(), { unitsPerSide });
  const units = countUnits(sim, 0) + countUnits(sim, 1);
  sim.run(20);
  let max = 0;
  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    const t = performance.now();
    sim.step();
    max = Math.max(max, performance.now() - t);
  }
  return { units, ticks, avgMs: (performance.now() - start) / ticks, maxMs: max, finalHash: sim.hash() };
}
