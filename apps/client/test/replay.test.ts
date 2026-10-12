import { describe, expect, it } from 'vitest';
import { KIND, type ScheduledCommand } from '@signal-fall/sim';
import { createSim, parseReplay, runReplay, type Replay } from '../src/game/scenario';
import type { ScenarioSpec } from '../src/protocol';

const scenario: ScenarioSpec = {
  kind: 'skirmish',
  seed: 42,
  factions: [0, 2],
  ai: [null, 'normal'],
  map: { size: 'S', biome: 'city', resources: 'normal', terrain: 'normal' },
};

/** Play a match the way the worker does: player commands scheduled at their tick and logged. */
function record(ticks: number): Replay {
  const { sim } = createSim(scenario);
  const log: ScheduledCommand[] = [];
  const send = (c: ScheduledCommand['cmd']) => {
    const sc = { tick: sim.tick, player: 0, cmd: c };
    sim.schedule(sc);
    log.push(sc);
  };
  const own = (pred: (s: number) => boolean) => {
    const e = sim.world.entities;
    const out: number[] = [];
    for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === 0 && pred(s)) out.push(e.handle(s));
    return out;
  };
  while (sim.tick < ticks) {
    if (sim.tick === 20) send({ type: 'deploy', units: own((s) => sim.world.entities.kind[s] === KIND.unit) });
    if (sim.tick === 100) send({ type: 'build', category: 'structures', item: sim.world.rules.structureIndex.get('dynamo')! });
    if (sim.tick > 200 && sim.tick % 300 === 0)
      send({ type: 'move', units: own((s) => sim.world.entities.kind[s] === KIND.unit), x: (20 + (sim.tick % 40)) * 1024, y: 40 * 1024 });
    sim.step();
  }
  return { format: 'signal-fall-replay', version: 1, scenario, localPlayer: 0, commands: log, endTick: sim.tick, hash: sim.hash() };
}

describe('replays', () => {
  it('a recorded match replays to the exact same final state hash', () => {
    const replay = record(20 * 90);
    expect(replay.commands.length).toBeGreaterThan(3);
    // Through the file format, as a player would save and load it.
    const loaded = parseReplay(JSON.stringify(replay));
    expect(runReplay(loaded)).toBe(replay.hash);
  });

  it('a tampered replay does not reproduce', () => {
    const replay = record(20 * 30);
    const tampered = { ...replay, commands: replay.commands.slice(1) };
    expect(runReplay(tampered)).not.toBe(replay.hash);
  });

  it('rejects files that are not replays', () => {
    expect(() => parseReplay('{"hello": 1}')).toThrow('Not a Signal Fall replay');
  });
});
