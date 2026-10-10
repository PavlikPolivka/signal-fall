import { FX_SHIFT } from './fx';
import type { Entities } from './entities';

/** Cells are 4x4 tiles. */
export const CELL_SHIFT = FX_SHIFT + 2;

/**
 * Uniform grid over all live entities, rebuilt once per tick with a counting
 * sort. Within a cell, slots are in ascending order, so queries are
 * deterministic.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly start: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;

  constructor(widthTiles: number, heightTiles: number) {
    this.cols = (widthTiles + 3) >> 2;
    this.rows = (heightTiles + 3) >> 2;
    this.start = new Int32Array(this.cols * this.rows + 1);
    this.items = new Int32Array(256);
    this.cellOf = new Int32Array(256);
  }

  private cellX(x: number): number {
    const c = x >> CELL_SHIFT;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private cellY(y: number): number {
    const c = y >> CELL_SHIFT;
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  rebuild(e: Entities): void {
    if (this.cellOf.length < e.high) {
      this.cellOf = new Int32Array(e.capacity);
      this.items = new Int32Array(e.capacity);
    }
    const start = this.start;
    start.fill(0);
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1) {
        this.cellOf[s] = -1;
        continue;
      }
      const c = this.cellY(e.y[s]!) * this.cols + this.cellX(e.x[s]!);
      this.cellOf[s] = c;
      start[c + 1]!++;
    }
    for (let c = 0; c < this.cols * this.rows; c++) start[c + 1]! += start[c]!;
    const fill = start.slice(0, this.cols * this.rows);
    for (let s = 0; s < e.high; s++) {
      const c = this.cellOf[s]!;
      if (c >= 0) this.items[fill[c]!++] = s;
    }
  }

  /**
   * Call fn for every entity slot whose cell overlaps the square of half-size r
   * around (x, y). Callers must do their own exact distance test.
   */
  query(x: number, y: number, r: number, fn: (slot: number) => void): void {
    const x0 = this.cellX(x - r);
    const x1 = this.cellX(x + r);
    const y0 = this.cellY(y - r);
    const y1 = this.cellY(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cols + cx;
        const end = this.start[c + 1]!;
        for (let i = this.start[c]!; i < end; i++) fn(this.items[i]!);
      }
    }
  }
}
