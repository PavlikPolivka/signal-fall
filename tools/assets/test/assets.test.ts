import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PUBLIC = join(ROOT, 'apps/client/public/assets');
const rules = defaultRules();
/** Factions whose art is done; the rest still use placeholders (M7). */
const ARTED = ['holdout'];

function atlasFrames(faction: string): Set<string> {
  const dir = join(PUBLIC, 'sprites', faction);
  const names = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!/^atlas-\d+\.json$/.test(f)) continue;
    const sheet = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { frames: Record<string, unknown> };
    for (const k of Object.keys(sheet.frames)) names.add(k);
  }
  return names;
}

describe.each(ARTED)('%s art is complete', (factionId) => {
  const faction = rules.factions.find((f) => f.id === factionId)!;
  const catalog = JSON.parse(readFileSync(join(PUBLIC, 'sprites', factionId, 'catalog.json'), 'utf8')) as {
    sprites: Record<string, { kind: string; dirs: number; anims: Record<string, number>; turret: boolean }>;
  };
  const frames = atlasFrames(factionId);
  const pad = (d: number) => String(d).padStart(2, '0');

  it.each(faction.units.map((i) => rules.units[i]!.id))('unit %s has every direction and animation frame', (id) => {
    const s = catalog.sprites[id];
    expect(s, `no sprite for ${id}`).toBeDefined();
    expect(s!.dirs).toBeGreaterThanOrEqual(8);
    for (let d = 0; d < s!.dirs; d++) {
      for (const [anim, count] of Object.entries(s!.anims)) {
        for (let f = 0; f < count; f++) expect(frames.has(`${id}/hull/${anim}/${pad(d)}/${f}.color`), `${id} ${anim} d${d} f${f}`).toBe(true);
      }
      if (s!.turret) expect(frames.has(`${id}/turret/idle/${pad(d)}/0.color`)).toBe(true);
    }
    expect(existsSync(join(PUBLIC, 'icons', factionId, `${id}.png`))).toBe(true);
  });

  it.each(faction.structures.map((i) => rules.structures[i]!.id))('building %s has all states', (id) => {
    for (const state of ['built', 'damaged', 'construction']) expect(frames.has(`${id}/body/${state}/00/0.color`), `${id} ${state}`).toBe(true);
    const rule = rules.structures[rules.structureIndex.get(id)!]!;
    if (catalog.sprites[id]!.turret) for (let d = 0; d < 16; d++) expect(frames.has(`${id}/turret/idle/${pad(d)}/0.color`)).toBe(true);
    void rule;
    expect(existsSync(join(PUBLIC, 'icons', factionId, `${id}.png`))).toBe(true);
  });
});

describe('licenses', () => {
  it('every shipped asset has a license entry', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'assets/LICENSES.json'), 'utf8')) as {
      entries: { files: string; license: string; source: string; author: string }[];
    };
    for (const e of manifest.entries) {
      expect(e.license).toMatch(/^(CC0|CC-BY|OFL|MIT)/);
      expect(e.source.length).toBeGreaterThan(0);
    }
    const patterns = manifest.entries.map((e) => new RegExp(`^${e.files.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [relative(PUBLIC, p)];
      });
    const missing = walk(PUBLIC).filter((f) => !patterns.some((r) => r.test(f)));
    expect(missing).toEqual([]);
  });
});
