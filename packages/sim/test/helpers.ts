import { defaultRules } from '@signal-fall/data';
import { FX_HALF, FX_SHIFT } from '../src/fx';
import { Sim } from '../src/sim';

export const rules = defaultRules();
export const unit = (id: string) => rules.unitIndex.get(id)!;
export const structure = (id: string) => rules.structureIndex.get(id)!;
/** Q10 center of tile n. */
export const at = (n: number) => (n << FX_SHIFT) + FX_HALF;

export function makeSim(opts: { size?: number; terrain?: Uint8Array; victoryRules?: boolean; seed?: number } = {}) {
  const size = opts.size ?? 32;
  return new Sim({
    rules,
    seed: opts.seed ?? 1,
    width: size,
    height: size,
    terrain: opts.terrain,
    players: [
      { faction: 0, team: 0 },
      { faction: 2, team: 1 },
    ],
    victoryRules: opts.victoryRules ?? false,
  });
}
