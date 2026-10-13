import type { Role, Rules, StructureRule, Tab } from '@signal-fall/data';
import { FX_SHIFT, KIND, type Command, type PlacedStructure, type PlacementView } from '@signal-fall/sim';
import { E, Snapshot, type PlayerInfo, type ToWorker } from '../protocol';

export type Mode =
  | 'normal'
  | 'move'
  | 'attackMove'
  | 'patrol'
  | 'guard'
  | 'ability'
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
  replay: { endTick: number; verified: boolean | null; speed: number; paused: boolean } | null = null;
  saveReplay: () => void = () => undefined;
  /** Match statistics for the post-game report (arrives when the match ends). */
  stats: import('./scenario').MatchStats | null = null;
  reportOpen = false;
  requestStats: () => void = () => undefined;
  replaySpeed: (speed: number) => void = () => undefined;
  mapSeed = 0;
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
  /** Recent hits on own units/buildings, for minimap pings. */
  hits: { x: number; y: number; time: number }[] = [];
  /** Sidebar item under the cursor and the button's screen top. */
  hoverItem: { index: number; kind: 'unit' | 'structure'; top: number } | null = null;
  /** World entity under the cursor and where (client px). */
  hoverEntity = -1;
  hoverPos = { x: 0, y: 0 };
  /** Structure waiting to be placed (placement mode). */
  placing: { category: 'structures' | 'defenses'; item: number } | null = null;

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

  get lowPower(): boolean {
    return this.cur?.player(this.localPlayer, 4) === 1;
  }

  /** Placement view built from the snapshot, for the client-side placement preview. */
  placementView(): PlacementView {
    const cur = this.cur!;
    const structures: PlacedStructure[] = [];
    const units = new Uint8Array(this.width * this.height);
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      const kind = cur.get(o, E.kind);
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
    };
  }

  private lastReady = [false, false];
  private lastQueueLengths = [0, 0, 0];
  private lastLowPower = false;

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
  }

  /** Explain why an action did nothing (shown in the top bar). */
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
  /** First-match tips in the corner. */
  hints: boolean;
}

const SETTINGS_KEY = 'signalfall.settings';
const DEFAULT_SETTINGS: Settings = { scrollSpeed: 1, effects: 'full', hints: true };

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
