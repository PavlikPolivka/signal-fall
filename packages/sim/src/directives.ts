import type { World } from './world';

/**
 * A player's standing plan for an autopilot (an AI agent's "hands"): what to build, what army
 * to keep, when and where to fight. Plain data, set with the `directives` command and kept in
 * the player state, so replays and lockstep reproduce it exactly. Ids are rule ids of the
 * player's faction; coordinates are tiles. Missing fields keep the autopilot's defaults.
 */
export interface Directives {
  /** Structures to have, in order; repeat an id for more than one. Power is added when needed. */
  build?: string[];
  /** Defenses to have, in order. */
  defenses?: string[];
  /** Army composition: [unit id, weight 0..100]. */
  army?: [string, number][];
  /** Adapt the army mix to counter what the enemy fields (default true). */
  adapt?: boolean;
  harvestersPerRefinery?: number;
  maxRefineries?: number;
  /** Upgrades to research, in order. */
  research?: string[];
  /** defend: keep the army home. attack: send waves once the army is worth `attackAt` credits. all_in: send everything now. */
  posture?: 'defend' | 'attack' | 'all_in';
  attackAt?: number;
  /** Where waves go; null: the nearest enemy structure we know of. */
  target?: [number, number] | null;
  /** Where new units gather; null: in front of the base. */
  rally?: [number, number] | null;
  scout?: boolean;
  harass?: boolean;
}

const MAX_LIST = 24;

function ids(list: unknown, ok: (id: string) => boolean): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: string[] = [];
  for (const v of list) if (typeof v === 'string' && ok(v) && out.length < MAX_LIST) out.push(v);
  return out;
}

function int(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v | 0)) : undefined;
}

function tile(world: World, v: unknown): [number, number] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const x = int(v[0], 0, world.map.width - 1);
  const y = int(v[1], 0, world.map.height - 1);
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** Keep only what is valid for this player's faction (commands come from untrusted clients). */
export function sanitizeDirectives(world: World, player: number, d: unknown): Directives {
  if (typeof d !== 'object' || d === null) return {};
  const raw = d as Record<string, unknown>;
  const rules = world.rules;
  const faction = rules.factions[world.players[player]!.faction]!;
  const hasStructure = (category: 'structures' | 'defenses') => (id: string) => {
    for (const i of faction.structures) if (rules.structures[i]!.id === id && rules.structures[i]!.category === category) return true;
    return false;
  };
  const hasUnit = (id: string) => {
    for (const i of faction.units) if (rules.units[i]!.id === id) return true;
    return false;
  };
  const hasUpgrade = (id: string) => {
    for (const u of rules.upgrades) if (u.id === id && (u.faction === -1 || u.faction === faction.index)) return true;
    return false;
  };
  const out: Directives = {};
  const build = ids(raw.build, hasStructure('structures'));
  if (build) out.build = build;
  const defenses = ids(raw.defenses, hasStructure('defenses'));
  if (defenses) out.defenses = defenses;
  if (Array.isArray(raw.army)) {
    const army: [string, number][] = [];
    for (const pair of raw.army)
      if (Array.isArray(pair) && typeof pair[0] === 'string' && hasUnit(pair[0]) && army.length < MAX_LIST) {
        const w = int(pair[1], 0, 100);
        if (w !== undefined) army.push([pair[0], w]);
      }
    out.army = army;
  }
  if (typeof raw.adapt === 'boolean') out.adapt = raw.adapt;
  const hpr = int(raw.harvestersPerRefinery, 0, 4);
  if (hpr !== undefined) out.harvestersPerRefinery = hpr;
  const mr = int(raw.maxRefineries, 1, 6);
  if (mr !== undefined) out.maxRefineries = mr;
  const research = ids(raw.research, hasUpgrade);
  if (research) out.research = research;
  if (raw.posture === 'defend' || raw.posture === 'attack' || raw.posture === 'all_in') out.posture = raw.posture;
  const at = int(raw.attackAt, 0, 100_000);
  if (at !== undefined) out.attackAt = at;
  const target = tile(world, raw.target);
  if (target !== undefined) out.target = target;
  const rally = tile(world, raw.rally);
  if (rally !== undefined) out.rally = rally;
  if (typeof raw.scout === 'boolean') out.scout = raw.scout;
  if (typeof raw.harass === 'boolean') out.harass = raw.harass;
  return out;
}
