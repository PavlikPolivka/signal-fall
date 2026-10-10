import choir from '../json/choir.json' with { type: 'json' };
import constants from '../json/constants.json' with { type: 'json' };
import damageMatrix from '../json/damageMatrix.json' with { type: 'json' };
import halcyon from '../json/halcyon.json' with { type: 'json' };
import holdout from '../json/holdout.json' with { type: 'json' };
import keymap from '../json/keymap.json' with { type: 'json' };
import upgrades from '../json/upgrades.json' with { type: 'json' };
import { compileRules, type RawData, type Rules } from './compile';
import {
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
