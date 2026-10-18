import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { canResearch, computeFacts, Sim, spawnStructure } from '../src/index';

const rules = defaultRules();

describe('doctrines', () => {
  it('researching one half of an either/or choice closes the other', () => {
    const s = new Sim({ rules, seed: 1, width: 32, height: 32, players: [{ faction: 0, team: 0 }, { faction: 1, team: 1 }], victoryRules: false });
    const holdout = rules.factions[0]!;
    // A tech center (and power for it), so research is open.
    for (const [role, x] of [['tech', 4], ['power', 12]] as const) spawnStructure(s.world, holdout.structures.find((i) => rules.structures[i]!.role === role)!, 0, x, 4);
    const a = rules.upgradeIndex.get('salvage_crews')!;
    const b = rules.upgradeIndex.get('reinforced_plating')!;
    expect(rules.upgrades[a]!.excludes).toBe('reinforced_plating');
    expect(canResearch(s.world, computeFacts(s.world)[0]!, 0, b)).toBe(true);
    s.world.players[0]!.upgrades[a] = 1;
    expect(canResearch(s.world, computeFacts(s.world)[0]!, 0, b)).toBe(false);
  });
});
