import { describe, expect, it } from 'vitest';
import { generateMap, generateOnce, validateMap, type Biome, type MapParams, type MapSize } from '../src/index';
import { TERRAIN_BUILDABLE } from '@signal-fall/sim';

const base: MapParams = { seed: 1, size: 'M', players: 2, biome: 'wasteland', resources: 'normal', terrain: 'normal' };
const BIOMES: Biome[] = ['city', 'wasteland', 'crystal'];
type Style = 'open' | 'normal' | 'choke';
type Res = 'low' | 'normal' | 'rich';

describe('map generator', () => {
  it('golden hashes: a fixed seed always produces the same map', () => {
    const hashes = (['S', 'M', 'L'] as MapSize[]).map((size) =>
      BIOMES.map((biome) => generateMap({ ...base, size, biome, seed: 1234 }).hash.toString(16)),
    );
    expect(hashes).toMatchInlineSnapshot(`
      [
        [
          "c2497520",
          "53744a88",
          "a6fd978d",
        ],
        [
          "c0519dbd",
          "c154680c",
          "1ee411b0",
        ],
        [
          "9d6121ba",
          "965315d1",
          "d8b51471",
        ],
      ]
    `);
  });

  it('is deterministic and seed-sensitive', () => {
    const a = generateMap({ ...base, seed: 7 });
    const b = generateMap({ ...base, seed: 7 });
    const c = generateMap({ ...base, seed: 8 });
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(c.hash).not.toBe(a.hash);
  });

  it('maps are symmetric for every 2-player symmetry', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const m = generateOnce({ ...base, size: 'S', seed }, seed);
      seen.add(m.symmetry);
      const n = m.width;
      const partner = (x: number, y: number): [number, number] => {
        switch (m.symmetry) {
          case 'mirrorH':
            return [n - 1 - x, y];
          case 'mirrorV':
            return [x, n - 1 - y];
          case 'mirrorD':
            return [y, x];
          default:
            return [n - 1 - x, n - 1 - y];
        }
      };
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const [a, b] = partner(x, y);
          expect(m.terrain[b * n + a]).toBe(m.terrain[y * n + x]);
          expect(m.echo[b * n + a]).toBe(m.echo[y * n + x]);
        }
      const [px, py] = partner(m.starts[0]!.x, m.starts[0]!.y);
      expect(m.starts[1]).toEqual({ x: px, y: py });
    }
    expect([...seen].sort()).toEqual(['mirrorD', 'mirrorH', 'mirrorV', 'rotate180']);
  });

  it('every start has a flat 24x24 build area and Echo nearby', () => {
    const m = generateMap({ ...base, seed: 99 });
    for (const s of m.starts) {
      for (let y = s.y - 12; y < s.y + 12; y++)
        for (let x = s.x - 12; x < s.x + 12; x++) expect(TERRAIN_BUILDABLE[m.terrain[y * m.width + x]!]).toBe(true);
      let near = 0;
      for (let y = s.y - 20; y <= s.y + 20; y++)
        for (let x = s.x - 20; x <= s.x + 20; x++) if (m.echo[y * m.width + x]) near++;
      expect(near).toBeGreaterThan(15);
    }
  });

  it('resource and terrain parameters have the intended effect', () => {
    const echoTotal = (r: Res) => {
      let t = 0;
      for (let seed = 0; seed < 10; seed++) for (const v of generateMap({ ...base, size: 'S', seed, resources: r }).echo) t += v;
      return t;
    };
    expect(echoTotal('rich')).toBeGreaterThan(echoTotal('normal'));
    expect(echoTotal('normal')).toBeGreaterThan(echoTotal('low'));
    const blocked = (terrain: Style) => {
      let t = 0;
      for (let seed = 0; seed < 10; seed++) for (const v of generateMap({ ...base, size: 'S', seed, terrain }).terrain) if (v >= 2) t++;
      return t;
    };
    expect(blocked('choke')).toBeGreaterThan(blocked('open'));
  });

  it('supports 3 to 8 players', () => {
    for (let players = 3; players <= 8; players++) {
      const m = generateMap({ ...base, size: 'L', players, seed: 5 });
      expect(m.starts).toHaveLength(players);
      expect(validateMap(m)).toEqual([]);
    }
  });
});
