import { KIND } from '@signal-fall/sim';
import { E } from '../protocol';
import type { ClientState, Mode } from '../game/state';
import type { Renderer } from '../render/renderer';
import { bindings, matches, type Binding, type Context } from './keymap';

const FX = 1024;
/** Edge-scroll zone in px from each side of the game view. */
const EDGE = 48;
const PAN_SPEED = 900; // world px per second at zoom 1
const DOUBLE_MS = 350;

const svgCursor = (svg: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

/** Context cursors: what a click will do. */
const CURSORS = {
  move: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g fill="none" stroke="#000" stroke-width="4"><path d="M12 3v18M3 12h18"/></g><g fill="none" stroke="#6dff8a" stroke-width="2"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/></g></svg>',
    12, 12, 'crosshair',
  ),
  attack: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8" fill="none" stroke="#000" stroke-width="4"/><g fill="none" stroke="#ff5a5a" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 1v7M12 16v7M1 12h7M16 12h7"/></g></svg>',
    12, 12, 'crosshair',
  ),
  select: 'pointer',
  tool: 'cell',
};

/** Modes that wait for a target click. */
const TARGET_MODES: Mode[] = ['move', 'attackMove', 'patrol', 'guard', 'ability', 'repair', 'sell'];

/**
 * Keyboard and mouse handling. Every keyboard action goes through keymap.json;
 * `run(action, digit)` is the single entry point so the UI command card and
 * tests share the same code path.
 */
export class Input {
  private readonly bindings: Binding[];
  private held = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private drag: { x0: number; y0: number; x1: number; y1: number; button: number } | null = null;
  private lastClick = { time: 0, handle: -1 };
  private lastGroup = { digit: -1, time: 0 };
  private idleHarvesterCursor = 0;

  constructor(
    private readonly state: ClientState,
    private readonly renderer: Renderer,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.bindings = bindings(state.rules.keymap);
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Track the cursor anywhere in the window; stop edge scrolling when it leaves.
    document.documentElement.addEventListener('mouseleave', () => (this.mouse.inside = false));
  }

  // --- per-frame camera movement ---

  update(dt: number): void {
    const cam = this.renderer.camera;
    const step = (PAN_SPEED * dt) / cam.zoom;
    let dx = 0;
    let dy = 0;
    const on = (action: string) =>
      this.bindings.some((b) => b.action === action && !b.chord.anyDigit && this.held.has(b.chord.code));
    if (on('panLeft')) dx -= step;
    if (on('panRight')) dx += step;
    if (on('panUp')) dy -= step;
    if (on('panDown')) dy += step;
    if (this.mouse.inside && !this.drag && !this.state.menuOpen) {
      // Scroll when the cursor is near an edge of the game view; faster closer to the edge.
      const r = this.canvas.getBoundingClientRect();
      const mx = this.mouse.x;
      const my = this.mouse.y;
      if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
        const ramp = (d: number) => (d < EDGE ? 0.35 + 0.65 * (1 - d / EDGE) : 0);
        dx += step * (ramp(mx - r.left) > 0 ? -ramp(mx - r.left) : ramp(r.right - mx));
        dy += step * (ramp(my - r.top) > 0 ? -ramp(my - r.top) : ramp(r.bottom - my));
      }
    }
    if (dx || dy) {
      cam.x += dx;
      cam.y += dy;
      this.renderer.clampCamera();
    }
  }

  // --- keyboard ---

  private activeContexts(): Context[] {
    return this.state.selectedUnits().length > 0 ? ['global', 'units', 'base'] : ['global', 'base'];
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    this.held.add(e.code);
    if (e.repeat && !e.code.startsWith('Arrow')) return;
    const contexts = this.activeContexts();
    // Structure menus (B / N then a letter) take the next letter key: wired in M3.
    for (const b of this.bindings) {
      if (!contexts.includes(b.context)) continue;
      const m = matches(b.chord, e);
      if (m === false) continue;
      e.preventDefault();
      this.run(b.action, typeof m === 'number' ? m : -1);
      return;
    }
  }

  /** Execute a keymap action. Exposed for the command card and tests. */
  run(action: string, digit = -1): void {
    const s = this.state;
    const units = s.selectedUnits();
    switch (action) {
      case 'panUp':
      case 'panDown':
      case 'panLeft':
      case 'panRight':
        return; // handled while held, in update()
      case 'jumpToAlert': {
        const a = s.alerts[s.alerts.length - 1];
        if (a) this.renderer.centerOnSim(a.x, a.y);
        return;
      }
      case 'jumpToBase': {
        const base = this.findOwn((h) => !s.isUnit(h) && s.ruleOf(h).kind === 'structure' && (s.ruleOf(h) as { role: string }).role === 'conyard')
          ?? this.findOwn((h) => !s.isUnit(h))
          ?? this.findOwn(() => true);
        if (base !== undefined) this.renderer.centerOnSim(s.field(base, E.x), s.field(base, E.y));
        return;
      }
      case 'selectArmy':
        s.select(this.allOwnUnits().filter((h) => this.isArmy(h)));
        return;
      case 'selectIdleHarvesters': {
        const idle = this.allOwnUnits().filter((h) => this.isHarvester(h) && s.field(h, E.orderCount) === 0);
        if (idle.length === 0) return;
        const h = idle[this.idleHarvesterCursor++ % idle.length]!;
        s.select([h]);
        this.renderer.centerOnSim(s.field(h, E.x), s.field(h, E.y));
        return;
      }
      case 'controlGroupAssign':
        s.controlGroups[digit] = [...s.selection];
        s.changed();
        return;
      case 'controlGroupAdd':
        s.controlGroups[digit] = [...new Set([...s.controlGroups[digit]!, ...s.selection])];
        s.changed();
        return;
      case 'controlGroupSelect': {
        const group = s.controlGroups[digit]!;
        const now = performance.now();
        if (this.lastGroup.digit === digit && now - this.lastGroup.time < DOUBLE_MS && group.length > 0) {
          const h = group[0]!;
          this.renderer.centerOnSim(s.field(h, E.x), s.field(h, E.y));
        }
        this.lastGroup = { digit, time: now };
        if (group.length > 0) s.select(group);
        return;
      }
      case 'cycleSubgroup': {
        const n = s.subgroups().length;
        if (n > 0) s.subgroup = (s.subgroup + 1) % n;
        s.changed();
        return;
      }
      case 'cancel':
        // Esc peels back one layer: menu, then mode, then selection, then opens the menu.
        if (s.menuOpen) this.toggleMenu();
        else if (s.mode !== 'normal') this.setMode('normal');
        else if (s.selection.length > 0) s.select([]);
        else this.toggleMenu();
        return;
      // unit commands
      case 'move':
      case 'attackMove':
      case 'patrol':
      case 'guard':
        if (units.length > 0) this.setMode(action);
        return;
      case 'stop':
      case 'hold':
      case 'scatter':
      case 'deploy':
        if (units.length > 0) s.send({ type: action, units });
        return;
      case 'ability':
        if (units.length > 0) s.send({ type: 'ability', units });
        return;
      // base
      case 'buildMenu':
        s.sidebarTab = 'structures';
        this.setMode('buildMenu');
        return;
      case 'defenseMenu':
        s.sidebarTab = 'defenses';
        this.setMode('defenseMenu');
        return;
      case 'repair':
      case 'sell':
        this.setMode(s.mode === action ? 'normal' : action);
        return;
    }
  }

  setMode(mode: Mode): void {
    this.state.mode = mode;
    this.canvas.style.cursor = mode === 'move' ? CURSORS.move : TARGET_MODES.includes(mode) ? CURSORS.attack : 'default';
    this.state.changed();
  }

  toggleMenu(): void {
    const s = this.state;
    s.menuOpen = !s.menuOpen;
    s.setPaused(s.menuOpen);
    s.changed();
  }

  // --- mouse ---

  private local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown(e: PointerEvent): void {
    const p = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, button: 1 };
      return;
    }
    if (e.button === 2) {
      this.rightClick(p.x, p.y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (TARGET_MODES.includes(this.state.mode)) {
      this.targetClick(p.x, p.y, e.shiftKey);
      return;
    }
    this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, button: 0 };
  }

  private onPointerMove(e: PointerEvent): void {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
    const p = this.local(e);
    if (!this.drag) {
      if (e.target === this.canvas) this.updateCursor(p.x, p.y);
      return;
    }
    if (this.drag.button === 1) {
      const cam = this.renderer.camera;
      cam.x -= (p.x - this.drag.x1) / cam.zoom;
      cam.y -= (p.y - this.drag.y1) / cam.zoom;
      this.renderer.clampCamera();
    }
    this.drag.x1 = p.x;
    this.drag.y1 = p.y;
    if (this.drag.button === 0 && this.dragSize() > 4) this.renderer.drawBox(this.drag);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.renderer.drawBox(null);
    if (d.button !== 0) return;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4) this.boxSelect(d, e.shiftKey);
    else this.leftClick(d.x1, d.y1, e.shiftKey, e.ctrlKey || e.metaKey);
  }

  /**
   * What a plain left click at this point would do: select something, or
   * (with own units selected) order them to move or attack. C&C style.
   */
  intentAt(sx: number, sy: number): { kind: 'select' | 'move' | 'attack' | 'none'; target: number } {
    const s = this.state;
    const h = this.renderer.pick(sx, sy);
    const haveUnits = s.selectedUnits().length > 0;
    if (h >= 0 && s.isOwn(h)) return { kind: 'select', target: h };
    if (h >= 0 && haveUnits && this.isEnemy(h)) return { kind: 'attack', target: h };
    if (haveUnits) return { kind: 'move', target: -1 };
    return { kind: h >= 0 ? 'select' : 'none', target: h };
  }

  private isEnemy(h: number): boolean {
    const s = this.state;
    return s.teamOf(h) !== s.players[s.localPlayer]!.team && this.renderer.visibleEntity(h);
  }

  leftClick(sx: number, sy: number, shift: boolean, ctrl: boolean): void {
    const s = this.state;
    const intent = this.intentAt(sx, sy);
    const units = s.selectedUnits();
    if (intent.kind === 'attack') {
      s.send({ type: 'attack', units, target: intent.target, queue: shift });
      this.renderer.ping(sx, sy, 0xff5a5a);
      return;
    }
    if (intent.kind === 'move') {
      const p = this.simPoint(sx, sy);
      s.send({ type: 'move', units, x: p.x, y: p.y, queue: shift });
      this.renderer.ping(sx, sy, 0x6dff8a);
      return;
    }
    this.clickSelect(sx, sy, shift, ctrl);
  }

  private updateCursor(sx: number, sy: number): void {
    const mode = this.state.mode;
    let cursor: string;
    if (mode === 'attackMove' || mode === 'patrol' || mode === 'ability') cursor = CURSORS.attack;
    else if (mode === 'move') cursor = CURSORS.move;
    else if (mode === 'guard') cursor = CURSORS.select;
    else if (mode === 'repair' || mode === 'sell') cursor = CURSORS.tool;
    else {
      const k = this.intentAt(sx, sy).kind;
      cursor = k === 'attack' ? CURSORS.attack : k === 'move' ? CURSORS.move : k === 'select' ? CURSORS.select : 'default';
    }
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  private dragSize(): number {
    return this.drag ? Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) : 0;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const cam = this.renderer.camera;
    cam.zoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.renderer.clampCamera();
  }

  /** Q10 sim coordinates of a screen point, clamped to the map. */
  simPoint(sx: number, sy: number): { x: number; y: number } {
    const { u, v } = this.renderer.screenToTile(sx, sy);
    const s = this.state;
    return {
      x: Math.round(Math.max(0, Math.min(s.width - 0.01, u)) * FX),
      y: Math.round(Math.max(0, Math.min(s.height - 0.01, v)) * FX),
    };
  }

  rightClick(sx: number, sy: number, shift: boolean): void {
    const s = this.state;
    if (s.mode !== 'normal') {
      this.setMode('normal');
      return;
    }
    const units = s.selectedUnits();
    if (units.length === 0) {
      s.select([]);
      return;
    }
    const h = this.renderer.pick(sx, sy);
    if (h >= 0 && this.isEnemy(h)) {
      s.send({ type: 'attack', units, target: h, queue: shift });
      this.renderer.ping(sx, sy, 0xff5a5a);
    } else if (h >= 0 && s.isOwn(h) && !units.includes(h)) {
      s.send({ type: 'guard', units, target: h, queue: shift });
      this.renderer.ping(sx, sy, 0x6db8ff);
    } else {
      const p = this.simPoint(sx, sy);
      s.send({ type: 'move', units, x: p.x, y: p.y, queue: shift });
      this.renderer.ping(sx, sy, 0x6dff8a);
    }
  }

  targetClick(sx: number, sy: number, shift: boolean): void {
    const s = this.state;
    const units = s.selectedUnits();
    const p = this.simPoint(sx, sy);
    const h = this.renderer.pick(sx, sy);
    this.renderer.ping(sx, sy, s.mode === 'move' ? 0x6dff8a : s.mode === 'guard' ? 0x6db8ff : 0xff5a5a);
    switch (s.mode) {
      case 'move':
        s.send({ type: 'move', units, x: p.x, y: p.y, queue: shift });
        break;
      case 'attackMove':
        if (h >= 0 && s.teamOf(h) !== s.players[s.localPlayer]!.team) s.send({ type: 'attack', units, target: h, queue: shift });
        else s.send({ type: 'attackMove', units, x: p.x, y: p.y, queue: shift });
        break;
      case 'patrol':
        s.send({ type: 'patrol', units, x: p.x, y: p.y, queue: shift });
        break;
      case 'guard':
        if (h >= 0 && s.isOwn(h)) s.send({ type: 'guard', units, target: h, queue: shift });
        break;
      case 'ability':
        s.send({ type: 'ability', units, x: p.x, y: p.y });
        break;
      default:
        break; // repair / sell: M3
    }
    // Shift keeps the mode for chaining orders.
    if (!shift) this.setMode('normal');
  }

  clickSelect(sx: number, sy: number, shift: boolean, ctrl: boolean): void {
    const s = this.state;
    const h = this.renderer.pick(sx, sy);
    const now = performance.now();
    const double = h >= 0 && this.lastClick.handle === h && now - this.lastClick.time < DOUBLE_MS;
    this.lastClick = { time: now, handle: h };
    if (h < 0) {
      if (!shift) s.select([]);
      return;
    }
    if ((ctrl || double) && s.isOwn(h)) {
      s.select(this.onScreenOfType(h));
      return;
    }
    if (shift && s.isOwn(h)) {
      s.select(s.selection.includes(h) ? s.selection.filter((x) => x !== h) : [...s.selection, h]);
      return;
    }
    s.select([h]);
  }

  boxSelect(d: { x0: number; y0: number; x1: number; y1: number }, shift: boolean): void {
    const s = this.state;
    const x0 = Math.min(d.x0, d.x1);
    const x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1);
    const y1 = Math.max(d.y0, d.y1);
    const hits = this.allOwnUnits().filter((h) => {
      const p = this.renderer.screenOf(h);
      return p !== null && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    s.select(shift ? [...s.selection, ...hits] : hits);
  }

  // --- queries ---

  private allOwnUnits(): number[] {
    const cur = this.state.cur;
    if (!cur) return [];
    const out: number[] = [];
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.owner) === this.state.localPlayer && cur.get(o, E.kind) === KIND.unit) out.push(cur.get(o, E.handle));
    }
    return out;
  }

  private findOwn(pred: (h: number) => boolean): number | undefined {
    const cur = this.state.cur;
    if (!cur) return undefined;
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      const h = cur.get(o, E.handle);
      if (cur.get(o, E.owner) === this.state.localPlayer && pred(h)) return h;
    }
    return undefined;
  }

  private isHarvester(h: number): boolean {
    const r = this.state.ruleOf(h);
    return r.kind === 'unit' && r.abilities.some((a) => a.kind === 'harvest');
  }

  /** Army = armed units (no harvesters, engineers, construction units). */
  private isArmy(h: number): boolean {
    const r = this.state.ruleOf(h);
    return r.kind === 'unit' && r.weapon !== null;
  }

  private onScreenOfType(h: number): number[] {
    const type = this.state.field(h, E.type);
    return this.allOwnUnits().filter((u) => {
      if (this.state.field(u, E.type) !== type) return false;
      const p = this.renderer.screenOf(u);
      return p !== null && p.x >= 0 && p.y >= 0 && p.x <= this.renderer.width && p.y <= this.renderer.height;
    });
  }
}
