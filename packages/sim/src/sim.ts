import { CommandQueue, type ScheduledCommand } from './commands';
import { IntWriter } from './hash';
import { applyCommand } from './orders';
import { behaviorSystem } from './systems/behavior';
import { deathSystem, projectileSystem, shieldSystem, weaponSystem } from './systems/combat';
import { fogSystem } from './systems/fog';
import { movementSystem } from './systems/movement';
import { victorySystem } from './systems/victory';
import { createWorld, serializeWorld, type World, type WorldOptions } from './world';

export type SimSetup = WorldOptions;

/** Ticks between state hashes exchanged in lockstep. */
export const HASH_INTERVAL = 20;

export class Sim {
  readonly world: World;
  private readonly queue = new CommandQueue();
  private readonly writer = new IntWriter();

  constructor(setup: SimSetup) {
    this.world = createWorld(setup);
    fogSystem(this.world, true);
  }

  get tick(): number {
    return this.world.tick;
  }

  schedule(c: ScheduledCommand): void {
    if (c.tick < this.world.tick) throw new Error(`command for past tick ${c.tick} (now ${this.world.tick})`);
    if (c.player < 0 || c.player >= this.world.players.length) throw new Error(`bad player ${c.player}`);
    this.queue.push(c);
  }

  /** Advance one tick: apply this tick's commands, then run systems in a fixed order. */
  step(): void {
    const w = this.world;
    for (const c of this.queue.take(w.tick)) applyCommand(w, c);
    if (!w.ended) {
      w.spatial.rebuild(w.entities);
      behaviorSystem(w);
      movementSystem(w);
      w.spatial.rebuild(w.entities);
      weaponSystem(w);
      projectileSystem(w);
      deathSystem(w);
      shieldSystem(w);
      fogSystem(w);
      victorySystem(w);
    }
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
