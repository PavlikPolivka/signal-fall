import type { Rules } from '@signal-fall/data';
import { CommandQueue, type ScheduledCommand } from './commands';
import { IntWriter } from './hash';
import { createWorld, serializeWorld, type PlayerSetup, type World } from './world';

export interface SimSetup {
  rules: Rules;
  seed: number;
  width: number;
  height: number;
  players: PlayerSetup[];
}

/** Ticks between state hashes exchanged in lockstep. */
export const HASH_INTERVAL = 20;

export class Sim {
  readonly world: World;
  private readonly queue = new CommandQueue();
  private readonly writer = new IntWriter();

  constructor(setup: SimSetup) {
    this.world = createWorld(setup.rules, setup.seed, setup.width, setup.height, setup.players);
  }

  get tick(): number {
    return this.world.tick;
  }

  schedule(c: ScheduledCommand): void {
    if (c.tick < this.world.tick) throw new Error(`command for past tick ${c.tick} (now ${this.world.tick})`);
    if (c.player < 0 || c.player >= this.world.players.length) throw new Error(`bad player ${c.player}`);
    this.queue.push(c);
  }

  /** Advance one tick: apply this tick's commands, then run systems in fixed order. */
  step(): void {
    const w = this.world;
    for (const c of this.queue.take(w.tick)) applyCommand(w, c);
    // Systems are added here in later milestones, always in this fixed order:
    // production -> economy -> pathing -> movement -> combat -> deaths -> fog -> victory.
    w.tick++;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** xxhash32 of the serialized state. */
  hash(): number {
    this.writer.reset();
    serializeWorld(this.world, this.writer);
    return this.writer.hash();
  }
}

function applyCommand(w: World, c: ScheduledCommand): void {
  const player = w.players[c.player]!;
  switch (c.cmd.type) {
    case 'noop':
      return;
    case 'surrender':
      player.surrendered = true;
      player.defeated = true;
      return;
  }
}
