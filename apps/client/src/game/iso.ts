/** 2:1 isometric projection. Tiles are 64x32 px diamonds. */
export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;
const FX = 1024;

/** Tile-space (float tiles) to world pixels. */
export function isoX(u: number, v: number): number {
  return (u - v) * HW;
}

export function isoY(u: number, v: number): number {
  return (u + v) * HH;
}

/** World pixels back to tile space (float tiles). */
export function tileU(px: number, py: number): number {
  return (px / HW + py / HH) / 2;
}

export function tileV(px: number, py: number): number {
  return (py / HH - px / HW) / 2;
}

/** Q10 sim coordinates to world pixels. */
export function simToPxX(x: number, y: number): number {
  return isoX(x / FX, y / FX);
}

export function simToPxY(x: number, y: number): number {
  return isoY(x / FX, y / FX);
}

/** Screen rotation (radians) for a sim binary angle (4096 per turn). */
export function facingToRotation(angle: number): number {
  const a = (angle / 4096) * Math.PI * 2;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  return Math.atan2(isoY(dx, dy), isoX(dx, dy));
}
