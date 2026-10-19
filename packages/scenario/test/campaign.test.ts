import { describe, expect, it } from 'vitest';
import { defaultRules } from '@signal-fall/data';
import { MARKER, missionMarkers } from '@signal-fall/sim';
import { CAMPAIGNS, createSim, MISSIONS } from '../src';

describe('campaign', () => {
  it('campaigns: unique mission ids, and every act a mission names exists', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAMPAIGNS) for (const m of c.missions) expect(m.act >= 1 && m.act <= c.acts.length, `${c.id}/${m.id} act ${m.act}`).toBe(true);
  });

  it('every unit a mission spawns exists (an unknown id would silently spawn nothing)', () => {
    const r = defaultRules();
    const unknown: string[] = [];
    for (const m of MISSIONS)
      for (const t of m.triggers) for (const a of t.actions) if (a.kind === 'spawn' && !r.unitIndex.has(a.unit)) unknown.push(`${m.id}: ${a.unit}`);
    expect(unknown).toEqual([]);
  });

  it('everything a mission lets you build can actually be built there', () => {
    const r = defaultRules();
    const problems: string[] = [];
    for (const m of MISSIONS) {
      const seat = m.seats[0]!;
      const f = r.factions[seat.faction]!;
      if (!m.allow) continue;
      const allowed = new Set(m.allow);
      const roles = new Set<string>(seat.start === 'base' ? ['conyard', 'power', 'refinery', 'barracks', 'defense'] : []);
      // A starting construction vehicle deploys into a yard.
      if (seat.start === 'vehicle') roles.add('conyard');
      for (let changed = true; changed; ) {
        changed = false;
        for (const i of f.structures) {
          const s = r.structures[i]!;
          if (allowed.has(s.id) && !roles.has(s.role) && s.requires.every((q) => roles.has(q))) {
            roles.add(s.role);
            changed = true;
          }
        }
      }
      for (const id of allowed) {
        const ui = r.unitIndex.get(id);
        const si = r.structureIndex.get(id);
        // The construction vehicle is listed so it may deploy; it isn't built in early missions.
        if (ui === f.constructionUnit) continue;
        const req = ui !== undefined ? r.units[ui]!.requires : si !== undefined ? r.structures[si]!.requires : null;
        if (!req) problems.push(`${m.id}: unknown id ${id}`);
        else if (req.some((q) => !roles.has(q))) problems.push(`${m.id}: ${id} needs ${req.filter((q) => !roles.has(q)).join(', ')}`);
      }
      // If you can lose a harvester, you can build another.
      if (allowed.has(r.units[f.harvester]!.id) || roles.has('refinery')) expect(roles.has('factory'), `${m.id}: no factory for harvesters`).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  it('Cut the Cable marks the three relays on the map', () => {
    const { sim } = createSim({ kind: 'mission', id: 'cut-the-cable', seed: 0 });
    for (let i = 0; i < 20; i++) sim.step();
    const targets = missionMarkers(sim.world).filter((k) => k.kind === MARKER.target && k.objective === 1);
    expect(targets).toHaveLength(3);
  });

  it('waves grow each time and scale with the difficulty', () => {
    const count = (difficulty: 'story' | 'normal' | 'hard') => {
      const { sim } = createSim({ kind: 'mission', id: 'dead-air', seed: 0, difficulty });
      const w = sim.world;
      const enemies = () => {
        let n = 0;
        for (let s = 0; s < w.entities.high; s++) if (w.entities.alive[s] === 1 && w.entities.owner[s] === 1) n++;
        return n;
      };
      const seen: number[] = [];
      for (const t of [76 * 20, 121 * 20, 166 * 20]) {
        while (sim.tick < t) sim.step();
        seen.push(enemies());
      }
      return seen;
    };
    const normal = count('normal');
    expect(normal[1]! - normal[0]!).toBeGreaterThan(normal[0]!);
    expect(count('hard')[0]).toBeGreaterThan(normal[0]!);
    expect(count('story')[0]).toBeLessThanOrEqual(normal[0]!);
  });
});
