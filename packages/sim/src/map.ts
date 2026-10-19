import { FX_HALF, FX_SHIFT, idiv } from './fx';

/** Terrain kinds on the square sim grid. */
export const TERRAIN = {
  ground: 0,
  rough: 1,
  rock: 2,
  water: 3,
  cliff: 4,
  ruins: 5,
} as const;
export type Terrain = (typeof TERRAIN)[keyof typeof TERRAIN];

/** Percent of normal speed on each terrain (0 = impassable for ground units). */
export const TERRAIN_SPEED_PCT: readonly number[] = [100, 70, 0, 0, 0, 0];
export const TERRAIN_BUILDABLE: readonly boolean[] = [true, false, false, false, false, false];

export interface GameMap {
  width: number;
  height: number;
  terrain: Uint8Array;
  /** Echo crystals per tile (0 = none). */
  echo: Uint8Array;
  /** Max crystals a tile regrows to (0 = not part of a field). */
  echoCap: Uint8Array;
  /** Structure slot occupying each tile, or -1. */
  occupant: Int32Array;
  /** 1 if a ground unit can stand on the tile. */
  nav: Uint8Array;
  /** Bumped whenever nav changes; invalidates cached flow fields. */
  navVersion: number;
  /** 1 on road tiles (vehicles drive faster). */
  road: Uint8Array;
}

/** Ground units on a road move this much faster, percent. */
export const ROAD_SPEED_PCT = 120;
/** Units on rough ground (brush) are seen only by enemies this close, tiles. */
export const BRUSH_SIGHT = 6;

export function createMap(width: number, height: number, terrain?: Uint8Array, echo?: Uint8Array, road?: Uint8Array): GameMap {
  const n = width * height;
  const map: GameMap = {
    width,
    height,
    terrain: terrain ?? new Uint8Array(n),
    echo: echo ? echo.slice() : new Uint8Array(n),
    echoCap: echo ? echo.slice() : new Uint8Array(n),
    occupant: new Int32Array(n).fill(-1),
    nav: new Uint8Array(n),
    navVersion: 0,
    road: road ? road.slice() : new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) refreshNav(map, i);
  return map;
}

export function refreshNav(map: GameMap, i: number): void {
  map.nav[i] = TERRAIN_SPEED_PCT[map.terrain[i]!]! > 0 && map.occupant[i] === -1 ? 1 : 0;
}

export function inBounds(map: GameMap, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < map.width && ty < map.height;
}

export function tileIndex(map: GameMap, tx: number, ty: number): number {
  return ty * map.width + tx;
}

export function passable(map: GameMap, tx: number, ty: number): boolean {
  return inBounds(map, tx, ty) && map.nav[ty * map.width + tx] === 1;
}

/** Tile index containing a Q10 world position, or -1 when off the map. */
export function tileAt(map: GameMap, x: number, y: number): number {
  const tx = x >> FX_SHIFT;
  const ty = y >> FX_SHIFT;
  return inBounds(map, tx, ty) ? ty * map.width + tx : -1;
}

/** Q10 center of a tile. */
export function tileCenterX(map: GameMap, i: number): number {
  return ((i % map.width) << FX_SHIFT) + FX_HALF;
}

export function tileCenterY(map: GameMap, i: number): number {
  return (idiv(i, map.width) << FX_SHIFT) + FX_HALF;
}
