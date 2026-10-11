import { expect } from 'vitest';
import { SIZES, generateMap, validateMap, type Biome, type MapParams, type MapSize } from '../src/index';

const BIOMES: Biome[] = ['city', 'wasteland', 'crystal'];
const STYLES = ['open', 'normal', 'choke'] as const;
const RES = ['low', 'normal', 'rich'] as const;

/** M4 acceptance: 1,000 seeds per size pass validation (with the seed+1 retry). */
export function sweep(size: MapSize): void {
  let retries = 0;
  for (let seed = 0; seed < 1000; seed++) {
    // Vary the other parameters across seeds so every combination is exercised.
    const params: MapParams = {
      seed,
      size,
      players: 2,
      biome: BIOMES[seed % 3]!,
      terrain: STYLES[(seed >> 2) % 3]!,
      resources: RES[(seed >> 4) % 3]!,
    };
    const map = generateMap(params);
    if (map.seedUsed !== seed) retries++;
    expect(map.width).toBe(SIZES[size]);
    expect(validateMap(map)).toEqual([]);
  }
  // Retries should be the exception.
  expect(retries).toBeLessThan(50);
}
