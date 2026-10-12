import { FX_SHIFT, KIND, PLACEMENT_MESSAGES, placementError } from '@signal-fall/sim';
import type { StructureRule, UnitRule } from '@signal-fall/data';
import { E } from '../protocol';
import type { ClientState, Mode } from '../game/state';
import type { Renderer } from '../render/renderer';
import { bindings, matches, type Binding, type Context } from './keymap';

const FX = 1024;
/** Edge-scroll zone in px from each side of the game view. */
const EDGE = 48;
/** Any cursor within this many px of the browser window's edge scrolls. */
const WINDOW_EDGE = 4;
/** View edges next to UI panels (right: sidebar, bottom: command bar) only scroll after this dwell, so crossing to buttons doesn't move the map. */
const PANEL_DWELL_MS = 250;
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

const ROLE_NAME: Record<string, string> = {
  conyard: 'Construction Yard',
  power: 'Power',
  refinery: 'Refinery',
  barracks: 'Barracks',
  factory: 'Vehicle Factory',
  radar: 'Radar',
  special: 'faction special',
  airfield: 'Airfield',
  tech: 'Tech Center',
};
const roleName = (r: string) => ROLE_NAME[r] ?? r;

export const STANCE_NAMES = ['Guard area', 'Hold ground', 'Aggressive', 'Hold fire'];

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
  /** Direction the cursor left the window through (keeps scrolling until it returns), or null. */
  private exited: { dx: number; dy: number } | null = null;
  /** Since when the cursor has been in a panel-side edge zone (for the dwell delay). */
  private panelEdgeSince = 0;
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
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      this.state.shiftHeld = e.shiftKey;
    });
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Leaving the window through an edge keeps scrolling that way until the cursor comes back (like a fullscreen RTS).
    document.documentElement.addEventListener('mouseleave', (e) => {
      this.mouse.inside = false;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dx = e.clientX <= 0 ? -1 : e.clientX >= w - 1 ? 1 : 0;
      const dy = e.clientY <= 0 ? -1 : e.clientY >= h - 1 ? 1 : 0;
      this.exited = dx || dy ? { dx, dy } : null;
    });
    document.documentElement.addEventListener('mouseenter', () => (this.exited = null));
    window.addEventListener('blur', () => (this.exited = null));
  }

  // --- per-frame camera movement ---

  update(dt: number): void {
    const cam = this.renderer.camera;
    const step = (PAN_SPEED * this.state.settings.scrollSpeed * dt) / cam.zoom;
    let dx = 0;
    let dy = 0;
    const on = (action: string) =>
      this.bindings.some((b) => b.action === action && !b.chord.anyDigit && this.held.has(b.chord.code));
    if (on('panLeft')) dx -= step;
    if (on('panRight')) dx += step;
    if (on('panUp')) dy -= step;
    if (on('panDown')) dy += step;
    if (!this.drag && !this.state.menuOpen) {
      const [ex, ey] = this.edgeScroll();
      dx += step * ex;
      dy += step * ey;
    }
    if (dx || dy) {
      cam.x += dx;
      cam.y += dy;
      this.renderer.clampCamera();
    }
  }

  /**
   * Edge-scroll direction and strength (-1..1 per axis).
   * - outside the window (left through an edge): full speed that way
   * - within WINDOW_EDGE px of the window edge: full speed
   * - inside the game view near its left/top edge: ramped, immediately
   * - near its right/bottom edge (next to the sidebar / command bar): ramped, after a short dwell
   */
  private edgeScroll(): [number, number] {
    if (this.exited) return [this.exited.dx, this.exited.dy];
    if (!this.mouse.inside) return [0, 0];
    const mx = this.mouse.x;
    const my = this.mouse.y;
    let x = mx <= WINDOW_EDGE ? -1 : mx >= window.innerWidth - 1 - WINDOW_EDGE ? 1 : 0;
    let y = my <= WINDOW_EDGE ? -1 : my >= window.innerHeight - 1 - WINDOW_EDGE ? 1 : 0;
    if (x || y) return [x, y];
    const r = this.canvas.getBoundingClientRect();
    if (mx < r.left || mx > r.right || my < r.top || my > r.bottom) {
      this.panelEdgeSince = 0;
      return [0, 0];
    }
    const ramp = (d: number) => (d < EDGE ? 0.35 + 0.65 * (1 - d / EDGE) : 0);
    x = -ramp(mx - r.left);
    y = -ramp(my - r.top);
    const toPanel = [ramp(r.right - mx), ramp(r.bottom - my)];
    if (toPanel[0]! > 0 || toPanel[1]! > 0) {
      const now = performance.now();
      if (this.panelEdgeSince === 0) this.panelEdgeSince = now;
      if (now - this.panelEdgeSince >= PANEL_DWELL_MS) {
        if (x === 0) x = toPanel[0]!;
        if (y === 0) y = toPanel[1]!;
      }
    } else this.panelEdgeSince = 0;
    return [x, y];
  }

  // --- keyboard ---

  private activeContexts(): Context[] {
    return this.state.selectedUnits().length > 0 ? ['global', 'units', 'base'] : ['global', 'base'];
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    this.state.shiftHeld = e.shiftKey;
    this.held.add(e.code);
    if (e.repeat && !e.code.startsWith('Arrow')) return;
    const contexts = this.activeContexts();
    const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const s = this.state;
    // B / N menus: the next letter picks a structure.
    if ((s.mode === 'buildMenu' || s.mode === 'defenseMenu') && letter && plain) {
      e.preventDefault();
      const category = s.mode === 'buildMenu' ? 'structures' : 'defenses';
      const item = this.factionStructures().find((r) => r.category === category && r.key === letter);
      this.setMode('normal');
      if (item) this.activateStructure(item);
      else s.warn(`No ${category === 'structures' ? 'structure' : 'defense'} on ${letter}`);
      return;
    }
    // I / V / Y menus: the next letter trains a unit from that tab (Shift queues five).
    const menuTab = s.mode === 'infantryMenu' ? 'infantry' : s.mode === 'vehicleMenu' ? 'vehicles' : s.mode === 'airMenu' ? 'air' : null;
    if (menuTab && letter && plain) {
      e.preventDefault();
      const unit = this.factionUnits().find((u) => u.tab === menuTab && u.key === letter);
      this.setMode('normal');
      if (unit) this.activateUnit(unit, e.shiftKey ? 5 : 1);
      else s.warn(`No ${menuTab === 'air' ? 'aircraft' : menuTab === 'vehicles' ? 'vehicle' : 'infantry'} on ${letter}`);
      return;
    }
    // A selected factory takes unit letters (Shift queues five).
    const factory = this.selectedFactory();
    if (factory && letter && plain) {
      const unit = this.factionUnits().find((u) => u.tab === factory.produces && u.key === letter);
      if (unit) {
        e.preventDefault();
        this.activateUnit(unit, e.shiftKey ? 5 : 1);
        return;
      }
    }
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
        const a = [...s.alerts].reverse().find((x) => x.x >= 0);
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
        // Esc peels back one layer: codex / credits, menu, then mode, then selection, then opens the menu.
        if (s.codexOpen || s.creditsOpen) {
          s.codexOpen = false;
          s.creditsOpen = false;
          s.changed();
        } else if (s.menuOpen) this.toggleMenu();
        else if (s.placing) this.stopPlacing();
        else if (s.mode !== 'normal') this.setMode('normal');
        else if (s.selection.length > 0) s.select([]);
        // Esc never opens the menu: browsers use it to leave fullscreen. The menu is on ` (and the button).
        return;
      case 'menu':
        this.toggleMenu();
        return;
      case 'mute':
        s.toggleMute();
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
      case 'ability': {
        // Phase fires at once; blink and Override need a target, so they enter targeting mode.
        const phase = this.withAbility(units, 'phase');
        if (phase.length > 0) s.send({ type: 'ability', units: phase });
        if (this.withAbility(units, 'blink').length > 0 || this.withAbility(units, 'override').length > 0) this.setMode('ability');
        else if (phase.length === 0 && units.length > 0) s.warn('No ability on the selected units');
        return;
      }
      case 'stance': {
        if (units.length === 0) return;
        // Cycle guard -> aggressive -> hold ground -> hold fire, from the first unit's stance.
        const order = [0, 2, 1, 3];
        const cur = s.field(units[0]!, E.stance);
        const next = order[(order.indexOf(cur) + 1) % order.length]!;
        s.send({ type: 'stance', units, stance: next });
        s.notice(`Stance: ${STANCE_NAMES[next]}`);
        return;
      }
      // base
      case 'buildMenu':
        s.sidebarTab = 'structures';
        this.setMode('buildMenu');
        return;
      case 'defenseMenu':
        s.sidebarTab = 'defenses';
        this.setMode('defenseMenu');
        return;
      case 'infantryMenu':
      case 'vehicleMenu':
      case 'airMenu':
        s.sidebarTab = action === 'infantryMenu' ? 'infantry' : action === 'vehicleMenu' ? 'vehicles' : 'air';
        this.setMode(action);
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
    if (this.state.placing) {
      this.tryPlace(p.x, p.y, e.shiftKey);
      return;
    }
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
      else if (this.state.hoverEntity >= 0) {
        this.state.hoverEntity = -1;
        this.state.changed();
      }
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
    if (h >= 0 && s.field(h, E.kind) === KIND.wreck && haveUnits) return { kind: 'move', target: h };
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
    // A production building selected and the ground clicked: that's its new rally point.
    if (units.length === 0 && intent.kind !== 'select' && this.selectedFactory()) {
      const p = this.simPoint(sx, sy);
      s.send({ type: 'rally', target: s.selection[0]!, x: p.x, y: p.y });
      this.renderer.ping(sx, sy, 0xe8c35a);
      return;
    }
    if (intent.kind !== 'select' && this.economyClick(sx, sy, intent.target, units, shift, false)) return;
    if (intent.kind === 'attack') {
      s.send({ type: 'attack', units, target: intent.target, queue: shift });
      this.renderer.ping(sx, sy, 0xff5a5a);
      return;
    }
    if (intent.kind === 'move') {
      // Clicking the ground is an attack-move: units fight what they meet (M + click for a pure move).
      const p = this.simPoint(sx, sy);
      s.send({ type: 'attackMove', units, x: p.x, y: p.y, queue: shift });
      this.renderer.ping(sx, sy, 0xffb46d);
      return;
    }
    this.clickSelect(sx, sy, shift, ctrl);
  }

  private updateCursor(sx: number, sy: number): void {
    const mode = this.state.mode;
    const hovered = this.state.placing ? -1 : this.renderer.pick(sx, sy);
    if (hovered !== this.state.hoverEntity) {
      const r = this.canvas.getBoundingClientRect();
      this.state.hoverEntity = hovered;
      this.state.hoverPos = { x: sx + r.left, y: sy + r.top };
      this.state.changed();
    }
    let cursor: string;
    if (mode === 'attackMove' || mode === 'patrol' || mode === 'ability') cursor = CURSORS.attack;
    else if (mode === 'move') cursor = CURSORS.move;
    else if (mode === 'guard') cursor = CURSORS.select;
    else if (mode === 'repair' || mode === 'sell') cursor = CURSORS.tool;
    else {
      const k = this.intentAt(sx, sy).kind;
      const rally = k !== 'select' && this.state.selectedUnits().length === 0 && this.selectedFactory() !== null;
      cursor = k === 'attack' ? CURSORS.attack : k === 'move' || rally ? CURSORS.move : k === 'select' ? CURSORS.select : 'default';
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

  /** Right click backs out: cancels placement or a targeting mode, otherwise clears the selection. */
  rightClick(_sx: number, _sy: number, _shift: boolean): void {
    const s = this.state;
    if (s.placing) {
      this.stopPlacing();
      return;
    }
    if (s.mode !== 'normal') {
      this.setMode('normal');
      return;
    }
    if (s.selection.length > 0) s.select([]);
  }

  /**
   * Order the selection to a sim position given from the minimap (tile coordinates):
   * a target mode (A/P/M/G) applies there, otherwise it's the same as a ground right-click.
   */
  minimapOrder(u: number, v: number, shift: boolean): boolean {
    const s = this.state;
    const units = s.selectedUnits();
    const factory = this.selectedFactory();
    const x = Math.round(Math.max(0, Math.min(s.width - 0.01, u)) * FX);
    const y = Math.round(Math.max(0, Math.min(s.height - 0.01, v)) * FX);
    if (units.length === 0) {
      if (!factory) return false;
      s.send({ type: 'rally', target: s.selection[0]!, x, y });
      return true;
    }
    const mode = s.mode;
    if (mode === 'move' || mode === 'patrol') s.send({ type: mode, units, x, y, queue: shift });
    else s.send({ type: 'attackMove', units, x, y, queue: shift });
    if (TARGET_MODES.includes(mode) && !shift) this.setMode('normal');
    return true;
  }

  /** Selected units that have an active ability of this kind and can use it now. */
  withAbility(units: number[], kind: 'blink' | 'phase' | 'override'): number[] {
    const s = this.state;
    return units.filter((h) => {
      const rule = s.ruleOf(h);
      return rule.kind === 'unit' && rule.abilities.some((a) => a.kind === kind) && s.field(h, E.abilityLeft) === 0;
    });
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
      case 'ability': {
        const blink = this.withAbility(units, 'blink');
        if (blink.length > 0) s.send({ type: 'ability', units: blink, x: p.x, y: p.y });
        const override = this.withAbility(units, 'override');
        if (override.length > 0) {
          if (h >= 0 && s.isUnit(h) && s.teamOf(h) !== s.players[s.localPlayer]!.team) s.send({ type: 'ability', units: override, target: h });
          else if (blink.length === 0) s.warn('Override: click an enemy vehicle');
        }
        break;
      }
      case 'repair':
      case 'sell':
        if (h >= 0 && s.isOwn(h) && !s.isUnit(h)) s.send({ type: s.mode, target: h });
        break;
      default:
        break;
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

  // --- economy ---

  /**
   * Harvesters on Echo (or a refinery, right-click), salvagers on wrecks.
   * Returns true if the click was handled.
   */
  private economyClick(sx: number, sy: number, h: number, units: number[], shift: boolean, right: boolean): boolean {
    const s = this.state;
    const harvesters = units.filter((u) => this.isHarvester(u));
    if (h >= 0 && s.field(h, E.kind) === KIND.wreck) {
      s.send({ type: 'salvage', units, target: h, queue: shift });
      this.renderer.ping(sx, sy, 0xe8c35a);
      return true;
    }
    if (harvesters.length === 0) return false;
    const p = this.simPoint(sx, sy);
    const tile = (p.y >> FX_SHIFT) * s.width + (p.x >> FX_SHIFT);
    const onEcho = (s.echo[tile] ?? 0) > 0;
    const onRefinery = right && h >= 0 && s.isOwn(h) && !s.isUnit(h) && (s.ruleOf(h) as StructureRule).role === 'refinery';
    if (!onEcho && !onRefinery) return false;
    s.send({ type: 'harvest', units: harvesters, x: p.x, y: p.y });
    const others = units.filter((u) => !harvesters.includes(u));
    if (others.length > 0) s.send({ type: 'move', units: others, x: p.x, y: p.y, queue: shift });
    this.renderer.ping(sx, sy, 0x3ee6ff);
    return true;
  }

  factionStructures(): StructureRule[] {
    const s = this.state;
    const f = s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]!;
    return f.structures.map((i) => s.rules.structures[i]!);
  }

  factionUnits(): UnitRule[] {
    const s = this.state;
    const f = s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]!;
    return f.units.map((i) => s.rules.units[i]!);
  }

  /** The single selected own production structure, if any. */
  selectedFactory(): StructureRule | null {
    const s = this.state;
    if (s.selection.length !== 1) return null;
    const h = s.selection[0]!;
    if (!s.isOwn(h) || s.isUnit(h) || s.field(h, E.kind) !== KIND.structure) return null;
    const rule = s.ruleOf(h) as StructureRule;
    return rule.produces ? rule : null;
  }

  /** Sidebar click on a structure: start building it, or pick it up for placement when ready. */
  activateStructure(rule: StructureRule): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur || !rule.category) return;
    const q = cur.buildQueue(s.localPlayer, rule.category === 'structures' ? 0 : 1);
    const missing = s.missing(rule.requires);
    if (q.item === rule.index && q.ready) {
      s.placing = { category: rule.category, item: rule.index };
      this.setMode('normal');
      s.changed();
    } else if (!s.roles().get('conyard')) {
      s.warn('No construction yard — deploy your construction vehicle (D)');
    } else if (q.item === rule.index) {
      s.warn(`${rule.name} is already being built`);
    } else if (q.item >= 0) {
      s.warn(`Already building ${s.rules.structures[q.item]!.name}${q.ready ? ' — place it first' : ''}`);
    } else if (missing.length > 0) {
      s.warn(`${rule.name} requires ${missing.map(roleName).join(', ')}`);
    } else {
      if (cur.credits(s.localPlayer) <= 0) s.warn('Not enough money');
      s.send({ type: 'build', category: rule.category, item: rule.index });
    }
  }

  cancelStructure(rule: StructureRule): void {
    const s = this.state;
    if (!rule.category || !s.cur) return;
    if (s.cur.buildQueue(s.localPlayer, rule.category === 'structures' ? 0 : 1).item !== rule.index) return;
    if (s.placing?.item === rule.index) this.stopPlacing();
    s.send({ type: 'cancelBuild', category: rule.category });
  }

  activateUnit(rule: UnitRule, count: number): void {
    const s = this.state;
    const missing = s.missing(rule.requires);
    if (missing.length > 0) {
      s.warn(`${rule.name} requires ${missing.map(roleName).join(', ')}`);
      return;
    }
    s.send({ type: 'train', item: rule.index, count });
  }

  cancelUnit(rule: UnitRule): void {
    this.state.send({ type: 'cancelTrain', item: rule.index });
  }

  stopPlacing(): void {
    this.state.placing = null;
    this.state.changed();
  }

  /** Footprint origin for the placement ghost under the cursor. */
  placementAt(sx: number, sy: number): { tx: number; ty: number; rule: StructureRule; error: string | null } | null {
    const s = this.state;
    if (!s.placing || !s.cur) return null;
    const rule = s.rules.structures[s.placing.item]!;
    const { u, v } = this.renderer.screenToTile(sx, sy);
    const tx = Math.floor(u - rule.footprintW / 2 + 0.5);
    const ty = Math.floor(v - rule.footprintH / 2 + 0.5);
    const faction = s.rules.factions[s.players[s.localPlayer]!.faction]!;
    const err = placementError(s.placementView(), s.localPlayer, faction, rule, tx, ty);
    return { tx, ty, rule, error: err ? PLACEMENT_MESSAGES[err] : null };
  }

  /** Last cursor position over the game view, in canvas px (for the placement ghost). */
  cursor(): { x: number; y: number } | null {
    if (!this.mouse.inside) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: this.mouse.x - r.left, y: this.mouse.y - r.top };
  }

  private tryPlace(sx: number, sy: number, shift: boolean): void {
    const s = this.state;
    const at = this.placementAt(sx, sy);
    if (!at || !s.placing) return;
    if (at.error) {
      s.notice(at.error);
      return;
    }
    s.send({ type: 'place', category: s.placing.category, tx: at.tx, ty: at.ty });
    const rule = at.rule;
    // Shift+click keeps placing walls: queue the next one right away.
    if (shift && rule.role === 'wall') {
      s.send({ type: 'build', category: s.placing.category, item: rule.index });
    }
    s.placing = null;
    s.changed();
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

  isHarvester(h: number): boolean {
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
