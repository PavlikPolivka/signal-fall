import { describe, expect, it } from 'vitest';
import holdout from '../json/holdout.json';
import {
  ARMOR,
  DAMAGE,
  FX_ONE,
  bundledRaw,
  defaultRules,
  factionSchema,
  validateRaw,
} from '../src/index';

describe('bundled data', () => {
  it('parses and passes cross-reference validation', () => {
    expect(() => bundledRaw()).not.toThrow();
  });

  it('compiles to integer-only rules', () => {
    const rules = defaultRules();
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') expect(Number.isInteger(v), path).toBe(true);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v instanceof Map) return;
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(rules, 'rules');
  });

  it('has three factions with full rosters', () => {
    const rules = defaultRules();
    expect(rules.factions.map((f) => f.id)).toEqual(['holdout', 'halcyon', 'choir']);
    expect(rules.units).toHaveLength(12 + 11 + 11);
    for (const f of rules.factions) expect(f.structures).toHaveLength(13);
  });

  it('converts units to fixed point and ticks', () => {
    const rules = defaultRules();
    const grunt = rules.units[rules.unitIndex.get('grunt')!]!;
    expect(grunt.weapon?.range).toBe(4 * FX_ONE);
    expect(grunt.weapon?.cooldown).toBe(12); // 0.6 s at 20 ticks/s
    expect(grunt.buildTicks).toBe(80);
    expect(grunt.speed).toBe(Math.round((1.6 * FX_ONE) / 20));
  });

  it('builds the damage matrix in DAMAGE x ARMOR order', () => {
    const m = defaultRules().damageMatrix;
    expect(m).toHaveLength(DAMAGE.length * ARMOR.length);
    const at = (d: (typeof DAMAGE)[number], a: (typeof ARMOR)[number]) =>
      m[DAMAGE.indexOf(d) * ARMOR.length + ARMOR.indexOf(a)];
    expect(at('kinetic', 'light')).toBe(100);
    expect(at('flak', 'air')).toBe(150);
    expect(at('siege', 'structure')).toBe(150);
    expect(at('explosive', 'air')).toBe(0);
  });
});

describe('validation catches mistakes', () => {
  it('rejects duplicate hotkeys within a tab', () => {
    const raw = bundledRaw();
    const f = structuredClone(raw.factions[0]!);
    f.units[1]!.key = f.units[0]!.key; // tankbuster -> G, same tab as grunt
    const errors = validateRaw({ ...raw, factions: [f, ...raw.factions.slice(1)] });
    expect(errors.some((e) => e.includes('hotkey infantry:G'))).toBe(true);
  });

  it('rejects a unit that does not require its producer', () => {
    const raw = bundledRaw();
    const f = structuredClone(raw.factions[0]!);
    f.units[0]!.requires = [];
    expect(validateRaw({ ...raw, factions: [f, ...raw.factions.slice(1)] }).join()).toContain('must require barracks');
  });

  it('schema rejects unknown fields and bad values', () => {
    const bad = structuredClone(holdout) as Record<string, unknown> & { units: Record<string, unknown>[] };
    bad.units[0]!.armour = 'light';
    expect(factionSchema.safeParse(bad).success).toBe(false);
    const bad2 = structuredClone(holdout) as typeof holdout;
    bad2.units[0]!.cost = -5;
    expect(factionSchema.safeParse(bad2).success).toBe(false);
  });
});
