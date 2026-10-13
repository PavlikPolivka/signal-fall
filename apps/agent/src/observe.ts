import type { Role, Rules, StructureRule } from '@signal-fall/data';
import { FX_SHIFT, HARVEST, KIND, computeFacts, visibleTo, type World } from '@signal-fall/sim';
import type { AgentMatch } from './match';

/** Tile coordinates with one decimal: what agents read and write. */
const tile = (q10: number) => Math.round((q10 / (1 << FX_SHIFT)) * 10) / 10;
const hpPct = (hp: number, max: number) => Math.max(1, Math.round((100 * hp) / Math.max(1, max)));

export function roleName(rules: Rules, faction: number, role: Role): string {
  const f = rules.factions[faction]!;
  for (const s of f.structures) if (rules.structures[s]!.role === role) return rules.structures[s]!.id;
  return role;
}

function unitStatus(world: World, s: number): string {
  const e = world.entities;
  const order = e.orders[s]?.[0];
  if (e.hstate[s]! !== HARVEST.off) {
    const h = e.hstate[s]!;
    return h === HARVEST.harvesting ? 'harvesting' : h === HARVEST.toRefinery || h === HARVEST.unloading || h === HARVEST.waiting ? 'returning cargo' : h === HARVEST.hiding ? 'fleeing' : 'to field';
  }
  if (!order) return e.target[s]! >= 0 ? 'fighting' : 'idle';
  switch (order.type) {
    case 'move':
      return 'moving';
    case 'attackMove':
      return 'attack-moving';
    case 'attack':
      return 'attacking';
    case 'patrol':
      return 'patrolling';
    case 'guard':
      return 'guarding';
    case 'salvage':
      return 'salvaging';
  }
}

export interface Observation {
  match: string;
  tick: number;
  time: string;
  result: string;
  you: {
    seat: number;
    faction: string;
    team: number;
    credits: number;
    power: { produced: number; used: number; low: boolean };
    harvested: number;
    unit_cap: string;
  };
  players: { seat: number; faction: string; team: number; controller: string; defeated: boolean }[];
  map: { width: number; height: number; starts: { seat: number; x: number; y: number }[] };
  structures: { id: number; type: string; x: number; y: number; hp: number; rally?: [number, number]; repairing?: boolean }[];
  units: { id: number; type: string; x: number; y: number; hp: number; status: string; rank?: number; cargo?: number }[];
  queues: Record<string, unknown>;
  can_build: { structures: string[]; defenses: string[]; units: string[]; research: string[] };
  locked: Record<string, string>;
  enemies: { id: number; seat: number; type: string; x: number; y: number; hp: number }[];
  remembered_enemy_structures: { id: number; seat: number; type: string; x: number; y: number; seen_at: number }[];
  echo_fields: { x: number; y: number; amount: number }[];
  notes: string[];
}

/** Everything one seat may know: its own forces in full, enemies only where its team can see. */
export function observe(match: AgentMatch, seat: number): Observation {
  const sim = match.sim;
  const w = sim.world;
  const rules = w.rules;
  const e = w.entities;
  const me = w.players[seat]!;
  const faction = rules.factions[me.faction]!;
  const facts = computeFacts(w)[seat]!;
  const has = (r: Role) => (facts.roles.get(r) ?? 0) > 0;
  const missing = (requires: readonly Role[]) => requires.filter((r) => !has(r)).map((r) => roleName(rules, me.faction, r));

  const structures: Observation['structures'] = [];
  const units: Observation['units'] = [];
  const enemies: Observation['enemies'] = [];
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const owner = e.owner[s]!;
    const kind = e.kind[s]!;
    if (kind !== KIND.unit && kind !== KIND.structure) continue;
    const id = e.handle(s);
    const rule = kind === KIND.unit ? rules.units[e.type[s]!]! : rules.structures[e.type[s]!]!;
    const x = kind === KIND.structure ? e.tileX[s]! + (rule as StructureRule).footprintW / 2 : tile(e.x[s]!);
    const y = kind === KIND.structure ? e.tileY[s]! + (rule as StructureRule).footprintH / 2 : tile(e.y[s]!);
    const hp = hpPct(e.hp[s]! + e.shields[s]!, e.maxHp[s]! + e.maxShields[s]!);
    if (owner === seat) {
      if (kind === KIND.structure) {
        const st: Observation['structures'][number] = { id, type: rule.id, x, y, hp };
        if (e.rallyX[s]! >= 0) st.rally = [tile(e.rallyX[s]!), tile(e.rallyY[s]!)];
        if (e.repairing[s]) st.repairing = true;
        structures.push(st);
      } else {
        const u: Observation['units'][number] = { id, type: rule.id, x, y, hp, status: unitStatus(w, s) };
        if (e.rank[s]) u.rank = e.rank[s]!;
        if (e.cargo[s]) u.cargo = e.cargo[s]!;
        units.push(u);
      }
    } else if (w.players[owner]!.team !== me.team && visibleTo(w, seat, s)) {
      enemies.push({ id, seat: owner, type: rule.id, x, y, hp });
    }
  }

  // Queues: what is being built, and whether a finished structure waits to be placed.
  const queues: Record<string, unknown> = {};
  (['structures', 'defenses'] as const).forEach((cat, i) => {
    const q = me.build[i]!;
    if (q.item < 0) return;
    const r = rules.structures[q.item]!;
    queues[cat] = q.ready ? { item: r.id, ready: true, hint: `place it: {"do":"place","what":"${r.id}"}` } : { item: r.id, progress: Math.round((100 * q.progress) / Math.max(1, r.buildTicks)) };
  });
  (['infantry', 'vehicles', 'air'] as const).forEach((tab, i) => {
    const q = me.production[i]!;
    if (q.items.length === 0) return;
    const first = rules.units[q.items[0]!]!;
    queues[tab] = { items: q.items.map((u) => rules.units[u]!.id), progress: Math.round((100 * q.progress) / Math.max(1, first.buildTicks)) };
  });
  if (me.research.item >= 0) {
    const u = rules.upgrades[me.research.item]!;
    queues.research = { item: u.id, progress: Math.round((100 * me.research.progress) / Math.max(1, u.researchTicks)) };
  }

  // What can be started now; what is locked and why.
  const can_build: Observation['can_build'] = { structures: [], defenses: [], units: [], research: [] };
  const locked: Record<string, string> = {};
  const conyard = has('conyard');
  for (const si of faction.structures) {
    const r = rules.structures[si]!;
    if (!r.category) continue;
    const miss = missing(r.requires);
    if (!conyard) locked[r.id] = 'needs a construction yard (deploy your construction vehicle)';
    else if (miss.length) locked[r.id] = `needs ${miss.join(', ')}`;
    else can_build[r.category].push(r.id);
  }
  for (const ui of faction.units) {
    const r = rules.units[ui]!;
    const miss = missing(r.requires);
    if (miss.length) locked[r.id] = `needs ${miss.join(', ')}`;
    else can_build.units.push(r.id);
  }
  rules.upgrades.forEach((u) => {
    if ((u.faction !== -1 && u.faction !== me.faction) || me.upgrades[u.index]) return;
    const miss = missing(u.requires);
    const prior = u.requiresUpgrade && !me.upgrades[rules.upgrades.find((x) => x.id === u.requiresUpgrade)!.index] ? u.requiresUpgrade : null;
    if (miss.length || prior) locked[u.id] = `needs ${[...miss, ...(prior ? [prior] : [])].join(', ')}`;
    else can_build.research.push(u.id);
  });

  // Echo: coarse clusters over tiles this side has explored, richest first.
  const echo_fields: Observation['echo_fields'] = [];
  const cell = 8;
  const fog = w.fog[seat]!;
  const m = w.map;
  for (let cy = 0; cy < m.height; cy += cell)
    for (let cx = 0; cx < m.width; cx += cell) {
      let amount = 0;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = cy; y < Math.min(m.height, cy + cell); y++)
        for (let x = cx; x < Math.min(m.width, cx + cell); x++) {
          const i = y * m.width + x;
          if (!fog[i] || !m.echo[i]) continue;
          amount += m.echo[i]!;
          sx += x;
          sy += y;
          n++;
        }
      if (n) echo_fields.push({ x: Math.round(sx / n), y: Math.round(sy / n), amount });
    }
  echo_fields.sort((a, b) => b.amount - a.amount);

  const notes: string[] = [];
  if (!conyard && units.some((u) => u.type === rules.units[faction.constructionUnit]!.id))
    notes.push(`Deploy your construction vehicle first: {"do":"deploy","units":[<${rules.units[faction.constructionUnit]!.id} id>]}`);
  if (me.lowPower) notes.push('Low power: production is slow and defenses are weak. Build power.');
  for (const [cat, q] of Object.entries(queues)) if ((q as { ready?: boolean }).ready) notes.push(`A finished ${cat.slice(0, -1)} is waiting to be placed.`);

  const secs = Math.floor(sim.tick / rules.constants.tickRate);
  match.lastObserved[seat] = sim.tick;
  return {
    match: match.id,
    tick: sim.tick,
    time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
    result: match.result(seat),
    you: {
      seat,
      faction: faction.id,
      team: me.team,
      credits: me.credits,
      power: { produced: me.powerProduced, used: me.powerUsed, low: me.lowPower },
      harvested: me.harvested,
      unit_cap: `${facts.units}/${rules.constants.unitCap}`,
    },
    players: w.players.map((p, k) => {
      const seatSpec = match.options.seats[k]!;
      return {
        seat: k,
        faction: rules.factions[p.faction]!.id,
        team: p.team,
        controller: seatSpec.kind === 'ai' ? `built-in AI (${seatSpec.difficulty})` : `agent: ${seatSpec.agent.name}`,
        defeated: p.defeated,
      };
    }),
    map: { width: m.width, height: m.height, starts: match.extras.starts.map((s, k) => ({ seat: k, x: s.x, y: s.y })) },
    structures,
    units,
    queues,
    can_build,
    locked,
    enemies,
    remembered_enemy_structures: [...match.memory[seat]!.values()]
      .filter((r) => !enemies.some((x) => x.id === r.id))
      .map((r) => ({ id: r.id, seat: r.owner, type: rules.structures[r.type]!.id, x: r.x, y: r.y, seen_at: r.tick })),
    echo_fields: echo_fields.slice(0, 12),
    notes,
  };
}
