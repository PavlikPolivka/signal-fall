import { CommandQueue, type Command, type ScheduledCommand } from './commands';
import { IntWriter } from './hash';
import { applyCommand } from './orders';
import { behaviorSystem } from './systems/behavior';
import { deathSystem, projectileSystem, shieldSystem, weaponSystem } from './systems/combat';
import { fogSystem } from './systems/fog';
import { buildSystem, computeFacts, echoRegrowSystem, harvestSystem, productionSystem, repairSystem, wreckSystem } from './systems/economy';
import { movementSystem } from './systems/movement';
import { victorySystem } from './systems/victory';
import { abilitySystem, chordRegrowSystem, coverageSystem, researchSystem, sustainSystem } from './systems/faction';
import { createWorld, serializeWorld, type World, type WorldOptions } from './world';
import { autoPlaceSystem } from './orders';

export type SimSetup = WorldOptions;

/**
 * A deterministic computer player. It runs inside the sim on every peer (so it
 * needs no network input), reads the world and returns commands, which apply
 * on the next tick like any player's. Must only use integer math and its own
 * RNG stream (world.aiRng[player]).
 */
export interface Brain {
  readonly player: number;
  think(world: World): Command[];
}

/** Brains think every this many ticks (staggered by player). */
export const BRAIN_INTERVAL = 10;

/** Ticks between state hashes exchanged in lockstep. */
export const HASH_INTERVAL = 20;

export class Sim {
  readonly world: World;
  private readonly queue = new CommandQueue();
  private readonly writer = new IntWriter();
  private readonly brains: Brain[] = [];

  constructor(setup: SimSetup) {
    this.world = createWorld(setup);
    fogSystem(this.world, true);
  }

  get tick(): number {
    return this.world.tick;
  }

  addBrain(brain: Brain): void {
    this.brains.push(brain);
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
      const facts = computeFacts(w);
      buildSystem(w, facts);
      autoPlaceSystem(w);
      productionSystem(w, facts);
      researchSystem(w, facts);
      abilitySystem(w);
      coverageSystem(w);
      behaviorSystem(w);
      harvestSystem(w, facts);
      movementSystem(w);
      w.spatial.rebuild(w.entities);
      repairSystem(w);
      weaponSystem(w);
      projectileSystem(w);
      deathSystem(w);
      shieldSystem(w);
      sustainSystem(w);
      wreckSystem(w);
      echoRegrowSystem(w);
      chordRegrowSystem(w);
      fogSystem(w);
      victorySystem(w);
      for (const b of this.brains) {
        if (w.players[b.player]!.defeated || (w.tick + b.player) % BRAIN_INTERVAL !== 0) continue;
        for (const cmd of b.think(w)) this.queue.push({ tick: w.tick + 1, player: b.player, cmd });
      }
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
