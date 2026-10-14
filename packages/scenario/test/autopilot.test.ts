import { describe, expect, it } from 'vitest';
import { createSim, type ScenarioSpec } from '../src/index';

const map = { size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'normal' } as const;
const spec = (extra: Partial<Extract<ScenarioSpec, { kind: 'skirmish' }>> = {}): ScenarioSpec => ({
  kind: 'skirmish',
  seed: 21,
  factions: [0, 1],
  ai: [null, 'easy'],
  agents: [{ name: 'pilot', autopilot: true }, null],
  map,
  ...extra,
});

const structures = (sim: ReturnType<typeof createSim>['sim'], p: number) => {
  const e = sim.world.entities;
  const out: string[] = [];
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === p && e.kind[s] === 2) out.push(sim.world.rules.structures[e.type[s]!]!.id);
  return out;
};

describe('autopilot', () => {
  it('without directives it builds an economy and stays home', { timeout: 60_000 }, () => {
    const { sim } = createSim(spec());
    sim.run(5 * 1200);
    const mine = structures(sim, 0);
    expect(mine).toContain('holdfast');
    expect(mine).toContain('smelter');
    expect(sim.world.players[0]!.harvested).toBeGreaterThan(0);
  });

  it('follows directives sent as commands, and the match reproduces exactly', { timeout: 60_000 }, () => {
    const run = () => {
      const { sim } = createSim(spec());
      sim.schedule({
        tick: 0,
        player: 0,
        cmd: {
          type: 'directives',
          directives: {
            build: ['dynamo', 'smelter', 'bunkhouse', 'dynamo', 'motor_pool', 'smelter'],
            army: [['grunt', 30], ['bulldog', 70]],
            posture: 'attack',
            attackAt: 3000,
            harvestersPerRefinery: 2,
            // Junk is dropped by the sim, not trusted.
            ...({ nonsense: 1, research: ['not_an_upgrade'] } as object),
          },
        },
      });
      let maxStructures = 0;
      while (!sim.world.ended && sim.tick < 20 * 1200) {
        sim.run(200);
        maxStructures = Math.max(maxStructures, structures(sim, 0).length);
      }
      return { hash: sim.hash(), tick: sim.tick, winner: sim.world.winnerTeam, maxStructures, plan: sim.world.players[0]!.directives };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.plan?.research).toEqual([]);
    expect(a.maxStructures).toBeGreaterThanOrEqual(6);
    // A Hard-speed autopilot attacking with a tank army beats the Easy AI.
    expect(a.winner).toBe(0);
  });
});
