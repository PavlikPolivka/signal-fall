import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { bigBattle, countUnits } from '../src/scenarios';

describe('performance', () => {
  it('400 units tick in at most 4 ms on average', () => {
    const { sim } = bigBattle(defaultRules(), { unitsPerSide: 200 });
    expect(countUnits(sim, 0) + countUnits(sim, 1)).toBeGreaterThan(380);
    sim.run(20); // warm up the JIT and the first flow fields
    const ticks = 400;
    const start = performance.now();
    sim.run(ticks);
    const avg = (performance.now() - start) / ticks;
    console.log(`400-unit battle: ${avg.toFixed(3)} ms/tick average`);
    expect(avg).toBeLessThanOrEqual(4);
  });
});
