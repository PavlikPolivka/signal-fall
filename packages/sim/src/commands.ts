/** Player commands: the only input to the sim. M0 has the bare minimum; M1+ extends the union. */
export type Command = { type: 'noop' } | { type: 'surrender' };

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
