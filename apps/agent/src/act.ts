import type { StructureRule } from '@signal-fall/data';
import { FX_SHIFT, KIND, STANCE, placementError, worldPlacementView, type Command, type World } from '@signal-fall/sim';

/**
 * An agent's action, in the vocabulary of the observation: entity ids, rule ids
 * ("bulldog", "bell") and tile coordinates. Unit lists may be ids or a selector:
 * "army" (all armed units), "idle_army", "harvesters", or "type:<unit id>".
 */
export type Action =
  | { do: 'build'; what: string }
  | { do: 'place'; what: string; at?: [number, number] }
  | { do: 'cancel_build'; category: 'structures' | 'defenses' }
  | { do: 'train'; what: string; count?: number }
  | { do: 'cancel_train'; what: string }
  | { do: 'research'; what: string }
  | { do: 'cancel_research' }
  | { do: 'move' | 'attack_move' | 'patrol'; units: Units; to: [number, number]; queue?: boolean }
  | { do: 'attack' | 'guard'; units: Units; target: number; queue?: boolean }
  | { do: 'stop' | 'scatter' | 'hold' | 'deploy'; units: Units }
  | { do: 'stance'; units: Units; stance: 'guard' | 'hold' | 'aggressive' | 'hold_fire' }
  | { do: 'harvest'; units: Units; at: [number, number] }
  | { do: 'salvage'; units: Units; target: number }
  | { do: 'ability'; units: Units; at?: [number, number]; target?: number }
  | { do: 'rally'; building: number; to: [number, number] }
  | { do: 'sell' | 'repair'; building: number }
  | { do: 'surrender' };

export type Units = number[] | string;

const q10 = (t: number) => Math.round(t * (1 << FX_SHIFT));

function own(world: World, seat: number, id: number, kind?: number): boolean {
  const e = world.entities;
  const slot = id & 0xffff;
  return Number.isInteger(id) && slot < e.high && e.alive[slot] === 1 && e.handle(slot) === id && e.owner[slot] === seat && (kind === undefined || e.kind[slot] === kind);
}

/** Resolve ids or a selector to this seat's living units. */
export function resolveUnits(world: World, seat: number, units: Units): number[] {
  const e = world.entities;
  if (Array.isArray(units)) return units.filter((id) => own(world, seat, id, KIND.unit));
  const out: number[] = [];
  const harvester = world.rules.factions[world.players[seat]!.faction]!.harvester;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.owner[s] !== seat) continue;
    const rule = world.rules.units[e.type[s]!]!;
    const armed = !!rule.weapon && rule.index !== harvester;
    const pick =
      units === 'army'
        ? armed
        : units === 'idle_army'
          ? armed && (e.orders[s]?.length ?? 0) === 0 && e.target[s]! < 0
          : units === 'harvesters'
            ? rule.index === harvester
            : units.startsWith('type:')
              ? rule.id === units.slice(5)
              : false;
    if (pick) out.push(e.handle(s));
  }
  return out;
}

/** A free spot for `rule` near (ax, ay), or near the construction yard. */
export function findSpot(world: World, seat: number, rule: StructureRule, near?: [number, number]): { tx: number; ty: number } | null {
  const e = world.entities;
  const faction = world.rules.factions[world.players[seat]!.faction]!;
  let ax = near?.[0];
  let ay = near?.[1];
  if (ax === undefined || ay === undefined) {
    for (let s = 0; s < e.high; s++)
      if (e.alive[s] === 1 && e.owner[s] === seat && e.kind[s] === KIND.structure && world.rules.structures[e.type[s]!]!.role === 'conyard') {
        ax = e.tileX[s]! + 1;
        ay = e.tileY[s]! + 1;
        break;
      }
  }
  if (ax === undefined || ay === undefined) return null;
  const view = worldPlacementView(world, seat);
  for (let r = 0; r <= 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = Math.round(ax) + dx - (rule.footprintW >> 1);
        const ty = Math.round(ay) + dy - (rule.footprintH >> 1);
        if (placementError(view, seat, faction, rule, tx, ty) === null) return { tx, ty };
      }
  return null;
}

/** Translate and check one action. Returns the sim command, or why it was refused. */
export function translate(world: World, seat: number, a: Action): { cmd: Command } | { error: string } {
  const rules = world.rules;
  const player = world.players[seat]!;
  const faction = rules.factions[player.faction]!;
  const structure = (id: string) => faction.structures.map((i) => rules.structures[i]!).find((r) => r.id === id && r.category);
  const unit = (id: string) => faction.units.map((i) => rules.units[i]!).find((r) => r.id === id);
  const units = (u: Units) => {
    const list = resolveUnits(world, seat, u);
    return list.length ? list : null;
  };
  const point = (p: [number, number] | undefined) =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) && p[0] >= 0 && p[1] >= 0 && p[0] < world.map.width && p[1] < world.map.height
      ? { x: q10(p[0]), y: q10(p[1]) }
      : null;
  const noUnits = { error: 'none of those units are yours and alive' };

  switch (a.do) {
    case 'build': {
      const r = structure(a.what);
      return r ? { cmd: { type: 'build', category: r.category!, item: r.index } } : { error: `"${a.what}" is not a ${faction.id} structure or defense` };
    }
    case 'place': {
      const r = structure(a.what);
      if (!r) return { error: `"${a.what}" is not a ${faction.id} structure or defense` };
      const q = player.build[r.category === 'structures' ? 0 : 1]!;
      if (q.item !== r.index || !q.ready) return { error: `no finished ${r.id} waiting to be placed` };
      const spot = findSpot(world, seat, r, a.at);
      return spot ? { cmd: { type: 'place', category: r.category!, tx: spot.tx, ty: spot.ty } } : { error: `no room to place ${r.id} there` };
    }
    case 'cancel_build':
      return { cmd: { type: 'cancelBuild', category: a.category } };
    case 'train': {
      const r = unit(a.what);
      const count = Math.max(1, Math.min(15, Math.floor(a.count ?? 1)));
      return r ? { cmd: { type: 'train', item: r.index, count } } : { error: `"${a.what}" is not a ${faction.id} unit` };
    }
    case 'cancel_train': {
      const r = unit(a.what);
      return r ? { cmd: { type: 'cancelTrain', item: r.index } } : { error: `"${a.what}" is not a ${faction.id} unit` };
    }
    case 'research': {
      const u = rules.upgrades.find((x) => x.id === a.what && (x.faction === -1 || x.faction === player.faction));
      return u ? { cmd: { type: 'research', upgrade: u.index } } : { error: `"${a.what}" is not an upgrade ${faction.id} can research` };
    }
    case 'cancel_research':
      return { cmd: { type: 'cancelResearch' } };
    case 'move':
    case 'attack_move':
    case 'patrol': {
      const list = units(a.units);
      const p = point(a.to);
      if (!list) return noUnits;
      if (!p) return { error: 'to must be [x, y] inside the map' };
      const type = a.do === 'attack_move' ? 'attackMove' : a.do;
      return { cmd: { type, units: list, x: p.x, y: p.y, queue: a.queue } };
    }
    case 'attack':
    case 'guard': {
      const list = units(a.units);
      if (!list) return noUnits;
      const slot = a.target & 0xffff;
      const e = world.entities;
      if (!Number.isInteger(a.target) || slot >= e.high || e.alive[slot] !== 1 || e.handle(slot) !== a.target) return { error: 'target is not a living entity id' };
      return { cmd: { type: a.do, units: list, target: a.target, queue: a.queue } };
    }
    case 'stop':
    case 'scatter':
    case 'hold':
    case 'deploy': {
      const list = units(a.units);
      return list ? { cmd: { type: a.do, units: list } } : noUnits;
    }
    case 'stance': {
      const list = units(a.units);
      const stance = { guard: STANCE.guard, hold: STANCE.hold, aggressive: STANCE.aggressive, hold_fire: STANCE.holdFire }[a.stance];
      if (!list) return noUnits;
      return stance === undefined ? { error: 'stance is guard, hold, aggressive or hold_fire' } : { cmd: { type: 'stance', units: list, stance } };
    }
    case 'harvest': {
      const list = units(a.units);
      const p = point(a.at);
      if (!list) return noUnits;
      return p ? { cmd: { type: 'harvest', units: list, x: p.x, y: p.y } } : { error: 'at must be [x, y] inside the map' };
    }
    case 'salvage': {
      const list = units(a.units);
      return list ? { cmd: { type: 'salvage', units: list, target: a.target } } : noUnits;
    }
    case 'ability': {
      const list = units(a.units);
      if (!list) return noUnits;
      const p = a.at ? point(a.at) : null;
      return { cmd: { type: 'ability', units: list, x: p?.x, y: p?.y, target: a.target } };
    }
    case 'rally': {
      const p = point(a.to);
      if (!own(world, seat, a.building, KIND.structure)) return { error: 'building is not one of your structures' };
      return p ? { cmd: { type: 'rally', target: a.building, x: p.x, y: p.y } } : { error: 'to must be [x, y] inside the map' };
    }
    case 'sell':
    case 'repair':
      return own(world, seat, a.building, KIND.structure) ? { cmd: { type: a.do, target: a.building } } : { error: 'building is not one of your structures' };
    case 'surrender':
      return { cmd: { type: 'surrender' } };
    default:
      return { error: `unknown action "${(a as { do?: string }).do}"` };
  }
}
