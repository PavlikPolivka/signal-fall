import choir from '../json/choir.json' with { type: 'json' };
import constants from '../json/constants.json' with { type: 'json' };
import damageMatrix from '../json/damageMatrix.json' with { type: 'json' };
import halcyon from '../json/halcyon.json' with { type: 'json' };
import holdout from '../json/holdout.json' with { type: 'json' };
import keymap from '../json/keymap.json' with { type: 'json' };
import upgrades from '../json/upgrades.json' with { type: 'json' };
import aiHoldout from '../json/ai/holdout.json' with { type: 'json' };
import aiHalcyon from '../json/ai/halcyon.json' with { type: 'json' };
import aiChoir from '../json/ai/choir.json' with { type: 'json' };
import { compileRules, type RawData, type Rules } from './compile';
import {
  aiProfileSchema,
  type AiProfile,
  type FactionId,
  constantsSchema,
  damageMatrixSchema,
  factionSchema,
  keymapSchema,
  upgradeSchema,
} from './schema';
import { validateRaw } from './validate';

export * from './schema';
export * from './compile';
export { validateRaw } from './validate';

/** Parse and validate the bundled JSON. Throws with every problem listed. */
export function parseRaw(input: {
  factions: unknown[];
  upgrades: unknown;
  damageMatrix: unknown;
  constants: unknown;
  keymap: unknown;
}): RawData {
  const raw: RawData = {
    factions: input.factions.map((f) => factionSchema.parse(f)),
    upgrades: upgradeSchema.array().parse(input.upgrades),
    damageMatrix: damageMatrixSchema.parse(input.damageMatrix),
    constants: constantsSchema.parse(input.constants),
    keymap: keymapSchema.parse(input.keymap),
  };
  const errors = validateRaw(raw);
  if (errors.length > 0) throw new Error(`invalid game data:\n  ${errors.join('\n  ')}`);
  return raw;
}

export function bundledRaw(): RawData {
  return parseRaw({ factions: [holdout, halcyon, choir], upgrades, damageMatrix, constants, keymap });
}

let cached: Rules | null = null;

/** The compiled default rules. Compiled once and shared; treat as read-only. */
export function defaultRules(): Rules {
  cached ??= compileRules(bundledRaw());
  return cached;
}

let aiCache: Map<FactionId, AiProfile> | null = null;

/** AI profiles per faction, validated against the bundled rules. */
export function aiProfiles(): Map<FactionId, AiProfile> {
  if (aiCache) return aiCache;
  const rules = defaultRules();
  const profiles = [aiHoldout, aiHalcyon, aiChoir].map((p) => aiProfileSchema.parse(p));
  for (const p of profiles) {
    const faction = rules.factions.find((f) => f.id === p.faction)!;
    const own = (id: string) => {
      const i = rules.unitIndex.get(id);
      if (i === undefined || rules.units[i]!.faction !== faction.index) throw new Error(`AI ${p.faction}: unit ${id} is not a ${p.faction} unit`);
    };
    own(p.scout);
    own(p.raider);
    for (const [id] of p.army) own(id);
  }
  aiCache = new Map(profiles.map((p) => [p.faction, p]));
  return aiCache;
}
