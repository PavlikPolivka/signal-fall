import { ROLES, type Role, type Tab } from './schema';
import type { RawData } from './compile';

const PRODUCER: Record<Tab, Role> = { infantry: 'barracks', vehicles: 'factory', air: 'airfield' };
const PRODUCES: Partial<Record<Role, Tab>> = { barracks: 'infantry', factory: 'vehicles', airfield: 'air' };

/** Cross-reference checks the per-file schemas cannot express. Returns a list of problems. */
export function validateRaw(raw: RawData): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (ids.has(id)) err(`duplicate id "${id}" (${what})`);
    ids.add(id);
  };

  for (const f of raw.factions) {
    const where = (s: string) => `${f.id}: ${s}`;
    for (const s of f.structures) claim(s.id, where('structure'));
    for (const u of f.units) claim(u.id, where('unit'));

    for (const role of ROLES) {
      const n = f.structures.filter((s) => s.role === role).length;
      if (n !== 1) err(where(`expected exactly one ${role} structure, found ${n}`));
    }

    const structureKeys = new Map<string, string>();
    for (const s of f.structures) {
      if (s.role === 'conyard') {
        if (s.key || s.category) err(where(`conyard ${s.id} must not have a build key or category`));
        continue;
      }
      if (!s.key || !s.category) {
        err(where(`structure ${s.id} needs key and category`));
        continue;
      }
      const k = `${s.category}:${s.key}`;
      const prev = structureKeys.get(k);
      if (prev) err(where(`hotkey ${k} used by ${prev} and ${s.id}`));
      structureKeys.set(k, s.id);
      if (s.weapon && s.category !== 'defenses') err(where(`armed structure ${s.id} must be a defense`));
      const expected = PRODUCES[s.role];
      if ((s.produces ?? undefined) !== expected) err(where(`structure ${s.id} role ${s.role} should produce ${expected ?? 'nothing'}`));
    }

    const unitKeys = new Map<string, string>();
    for (const u of f.units) {
      const k = `${u.tab}:${u.key}`;
      const prev = unitKeys.get(k);
      if (prev) err(where(`hotkey ${k} used by ${prev} and ${u.id}`));
      unitKeys.set(k, u.id);
      if (!u.summoned && !u.requires.includes(PRODUCER[u.tab])) err(where(`unit ${u.id} must require ${PRODUCER[u.tab]}`));
      if (u.sprite && !f.units.some((o) => o.id === u.sprite)) err(where(`unit ${u.id} borrows art from unknown unit ${u.sprite}`));
      if (u.tier === 3 && !u.requires.includes('tech')) err(where(`tier 3 unit ${u.id} must require tech`));
      if (u.weapon?.targets === 'air' && u.weapon.type !== 'flak') err(where(`air-only weapon on ${u.id} should be flak`));
      if ((u.armor === 'air') !== (u.tab === 'air')) err(where(`unit ${u.id}: air armor iff air tab`));
    }

    const unit = (id: string) => f.units.find((u) => u.id === id);
    if (f.power?.kind === 'awaken' && !unit(f.power.unit)?.summoned) err(where(`Awaken unit ${f.power.unit} must be a summoned unit`));
    const conyard = f.structures.find((s) => s.role === 'conyard');
    const cu = unit(f.constructionUnit);
    const deploy = cu?.abilities.find((a) => a.kind === 'deploy');
    if (!cu) err(where(`construction unit ${f.constructionUnit} missing`));
    else if (!deploy || deploy.into !== conyard?.id) err(where(`construction unit must deploy into ${conyard?.id}`));
    if (!unit(f.harvester)?.abilities.some((a) => a.kind === 'harvest')) err(where(`harvester ${f.harvester} needs harvest ability`));
    if (!unit(f.engineer)?.abilities.some((a) => a.kind === 'engineer')) err(where(`engineer ${f.engineer} needs engineer ability`));
  }

  const upgradeIds = new Set(raw.upgrades.map((u) => u.id));
  for (const u of raw.upgrades) {
    claim(u.id, 'upgrade');
    if (u.requiresUpgrade && !upgradeIds.has(u.requiresUpgrade)) err(`upgrade ${u.id} requires unknown ${u.requiresUpgrade}`);
    if (u.excludes && !upgradeIds.has(u.excludes)) err(`upgrade ${u.id} excludes unknown ${u.excludes}`);
  }

  const seen = new Map<string, string>();
  for (const ctx of ['global', 'units', 'base'] as const) {
    for (const [action, chords] of Object.entries(raw.keymap[ctx])) {
      for (const chord of chords) {
        // units and base contexts are never active at the same time, but both share the global context.
        const scope = ctx === 'global' ? 'global' : ctx;
        const keys = scope === 'global' ? [`units|${chord}`, `base|${chord}`] : [`${scope}|${chord}`];
        for (const key of keys) {
          const prev = seen.get(key);
          if (prev) err(`keymap chord ${chord} bound to ${prev} and ${ctx}.${action}`);
          seen.set(key, `${ctx}.${action}`);
        }
      }
    }
  }

  return errors;
}
