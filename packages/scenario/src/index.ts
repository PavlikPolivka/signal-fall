import { defaultRules } from '@signal-fall/data';
import { Sim, TERRAIN_SPEED_PCT, createMatch, grantBase, sandbox, spawnStructure, spawnUnitAtTile, type MissionRuleAction, type MissionRuleObjective, type MissionRuleTrigger, type MissionRules, type ScheduledCommand } from '@signal-fall/sim';
import { MISSIONS, type MissionSpec, type PArea, type Pos } from './missions';
import { customToGenerated, decodeMap, generateMap, type Biome, type MapSize, type Resources, type TerrainStyle } from '@signal-fall/mapgen';
import { attachAi, HordeBrain, type Difficulty, type StrategyName } from '@signal-fall/ai';

/**
 * A seat played by an AI agent (an LLM or a program over the agent API) rather than a
 * person or the built-in AI. Shown in every view of the match, so nobody mistakes it
 * for a human player.
 */
export interface AgentSeat {
  /** Display name the agent chose. */
  name: string;
  /** Model or program behind it, if the agent says. */
  model?: string;
  /**
   * An autopilot carries out the agent's directives (build order, army mix, when to attack):
   * the built-in AI's hands at the given difficulty's speed (true: hard), without any income
   * bonus. Against a built-in AI, give it the same level, so only decisions differ. Without
   * it, the agent issues every unit order itself.
   */
  autopilot?: boolean | Difficulty;
}

/** A match to set up: map, sides, AI. Deterministic: the same spec always gives the same match. */
export type ScenarioSpec =
  | {
      kind: 'skirmish';
      seed: number;
      factions: number[];
      /** AI difficulty per player slot, null for the human. */
      ai: (Difficulty | null)[];
      /** Player slots controlled by people (multiplayer); others without AI get a passive base. */
      humans?: number[];
      /** Team per slot (2v2: [0, 0, 1, 1]); default: everyone on their own team. */
      teams?: number[];
      /** Seats played by AI agents (null elsewhere); they send commands like people do. */
      agents?: (AgentSeat | null)[];
      map: { size: MapSize; biome: Biome; resources: Resources; terrain: TerrainStyle; points?: 'none' | 'some'; crates?: boolean; hill?: boolean; custom?: string; credits?: number; superweapons?: boolean; techLimit?: boolean; unitCap?: number; startArmy?: boolean };
      /** AI personality per slot (a strategy it always plays); null or missing: drawn per match. */
      personality?: (StrategyName | null)[];
      /** Survival: the last slot is the horde, which sends waves at everyone else (they are one team). */
      survival?: 'easy' | 'normal' | 'hard';
      /** Lighting (cosmetic only: vision and the sim are the same at any time of day). */
      time?: 'day' | 'dusk' | 'night';
    }
  /** A campaign mission (see missions.ts). */
  | { kind: 'mission'; id: string; seed: number; difficulty?: CampaignDifficulty }
  | { kind: 'sandbox'; unitsPerSide: number; seed: number }
  | { kind: 'stress'; unitsPerSide: number; seed: number };

/** Campaign difficulty: scales scripted waves and moves enemy AIs a level down or up. */
export type CampaignDifficulty = 'story' | 'normal' | 'hard';
export const CAMPAIGN_WAVE_PCT: Record<CampaignDifficulty, number> = { story: 60, normal: 100, hard: 150 };
const AI_LEVELS: Difficulty[] = ['easy', 'normal', 'hard', 'brutal'];

export interface MapExtras {
  decoration: Uint8Array;
  surface: Uint8Array;
  landmark: Uint8Array;
  biome: Biome;
  mapSeed: number;
  /** Start position per player slot, in tiles. */
  starts: { x: number; y: number }[];
}

/** Build the sim for a scenario: map, players, AI brains. Deterministic: the same spec always gives the same match. */
export function createSim(spec: ScenarioSpec): { sim: Sim; extras: MapExtras } {
  const rules = defaultRules();
  switch (spec.kind) {
    case 'skirmish': {
      // A hand-made map (share code) or a generated one.
      // Survival: the horde (last slot) needs no start of its own; it gets the map center.
      const horde = spec.survival ? spec.factions.length - 1 : undefined;
      const players = horde !== undefined ? Math.max(2, horde) : spec.factions.length;
      const map = spec.map.custom ? customToGenerated(decodeMap(spec.map.custom)) : generateMap({ seed: spec.seed, players, ...spec.map });
      if (horde !== undefined) map.starts = [...map.starts.slice(0, horde), { x: map.width >> 1, y: map.height >> 1 }];
      const sim = createMatch({
        rules,
        seed: spec.seed,
        map,
        players: spec.factions.map((faction, k) => ({ faction, team: spec.teams?.[k] ?? k })),
        crates: spec.map.crates,
        survivalHorde: horde,
        survivalPct: spec.survival === 'easy' ? 70 : spec.survival === 'hard' ? 170 : 125,
        credits: spec.map.credits,
        noSuperweapons: spec.map.superweapons === false,
        techLimit: spec.map.techLimit,
        unitCap: spec.map.unitCap,
        startArmy: spec.map.startArmy,
      });
      if (horde !== undefined) sim.addBrain(new HordeBrain(horde));
      spec.ai.forEach((difficulty, p) => {
        if (p === horde) return;
        // A computer player without a difficulty is a passive base (sandbox/testing); people play their own.
        if (difficulty) attachAi(sim, p, difficulty, map.starts, { strategy: spec.personality?.[p] ?? undefined });
        else if (spec.agents?.[p]?.autopilot) {
          const level = spec.agents[p]!.autopilot;
          attachAi(sim, p, level === true ? 'hard' : (level as Difficulty), map.starts, { directed: true });
        }
        else if (p !== 0 && !spec.humans?.includes(p) && !spec.agents?.[p]) grantBase(sim, p, map.starts[p]!);
      });
      return {
        sim,
        extras: { decoration: map.decoration, surface: map.surface, landmark: map.landmark, biome: map.biome, mapSeed: map.seedUsed, starts: map.starts },
      };
    }
    case 'mission':
      return createMission(spec.id, spec.difficulty ?? 'normal');
    case 'sandbox':
    case 'stress': {
      const sim = sandbox(rules, { unitsPerSide: spec.unitsPerSide, seed: spec.seed });
      const n = sim.world.map.width * sim.world.map.height;
      return { sim, extras: { decoration: new Uint8Array(n), surface: new Uint8Array(n), landmark: new Uint8Array(n), biome: 'wasteland', mapSeed: spec.seed, starts: [] } };
    }
  }
}

/**
 * A recorded match: the scenario plus every player command with its tick.
 * AI players are part of the scenario and re-think identically on replay.
 */
export interface Replay {
  format: 'signal-fall-replay';
  version: 1;
  scenario: ScenarioSpec;
  localPlayer: number;
  commands: ScheduledCommand[];
  /** Last tick recorded and the state hash there: a replay must reach the same hash. */
  endTick: number;
  hash: number;
}

export function parseReplay(text: string): Replay {
  const r = JSON.parse(text) as Partial<Replay>;
  if (r.format !== 'signal-fall-replay' || r.version !== 1 || !r.scenario || !Array.isArray(r.commands)) throw new Error('Not a Signal Fall replay');
  return r as Replay;
}

/** Commands of a replay bucketed by tick, for feeding a sim tick by tick. */
export function commandsByTick(commands: ScheduledCommand[]): Map<number, ScheduledCommand[]> {
  const by = new Map<number, ScheduledCommand[]>();
  for (const c of commands) {
    const list = by.get(c.tick) ?? [];
    list.push(c);
    by.set(c.tick, list);
  }
  return by;
}

/**
 * Schedule a recorded or live command; a takeover also puts the built-in AI in charge of
 * that seat (deterministically, at that tick, on every machine and in every replay).
 */
export function scheduleCommand(sim: Sim, c: ScheduledCommand, starts: { x: number; y: number }[]): void {
  if (c.cmd.type === 'takeover') attachAi(sim, c.player, c.cmd.difficulty, starts);
  sim.schedule(c);
}

/** Play a replay headless to its end; returns the final hash (equal to replay.hash if it reproduces). */
export function runReplay(replay: Replay): number {
  const { sim, extras } = createSim(replay.scenario);
  const by = commandsByTick(replay.commands);
  while (sim.tick < replay.endTick) {
    for (const c of by.get(sim.tick) ?? []) scheduleCommand(sim, c, extras.starts);
    sim.step();
  }
  return sim.hash();
}

/** One sample of a player's match statistics. */
export interface StatPoint {
  /** Echo harvested so far (income). */
  income: number;
  credits: number;
  /** Cost of armed units alive. */
  army: number;
  units: number;
  structures: number;
  built: number;
  unitsLost: number;
  unitsKilled: number;
  structuresLost: number;
  structuresKilled: number;
  /** Production tabs (infantry, vehicles, air) with a factory standing but nothing queued. */
  idleTabs: number;
  valueLost: number;
  valueKilled: number;
}

/** Statistics over a match: one sample per player every `interval` ticks. */
export interface MatchStats {
  interval: number;
  players: { faction: number; team: number }[];
  samples: { tick: number; players: StatPoint[] }[];
  /** Orders given per player over the match (people only; the built-in AI's are not logged). */
  actions?: number[];
}

export const STATS_INTERVAL = 200;

/** Sample every player's statistics from the sim (read-only). */
export function sampleStats(world: import('@signal-fall/sim').World): StatPoint[] {
  const e = world.entities;
  const out: StatPoint[] = world.players.map((p) => ({
    income: p.harvested,
    credits: p.credits,
    army: 0,
    units: 0,
    structures: 0,
    built: p.trained.reduce((a, b) => a + b, 0),
    unitsLost: p.stats.unitsLost,
    unitsKilled: p.stats.unitsKilled,
    structuresLost: p.stats.structuresLost,
    structuresKilled: p.stats.structuresKilled,
    valueLost: p.stats.valueLost,
    valueKilled: p.stats.valueKilled,
    idleTabs: 0,
  }));
  // Which production tabs each player can use (a barracks, factory or airfield standing).
  const tabOf: Record<string, number> = { barracks: 0, factory: 1, airfield: 2 };
  const producers = world.players.map(() => [false, false, false]);
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const o = out[e.owner[s]!];
    if (!o) continue;
    if (e.kind[s] === 2) {
      o.structures++;
      const tab = tabOf[world.rules.structures[e.type[s]!]!.role];
      if (tab !== undefined) producers[e.owner[s]!]![tab] = true;
    }
    else if (e.kind[s] === 1) {
      o.units++;
      const rule = world.rules.units[e.type[s]!]!;
      if (rule.weapon) o.army += rule.cost;
    }
  }
  world.players.forEach((p, k) => {
    for (let tab = 0; tab < 3; tab++) if (producers[k]![tab] && p.production[tab]!.items.length === 0) out[k]!.idleTabs++;
  });
  return out;
}

/** Find a mission by id. */
export function missionById(id: string): MissionSpec {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error(`no mission ${id}`);
  return m;
}

/** Tiles reachable on foot from `from` (8 ways, like units move), as a 0/1 grid. */
export function walkableFrom(map: { width: number; height: number; terrain: Uint8Array }, from: { x: number; y: number }): Uint8Array {
  const w = map.width;
  const ok = (i: number) => (TERRAIN_SPEED_PCT[map.terrain[i]!] ?? 0) > 0;
  const seen = new Uint8Array(w * map.height);
  const start = from.y * w + from.x;
  const todo = [start];
  seen[start] = 1;
  while (todo.length > 0) {
    const t = todo.pop()!;
    const x = t % w;
    const y = Math.trunc(t / w);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
        const i = ny * w + nx;
        if (seen[i] || !ok(i)) continue;
        // No squeezing diagonally between two blocked tiles.
        if (dx !== 0 && dy !== 0 && !ok(y * w + nx) && !ok(ny * w + x)) continue;
        seen[i] = 1;
        todo.push(i);
      }
  }
  return seen;
}

/** The nearest tile to `p` in the reachable grid (ring by ring), or `p` itself when it already is. */
export function snapTo(reach: Uint8Array, w: number, h: number, p: { x: number; y: number }): { x: number; y: number } {
  if (reach[p.y * w + p.x]) return p;
  for (let r = 1; r < Math.max(w, h); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && reach[y * w + x]) return { x, y };
      }
  return p;
}

/** A mission's match: its map, seats, preset forces, objectives and triggers. */
function createMission(id: string, difficulty: CampaignDifficulty): { sim: Sim; extras: MapExtras } {
  const rules = defaultRules();
  const m = missionById(id);
  const pct = CAMPAIGN_WAVE_PCT[difficulty];
  // Enemy waves scale with the difficulty (never below one unit); the player's own reinforcements don't.
  const scale = (n: number, player: number) => (player === 0 || m.seats[player]?.team === m.seats[0]!.team ? n : Math.max(1, Math.round((n * pct) / 100)));
  const shift = difficulty === 'story' ? -1 : difficulty === 'hard' ? 1 : 0;
  const enemyAi = (k: number, level: Difficulty) =>
    m.seats[k]!.team === m.seats[0]!.team ? level : AI_LEVELS[Math.max(0, Math.min(AI_LEVELS.length - 1, AI_LEVELS.indexOf(level) + shift))]!;
  const map = generateMap({ seed: m.map.seed, players: m.seats.length, size: m.map.size, biome: m.map.biome, resources: m.map.resources, terrain: m.map.terrain });
  const n = map.width;
  const clamp = (v: number) => Math.max(2, Math.min(n - 3, v));
  const raw = (p: Pos) => ('start' in p ? { x: clamp(map.starts[p.start]!.x + (p.dx ?? 0)), y: clamp(map.starts[p.start]!.y + (p.dy ?? 0)) } : { x: clamp(Math.trunc((n * p.pct[0]) / 100)), y: clamp(Math.trunc((n * p.pct[1]) / 100)) });
  // Every mission spot (areas to reach or hold, spawns) sits on ground the player can walk to: a spot
  // given as a share of the map can land on rocks or water, and an area there can never be reached.
  const reach = walkableFrom(map, map.starts[0]!);
  const at = (p: Pos) => snapTo(reach, map.width, map.height, raw(p));
  const area = (a: PArea) => ({ ...at(a), r: a.r });
  const missionRules: MissionRules = {
    objectives: m.objectives.map((o): MissionRuleObjective => {
      switch (o.kind) {
        case 'reach':
          return { kind: 'reach', area: area(o.area), tag: o.tag };
        case 'hold':
          return { kind: 'hold', area: area(o.area), ticks: o.ticks };
        case 'destroy':
          return { kind: 'destroy', player: o.player, role: o.role, count: o.count };
        case 'have':
          return { kind: 'have', role: o.role, count: o.count };
        case 'harvest':
          return { kind: 'harvest', amount: o.amount };
        case 'survive':
          return { kind: 'survive', ticks: o.ticks };
        case 'protect':
          return { kind: 'protect', tag: o.tag };
        case 'kill':
          return { kind: 'kill', player: o.player, count: o.count };
      }
    }),
    triggers: m.triggers.map((t): MissionRuleTrigger => ({
      at: t.at,
      objective: t.objective,
      enter: t.enter ? area(t.enter) : undefined,
      every: t.every,
      until: t.until,
      actions: t.actions.map((a): MissionRuleAction => {
        if (a.kind === 'spawn') {
          const p = at(a.at);
          return {
            kind: 'spawn',
            player: a.player,
            unit: a.unit,
            count: scale(a.count, a.player),
            grow: a.grow === undefined ? undefined : a.grow === 0 ? 0 : scale(a.grow, a.player),
            max: a.max === undefined ? undefined : scale(a.max, a.player),
            x: p.x,
            y: p.y,
            tag: a.tag,
            attack: a.attack ? at(a.attack) : undefined,
          };
        }
        if (a.kind === 'reveal') return { kind: 'reveal', area: area(a.area) };
        return a;
      }),
    })),
  };
  const sim = createMatch({ rules, seed: m.map.seed, map, players: m.seats.map((s) => ({ faction: s.faction, team: s.team })), mission: missionRules, allow: m.allow });
  const w = sim.world;
  m.seats.forEach((seat, k) => {
    const start = map.starts[k]!;
    if (seat.start === 'base') {
      grantBase(sim, k, start);
      // A refinery comes with its harvester.
      spawnUnitAtTile(w, rules.factions[seat.faction]!.harvester, k, clamp(start.x + 2), clamp(start.y + 6));
    }
    else if (seat.start === 'none') for (let s = 0; s < w.entities.high; s++) if (w.entities.alive[s] === 1 && w.entities.owner[s] === k) w.entities.free(s);
    if (seat.credits !== undefined) w.players[k]!.credits = seat.credits;
    // Story: a cushion of credits for the player.
    if (k === 0 && difficulty === 'story') w.players[k]!.credits += 3000;
    for (const [unit, count] of seat.units ?? []) {
      const ri = rules.unitIndex.get(unit);
      if (ri === undefined) continue;
      for (let c = 0; c < count; c++) spawnUnitAtTile(w, ri, k, clamp(start.x + 3 + (c % 4)), clamp(start.y + 3 + Math.trunc(c / 4)));
    }
    for (const [sid, dx, dy] of seat.structures ?? []) {
      const ri = rules.structures.findIndex((x) => x.id === sid);
      if (ri >= 0) spawnStructure(w, ri, k, clamp(start.x + dx), clamp(start.y + dy));
    }
    if (seat.ai) attachAi(sim, k, enemyAi(k, seat.ai), map.starts);
  });
  return {
    sim,
    extras: { decoration: map.decoration, surface: map.surface, landmark: map.landmark, biome: map.biome, mapSeed: map.seedUsed, starts: map.starts },
  };
}

export * from './missions';
