/* eslint-disable no-restricted-syntax, no-restricted-properties --
 * This file is the one sanctioned place for division and Math.trunc/sqrt in the sim.
 * Every function returns an exact integer: inputs are integers below 2^52, IEEE
 * division/sqrt are correctly rounded, and results are corrected or truncated.
 */
import { ATAN_TABLE, SIN_QUARTER } from './trig-table';

/** Q10 fixed point: 1024 = one tile. */
export const FX_SHIFT = 10;
export const FX_ONE = 1 << FX_SHIFT;
export const FX_HALF = FX_ONE >> 1;

/** Binary angles: 4096 units per full turn. 0 = +x (east on the sim grid), increasing toward +y. */
export const ANGLE_BITS = 12;
export const ANGLE_FULL = 1 << ANGLE_BITS;
export const ANGLE_MASK = ANGLE_FULL - 1;
const ANGLE_QUARTER = ANGLE_FULL >> 2;

/** Integer division truncating toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Integer division rounding toward negative infinity. */
export function fdiv(a: number, b: number): number {
  const q = Math.trunc(a / b);
  return (a % b !== 0 && (a < 0) !== (b < 0)) ? q - 1 : q;
}

/** Fixed-point multiply: (a * b) >> FX_SHIFT, truncating toward zero. */
export function fmul(a: number, b: number): number {
  return Math.trunc((a * b) / FX_ONE);
}

/** Fixed-point divide: (a << FX_SHIFT) / b, truncating toward zero. */
export function fdivFx(a: number, b: number): number {
  return Math.trunc((a * FX_ONE) / b);
}

/** Scale by a percentage: v * pct / 100, truncating toward zero. */
export function pct(v: number, percent: number): number {
  return Math.trunc((v * percent) / 100);
}

/** Exact floor(sqrt(n)) for 0 <= n < 2^52. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.trunc(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Length of the vector (dx, dy), same units as the inputs. */
export function ilength(dx: number, dy: number): number {
  return isqrt(dx * dx + dy * dy);
}

/** sin of a binary angle, Q10. */
export function isin(angle: number): number {
  const a = angle & ANGLE_MASK;
  const quadrant = a >> 10;
  const i = a & (ANGLE_QUARTER - 1);
  switch (quadrant) {
    case 0:
      return SIN_QUARTER[i]!;
    case 1:
      return SIN_QUARTER[ANGLE_QUARTER - i]!;
    case 2:
      return -SIN_QUARTER[i]!;
    default:
      return -SIN_QUARTER[ANGLE_QUARTER - i]!;
  }
}

/** cos of a binary angle, Q10. */
export function icos(angle: number): number {
  return isin(angle + ANGLE_QUARTER);
}

/** atan2(dy, dx) as a binary angle in [0, ANGLE_FULL). Returns 0 for (0, 0). */
export function iatan2(dy: number, dx: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // Angle within the first octant, 0..512.
  let a: number;
  if (ax >= ay) a = ATAN_TABLE[Math.trunc((ay * 1024) / ax)]!;
  else a = ANGLE_QUARTER - ATAN_TABLE[Math.trunc((ax * 1024) / ay)]!;
  if (dx < 0) a = (ANGLE_FULL >> 1) - a;
  if (dy < 0) a = ANGLE_FULL - a;
  return a & ANGLE_MASK;
}

/** Convert whole tiles to Q10. */
export function tiles(n: number): number {
  return n * FX_ONE;
}

/** Q10 to whole tile index (floor). */
export function toTile(v: number): number {
  return v >> FX_SHIFT;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
