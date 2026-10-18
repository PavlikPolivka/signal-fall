import { xxh32Words } from '@signal-fall/sim';
import { LANDMARK, type Biome, type GeneratedMap, type MapSize } from './generate';

/**
 * Hand-made maps (the map editor, and the maps that ship with the game): terrain, Echo and starts,
 * shared as a short code. Decorations are left to the renderer; everything the sim needs is here.
 */
export interface CustomMap {
  name: string;
  size: number;
  biome: Biome;
  /** TERRAIN per tile, size * size. */
  terrain: Uint8Array;
  /** Echo crystals per tile (0..15). */
  echo: Uint8Array;
  starts: { x: number; y: number }[];
}

const BIOMES: Biome[] = ['wasteland', 'city', 'crystal'];
const PREFIX = 'SF1.';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const v = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) out += ALPHABET[(v >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const c = k < chunk.length ? ALPHABET.indexOf(chunk[k]!) : 0;
      if (c < 0) throw new Error('Damaged map code');
      v = (v << 6) | c;
    }
    out.push((v >> 16) & 255);
    if (chunk.length > 2) out.push((v >> 8) & 255);
    if (chunk.length > 3) out.push(v & 255);
  }
  return Uint8Array.from(out);
}

/** Map names are kept to plain printable characters. */
const ascii = (s: string) => Array.from(s.replace(/[^ -~]/g, '').slice(0, 40), (c) => c.charCodeAt(0));

/** The map as a share code: "SF1." then run-length encoded tiles in base64url. */
export function encodeMap(m: CustomMap): string {
  const out: number[] = [];
  const name = ascii(m.name);
  out.push(m.size, BIOMES.indexOf(m.biome), m.starts.length, name.length, ...name);
  for (const s of m.starts) out.push(s.x, s.y);
  const n = m.size * m.size;
  let i = 0;
  while (i < n) {
    const v = (m.terrain[i]! << 4) | Math.min(15, m.echo[i]!);
    let run = 1;
    while (i + run < n && run < 0xffff && ((m.terrain[i + run]! << 4) | Math.min(15, m.echo[i + run]!)) === v) run++;
    out.push(v, run >> 8, run & 255);
    i += run;
  }
  return PREFIX + toBase64Url(Uint8Array.from(out));
}

export function decodeMap(code: string): CustomMap {
  const text = code.trim();
  if (!text.startsWith(PREFIX)) throw new Error('Not a Signal Fall map code');
  const b = fromBase64Url(text.slice(PREFIX.length));
  let p = 0;
  const size = b[p++]!;
  const biome = BIOMES[b[p++]!] ?? 'wasteland';
  const players = b[p++]!;
  const nameLen = b[p++]!;
  const name = String.fromCharCode(...b.slice(p, p + nameLen));
  p += nameLen;
  const starts: { x: number; y: number }[] = [];
  for (let k = 0; k < players; k++) starts.push({ x: b[p++]!, y: b[p++]! });
  if (size < 32 || size > 192 || players < 2 || players > 8) throw new Error('Damaged map code');
  const n = size * size;
  const terrain = new Uint8Array(n);
  const echo = new Uint8Array(n);
  let i = 0;
  while (p + 2 < b.length + 0 && i < n) {
    const v = b[p]!;
    const run = (b[p + 1]! << 8) | b[p + 2]!;
    p += 3;
    for (let k = 0; k < run && i < n; k++, i++) {
      terrain[i] = v >> 4;
      echo[i] = v & 15;
    }
  }
  if (i !== n) throw new Error('Damaged map code');
  return { name, size, biome, terrain, echo, starts };
}

/** The nearest map size class (for the setup screen and the AI). */
export function sizeClass(size: number): MapSize {
  return size <= 100 ? 'S' : size <= 140 ? 'M' : 'L';
}

/** A hand-made map in the shape the rest of the game uses for generated ones. */
export function customToGenerated(m: CustomMap): GeneratedMap {
  const n = m.size;
  const words = new Int32Array(n * n * 2 + m.starts.length * 2);
  for (let i = 0; i < n * n; i++) {
    words[i] = m.terrain[i]!;
    words[n * n + i] = m.echo[i]!;
  }
  m.starts.forEach((s, k) => {
    words[2 * n * n + 2 * k] = s.x;
    words[2 * n * n + 2 * k + 1] = s.y;
  });
  return {
    width: n,
    height: n,
    terrain: m.terrain.slice(),
    echo: m.echo.slice(),
    starts: m.starts.map((s) => ({ ...s })),
    params: { seed: 0, size: sizeClass(n), players: m.starts.length, biome: m.biome, resources: 'normal', terrain: 'normal' },
    seedUsed: 0,
    symmetry: 'mirrorH',
    biome: m.biome,
    decoration: new Uint8Array(n * n),
    surface: new Uint8Array(n * n),
    landmark: new Uint8Array(n * n).fill(LANDMARK.none),
    hash: xxh32Words(words),
  };
}
