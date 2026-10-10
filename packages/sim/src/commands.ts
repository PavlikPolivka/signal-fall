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
  /** Deploy construction units (M3). */
  | { type: 'deploy'; units: number[] }
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
