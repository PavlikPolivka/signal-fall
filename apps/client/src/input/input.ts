import { FX_SHIFT, KIND, PLACEMENT_MESSAGES, TERRAIN, TERRAIN_SPEED_PCT, placementError } from '@signal-fall/sim';
import type { StructureRule, UnitRule } from '@signal-fall/data';
import { E } from '../protocol';
import type { ClientState, Mode } from '../game/state';
import type { Renderer } from '../render/renderer';
import { bindings, matches, withOverrides, type Binding, type Context } from './keymap';
import { roleName, roleNames } from '../game/names';

/** Production tabs that stay open for several hotkeys in a row. */
const UNIT_MENUS: string[] = ['infantryMenu', 'vehicleMenu', 'airMenu'];

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

/**
 * Context cursors (what a click will do), drawn in the faction's style: Holdout a field
 * crosshair in amber, Halcyon square brackets in cyan, the Choir a violet crystal diamond.
 */
/** A plain arrow, for the large-cursor setting (the browser's own arrow can't be scaled). */
const ARROW = '<path d="M3 2v17l5-5 3 7 3-1-3-7h7z"/>';

function factionCursors(faction: string, large = false) {
  const shape: Record<string, { color: string; move: string; attack: string }> = {
    holdout: {
      color: '#e8c35a',
      move: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/>',
      attack: '<circle cx="12" cy="12" r="8"/><path d="M12 1v7M12 16v7M1 12h7M16 12h7"/>',
    },
    halcyon: {
      color: '#3ee6ff',
      move: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><circle cx="12" cy="12" r="1.5"/>',
      attack: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path d="M12 7v10M7 12h10"/>',
    },
    choir: {
      color: '#c58cff',
      move: '<path d="M12 3l6 9-6 9-6-9z"/>',
      attack: '<path d="M12 1l9 11-9 11-9-11z"/><path d="M12 7v10"/>',
    },
  };
  const f = shape[faction] ?? shape.holdout!;
  // Large cursor setting: the same shapes at 36 px.
  const px = large ? 36 : 24;
  const hot = large ? 18 : 12;
  const svg = (body: string, color: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24"><g fill="none" stroke="#000" stroke-width="4">${body}</g><g fill="none" stroke="${color}" stroke-width="2">${body}</g></svg>`;
  const arrow = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round">${ARROW}</g></svg>`;
  return {
    normal: large ? svgCursor(arrow, Math.round((3 * px) / 24), Math.round((2 * px) / 24), 'default') : 'default',
    move: svgCursor(svg(f.move, f.color), hot, hot, 'crosshair'),
    attack: svgCursor(svg(f.attack, '#ff5a5a'), hot, hot, 'crosshair'),
    select: 'pointer',
    tool: 'cell',
  };
}
let CURSORS = factionCursors('holdout');


/** Skirmish game speeds (- and = step through them). */
export const GAME_SPEEDS = [0.5, 0.75, 1, 1.5, 2];

export const STANCE_NAMES = ['Guard area', 'Hold ground', 'Aggressive', 'Hold fire'];

/** Modes that wait for a target click. */
const TARGET_MODES: Mode[] = ['move', 'attackMove', 'patrol', 'guard', 'ability', 'power', 'superweapon', 'repair', 'sell'];

/**
 * Keyboard and mouse handling. Every keyboard action goes through keymap.json;
 * `run(action, digit)` is the single entry point so the UI command card and
 * tests share the same code path.
 */
export class Input {
  private bindings: Binding[];
  private held = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  /** Direction the cursor left the window through (keeps scrolling until it returns), or null. */
  private exited: { dx: number; dy: number } | null = null;
  /** Since when the cursor has been in a panel-side edge zone (for the dwell delay). */
  private panelEdgeSince = 0;
  private drag: { x0: number; y0: number; x1: number; y1: number; button: number } | null = null;
  /** A wall line being dragged out (screen px). */
  private wallDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastClick = { time: 0, handle: -1 };
  private lastGroup = { digit: -1, time: 0 };
  private idleHarvesterCursor = 0;
  private productionCursor = 0;
  private idleArmyCursor = 0;
  /** Space pressed again soon after: step back to an older alert. */
  private alertCycle = { index: 0, time: 0 };

  constructor(
    private readonly state: ClientState,
    private readonly renderer: Renderer,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.bindings = bindings(withOverrides(state.rules.keymap, state.settings.keys));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      this.state.shiftHeld = e.shiftKey;
      this.state.altHeld = e.altKey;
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.state.altHeld = false;
    });
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
    this.advanceWallPlan();
    this.renderer.wallPlan = this.wallDrag ? this.renderer.wallPlan : (this.state.wallPlan?.tiles ?? []);
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
    this.state.altHeld = e.altKey;
    this.held.add(e.code);
    if (e.repeat && !e.code.startsWith('Arrow')) return;
    // Multiplayer: Enter opens the chat box.
    if (e.code === 'Enter' && this.state.multiplayer && !this.state.menuOpen) {
      e.preventDefault();
      this.state.chatOpen = true;
      this.state.changed();
      return;
    }
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
    // I / V / Y tabs stay open: every letter on the tab queues one more (Shift: five), so I G G G queues three.
    // A letter that is not on the tab closes it and does its usual job (A attack, S stop...).
    const menuTab = s.mode === 'infantryMenu' ? 'infantry' : s.mode === 'vehicleMenu' ? 'vehicles' : s.mode === 'airMenu' ? 'air' : null;
    // Ctrl+letter on an open tab (or with its factory selected): repeat that unit until cancelled.
    const repeatTab = menuTab ?? this.selectedFactory()?.produces ?? null;
    if (repeatTab && letter && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const unit = this.factionUnits().find((u) => u.tab === repeatTab && u.key === letter);
      if (unit) {
        e.preventDefault();
        this.toggleRepeat(unit);
        return;
      }
    }
    if (menuTab && letter && plain) {
      const unit = this.factionUnits().find((u) => u.tab === menuTab && u.key === letter);
      if (unit) {
        e.preventDefault();
        this.activateUnit(unit, e.shiftKey ? 5 : 1);
        return;
      }
      this.setMode('normal');
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
        // Space: the latest alert; Space again within 3 s: the one before it, and so on.
        const placed = s.alerts.filter((x) => x.x >= 0).reverse();
        if (placed.length === 0) return;
        const now = performance.now();
        const index = now - this.alertCycle.time < 3000 ? (this.alertCycle.index + 1) % placed.length : 0;
        this.alertCycle = { index, time: now };
        this.renderer.centerOnSim(placed[index]!.x, placed[index]!.y);
        return;
      }
      case 'cameraSave': {
        const cam = this.renderer.camera;
        s.bookmarks[digit - 1] = { x: cam.x, y: cam.y };
        s.notice(`Camera saved to F${digit}`);
        return;
      }
      case 'cameraJump': {
        const b = s.bookmarks[digit - 1];
        if (!b) {
          s.warn(`Nothing saved on F${digit} (Ctrl+F${digit} saves the view)`);
          return;
        }
        Object.assign(this.renderer.camera, b);
        this.renderer.clampCamera();
        return;
      }
      case 'speedUp':
      case 'speedDown': {
        if (s.multiplayer || s.replay) return;
        const i = GAME_SPEEDS.indexOf(s.gameSpeed);
        const next = GAME_SPEEDS[Math.max(0, Math.min(GAME_SPEEDS.length - 1, (i < 0 ? 2 : i) + (action === 'speedUp' ? 1 : -1)))]!;
        s.setGameSpeed(next);
        s.notice(`Game speed ${next}×`);
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
      case 'cycleProduction': {
        // Factories, barracks, airfields and the construction yard, one after another.
        const producers = this.allOwnStructures().filter((h) => ['conyard', 'barracks', 'factory', 'airfield'].includes((s.ruleOf(h) as { role: string }).role));
        if (producers.length === 0) return;
        const h = producers[this.productionCursor++ % producers.length]!;
        s.select([h]);
        this.renderer.centerOnSim(s.field(h, E.x), s.field(h, E.y));
        return;
      }
      case 'cycleIdleArmy': {
        const idle = this.idleUnits().army;
        if (idle.length === 0) return;
        const h = idle[this.idleArmyCursor++ % idle.length]!;
        s.select([h]);
        this.renderer.centerOnSim(s.field(h, E.x), s.field(h, E.y));
        return;
      }
      case 'selectDamaged':
        s.select(this.allOwnUnits().filter((h) => s.field(h, E.hp) < s.field(h, E.maxHp)));
        return;
      case 'superweaponFire': {
        // Charged: strike under the cursor straight away; otherwise say when.
        const c = this.cursor();
        if (s.superStatus() === 0 && c && !s.spectator) {
          const p = this.simPoint(c.x, c.y);
          s.send({ type: 'superweapon', x: p.x, y: p.y });
        } else this.superweapon();
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
        else if (s.wallPlan) {
          s.wallPlan = null;
          s.changed();
        } else if (s.placing) this.stopPlacing();
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
        // Instant abilities (phase, Dig In) fire right away; the rest need a click.
        const phase = [...this.withAbility(units, 'phase'), ...this.withAbility(units, 'digIn'), ...this.withAbility(units, 'uplink')];
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
      case 'supportPower':
        this.supportPower();
        return;
    }
  }

  /** Q or the sidebar button: target the faction's support power, if it is ready. */
  supportPower(): void {
    const s = this.state;
    const power = s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]?.power;
    if (!power || s.spectator) return;
    if (s.mode === 'power') return this.setMode('normal');
    const status = s.powerStatus();
    if (status === 0) this.setMode('power');
    else if (status > 0) s.warn(`${power.name} is ready in ${Math.ceil(status / 20)} s`);
    else s.warn(`${power.name} needs ${roleName(s.rules, s.players[s.localPlayer]!.faction, power.requires)} and power`);
  }

  /** The superweapon button: target it once charged. */
  superweapon(): void {
    const s = this.state;
    const rule = s.superweaponRule();
    if (!rule?.superweapon || s.spectator) return;
    if (s.mode === 'superweapon') return this.setMode('normal');
    const status = s.superStatus();
    if (status === 0) this.setMode('superweapon');
    else if (status > 0) s.warn(`${rule.superweapon.name} is ready in ${clock(status)}`);
    else s.warn(`${rule.superweapon.name} needs a ${rule.name}`);
  }

  /** Pick up changed key bindings (settings). */
  reloadBindings(): void {
    this.bindings = bindings(withOverrides(this.state.rules.keymap, this.state.settings.keys));
  }

  /** Cursor set for the local player's faction (called once the match is known). */
  useFactionCursors(): void {
    const s = this.state;
    CURSORS = factionCursors(s.rules.factions[s.players[s.localPlayer]?.faction ?? 0]?.id ?? 'holdout', s.settings.largeCursor);
  }

  setMode(mode: Mode): void {
    this.state.mode = mode;
    this.canvas.style.cursor = mode === 'move' ? CURSORS.move : TARGET_MODES.includes(mode) ? CURSORS.attack : CURSORS.normal;
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

  // --- touch: tap = click, one finger pans (or box-selects in box mode), two fingers pinch-zoom and pan,
  // a long press backs out like a right click ---
  private touches = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private pinch: { d: number; zoom: number; cx: number; cy: number } | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;

  private onTouchDown(e: PointerEvent): void {
    if (!this.state.touched) {
      this.state.touched = true;
      this.state.changed();
    }
    const p = this.local(e);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // No such pointer to capture (synthetic events): fine.
    }
    this.touches.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: performance.now() });
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: this.renderer.camera.zoom, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
      this.drag = null;
      this.renderer.drawBox(null);
      return;
    }
    if (this.touches.size > 2) return;
    // Long press without moving: back out (deselect, cancel a mode or placement).
    this.longPress = setTimeout(() => {
      const t = this.touches.get(e.pointerId);
      if (t && Math.hypot(t.x - t.x0, t.y - t.y0) < 12) {
        this.touches.delete(e.pointerId);
        this.rightClick(t.x, t.y, false);
        this.renderer.ping(t.x, t.y, 0x9aa0a6);
      }
    }, 550);
    if (this.state.touchBox) this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, button: 0 };
  }

  private onTouchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const p = this.local(e);
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    t.x = p.x;
    t.y = p.y;
    const cam = this.renderer.camera;
    if (this.pinch && this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      cam.zoom = Math.max(0.4, Math.min(2, (this.pinch.zoom * d) / Math.max(1, this.pinch.d)));
      const cx = (a!.x + b!.x) / 2;
      const cy = (a!.y + b!.y) / 2;
      cam.x -= (cx - this.pinch.cx) / cam.zoom;
      cam.y -= (cy - this.pinch.cy) / cam.zoom;
      this.pinch.cx = cx;
      this.pinch.cy = cy;
      this.renderer.clampCamera();
      return;
    }
    if (this.drag) {
      this.drag.x1 = p.x;
      this.drag.y1 = p.y;
      if (this.dragSize() > 8) this.renderer.drawBox(this.drag);
      return;
    }
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    this.renderer.clampCamera();
  }

  private onTouchUp(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
    if (this.touches.size < 2) this.pinch = null;
    if (!t) return;
    const d = this.drag;
    if (d) {
      this.drag = null;
      this.renderer.drawBox(null);
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 8) {
        this.boxSelect(d, false);
        return;
      }
    }
    // A short tap that barely moved: a click.
    if (Math.hypot(t.x - t.x0, t.y - t.y0) < 12 && performance.now() - t.t0 < 450 && this.touches.size === 0) {
      if (this.state.placing) this.tryPlace(t.x, t.y, false);
      else if (TARGET_MODES.includes(this.state.mode)) this.targetClick(t.x, t.y, false);
      else this.leftClick(t.x, t.y, false, false);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      e.preventDefault();
      this.onTouchDown(e);
      return;
    }
    const p = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, button: 1 };
      return;
    }
    if (e.button === 2) {
      // Right-drag with units selected draws a formation line; a plain right-click backs out.
      if (this.state.selectedUnits().length > 1 && this.state.mode === 'normal' && !this.state.placing) {
        this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, button: 2 };
        return;
      }
      this.rightClick(p.x, p.y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    // Multiplayer: Alt+click pings the spot for your team.
    if (e.altKey && this.state.multiplayer) {
      const at = this.simPoint(p.x, p.y);
      this.state.sendChat('', true, at);
      return;
    }
    // Clicking the battlefield closes an open production tab.
    if (UNIT_MENUS.includes(this.state.mode)) this.setMode('normal');
    if (this.state.placing) {
      // Walls: drag out a whole line (a plain click still places one).
      const at = this.placementAt(p.x, p.y);
      if (at && at.rule.role === 'wall') {
        this.wallDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        return;
      }
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
    if (e.pointerType === 'touch') {
      this.onTouchMove(e);
      return;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
    const p = this.local(e);
    if (this.wallDrag) {
      this.wallDrag.x1 = p.x;
      this.wallDrag.y1 = p.y;
      this.renderer.wallPlan = this.wallLine(this.wallDrag);
      return;
    }
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
    if (this.drag.button === 2) this.renderer.drawLine(this.dragSize() > 12 ? this.drag : null, this.state.selectedUnits().length);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.onTouchUp(e);
      return;
    }
    if (this.wallDrag) {
      const line = this.wallLine(this.wallDrag);
      const w = this.wallDrag;
      this.wallDrag = null;
      this.renderer.wallPlan = [];
      if (line.length <= 1) this.tryPlace(w.x1, w.y1, e.shiftKey);
      else this.startWallLine(line);
      return;
    }
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.renderer.drawBox(null);
    if (d.button === 2) {
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 12) this.formationMove(d, e.shiftKey);
      else this.rightClick(d.x1, d.y1, e.shiftKey);
      return;
    }
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
      this.setRally(s.selection[0]!, p.x, p.y);
      this.renderer.ping(sx, sy, 0xe8c35a);
      return;
    }
    if (intent.kind !== 'select' && this.economyClick(sx, sy, intent.target, units, shift, false)) return;
    if (intent.kind === 'attack') {
      s.send({ type: 'attack', units, target: intent.target, queue: shift });
      this.renderer.ping(sx, sy, 0xff5a5a);
      return;
    }
    // Infantry clicked onto city ruins: they climb in.
    if (intent.kind === 'move' && this.ruinsAt(sx, sy) && units.some((h) => this.isInfantry(h))) {
      const p = this.simPoint(sx, sy);
      s.send({ type: 'garrison', units: units.filter((h) => this.isInfantry(h)), tx: p.x >> FX_SHIFT, ty: p.y >> FX_SHIFT });
      const others = units.filter((h) => !this.isInfantry(h));
      if (others.length > 0) s.send({ type: 'attackMove', units: others, x: p.x, y: p.y, queue: shift });
      this.renderer.ping(sx, sy, 0x9fd7ff);
      return;
    }
    // Ctrl+click on the ground: artillery and other splash weapons shell that spot (force fire).
    if (intent.kind === 'move' && ctrl) {
      const shellers = units.filter((h) => {
        const w = (s.ruleOf(h) as { weapon?: { splash: number; targetsGround: boolean } | null }).weapon;
        return !!w && w.splash > 0 && w.targetsGround;
      });
      if (shellers.length > 0) {
        const p = this.simPoint(sx, sy);
        s.send({ type: 'attackGround', units: shellers, x: p.x, y: p.y, queue: shift });
        const others = units.filter((h) => !shellers.includes(h));
        if (others.length > 0) s.send({ type: 'attackMove', units: others, x: p.x, y: p.y, queue: shift });
        this.renderer.ping(sx, sy, 0xff5a5a);
        return;
      }
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
    // The Echo tile under the cursor (when nothing else is), for the field card.
    const p = this.simPoint(sx, sy);
    const tile = (p.y >> FX_SHIFT) * this.state.width + (p.x >> FX_SHIFT);
    const echoTile = hovered < 0 && !this.state.placing && p.x >= 0 && p.y >= 0 && (this.state.echo[tile] ?? 0) > 0 && (!this.state.fog || (this.state.fog[tile]! & 2) !== 0) ? tile : -1;
    if (hovered !== this.state.hoverEntity || echoTile !== this.state.hoverEcho) {
      const r = this.canvas.getBoundingClientRect();
      this.state.hoverEntity = hovered;
      this.state.hoverEcho = echoTile;
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
      if (k === 'move' && this.ruinsAt(sx, sy) && this.state.selectedUnits().some((h) => this.isInfantry(h))) {
        if (this.canvas.style.cursor !== CURSORS.tool) this.canvas.style.cursor = CURSORS.tool;
        return;
      }
      cursor = k === 'attack' ? CURSORS.attack : k === 'move' || rally ? CURSORS.move : k === 'select' ? CURSORS.select : CURSORS.normal;
    }
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  private dragSize(): number {
    return this.drag ? Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) : 0;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const cam = this.renderer.camera;
    const p = this.local(e);
    // Zoom toward the cursor: the world point under it stays put.
    const wx = (p.x - this.renderer.width / 2) / cam.zoom + cam.x;
    const wy = (p.y - this.renderer.height / 2) / cam.zoom + cam.y;
    const zoomIn = (e.deltaY < 0) !== this.state.settings.invertWheel;
    cam.zoom = Math.max(0.4, Math.min(2, cam.zoom * (zoomIn ? 1.1 : 1 / 1.1)));
    cam.x = wx - (p.x - this.renderer.width / 2) / cam.zoom;
    cam.y = wy - (p.y - this.renderer.height / 2) / cam.zoom;
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

  /**
   * Formation move: spread the selection evenly along a line drawn on the ground. Units are
   * matched to spots in order along the line, so they don't cross each other's paths.
   */
  formationMove(d: { x0: number; y0: number; x1: number; y1: number }, shift: boolean): void {
    const s = this.state;
    const units = s.selectedUnits();
    if (units.length === 0) return;
    const a = this.simPoint(d.x0, d.y0);
    const b = this.simPoint(d.x1, d.y1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = (h: number) => (s.field(h, E.x) - a.x) * dx + (s.field(h, E.y) - a.y) * dy;
    const sorted = [...units].sort((p, q) => along(p) - along(q));
    sorted.forEach((h, i) => {
      const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1);
      s.send({ type: 'move', units: [h], x: Math.round(a.x + dx * t), y: Math.round(a.y + dy * t), queue: shift });
    });
    this.renderer.ping(d.x1, d.y1, 0x6dff8a);
  }

  /** Right click backs out: cancels placement or a targeting mode, otherwise clears the selection. */
  rightClick(_sx: number, _sy: number, _shift: boolean): void {
    const s = this.state;
    if (s.wallPlan) {
      // Stop laying the rest of a wall line.
      s.wallPlan = null;
      s.changed();
      return;
    }
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
      this.setRally(s.selection[0]!, x, y);
      return true;
    }
    const mode = s.mode;
    if (mode === 'move' || mode === 'patrol') s.send({ type: mode, units, x, y, queue: shift });
    else s.send({ type: 'attackMove', units, x, y, queue: shift });
    if (TARGET_MODES.includes(mode) && !shift) this.setMode('normal');
    return true;
  }

  /** Selected units that have an active ability of this kind and can use it now. */
  withAbility(units: number[], kind: 'blink' | 'phase' | 'override' | 'digIn' | 'uplink'): number[] {
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
          if (h >= 0 && s.isUnit(h) && s.teamOf(h) !== s.players[s.localPlayer]!.team) {
            // Smart cast: one Override per target, from the nearest ready unit; the rest keep theirs.
            const tx = s.field(h, E.x);
            const ty = s.field(h, E.y);
            const d = (u: number) => Math.hypot(s.field(u, E.x) - tx, s.field(u, E.y) - ty);
            const caster = override.reduce((a, b) => (d(b) < d(a) ? b : a));
            s.send({ type: 'ability', units: [caster], target: h });
          }
          else if (blink.length === 0) s.warn('Override: click an enemy vehicle');
        }
        break;
      }
      case 'power':
        s.send({ type: 'power', x: p.x, y: p.y });
        break;
      case 'superweapon':
        s.send({ type: 'superweapon', x: p.x, y: p.y });
        break;
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
    if (ctrl && double && s.isOwn(h) && s.isUnit(h)) {
      // Ctrl+double-click: every unit of that type on the map.
      const type = s.field(h, E.type);
      s.select(this.allOwnUnits().filter((u) => s.field(u, E.type) === type));
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

  /**
   * Sidebar click (or B/N + letter) on a structure. Place-first: pick a spot and it is built
   * there, placing itself when done. Picking it again while choosing a spot starts it without
   * one (place it later). A finished structure is picked up for placement.
   */
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
    } else if (s.placing?.planned && s.placing.item === rule.index && q.item < 0) {
      // Second pick: start now, choose the spot when it is done.
      this.stopPlacing();
      s.send({ type: 'build', category: rule.category, item: rule.index });
    } else if (q.item < 0 && s.roles().get('conyard') && missing.length === 0) {
      s.placing = { category: rule.category, item: rule.index, planned: true };
      this.setMode('normal');
      s.changed();
    } else if (!s.roles().get('conyard')) {
      s.warn('No construction yard — deploy your construction vehicle (D)');
    } else if (q.item === rule.index) {
      s.warn(`${rule.name} is already being built`);
    } else if (q.item >= 0) {
      s.warn(`Already building ${s.rules.structures[q.item]!.name}${q.ready ? ' — place it first' : ''}`);
    } else if (missing.length > 0) {
      s.warn(`${rule.name} requires ${roleNames(s.rules, rule.faction, missing)}`);
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
    const comeback = rule.index === s.rules.factions[rule.faction]!.constructionUnit && s.emergencyRebuild();
    const missing = comeback ? [] : s.missing(rule.requires);
    if (missing.length > 0) {
      s.warn(`${rule.name} requires ${roleNames(s.rules, rule.faction, missing)}`);
      return;
    }
    s.send({ type: 'train', item: rule.index, count });
  }

  /** Right-click: stop repeating, else remove one. Shift+right-click: clear every one of this type. */
  cancelUnit(rule: UnitRule, all = false): void {
    const s = this.state;
    if (s.repeat.has(rule.index)) {
      s.toggleRepeat(rule.index);
      if (!all) return;
    }
    const tab = rule.tab === 'infantry' ? 0 : rule.tab === 'vehicles' ? 1 : 2;
    const n = all ? (s.cur?.productionQueue(s.localPlayer, tab).items.filter((x) => x === rule.index).length ?? 0) : 1;
    for (let i = 0; i < n; i++) s.send({ type: 'cancelTrain', item: rule.index });
  }

  /** Ctrl+click or Ctrl+letter: build this unit over and over (queues one whenever none is left). */
  toggleRepeat(rule: UnitRule): void {
    const s = this.state;
    const missing = s.missing(rule.requires);
    if (!s.repeat.has(rule.index) && missing.length > 0) {
      s.warn(`${rule.name} requires ${roleNames(s.rules, rule.faction, missing)}`);
      return;
    }
    s.toggleRepeat(rule.index);
    s.notice(s.repeat.has(rule.index) ? `Repeating ${rule.name} (right-click to stop)` : `${rule.name}: repeat off`);
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

  /** Wall tiles from the drag's start to its end, along whichever axis it went further (straight lines only). */
  private wallLine(d: { x0: number; y0: number; x1: number; y1: number }): { tx: number; ty: number }[] {
    const a = this.placementAt(d.x0, d.y0);
    const b = this.placementAt(d.x1, d.y1);
    if (!a || !b) return [];
    const step = Math.max(1, a.rule.footprintW);
    const dx = b.tx - a.tx;
    const dy = b.ty - a.ty;
    const alongX = Math.abs(dx) >= Math.abs(dy);
    const n = Math.min(40, Math.floor(Math.abs(alongX ? dx : dy) / step));
    const out: { tx: number; ty: number }[] = [];
    for (let k = 0; k <= n; k++) out.push(alongX ? { tx: a.tx + Math.sign(dx) * k * step, ty: a.ty } : { tx: a.tx, ty: a.ty + Math.sign(dy) * k * step });
    return out;
  }

  /** Lay a wall line: the first piece now, the rest one after another as each places itself. */
  private startWallLine(line: { tx: number; ty: number }[]): void {
    const s = this.state;
    if (!s.placing) return;
    const item = s.placing.item;
    const category = s.placing.category;
    const [first, ...rest] = line;
    if (s.placing.planned) s.send({ type: 'build', category, item, tx: first!.tx, ty: first!.ty });
    else s.send({ type: 'place', category, tx: first!.tx, ty: first!.ty });
    s.wallPlan = { item, category, tiles: rest, sentAt: performance.now() };
    s.placing = null;
    s.changed();
  }

  /** Each frame: when the defense queue is free, the next piece of a planned wall line. */
  private advanceWallPlan(): void {
    const s = this.state;
    const plan = s.wallPlan;
    if (!plan || !s.cur) return;
    if (plan.tiles.length === 0) {
      s.wallPlan = null;
      return;
    }
    // Give the last order a moment to reach the sim before reading the queue.
    if (performance.now() - plan.sentAt < 400) return;
    if (s.cur.buildQueue(s.localPlayer, 1).item >= 0) return;
    const faction = s.rules.factions[s.players[s.localPlayer]!.faction]!;
    const rule = s.rules.structures[plan.item]!;
    while (plan.tiles.length > 0) {
      const t = plan.tiles.shift()!;
      if (placementError(s.placementView(), s.localPlayer, faction, rule, t.tx, t.ty)) continue;
      s.send({ type: 'build', category: plan.category, item: plan.item, tx: t.tx, ty: t.ty });
      plan.sentAt = performance.now();
      break;
    }
    s.changed();
  }

  private tryPlace(sx: number, sy: number, shift: boolean): void {
    const s = this.state;
    const at = this.placementAt(sx, sy);
    if (!at || !s.placing) return;
    if (at.error) {
      s.notice(at.error);
      return;
    }
    const rule = at.rule;
    if (s.placing.planned) {
      if (s.cur && s.cur.credits(s.localPlayer) <= 0) s.warn('Not enough money');
      s.send({ type: 'build', category: s.placing.category, item: rule.index, tx: at.tx, ty: at.ty });
    } else {
      s.send({ type: 'place', category: s.placing.category, tx: at.tx, ty: at.ty });
      // Shift+click keeps placing defenses (walls, turrets): plan the next one right away.
      if (shift && rule.category === 'defenses') {
        s.placing = { category: s.placing.category, item: rule.index, planned: true };
        s.changed();
        return;
      }
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

  private allOwnStructures(): number[] {
    const cur = this.state.cur;
    if (!cur) return [];
    const out: number[] = [];
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.owner) === this.state.localPlayer && cur.get(o, E.kind) === KIND.structure) out.push(cur.get(o, E.handle));
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

  /** Own harvesters doing nothing, and own armed units with no orders and nothing to shoot. */
  idleUnits(): { harvesters: number[]; army: number[] } {
    const s = this.state;
    const harvesters: number[] = [];
    const army: number[] = [];
    for (const h of this.allOwnUnits()) {
      if (s.field(h, E.orderCount) !== 0) continue;
      if (this.isHarvester(h)) {
        if (s.field(h, E.hstate) === 0) harvesters.push(h);
      } else if (this.isArmy(h) && s.field(h, E.target) < 0) army.push(h);
    }
    return { harvesters, army };
  }

  /** Ground regions (connected passable tiles), worked out once per map for rally checks. */
  private regions: Int32Array | null = null;

  private region(tile: number): number {
    const s = this.state;
    if (!this.regions || this.regions.length !== s.terrain.length) {
      const r = new Int32Array(s.terrain.length).fill(-1);
      let next = 0;
      for (let start = 0; start < r.length; start++) {
        if (r[start] !== -1 || TERRAIN_SPEED_PCT[s.terrain[start]!] === 0) continue;
        const stack = [start];
        r[start] = next;
        while (stack.length > 0) {
          const t = stack.pop()!;
          const x = t % s.width;
          for (const n of [x > 0 ? t - 1 : -1, x < s.width - 1 ? t + 1 : -1, t - s.width, t + s.width]) {
            if (n < 0 || n >= r.length || r[n] !== -1 || TERRAIN_SPEED_PCT[s.terrain[n]!] === 0) continue;
            r[n] = next;
            stack.push(n);
          }
        }
        next++;
      }
      this.regions = r;
    }
    return this.regions[tile] ?? -1;
  }

  /** Set a factory's rally point; warn when ground units could never walk there. */
  setRally(factory: number, x: number, y: number): void {
    const s = this.state;
    s.send({ type: 'rally', target: factory, x, y });
    const rule = s.ruleOf(factory) as StructureRule;
    if (rule.produces === 'air') return;
    const fx = (s.field(factory, E.x) >> FX_SHIFT) + 0;
    const fy = (s.field(factory, E.y) >> FX_SHIFT) + Math.ceil(rule.footprintH / 2);
    const from = this.region(Math.min(s.height - 1, fy) * s.width + Math.min(s.width - 1, fx));
    const to = this.region((y >> FX_SHIFT) * s.width + (x >> FX_SHIFT));
    if (to < 0) s.warn('Rally point is on blocked ground: units will gather as close as they can');
    else if (from >= 0 && to !== from) s.warn("Rally point can't be reached from this factory: units will gather as close as they can");
  }

  /** Center the camera on a sim position (Q10). */
  lookAt(x: number, y: number): void {
    this.renderer.centerOnSim(x, y);
  }

  /** Top bar: select idle harvesters (cycling one at a time) or the whole idle army, and look at them. */
  selectIdle(kind: 'harvesters' | 'army'): void {
    const s = this.state;
    const list = this.idleUnits()[kind];
    if (list.length === 0) return;
    if (kind === 'harvesters') return this.run('selectIdleHarvesters', 0);
    s.select(list);
    let x = 0;
    let y = 0;
    for (const h of list) {
      x += s.field(h, E.x);
      y += s.field(h, E.y);
    }
    this.renderer.centerOnSim(Math.round(x / list.length), Math.round(y / list.length));
  }

  /** Is the tile under this screen point city ruins (somewhere infantry can garrison)? */
  ruinsAt(sx: number, sy: number): boolean {
    const p = this.simPoint(sx, sy);
    return this.state.terrain[(p.y >> FX_SHIFT) * this.state.width + (p.x >> FX_SHIFT)] === TERRAIN.ruins;
  }

  isInfantry(h: number): boolean {
    const r = this.state.ruleOf(h);
    return r.kind === 'unit' && r.tab === 'infantry' && !r.isAir;
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

  /** Own units (or buildings) of the same type as h, on screen. */
  private onScreenOfType(h: number): number[] {
    const s = this.state;
    const type = s.field(h, E.type);
    const kind = s.field(h, E.kind);
    const cur = s.cur;
    if (!cur) return [];
    const same: number[] = [];
    for (let i = 0; i < cur.entityCount; i++) {
      const o = cur.ent(i);
      if (cur.get(o, E.owner) === s.localPlayer && cur.get(o, E.kind) === kind && cur.get(o, E.type) === type) same.push(cur.get(o, E.handle));
    }
    return same.filter((u) => {
      const p = this.renderer.screenOf(u);
      return p !== null && p.x >= 0 && p.y >= 0 && p.x <= this.renderer.width && p.y <= this.renderer.height;
    });
  }
}

/** Ticks as m:ss. */
function clock(ticks: number): string {
  const sec = Math.ceil(ticks / 20);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
