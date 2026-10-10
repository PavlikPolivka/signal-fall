import { describe, expect, it } from 'vitest';
import { IntWriter, xxh32, xxh32Words } from '../src/hash';
import { Rng } from '../src/rng';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('xxh32', () => {
  it('matches reference vectors', () => {
    expect(xxh32(bytes(''), 0)).toBe(0x02cc5d05);
    expect(xxh32(bytes('a'), 0)).toBe(0x550d7456);
    expect(xxh32(bytes('abc'), 0)).toBe(0x32d153ff);
    expect(xxh32(bytes('Nobody inspects the spammish repetition'), 0)).toBe(0xe2293b2f);
  });

  it('word variant equals byte variant over little-endian bytes', () => {
    for (const n of [0, 1, 3, 4, 5, 8, 17, 100]) {
      const words = Int32Array.from({ length: n }, (_, i) => Math.imul(i + 1, -1640531535));
      const b = new Uint8Array(words.buffer.slice(0));
      expect(xxh32Words(words, n, 7)).toBe(xxh32(b, 7));
    }
  });

  it('IntWriter grows and hashes what was pushed', () => {
    const w = new IntWriter(2);
    for (let i = 0; i < 10; i++) w.push(i * 3);
    expect(w.length).toBe(10);
    expect(w.hash()).toBe(xxh32Words(Int32Array.from({ length: 10 }, (_, i) => i * 3)));
  });
});

describe('Rng', () => {
  it('is reproducible and has a stable golden sequence', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 5 }, () => a.nextU32());
    const seqB = Array.from({ length: 5 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
    // Golden values: if this changes, every replay and golden hash breaks.
    expect(seqA).toMatchInlineSnapshot(`
      [
        518667457,
        440444462,
        4232892992,
        3757857622,
        3939018813,
      ]
    `);
  });

  it('streams differ', () => {
    expect(Rng.derive(1, 1).nextU32()).not.toBe(Rng.derive(1, 2).nextU32());
  });

  it('int is roughly uniform', () => {
    const r = new Rng(99);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) counts[r.int(10)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });
});
