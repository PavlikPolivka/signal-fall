/**
 * Player commands: the only input to the sim. Unit lists are entity handles;
 * positions are Q10 world coordinates. `queue` appends instead of replacing
 * current orders (Shift in the client).
 */
export type Command =
  | { type: 'noop' }
  | { type: 'surrender' }
  | { type: 'move'; units: number[]; x: number; y: number; queue?: boolean }
  | { type: 'attackMove'; units: number[]; x: number; y: number; queue?: boolean }
  | { type: 'attack'; units: number[]; target: number; queue?: boolean }
  | { type: 'patrol'; units: number[]; x: number; y: number; queue?: boolean }
  | { type: 'guard'; units: number[]; target: number; queue?: boolean }
  | { type: 'stop'; units: number[] }
  | { type: 'hold'; units: number[] }
  | { type: 'scatter'; units: number[] }
  /** Deploy construction units into a construction yard where they stand. */
  | { type: 'deploy'; units: number[] }
  /** Start building a structure at the construction yard (category queue). */
  | { type: 'build'; category: 'structures' | 'defenses'; item: number }
  | { type: 'cancelBuild'; category: 'structures' | 'defenses' }
  /** Place the finished structure of a category with its footprint origin at tile (tx, ty). */
  | { type: 'place'; category: 'structures' | 'defenses'; tx: number; ty: number }
  /** Queue units at the factory queue for their tab. */
  | { type: 'train'; item: number; count: number }
  /** Remove the last queued unit of this type (refunds progress if it was being built). */
  | { type: 'cancelTrain'; item: number }
  | { type: 'rally'; target: number; x: number; y: number }
  | { type: 'sell'; target: number }
  /** Toggle paid repair on a structure. */
  | { type: 'repair'; target: number }
  /** Send harvesters to Echo near (x, y), or to a refinery to unload. */
  | { type: 'harvest'; units: number[]; x: number; y: number }
  /** Harvester tile preference: 0 = richest first, 1 = nearest first. */
  | { type: 'harvestMode'; units: number[]; mode: number }
  /** Collect a wreck for credits (Holdout harvesters and engineers). */
  | { type: 'salvage'; units: number[]; target: number; queue?: boolean }
  /** Faction ability: blink, phase, override (M7). Optional target point or entity. */
  | { type: 'ability'; units: number[]; x?: number; y?: number; target?: number };

export type CommandType = Command['type'];

export interface ScheduledCommand {
  /** Tick at which the command is applied (before systems run). */
  tick: number;
  player: number;
  cmd: Command;
}

/** Commands bucketed by tick. Within a tick, commands apply in (player, arrival) order. */
export class CommandQueue {
  private readonly byTick = new Map<number, ScheduledCommand[]>();

  push(c: ScheduledCommand): void {
    let list = this.byTick.get(c.tick);
    if (!list) {
      list = [];
      this.byTick.set(c.tick, list);
    }
    // Stable insert keeping player order; same-player commands keep arrival order.
    let i = list.length;
    while (i > 0 && list[i - 1]!.player > c.player) i--;
    list.splice(i, 0, c);
  }

  take(tick: number): ScheduledCommand[] {
    const list = this.byTick.get(tick);
    if (!list) return EMPTY;
    this.byTick.delete(tick);
    return list;
  }

  get pending(): number {
    let n = 0;
    for (const list of this.byTick.values()) n += list.length;
    return n;
  }
}

const EMPTY: ScheduledCommand[] = [];
