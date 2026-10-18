import { describe, expect, it } from 'vitest';
import { customToGenerated, decodeMap, encodeMap, generateMap, generateOnce, validateMap, type Biome, type MapParams, type MapSize } from '../src/index';
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
          "d9e72982",
          "e326ca02",
          "7698507",
        ],
        [
          "15506db0",
          "7c80adc9",
          "58cb2204",
        ],
        [
          "511b5d8",
          "d213e168",
          "e1ce889f",
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

describe('capture points', () => {
  it('are placed for every player alike, on open reachable ground, only when asked for', () => {
    for (let seed = 0; seed < 20; seed++) {
      const off = generateMap({ seed, size: 'M', players: 2, biome: 'wasteland', resources: 'normal', terrain: 'normal' });
      expect(off.points).toBeUndefined();
      const on = generateMap({ seed, size: 'M', players: 2, biome: 'wasteland', resources: 'normal', terrain: 'normal', points: 'some' });
      // Same map otherwise.
      expect(on.hash).toBe(off.hash);
      expect(on.points!.length % 2).toBe(0);
      expect(on.points!.length).toBeGreaterThanOrEqual(4);
      for (const k of [1, 2, 3]) expect(on.points!.filter((p) => p.kind === k).length % 2).toBe(0);
      for (const p of on.points!) expect(on.terrain[p.y * on.width + p.x]).toBe(0);
    }
  });
});

describe('custom maps', () => {
  it('survive a round trip through a share code and validate like the original', () => {
    const g = generateMap({ seed: 9, size: 'M', players: 2, biome: 'city', resources: 'normal', terrain: 'normal' });
    const code = encodeMap({ name: 'Round trip', size: g.width, biome: g.biome, terrain: g.terrain, echo: g.echo, starts: g.starts });
    expect(code.startsWith('SF1.')).toBe(true);
    const back = decodeMap(code);
    expect(back.name).toBe('Round trip');
    expect(back.starts).toEqual(g.starts);
    expect(Array.from(back.terrain)).toEqual(Array.from(g.terrain));
    expect(Array.from(back.echo)).toEqual(Array.from(g.echo).map((v) => Math.min(15, v)));
    expect(validateMap(customToGenerated(back))).toEqual([]);
  });

  it('reject damaged codes', () => {
    expect(() => decodeMap('hello')).toThrow();
    expect(() => decodeMap('SF1.AAAA')).toThrow();
  });
});

describe('hand-made maps that ship with the game', () => {
  it('are all fair and playable', async () => {
    const { HANDMADE_MAPS } = await import('../../../apps/client/src/game/maps');
    expect(HANDMADE_MAPS.length).toBeGreaterThanOrEqual(4);
    for (const m of HANDMADE_MAPS) {
      const map = decodeMap(m.code);
      expect(map.starts.length).toBe(m.players);
      expect(validateMap(customToGenerated(map)), m.name).toEqual([]);
    }
  });
});
