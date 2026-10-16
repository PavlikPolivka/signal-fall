import type { Role, UnitRule } from '@signal-fall/data';

/**
 * How an AI plays one match. Picked once per match from the AI's own random stream (so a
 * replay reproduces it), on top of the faction profile and the difficulty. All numbers are
 * percentages of the difficulty's values, or ticks.
 */
export interface Strategy {
  name: StrategyName;
  /** Army value for the first wave, and growth per wave (percent of the difficulty's). */
  firstWavePct: number;
  waveGrowthPct: number;
  /** Shift of the earliest first attack, ticks. */
  attackDelay: number;
  /** Defenses beyond the difficulty's count. */
  extraDefenses: Role[];
  /** Refineries beyond the faction's count. */
  extraRefineries: number;
  /** Earliest expansion (a construction vehicle to a new Echo field), ticks. */
  expandAt: number;
  /** Raid harvesters even where the difficulty would not. */
  harass: boolean;
  /** Opening adjustments. */
  opening: (base: readonly Role[]) => Role[];
  /** Unit weight multiplier, percent. */
  weightPct: (unit: UnitRule) => number;
}

export type StrategyName = 'balanced' | 'rush' | 'tech' | 'turtle' | 'raider';

const MINUTE = 1200;
const cheap = (u: UnitRule) => u.cost < 600;
const heavy = (u: UnitRule) => u.cost >= 1200;

/** The radar last: units first, tech after. */
function lean(base: readonly Role[]): Role[] {
  const out = base.filter((r) => r !== 'radar');
  if (out.length < base.length) out.push('radar');
  return out;
}

export const STRATEGIES: Record<StrategyName, Strategy> = {
  balanced: {
    name: 'balanced',
    firstWavePct: 100,
    waveGrowthPct: 100,
    attackDelay: 0,
    extraDefenses: [],
    extraRefineries: 0,
    expandAt: 5 * MINUTE,
    harass: false,
    opening: (b) => [...b],
    weightPct: () => 100,
  },
  // Early pressure with cheap units in small waves; expands late.
  rush: {
    name: 'rush',
    firstWavePct: 55,
    waveGrowthPct: 60,
    attackDelay: -MINUTE,
    extraDefenses: [],
    extraRefineries: 0,
    expandAt: 8 * MINUTE,
    harass: false,
    opening: lean,
    weightPct: (u) => (cheap(u) ? 260 : heavy(u) ? 40 : 100),
  },
  // Greedy: expands early, techs up, attacks late with heavy units.
  tech: {
    name: 'tech',
    firstWavePct: 170,
    waveGrowthPct: 120,
    attackDelay: 2 * MINUTE,
    extraDefenses: ['defense'],
    extraRefineries: 1,
    expandAt: 3 * MINUTE + 600,
    harass: false,
    opening: (b) => [...b],
    weightPct: (u) => (heavy(u) ? 260 : cheap(u) ? 50 : u.isAir ? 150 : 100),
  },
  // Walls up with defenses, waits for a big army and counter-attacks.
  turtle: {
    name: 'turtle',
    firstWavePct: 200,
    waveGrowthPct: 130,
    attackDelay: 3 * MINUTE,
    extraDefenses: ['defense', 'heavyDefense', 'defense', 'antiAir'],
    extraRefineries: 0,
    expandAt: 6 * MINUTE,
    harass: false,
    opening: (b) => [...b],
    weightPct: (u) => (heavy(u) ? 160 : 100),
  },
  // Fast units and aircraft hunting harvesters, medium waves.
  raider: {
    name: 'raider',
    firstWavePct: 90,
    waveGrowthPct: 100,
    attackDelay: 0,
    extraDefenses: [],
    extraRefineries: 0,
    expandAt: 5 * MINUTE,
    harass: true,
    opening: (b) => [...b],
    weightPct: (u) => (u.isAir ? 300 : u.speed >= 150 ? 220 : 100),
  },
};

/** Strategies an AI of each difficulty may pick (Easy stays simple). */
export const STRATEGY_POOL: Record<string, StrategyName[]> = {
  easy: ['balanced', 'rush', 'turtle'],
  normal: ['balanced', 'rush', 'tech', 'turtle', 'raider'],
  hard: ['balanced', 'rush', 'tech', 'turtle', 'raider'],
  brutal: ['balanced', 'rush', 'tech', 'turtle', 'raider'],
};
