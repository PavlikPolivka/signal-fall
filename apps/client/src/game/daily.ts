import type { ScenarioSpec } from './scenario';

/** Today's date in UTC, "2026-10-19" (the challenge changes at midnight UTC). */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A stable number from a string (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const BIOMES = ['wasteland', 'city', 'crystal'] as const;
const FACTION_NAMES = ['Holdout', 'Halcyon', 'Choir'];

/** The same match for everyone today: your faction, the opponent's (Hard AI) and the map all follow from the date. */
export function dailyChallenge(day = today()): { scenario: ScenarioSpec; label: string } {
  const h = hash(`signal-fall-daily-${day}`);
  const faction = h % 3;
  const enemy = (faction + 1 + ((h >>> 4) % 2)) % 3;
  const biome = BIOMES[(h >>> 8) % 3]!;
  const size = (['S', 'M', 'M'] as const)[(h >>> 12) % 3]!;
  const scenario: ScenarioSpec = {
    kind: 'skirmish',
    seed: (h >>> 1) % 1_000_000,
    factions: [faction, enemy],
    ai: [null, 'hard'],
    map: { size, biome, resources: 'normal', terrain: 'normal' },
  };
  return { scenario, label: `${FACTION_NAMES[faction]} vs ${FACTION_NAMES[enemy]} (Hard), ${size === 'S' ? 'small' : 'medium'} ${biome === 'city' ? 'ruined city' : biome === 'crystal' ? 'crystal fields' : 'wasteland'}` };
}
