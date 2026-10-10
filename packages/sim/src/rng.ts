/**
 * xoshiro128** seeded via splitmix32. The state lives in a Uint32Array so it is
 * part of the serialized (and hashed) sim state.
 */
export class Rng {
  readonly s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
    if ((this.s[0]! | this.s[1]! | this.s[2]! | this.s[3]!) === 0) this.s[0] = 1;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const s = this.s;
    const s0 = s[0]!;
    const s1 = s[1]!;
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s[2]! ^= s0;
    s[3]! ^= s1;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3] = rotl(s[3]!, 11);
    return result;
  }

  /** Uniform integer in [0, n). n must be in 1..2^32. */
  int(n: number): number {
    return this.nextU32() % n;
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability percent/100. */
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  /** A new independent stream, derived deterministically from this one's seed material. */
  static derive(seed: number, stream: number): Rng {
    return new Rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca77)) >>> 0);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
