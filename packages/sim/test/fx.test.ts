import { describe, expect, it } from 'vitest';
import { ANGLE_FULL, FX_ONE, fdiv, fmul, iatan2, icos, idiv, isin, isqrt } from '../src/fx';

describe('fx', () => {
  it('idiv truncates, fdiv floors', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(fdiv(-7, 2)).toBe(-4);
    expect(fdiv(7, -2)).toBe(-4);
    expect(fdiv(-8, 2)).toBe(-4);
  });

  it('fmul multiplies Q10 values', () => {
    expect(fmul(3 * FX_ONE, FX_ONE / 2)).toBe(1.5 * FX_ONE);
    expect(fmul(-FX_ONE, 3)).toBe(-3);
  });

  it('isqrt is exact', () => {
    for (let n = 0; n < 100_000; n++) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
    for (const n of [2 ** 40, 2 ** 40 - 1, 2 ** 51 + 12345, 999_999_999_999]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
  });

  it('isin/icos match Math within one Q10 step', () => {
    for (let a = 0; a < ANGLE_FULL; a += 7) {
      const rad = (a / ANGLE_FULL) * 2 * Math.PI;
      expect(Math.abs(isin(a) - Math.sin(rad) * FX_ONE)).toBeLessThanOrEqual(1);
      expect(Math.abs(icos(a) - Math.cos(rad) * FX_ONE)).toBeLessThanOrEqual(1);
    }
    expect(isin(1024)).toBe(1024);
    expect(isin(-1024)).toBe(-1024);
  });

  it('iatan2 matches Math.atan2 within 2 angle units', () => {
    for (let dy = -40; dy <= 40; dy += 3) {
      for (let dx = -40; dx <= 40; dx += 3) {
        if (dx === 0 && dy === 0) continue;
        const expected = ((Math.atan2(dy, dx) / (2 * Math.PI)) * ANGLE_FULL + ANGLE_FULL) % ANGLE_FULL;
        let diff = Math.abs(iatan2(dy, dx) - expected);
        diff = Math.min(diff, ANGLE_FULL - diff);
        expect(diff).toBeLessThanOrEqual(2);
      }
    }
    expect(iatan2(0, 5)).toBe(0);
    expect(iatan2(5, 0)).toBe(1024);
    expect(iatan2(0, -5)).toBe(2048);
    expect(iatan2(-5, 0)).toBe(3072);
  });
});
