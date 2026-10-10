// xxHash32 (https://github.com/Cyan4973/xxHash). Implemented in-repo so the
// state hash can never drift with a dependency update.

const P1 = 0x9e3779b1;
const P2 = 0x85ebca77;
const P3 = 0xc2b2ae3d;
const P4 = 0x27d4eb2f;
const P5 = 0x165667b1;

const rotl = (x: number, r: number) => ((x << r) | (x >>> (32 - r))) >>> 0;
const round = (acc: number, lane: number) => Math.imul(rotl((acc + Math.imul(lane, P2)) >>> 0, 13), P1) >>> 0;

function finalize(h: number): number {
  h = Math.imul(h ^ (h >>> 15), P2) >>> 0;
  h = Math.imul(h ^ (h >>> 13), P3) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Standard xxHash32 over bytes. */
export function xxh32(bytes: Uint8Array, seed = 0): number {
  const len = bytes.length;
  const word = (i: number) =>
    (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0;
  let i = 0;
  let h: number;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) >>> 0;
    let v2 = (seed + P2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - P1) >>> 0;
    for (; i + 16 <= len; i += 16) {
      v1 = round(v1, word(i));
      v2 = round(v2, word(i + 4));
      v3 = round(v3, word(i + 8));
      v4 = round(v4, word(i + 12));
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + P5) >>> 0;
  }
  h = (h + len) >>> 0;
  for (; i + 4 <= len; i += 4) h = Math.imul(rotl((h + Math.imul(word(i), P3)) >>> 0, 17), P4) >>> 0;
  for (; i < len; i++) h = Math.imul(rotl((h + Math.imul(bytes[i]!, P5)) >>> 0, 11), P1) >>> 0;
  return finalize(h);
}

/**
 * xxHash32 over 32-bit words; identical to xxh32 of the words' little-endian
 * bytes, without materializing a byte array.
 */
export function xxh32Words(words: ArrayLike<number>, length: number = words.length, seed = 0): number {
  const len = length * 4;
  let i = 0;
  let h: number;
  if (length >= 4) {
    let v1 = (seed + P1 + P2) >>> 0;
    let v2 = (seed + P2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - P1) >>> 0;
    for (; i + 4 <= length; i += 4) {
      v1 = round(v1, words[i]! >>> 0);
      v2 = round(v2, words[i + 1]! >>> 0);
      v3 = round(v3, words[i + 2]! >>> 0);
      v4 = round(v4, words[i + 3]! >>> 0);
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + P5) >>> 0;
  }
  h = (h + len) >>> 0;
  for (; i < length; i++) h = Math.imul(rotl((h + Math.imul(words[i]! >>> 0, P3)) >>> 0, 17), P4) >>> 0;
  return finalize(h);
}

/** Append-only int32 buffer used to serialize sim state for hashing and snapshots. */
export class IntWriter {
  buf: Int32Array;
  length = 0;

  constructor(capacity = 4096) {
    this.buf = new Int32Array(capacity);
  }

  reset(): void {
    this.length = 0;
  }

  push(v: number): void {
    if (this.length === this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v | 0;
  }

  pushArray(a: ArrayLike<number>, count: number = a.length): void {
    for (let i = 0; i < count; i++) this.push(a[i]!);
  }

  hash(seed = 0): number {
    return xxh32Words(this.buf, this.length, seed);
  }
}
