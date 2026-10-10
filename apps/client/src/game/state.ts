import type { Rules, Tab } from '@signal-fall/data';
import { KIND, type Command } from '@signal-fall/sim';
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
  | 'defenseMenu';

export type SidebarTab = 'structures' | 'defenses' | Tab;

export interface Alert {
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
  players: PlayerInfo[] = [];
  localPlayer = 0;
  ready = false;

  prev: Snapshot | null = null;
  cur: Snapshot | null = null;
  curAt = 0;
  fog: Uint8Array | null = null;
  fogVersion = 0;

  selection: number[] = [];
  /** Index into the selection's unit-type subgroups (Tab cycles). */
  subgroup = 0;
  controlGroups: number[][] = Array.from({ length: 10 }, () => []);
  mode: Mode = 'normal';
  sidebarTab: SidebarTab = 'structures';
  menuOpen = false;
  alerts: Alert[] = [];
  /** Every command sent, newest last (for UI feedback and tests). */
  sent: Command[] = [];
  fps = 0;

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
    if (this.sent.length > 200) this.sent.shift();
    this.post({ type: 'command', cmd });
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'pause', paused });
  }

  onSnapshot(s: Snapshot, fog: Uint8Array | null): void {
    this.prev = this.cur;
    this.cur = s;
    this.curAt = performance.now();
    if (fog) {
      this.fog = fog;
      this.fogVersion++;
    }
    this.detectAlerts();
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
    return this.isUnit(h) ? this.rules.units[type]! : this.rules.structures[type]!;
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

  alert(text: string, x: number, y: number): void {
    const now = performance.now();
    // One alert of a kind per 8 seconds.
    if (this.alerts.some((a) => a.text === text && now - a.time < 8000)) return;
    this.alerts.push({ text, x, y, time: now });
    if (this.alerts.length > 5) this.alerts.shift();
    this.changed();
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
        this.alert(isStructure ? 'Base under attack' : 'Unit under attack', cur.get(o, E.x), cur.get(o, E.y));
      }
    }
  }
}
