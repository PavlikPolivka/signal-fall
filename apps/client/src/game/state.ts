import type { Role, Rules, StructureRule, Tab } from '@signal-fall/data';
import { FX_SHIFT, KIND, type Command, type PlacedStructure, type PlacementView } from '@signal-fall/sim';
import { E, P_HARVESTED, P_POWER, Snapshot, type PlayerInfo, type ToWorker } from '../protocol';

export type Mode =
  | 'normal'
  | 'move'
  | 'attackMove'
  | 'patrol'
  | 'guard'
  | 'ability'
  | 'power'
  | 'repair'
  | 'sell'
  | 'buildMenu'
  | 'defenseMenu'
  | 'infantryMenu'
  | 'vehicleMenu'
  | 'airMenu';

export type SidebarTab = 'structures' | 'defenses' | Tab;

export interface Alert {
  /** 'alert' = something is under attack / wrong; 'notice' = good news. */
  kind: 'alert' | 'notice' | 'warn';
  text: string;
  x: number;
  y: number;
  time: number;
}

export interface SeatLabel {
  kind: 'you' | 'person' | 'ai' | 'agent';
  /** "You", "Player 2", "AI (Hard)", or the agent's name. */
  label: string;
  /** Agents: the model or program behind it, if given. */
  model?: string;
}

/** Seat labels from the scenario: people, built-in AI at its difficulty, and AI agents by name. */
export function seatLabels(scenario: import('./scenario').ScenarioSpec, localPlayer: number, spectator: boolean): SeatLabel[] {
  if (scenario.kind !== 'skirmish') return [];
  return scenario.factions.map((_, k) => {
    const agent = scenario.agents?.[k];
    if (agent) return { kind: 'agent', label: agent.name, model: agent.model };
    const ai = scenario.ai[k];
    if (ai) return { kind: 'ai', label: `AI (${ai[0]!.toUpperCase()}${ai.slice(1)})` };
    if (k === localPlayer && !spectator) return { kind: 'you', label: 'You' };
    return { kind: 'person', label: `Player ${k + 1}` };
  });
}

export const TEAM_COLORS = [0x3d8bfd, 0xe5484d, 0x30a46c, 0xf5d90a, 0xa855f7, 0xf97316, 0x14b8a6, 0xec4899];

/**
 * Everything the main thread knows: the latest two sim snapshots (for
 * interpolation) plus purely local UI state. UI components subscribe for
 * change notifications.
 */
export class ClientState {
  readonly rules: Rules;
  width = 0;
  height = 0;
  terrain: Uint8Array = new Uint8Array(0);
  decoration: Uint8Array = new Uint8Array(0);
  surface: Uint8Array = new Uint8Array(0);
  landmark: Uint8Array = new Uint8Array(0);
  biome: 'city' | 'wasteland' | 'crystal' = 'wasteland';
  /** Factions whose rendered art (sprites and icons) has loaded. */
  art = new Set<string>();
  creditsOpen = false;
  /** Player preferences, kept in local storage. */
  settings: Settings = loadSettings();
  /** Persist settings and push them to the renderer (set up by main). */
  applySettings: () => void = () => saveSettings(this.settings);
  /** Sound muted (mirrors the audio engine; set up by main). */
  muted = false;
  toggleMute: () => void = () => undefined;
  /** Networked match state (null in single player). */
  multiplayer = false;
  net: { delayTurns: number; rtt: number; waitingOn: number[] } | null = null;
  desync: { tick: number; report: string } | null = null;
  peerLost = false;
  /** Watching a replay: its end tick, and whether playback reproduced the recording (null until the end). */
  replay: { endTick: number; verified: boolean | null; speed: number; paused: boolean; live?: boolean } | null = null;
  /** Live spectating: the stream's state for the UI. */
  liveStatus: 'connecting' | 'live' | 'ended' | 'lost' | null = null;
  saveReplay: () => void = () => undefined;
  /** Match statistics for the post-game report (arrives when the match ends). */
  stats: import('./scenario').MatchStats | null = null;
  reportOpen = false;
  requestStats: () => void = () => undefined;
  replaySpeed: (speed: number) => void = () => undefined;
  mapSeed = 0;
  /** Who controls each seat, for labels (an AI agent is always marked as one). */
  seats: SeatLabel[] = [];
  players: PlayerInfo[] = [];
  localPlayer = 0;
  ready = false;

  prev: Snapshot | null = null;
  cur: Snapshot | null = null;
  curAt = 0;
  fog: Uint8Array | null = null;
  fogVersion = 0;
  echo: Uint8Array = new Uint8Array(0);
  echoVersion = 0;
  /** Watching an AI vs AI match: everything visible, no fog. */
  spectator = false;
  /** Shift is down: show queued waypoints of selected units. */
  shiftHeld = false;
  /** Alt held: show every health bar. */
  altHeld = false;
  /** Recent hits on own units/buildings, for minimap pings. */
  hits: { x: number; y: number; time: number }[] = [];
  /** Sidebar item under the cursor and the button's screen top. */
  hoverItem: { index: number; kind: 'unit' | 'structure'; top: number } | null = null;
  /** World entity under the cursor and where (client px). */
  hoverEntity = -1;
  hoverPos = { x: 0, y: 0 };
  /** Structure waiting to be placed (placement mode). */
  /** Choosing a spot for a structure: a finished one, or (planned) one to build there. */
  placing: { category: 'structures' | 'defenses'; item: number; planned?: boolean } | null = null;

  selection: number[] = [];
  /** Index into the selection's unit-type subgroups (Tab cycles). */
  subgroup = 0;
  controlGroups: number[][] = Array.from({ length: 10 }, () => []);
  mode: Mode = 'normal';
  sidebarTab: SidebarTab = 'structures';
  menuOpen = false;
  codexOpen = false;
  alerts: Alert[] = [];
  /** Every command sent, newest last (for UI feedback and tests). */
  sent: Command[] = [];
  /** Totals ever pushed to `sent` / `alerts` (the arrays are trimmed), for consumers that track new entries. */
  sentTotal = 0;
  alertTotal = 0;
  fps = 0;
  /** Skirmish game speed (1 = normal); multiplayer always runs at 1. */
  gameSpeed = 1;
  /** Camera bookmarks for F1–F4 (world px), saved with Ctrl or Shift + the F-key. */
  bookmarks: ({ x: number; y: number } | null)[] = [null, null, null, null];
  /** Unit types on repeat (Ctrl+click or Ctrl+letter): one is queued again whenever none is left. */
  repeat = new Set<number>();
  private repeatSent = new Map<number, number>();
  /** Echo harvested so far, sampled once a second as [tick, total], for income per minute. */
  private incomeLog: [number, number][] = [];
  /** Smoothed main-thread ms per frame spent in input + render prep. */
  frameMs = 0;

  private listeners = new Set<() => void>();
  private uiVersion = 0;
  private post: (msg: ToWorker) => void;

  constructor(rules: Rules, post: (msg: ToWorker) => void) {
    this.rules = rules;
    this.post = post;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Notify UI subscribers (cheap; components re-render from state). */
  changed(): void {
    this.uiVersion++;
    for (const fn of this.listeners) fn();
  }

  get version(): number {
    return this.uiVersion;
  }

  send(cmd: Command): void {
    this.sent.push(cmd);
    this.sentTotal++;
    if (this.sent.length > 200) this.sent.shift();
    this.post({ type: 'command', cmd });
  }

  /** Skirmish only: run the match faster or slower. */
  setGameSpeed(speed: number): void {
    if (this.multiplayer || this.replay) return;
    this.gameSpeed = speed;
    this.post({ type: 'speed', speed });
    this.changed();
  }

  /** Echo harvested over the last minute of game time (or since the start). */
  incomePerMinute(): number {
    const log = this.incomeLog;
    if (log.length < 2) return 0;
    const last = log[log.length - 1]!;
    const first = log[Math.max(0, log.length - 61)]!;
    const ticks = last[0] - first[0];
    return ticks > 0 ? Math.round(((last[1] - first[1]) * 1200) / ticks) : 0;
  }

  /** Turn repeat production of a unit type on or off. */
  toggleRepeat(item: number): void {
    if (this.repeat.has(item)) this.repeat.delete(item);
    else this.repeat.add(item);
    this.changed();
  }

  /** Keep one of each repeating unit type in its queue. */
  private repeatProduction(s: Snapshot): void {
    if (this.repeat.size === 0 || this.spectator || this.replay) return;
    const now = performance.now();
    const roles = this.roles();
    for (const item of this.repeat) {
      const rule = this.rules.units[item]!;
      const tab = rule.tab === 'infantry' ? 0 : rule.tab === 'vehicles' ? 1 : 2;
      if (!roles.get(rule.tab === 'infantry' ? 'barracks' : rule.tab === 'vehicles' ? 'factory' : 'airfield')) continue;
      if (s.productionQueue(this.localPlayer, tab).items.includes(item)) continue;
      // The order takes a few ticks to show up in the queue; don't send it twice.
      if (now - (this.repeatSent.get(item) ?? 0) < 1500 || this.missing(rule.requires, roles).length > 0) continue;
      this.repeatSent.set(item, now);
      this.send({ type: 'train', item, count: 1 });
    }
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'pause', paused });
  }

  onSnapshot(s: Snapshot, fog: Uint8Array | null, echo: Uint8Array | null): void {
    this.prev = this.cur;
    this.cur = s;
    this.curAt = performance.now();
    if (fog) {
      this.fog = this.spectator ? fog.fill(3) : fog;
      this.fogVersion++;
    }
    if (echo) {
      this.echo = echo;
      this.echoVersion++;
    }
    this.detectAlerts();
    this.detectEconomyEvents();
    this.repeatProduction(s);
    if (s.tick % 20 === 0 && this.incomeLog[this.incomeLog.length - 1]?.[0] !== s.tick) {
      this.incomeLog.push([s.tick, s.player(this.localPlayer, P_HARVESTED)]);
      if (this.incomeLog.length > 70) this.incomeLog.shift();
    }
    // Drop dead entities from selection and control groups.
    const alive = (h: number) => s.index.has(h);
    const before = this.selection.length;
    this.selection = this.selection.filter(alive);
    for (let i = 0; i < 10; i++) this.controlGroups[i] = this.controlGroups[i]!.filter(alive);
    if (this.selection.length !== before || s.tick % 5 === 0) this.changed();
  }

  // --- entity helpers (current snapshot) ---

  off(h: number): number {
    return this.cur?.index.get(h) ?? -1;
  }

  field(h: number, f: number): number {
    const o = this.off(h);
    return o < 0 ? 0 : this.cur!.a[o + f]!;
  }

  isOwn(h: number): boolean {
    return this.field(h, E.owner) === this.localPlayer && this.off(h) >= 0;
  }

  isUnit(h: number): boolean {
    return this.field(h, E.kind) === KIND.unit;
  }

  teamOf(h: number): number {
    return this.players[this.field(h, E.owner)]?.team ?? -1;
  }

  /** Rule for a unit or structure handle. */
  ruleOf(h: number) {
    const type = this.field(h, E.type);
    return this.field(h, E.kind) === KIND.structure ? this.rules.structures[type]! : this.rules.units[type]!;
  }

  /** Own unit handles in the current selection. */
  selectedUnits(): number[] {
    return this.selection.filter((h) => this.isOwn(h) && this.isUnit(h));
  }

  /** Distinct unit rule indices in the selection, in first-seen order. */
  subgroups(): number[] {
    const types: number[] = [];
    for (const h of this.selection) {
      const t = (this.isUnit(h) ? 0 : 10000) + this.field(h, E.type);
      if (!types.includes(t)) types.push(t);
    }
    return types;
  }

  select(handles: number[]): void {
    this.selection = [...new Set(handles)];
    this.subgroup = 0;
    if (this.mode !== 'buildMenu' && this.mode !== 'defenseMenu') this.mode = 'normal';
    this.changed();
  }

  alert(text: string, x: number, y: number, kind: Alert['kind'] = 'alert'): void {
    const now = performance.now();
    // One alert of a kind per 8 seconds.
    if (this.alerts.some((a) => a.text === text && now - a.time < 8000)) return;
    this.alerts.push({ kind, text, x, y, time: now });
    this.alertTotal++;
    if (this.alerts.length > 5) this.alerts.shift();
    this.changed();
  }

  // --- economy views of the current snapshot ---

  /** Roles of the local player's structures, with counts. */
  roles(player = this.localPlayer): Map<Role, number> {
    const out = new Map<Role, number>();
    const cur = this.cur;
    if (!cur) return out;
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.owner) !== player || cur.get(o, E.kind) !== KIND.structure) continue;
      const role = this.rules.structures[cur.get(o, E.type)]!.role;
      out.set(role, (out.get(role) ?? 0) + 1);
    }
    return out;
  }

  /** Missing roles for an item, empty if it can be built. */
  missing(requires: readonly Role[], roles = this.roles()): Role[] {
    return requires.filter((r) => !roles.get(r));
  }

  /** Comeback rule (as the sim): no construction yard or construction unit left, but a refinery builds one. */
  emergencyRebuild(roles = this.roles()): boolean {
    const cur = this.cur;
    if (!cur || (roles.get('conyard') ?? 0) > 0 || !(roles.get('refinery') ?? 0)) return false;
    const cu = this.rules.factions[this.players[this.localPlayer]?.faction ?? 0]!.constructionUnit;
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.owner) === this.localPlayer && cur.get(o, E.kind) === KIND.unit && cur.get(o, E.type) === cu) return false;
    }
    return true;
  }

  get lowPower(): boolean {
    return this.cur?.player(this.localPlayer, 4) === 1;
  }

  /** Placement view built from the snapshot, for the client-side placement preview. */
  placementView(): PlacementView {
    const cur = this.cur!;
    const structures: PlacedStructure[] = [];
    const units = new Uint8Array(this.width * this.height);
    const ownUnits: { x: number; y: number }[] = [];
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      const kind = cur.get(o, E.kind);
      if (kind === KIND.unit && cur.get(o, E.owner) === this.localPlayer) ownUnits.push({ x: cur.get(o, E.x), y: cur.get(o, E.y) });
      if (kind === KIND.structure) {
        // Enemy structures only count where the player has explored.
        const rule: StructureRule = this.rules.structures[cur.get(o, E.type)]!;
        structures.push({ owner: cur.get(o, E.owner), rule, tx: cur.get(o, E.tileX), ty: cur.get(o, E.tileY) });
      } else if (kind === KIND.unit && !this.rules.units[cur.get(o, E.type)]!.isAir) {
        const tx = cur.get(o, E.x) >> FX_SHIFT;
        const ty = cur.get(o, E.y) >> FX_SHIFT;
        units[ty * this.width + tx] = 1;
      }
    }
    return {
      width: this.width,
      height: this.height,
      terrain: this.terrain,
      echo: this.echo,
      structures,
      unitOn: (x, y) => units[y * this.width + x] === 1,
      coveragePct: 100,
      ownUnits,
    };
  }

  private lastReady = [false, false];
  private lastQueueLengths = [0, 0, 0];
  private lastLowPower = false;
  private lastUpgrades = -1;
  private lastOptions = -1;

  private detectEconomyEvents(): void {
    const cur = this.cur;
    if (!cur) return;
    for (let c = 0; c < 2; c++) {
      const ready = cur.buildQueue(this.localPlayer, c).ready;
      if (ready && !this.lastReady[c]) this.notice('Construction complete');
      this.lastReady[c] = ready;
    }
    for (let t = 0; t < 3; t++) {
      const n = cur.productionQueue(this.localPlayer, t).items.length;
      if (n < this.lastQueueLengths[t]! && cur.productionQueue(this.localPlayer, t).progress === 0) this.notice('Unit ready');
      this.lastQueueLengths[t] = n;
    }
    if (this.lowPower && !this.lastLowPower) this.alert('Low power', -1, -1);
    this.lastLowPower = this.lowPower;
    // Research finished: one more upgrade bit.
    const upgrades = cur.player(this.localPlayer, 7);
    if (this.lastUpgrades >= 0 && upgrades !== this.lastUpgrades && popcount(upgrades) > popcount(this.lastUpgrades)) this.notice('Research complete');
    this.lastUpgrades = upgrades;
    // A new building unlocked something to build or train.
    const options = this.buildableCount();
    if (this.lastOptions >= 0 && options > this.lastOptions) this.notice('New construction options');
    this.lastOptions = options;
  }

  /** How many of our faction's structures and units have their requirements met. */
  private buildableCount(): number {
    const p = this.players[this.localPlayer];
    if (!p) return 0;
    const faction = this.rules.factions[p.faction]!;
    const roles = this.roles();
    let n = 0;
    for (const i of faction.structures) if (this.rules.structures[i]!.category && this.missing(this.rules.structures[i]!.requires, roles).length === 0) n++;
    for (const i of faction.units) if (this.missing(this.rules.units[i]!.requires, roles).length === 0) n++;
    return n;
  }

  /** Explain why an action did nothing (shown in the top bar). */
  /** Support power: -2 none, -1 unavailable, 0 ready, else ticks left. */
  powerStatus(): number {
    return this.cur ? this.cur.player(this.localPlayer, P_POWER) : -2;
  }

  warn(text: string): void {
    const now = performance.now();
    this.alerts = this.alerts.filter((a) => a.text !== text);
    this.alerts.push({ kind: 'warn', text, x: -1, y: -1, time: now });
    this.alertTotal++;
    if (this.alerts.length > 5) this.alerts.shift();
    this.changed();
  }

  /** Non-alarming status line (no camera jump target). */
  notice(text: string): void {
    this.alert(text, -1, -1, 'notice');
  }

  private detectAlerts(): void {
    const { prev, cur } = this;
    if (!prev || !cur) return;
    // Losses: our entities in the previous snapshot that are gone now (killed, not deployed or sold: those vanish too,
    // so only count what was recently hurt).
    for (let i = 0; i < prev.entityCount; i++) {
      const o = prev.ent(i);
      if (prev.get(o, E.owner) !== this.localPlayer || cur.index.has(prev.get(o, E.handle))) continue;
      const kind = prev.get(o, E.kind);
      if (kind !== KIND.unit && kind !== KIND.structure) continue;
      const hp = prev.get(o, E.hp) + prev.get(o, E.shields);
      if (hp > prev.get(o, E.maxHp) * 0.35) continue;
      this.alert(kind === KIND.structure ? 'Structure lost' : 'Unit lost', prev.get(o, E.x), prev.get(o, E.y));
    }
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.owner) !== this.localPlayer) continue;
      const po = prev.index.get(cur.get(o, E.handle));
      if (po === undefined) continue;
      const hpNow = cur.get(o, E.hp) + cur.get(o, E.shields);
      const hpBefore = prev.get(po, E.hp) + prev.get(po, E.shields);
      if (hpNow < hpBefore) {
        const isStructure = cur.get(o, E.kind) === KIND.structure;
        const rule = isStructure ? null : this.rules.units[cur.get(o, E.type)]!;
        const harvester = rule?.abilities.some((a) => a.kind === 'harvest') ?? false;
        const x = cur.get(o, E.x);
        const y = cur.get(o, E.y);
        this.alert(isStructure ? 'Base under attack' : harvester ? 'Harvester under attack' : 'Unit under attack', x, y);
        // One minimap ping per spot per second or so.
        const now = performance.now();
        if (!this.hits.some((h) => now - h.time < 1000 && Math.abs(h.x - x) < 4096 && Math.abs(h.y - y) < 4096)) this.hits.push({ x, y, time: now });
        this.hits = this.hits.filter((h) => now - h.time < 3000);
      }
    }
  }
}

export interface Settings {
  /** Camera pan speed multiplier (keys and screen edges). */
  scrollSpeed: number;
  /** Reduced: fewer smoke and spark particles (slower machines, calmer screen). */
  effects: 'full' | 'reduced';
  /** Graphics quality: Balanced hides ground clutter and prop shadows, Performance also renders at lower resolution with simpler terrain. */
  graphics: 'high' | 'balanced' | 'performance';
  /** First-match tips in the corner. */
  hints: boolean;
  /** Mouse wheel zooms the other way. */
  invertWheel: boolean;
}

const SETTINGS_KEY = 'signalfall.settings';
const DEFAULT_SETTINGS: Settings = { scrollSpeed: 1, effects: 'full', graphics: 'high', hints: true, invertWheel: false };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Not persisted; applies for this session.
  }
}

/** Bits set in a 32-bit mask. */
function popcount(n: number): number {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c++;
  return c;
}
