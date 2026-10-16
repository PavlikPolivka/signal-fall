export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'brutal'];

export interface DifficultyProfile {
  /** Commands per minute the AI may issue. */
  apm: number;
  /** Ticks before the AI reacts to a newly seen enemy. */
  reactionTicks: number;
  /** Ticks between build-queue decisions (slow build order on Easy). */
  buildDelayTicks: number;
  /** Pick units that counter what it has seen. */
  counter: boolean;
  /** Focus fire on weak targets in fights. */
  focusFire: boolean;
  /** Raid enemy harvesters. */
  harass: boolean;
  /** Pull back from lost fights and damaged units. */
  retreat: boolean;
  /** Send a scout early. */
  scout: boolean;
  /** Use faction abilities (M7). */
  abilities: boolean;
  /** Harvesters per refinery is capped at this (profile value applies when higher). */
  maxHarvestersPerRefinery: number;
  /** Defenses it builds. */
  defenses: number;
  /** Army value needed for the first attack wave; each wave needs `waveGrowth` more. */
  firstWave: number;
  waveGrowth: number;
  /** Earliest first attack, ticks. */
  firstAttackTick: number;
  /** Income bonus percent (Brutal is the only level that cheats). */
  incomeBonusPct: number;
  /** Refineries it builds at most (profile value applies when lower). */
  maxRefineries: number;
  /** Units it keeps queued per factory tab. */
  queueDepth: number;
  /** Credits it holds back before buying army units (Easy wastes money idling). */
  armyReserve: number;
}

const TICKS_PER_MINUTE = 1200;

export const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    maxRefineries: 2,
    queueDepth: 1,
    armyReserve: 800,
    apm: 30,
    reactionTicks: 60,
    buildDelayTicks: 300,
    counter: false,
    focusFire: false,
    harass: false,
    retreat: false,
    scout: false,
    abilities: false,
    maxHarvestersPerRefinery: 1,
    defenses: 1,
    // Small piecemeal waves: Easy throws units away.
    firstWave: 2000,
    waveGrowth: 500,
    firstAttackTick: 6 * TICKS_PER_MINUTE,
    incomeBonusPct: 0,
  },
  normal: {
    maxRefineries: 3,
    queueDepth: 2,
    armyReserve: 0,
    apm: 80,
    reactionTicks: 30,
    buildDelayTicks: 40,
    counter: true,
    focusFire: true,
    harass: false,
    retreat: false,
    scout: true,
    abilities: false,
    maxHarvestersPerRefinery: 3,
    defenses: 2,
    firstWave: 4000,
    waveGrowth: 1500,
    firstAttackTick: 4 * TICKS_PER_MINUTE,
    incomeBonusPct: 0,
  },
  hard: {
    maxRefineries: 4,
    queueDepth: 2,
    armyReserve: 0,
    apm: 160,
    reactionTicks: 10,
    buildDelayTicks: 0,
    counter: true,
    focusFire: true,
    harass: true,
    retreat: true,
    scout: true,
    abilities: true,
    maxHarvestersPerRefinery: 4,
    defenses: 3,
    firstWave: 4000,
    waveGrowth: 1000,
    firstAttackTick: 4 * TICKS_PER_MINUTE,
    incomeBonusPct: 0,
  },
  brutal: {
    maxRefineries: 4,
    queueDepth: 2,
    armyReserve: 0,
    apm: 160,
    reactionTicks: 10,
    buildDelayTicks: 0,
    counter: true,
    focusFire: true,
    harass: true,
    retreat: true,
    scout: true,
    abilities: true,
    maxHarvestersPerRefinery: 4,
    defenses: 3,
    firstWave: 4000,
    waveGrowth: 1000,
    firstAttackTick: 4 * TICKS_PER_MINUTE,
    incomeBonusPct: 25,
  },
};
