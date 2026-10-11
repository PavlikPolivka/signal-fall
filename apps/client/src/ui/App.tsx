import { useEffect, useReducer, useRef } from 'preact/hooks';
import { KIND } from '@signal-fall/sim';
import type { StructureRule, UnitRule } from '@signal-fall/data';
import { E, H, P } from '../protocol';
import { TEAM_COLORS, type ClientState, type SidebarTab } from '../game/state';
import type { Input } from '../input/input';
import { BIOME_COLORS, type Renderer } from '../render/renderer';
import { chordLabel } from '../input/keymap';
import { STANCE_NAMES } from '../input/input';
import { EntityCard, ItemCard } from './InfoCard';
import { Codex } from './Codex';
import { isoX, isoY } from '../game/iso';
import { Icon } from './Icon';
import { Credits } from './Credits';
import type { GameAudio } from '../audio/audio';

const FX = 1024;

function useStateVersion(state: ClientState): void {
  const [, force] = useReducer((n: number, _: undefined) => n + 1, 0);
  useEffect(() => state.subscribe(() => force(undefined)), [state]);
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function App(props: { state: ClientState; input: Input; renderer: Renderer; audio: GameAudio; gameHost: (el: HTMLDivElement) => void }) {
  const { state } = props;
  useStateVersion(state);
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hostRef.current) props.gameHost(hostRef.current);
  }, []);
  const factionId = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]?.id ?? 'holdout';
  return (
    <div class="layout" data-faction={factionId}>
      <TopBar state={state} input={props.input} />
      <div class="game" ref={hostRef} data-testid="game" />
      <BottomPanel state={state} input={props.input} />
      <Sidebar state={state} input={props.input} renderer={props.renderer} />
      <HoverCards state={state} />
      {state.menuOpen && <Menu state={state} input={props.input} audio={props.audio} />}
      {state.creditsOpen && (
        <Credits
          onClose={() => {
            state.creditsOpen = false;
            state.changed();
          }}
        />
      )}
      {state.codexOpen && (
        <Codex
          rules={state.rules}
          onClose={() => {
            state.codexOpen = false;
            state.changed();
          }}
        />
      )}
      <EndScreen state={state} />
      {state.multiplayer && <NetOverlays state={state} />}
    </div>
  );
}

function TopBar({ state, input }: { state: ClientState; input: Input }) {
  const tick = state.cur?.tick ?? 0;
  const secs = Math.floor(tick / 20);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const alert = state.alerts[state.alerts.length - 1];
  const fresh = alert && performance.now() - alert.time < 6000;
  return (
    <header class="topbar">
      <span class="timer" data-testid="timer">{time}</span>
      <span class={`alert ${fresh ? 'on' : ''} ${alert?.kind ?? ''}`} data-testid="alert">
        {fresh ? alert.text : ''}
      </span>
      {state.net && (
        <span class="net-badge" data-testid="net-badge" title="Round trip and input delay">
          ping {state.net.rtt >= 0 ? `${Math.round(state.net.rtt)} ms` : '…'} · delay {state.net.delayTurns}
        </span>
      )}
      <span class="fps" data-testid="fps">{state.fps} fps</span>
      <button class="menu-btn" onClick={() => input.toggleMenu()} title="Menu (Esc)">
        Menu <kbd>Esc</kbd>
      </button>
    </header>
  );
}

const TABS: { id: SidebarTab; label: string; key: string }[] = [
  { id: 'structures', label: 'Build', key: 'B' },
  { id: 'defenses', label: 'Defense', key: 'N' },
  { id: 'infantry', label: 'Infantry', key: 'I' },
  { id: 'vehicles', label: 'Vehicles', key: 'V' },
  { id: 'air', label: 'Air', key: 'Y' },
];
const MENU_MODES = ['buildMenu', 'defenseMenu', 'infantryMenu', 'vehicleMenu', 'airMenu'];

const ROLE_NAMES: Record<string, string> = {
  conyard: 'Construction Yard',
  power: 'Power',
  refinery: 'Refinery',
  barracks: 'Barracks',
  factory: 'Vehicle Factory',
  radar: 'Radar',
  special: 'Special',
  airfield: 'Airfield',
  tech: 'Tech Center',
};

function Sidebar({ state, input, renderer }: { state: ClientState; input: Input; renderer: Renderer }) {
  const faction = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]!;
  const cur = state.cur;
  const credits = cur?.credits(state.localPlayer) ?? 0;
  const produced = cur?.player(state.localPlayer, 2) ?? 0;
  const used = cur?.player(state.localPlayer, 3) ?? 0;
  const roles = state.roles();
  const structureTab = state.sidebarTab === 'structures' || state.sidebarTab === 'defenses';
  const items: (UnitRule | StructureRule)[] = structureTab
    ? faction.structures.map((i) => state.rules.structures[i]!).filter((s) => s.category === state.sidebarTab)
    : faction.units.map((i) => state.rules.units[i]!).filter((u) => u.tab === state.sidebarTab);
  const tabIndex = state.sidebarTab === 'infantry' ? 0 : state.sidebarTab === 'vehicles' ? 1 : 2;
  const bq = cur && structureTab ? cur.buildQueue(state.localPlayer, state.sidebarTab === 'structures' ? 0 : 1) : null;
  const pq = cur && !structureTab ? cur.productionQueue(state.localPlayer, tabIndex) : null;
  const teamColor = TEAM_COLORS[state.localPlayer % TEAM_COLORS.length]!;
  const art = state.art.has(faction.id);
  const hasProducer = structureTab ? (roles.get('conyard') ?? 0) > 0 : (roles.get(tabIndex === 0 ? 'barracks' : tabIndex === 1 ? 'factory' : 'airfield') ?? 0) > 0;
  return (
    <aside class="sidebar" data-faction={faction.id}>
      <Minimap state={state} renderer={renderer} input={input} radar={(roles.get('radar') ?? 0) > 0 && !state.lowPower} />
      <div class="economy">
        <div class="credits" data-testid="credits">
          ${credits.toLocaleString('en-US')}
        </div>
        <div class={`power ${used > produced ? 'low' : ''}`} title={`Power ${produced} produced / ${used} used`} data-testid="power">
          <div class="power-bar" style={{ width: `${Math.min(100, (used / Math.max(1, produced)) * 100)}%` }} />
          <span>
            {used}/{produced}
          </span>
        </div>
      </div>
      <nav class="tabs" data-testid="sidebar-tabs">
        {TABS.map((t) => (
          <button
            class={state.sidebarTab === t.id ? 'active' : ''}
            data-tab={t.id}
            title={`${t.label} (${t.key}, then the item's letter)`}
            onClick={() => ((state.sidebarTab = t.id), state.changed())}
          >
            <span>{t.label}</span>
            <kbd>{t.key}</kbd>
          </button>
        ))}
      </nav>
      {MENU_MODES.includes(state.mode) && (
        <div class="hint" data-testid="menu-hint">
          Press a letter · Esc cancels
        </div>
      )}
      {state.placing && (
        <div class="hint" data-testid="placing-hint">
          Click to place · right-click or Esc to cancel
        </div>
      )}
      {!hasProducer && (
        <div class="hint muted">{structureTab ? 'Deploy your construction vehicle (D) to build.' : `Needs a ${ROLE_NAMES[tabIndex === 0 ? 'barracks' : tabIndex === 1 ? 'factory' : 'airfield']}.`}</div>
      )}
      {hasProducer && !MENU_MODES.includes(state.mode) && !state.placing && (
        <div class="hint muted" data-testid="tab-hint">
          Press {TABS.find((t) => t.id === state.sidebarTab)!.key}, then a letter
        </div>
      )}
      <div class={`grid ${MENU_MODES.includes(state.mode) ? 'keys' : ''} ${art ? 'art' : ''}`} data-testid="build-grid">
        {items.map((it) => {
          const missing = state.missing(it.requires, roles);
          let progress = 0;
          let ready = false;
          let busy = false;
          let count = 0;
          if (it.kind === 'structure' && bq) {
            if (bq.item === it.index) {
              progress = bq.progress;
              ready = bq.ready;
            } else busy = bq.item >= 0;
          }
          if (it.kind === 'unit' && pq) {
            count = pq.items.filter((x) => x === it.index).length;
            if (pq.items[0] === it.index) progress = pq.progress;
          }
          const disabled = !hasProducer || missing.length > 0 || busy;
          const title =
            missing.length > 0
              ? `${it.name} — requires ${missing.map((r) => ROLE_NAMES[r] ?? r).join(', ')}`
              : `${it.name} — $${it.cost}${it.kind === 'unit' ? ' · click: 1, Shift+click: 5, right-click: cancel' : ready ? ' · click to place' : ' · right-click: cancel'}`;
          return (
            <button
              class={`item ${ready ? 'ready' : ''} ${progress > 0 && !ready ? 'building' : ''} ${disabled ? 'off' : ''}`}
              aria-disabled={disabled}
              aria-label={title}
              data-item={it.id}
              onMouseEnter={(e) => {
                state.hoverItem = { index: it.index, kind: it.kind, top: (e.currentTarget as HTMLElement).getBoundingClientRect().top };
                state.changed();
              }}
              onMouseLeave={() => {
                state.hoverItem = null;
                state.changed();
              }}
              onClick={(e) => {
                if (disabled) return;
                if (it.kind === 'structure') input.activateStructure(it);
                else input.activateUnit(it, e.shiftKey ? 5 : 1);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (it.kind === 'structure') input.cancelStructure(it);
                else input.cancelUnit(it);
              }}
            >
              <Icon state={state} faction={faction.id} id={it.id} color={teamColor} />
              {progress > 0 && !ready && <i class="progress" style={{ '--p': `${progress / 10}%` }} />}
              <span class={`name ${faction.monospaceNames ? 'mono' : ''}`}>{it.name}</span>
              <span class="cost">{ready ? 'READY' : `$${it.cost}`}</span>
              {it.key && <kbd class="key">{it.key}</kbd>}
              {count > 0 && <b class="count">{count}</b>}
            </button>
          );
        })}
      </div>
      <div class="mode" data-testid="mode">
        {state.mode === 'ability' ? 'Ability: click a point (blink) or an enemy vehicle (Override)' : state.mode !== 'normal' ? `Mode: ${state.mode}` : ''}
      </div>
    </aside>
  );
}

function Minimap({ state, renderer, input, radar }: { state: ClientState; renderer: Renderer; input: Input; radar: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const radarRef = useRef(radar);
  radarRef.current = radar;
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const base = document.createElement('canvas');
    let baseReady = false;
    const SIZE = canvas.width;
    const draw = () => {
      if (!state.ready) return;
      const w = state.width;
      const h = state.height;
      // Diamond transform: tile (u, v) -> minimap px.
      const scale = SIZE / (w + h);
      const tx = (u: number, v: number) => (u - v) * scale + (h * scale);
      const ty = (u: number, v: number) => (u + v) * scale * 0.5 + SIZE * 0.25;
      if (!baseReady) {
        base.width = w;
        base.height = h;
        const bctx = base.getContext('2d')!;
        const img = bctx.createImageData(w, h);
        const palette = BIOME_COLORS[state.biome] ?? BIOME_COLORS.wasteland!;
        for (let i = 0; i < w * h; i++) {
          const c = palette[state.terrain[i]!]!;
          img.data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], i * 4);
        }
        bctx.putImageData(img, 0, 0);
        baseReady = true;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (!radarRef.current) {
        // No radar (or low power): static.
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
          ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
        }
        ctx.fillStyle = '#8892a0';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(state.lowPower ? 'LOW POWER' : 'NO RADAR', SIZE / 2, SIZE / 2);
        return;
      }
      ctx.setTransform(scale, scale * 0.5, -scale, scale * 0.5, h * scale, SIZE * 0.25);
      ctx.drawImage(base, 0, 0);
      if (state.fog) {
        for (let i = 0; i < state.fog.length; i++) {
          const f = state.fog[i]!;
          if (f & 1) continue;
          ctx.fillStyle = f & 2 ? 'rgba(0,0,0,0.5)' : '#000';
          ctx.fillRect(i % w, Math.floor(i / w), 1, 1);
        }
      }
      const cur = state.cur;
      if (cur) {
        for (let i = 0; i < cur.entityCount; i++) {
          const o = cur.ent(i);
          const handle = cur.get(o, E.handle);
          if (!renderer.visibleEntity(handle)) continue;
          ctx.fillStyle = hex(TEAM_COLORS[cur.get(o, E.owner) % TEAM_COLORS.length]!);
          const size = cur.get(o, E.kind) === KIND.structure ? 2.5 : 1.4;
          ctx.fillRect(cur.get(o, E.x) / FX - size / 2, cur.get(o, E.y) / FX - size / 2, size, size);
        }
      }
      // Attack pings: red rings where own units/buildings were recently hit.
      const now = performance.now();
      for (const hit of state.hits) {
        const age = (now - hit.time) / 3000;
        if (age >= 1) continue;
        ctx.strokeStyle = `rgba(255,80,80,${1 - age})`;
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.arc(hit.x / FX, hit.y / FX, 2 + age * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Camera viewport.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const corners = [
        [0, 0],
        [renderer.width, 0],
        [renderer.width, renderer.height],
        [0, renderer.height],
      ].map(([x, y]) => renderer.screenToTile(x!, y!));
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(tx(c.u, c.v), ty(c.u, c.v)) : ctx.lineTo(tx(c.u, c.v), ty(c.u, c.v))));
      ctx.closePath();
      ctx.stroke();
    };
    const id = setInterval(draw, 100);
    // Minimap px -> tile coordinates (inverse of the diamond transform).
    const toTile = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * SIZE;
      const py = ((e.clientY - r.top) / r.height) * SIZE;
      const scale = SIZE / (state.width + state.height);
      const a = (px - state.height * scale) / scale;
      const b = (py - SIZE * 0.25) / (scale * 0.5);
      return { u: (a + b) / 2, v: (b - a) / 2 };
    };
    let panning = false;
    const pan = (e: PointerEvent) => {
      const { u, v } = toTile(e);
      renderer.camera.x = isoX(u, v);
      renderer.camera.y = isoY(u, v);
      renderer.clampCamera();
    };
    const down = (e: PointerEvent) => {
      if (!state.ready) return;
      e.preventDefault();
      if (e.button === 2) {
        // Right-click: order the selection there (or set a factory's rally point).
        const { u, v } = toTile(e);
        input.minimapOrder(u, v, e.shiftKey);
        return;
      }
      if (e.button !== 0) return;
      panning = true;
      canvas.setPointerCapture(e.pointerId);
      pan(e);
    };
    const move = (e: PointerEvent) => {
      if (panning) pan(e);
    };
    const up = () => (panning = false);
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('contextmenu', noMenu);
    return () => {
      clearInterval(id);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('contextmenu', noMenu);
    };
  }, [state, renderer, input]);
  return <canvas class="minimap" ref={ref} width={220} height={220} data-testid="minimap" data-radar={radar ? 'on' : 'off'} />;
}

const COMMANDS: { action: string; label: string; key: string }[] = [
  { action: 'move', label: 'Move', key: 'KeyM' },
  { action: 'attackMove', label: 'Attack', key: 'KeyA' },
  { action: 'stop', label: 'Stop', key: 'KeyS' },
  { action: 'hold', label: 'Hold', key: 'KeyH' },
  { action: 'patrol', label: 'Patrol', key: 'KeyP' },
  { action: 'guard', label: 'Guard', key: 'KeyG' },
  { action: 'scatter', label: 'Scatter', key: 'KeyX' },
  { action: 'deploy', label: 'Deploy', key: 'KeyD' },
  { action: 'ability', label: 'Ability', key: 'KeyF' },
];

function BottomPanel({ state, input }: { state: ClientState; input: Input }) {
  const sel = state.selection;
  const groups = state.subgroups();
  const activeType = groups[state.subgroup % Math.max(1, groups.length)];
  const own = state.selectedUnits().length > 0;
  return (
    <footer class="bottom">
      <GroupBar state={state} />
      <div class="selection" data-testid="selection" data-count={sel.length}>
        {sel.length === 0 && <span class="muted">Nothing selected</span>}
        {sel.length === 1 && <SelectedOne state={state} h={sel[0]!} />}
        {sel.length > 1 && (
          <div class="group-grid">
            {sel.slice(0, 36).map((h) => {
              const type = (state.isUnit(h) ? 0 : 10000) + state.field(h, E.type);
              const hp = state.field(h, E.hp) / Math.max(1, state.field(h, E.maxHp));
              return (
                <button
                  class={`cell ${type === activeType ? 'active' : ''}`}
                  title={state.ruleOf(h).name}
                  onClick={() => state.select([h])}
                >
                  <Icon state={state} faction={state.rules.factions[state.ruleOf(h).faction]!.id} id={state.ruleOf(h).id} color={TEAM_COLORS[state.field(h, E.owner) % TEAM_COLORS.length]!} />
                  {!state.art.has(state.rules.factions[state.ruleOf(h).faction]!.id) && <span>{state.ruleOf(h).name.slice(0, 3)}</span>}
                  <i style={{ width: `${hp * 100}%` }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div class="commands" data-testid="command-card">
        {COMMANDS.map((c) => {
          const ability = c.action === 'ability' ? abilityInfo(state) : null;
          const label = ability ? ability.label : c.label;
          return (
            <button
              disabled={!own || (c.action === 'ability' && !ability)}
              class={state.mode === c.action ? 'active' : ''}
              onClick={() => input.run(c.action)}
              title={ability ? ability.title : c.label}
              data-testid={c.action === 'ability' ? 'ability' : undefined}
            >
              {label}
              <kbd>{chordLabel(c.key)}</kbd>
            </button>
          );
        })}
        <StanceButton state={state} input={input} />
        <HarvestModeButton state={state} input={input} />
      </div>
    </footer>
  );
}

const ABILITY_NAMES: Record<string, [string, string]> = {
  blink: ['Blink', 'Jump a short distance: press, then click where'],
  phase: ['Phase', 'Phase out: untouchable, but cannot shoot, for a few seconds'],
  override: ['Override', 'Take control of an enemy vehicle for a while: press, then click it'],
};

/** Label for the ability button: the selection's ability and its shortest cooldown. */
function abilityInfo(state: ClientState): { label: string; title: string } | null {
  let kind: string | null = null;
  let left = Infinity;
  for (const h of state.selectedUnits()) {
    const rule = state.ruleOf(h);
    if (rule.kind !== 'unit') continue;
    const a = rule.abilities.find((x) => x.kind === 'blink' || x.kind === 'phase' || x.kind === 'override');
    if (!a) continue;
    kind ??= a.kind;
    left = Math.min(left, state.field(h, E.abilityLeft));
  }
  if (!kind) return null;
  const [name, title] = ABILITY_NAMES[kind]!;
  return { label: left > 0 ? `${name} ${Math.ceil(left / 20)}s` : name, title };
}

/** Control groups 1–9 and 0: click to select, Ctrl+click to assign the current selection. */
function GroupBar({ state }: { state: ClientState }) {
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  return (
    <div class="groups" data-testid="groups" title="Ctrl+1–9 assigns · 1–9 selects · double-tap jumps">
      {order.map((d) => {
        const g = state.controlGroups[d]!;
        return (
          <button
            class={g.length > 0 ? 'has' : ''}
            data-group={d}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                state.controlGroups[d] = [...state.selection];
                state.changed();
              } else if (g.length > 0) state.select(g);
            }}
          >
            <b>{d}</b>
            <span>{g.length > 0 ? g.length : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Current stance of the selection; click (or Z) cycles it. */
function StanceButton({ state, input }: { state: ClientState; input: Input }) {
  const units = state.selectedUnits().filter((h) => state.ruleOf(h).weapon);
  if (units.length === 0) return null;
  const stances = new Set(units.map((h) => state.field(h, E.stance)));
  const label = stances.size === 1 ? STANCE_NAMES[[...stances][0]!] : 'Mixed';
  return (
    <button class="wide" data-testid="stance" title="Guard area → Aggressive → Hold ground → Hold fire" onClick={() => input.run('stance')}>
      Stance: {label} <kbd>Z</kbd>
    </button>
  );
}

/** Toggle harvesters between richest-first and nearest-first tile choice. */
function HarvestModeButton({ state, input }: { state: ClientState; input: Input }) {
  const harvesters = state.selectedUnits().filter((h) => input.isHarvester(h));
  if (harvesters.length === 0) return null;
  const nearest = harvesters.every((h) => state.field(h, E.hmode) === 1);
  return (
    <button
      class="wide"
      data-testid="harvest-mode"
      title="Richest: go for tiles with the most crystals. Nearest: shortest trips."
      onClick={() => state.send({ type: 'harvestMode', units: harvesters, mode: nearest ? 0 : 1 })}
    >
      Harvest: {nearest ? 'Nearest' : 'Richest'}
    </button>
  );
}

function SelectedOne({ state, h }: { state: ClientState; h: number }) {
  const rule = state.ruleOf(h);
  const hp = state.field(h, E.hp);
  const maxHp = state.field(h, E.maxHp);
  const sh = state.field(h, E.shields);
  const maxSh = state.field(h, E.maxShields);
  const rank = state.field(h, E.rank);
  const faction = state.rules.factions[rule.faction]!;
  return (
    <div class="one">
      <div class="portrait" style={{ '--team': hex(TEAM_COLORS[state.field(h, E.owner) % TEAM_COLORS.length]!) }}>
        <Icon state={state} faction={faction.id} id={rule.id} color={TEAM_COLORS[state.field(h, E.owner) % TEAM_COLORS.length]!} />
      </div>
      <div>
        <div class={`title ${faction.monospaceNames ? 'mono' : ''}`}>
          {rule.name} {'★'.repeat(rank)}
        </div>
        <div class="bar">
          <i style={{ width: `${(hp / maxHp) * 100}%` }} />
        </div>
        <div class="muted">
          HP {hp}/{maxHp}
          {maxSh > 0 && ` · Shields ${sh}/${maxSh}`}
        </div>
        {rule.kind === 'unit' && <div class="muted">{rule.role}</div>}
        {rule.kind === 'structure' && (
          <div class="muted">
            Power {rule.power > 0 ? `+${rule.power}` : rule.power}
            {state.field(h, E.repairing) === 1 ? ' · repairing' : ''}
          </div>
        )}
      </div>
      {rule.kind === 'structure' && state.isOwn(h) && <StructureActions state={state} h={h} />}
      {rule.kind === 'structure' && rule.role === 'tech' && state.isOwn(h) && <ResearchPanel state={state} />}
    </div>
  );
}

function HoverCards({ state }: { state: ClientState }) {
  const item = state.hoverItem;
  if (item) {
    const rule = item.kind === 'unit' ? state.rules.units[item.index]! : state.rules.structures[item.index]!;
    return (
      <div class="card-anchor side" style={{ top: `${Math.min(item.top, window.innerHeight - 380)}px` }}>
        <ItemCard state={state} rule={rule} />
      </div>
    );
  }
  if (state.hoverEntity >= 0 && state.off(state.hoverEntity) >= 0) {
    const { x, y } = state.hoverPos;
    const left = Math.min(x + 18, window.innerWidth - 520);
    return (
      <div class="card-anchor" style={{ left: `${left}px`, top: `${Math.max(40, y - 10)}px` }}>
        <EntityCard state={state} h={state.hoverEntity} />
      </div>
    );
  }
  return null;
}

/** Upgrades at the tech center: researched, in progress, available or locked. */
function ResearchPanel({ state }: { state: ClientState }) {
  const cur = state.cur;
  if (!cur) return null;
  const me = state.localPlayer;
  const faction = state.players[me]!.faction;
  const done = cur.player(me, P.upgrades);
  const active = cur.player(me, P.researchItem);
  const progress = cur.player(me, P.researchProgress);
  const roles = state.roles();
  const ups = state.rules.upgrades.filter((u) => u.faction < 0 || u.faction === faction);
  return (
    <div class="research" data-testid="research">
      {ups.map((u) => {
        const researched = (done & (1 << u.index)) !== 0;
        const pre = u.requiresUpgrade ? state.rules.upgradeIndex.get(u.requiresUpgrade) : undefined;
        const locked = (pre !== undefined && (done & (1 << pre)) === 0) || state.missing(u.requires, roles).length > 0;
        const running = active === u.index;
        const busy = active >= 0 && !running;
        const effect = describeEffect(u.effect.kind, u.effect.pct);
        return (
          <button
            class={`upgrade ${researched ? 'done' : ''} ${running ? 'building' : ''}`}
            disabled={researched || locked || busy}
            data-upgrade={u.id}
            title={`${u.name}: ${effect}. $${u.cost}, ${Math.round(u.researchTicks / 20)} s${locked ? ' (locked)' : ''}${running ? ' · click to cancel' : ''}`}
            onClick={() => state.send(running ? { type: 'cancelResearch' } : { type: 'research', upgrade: u.index })}
          >
            {running && <i class="progress" style={{ '--p': `${progress / 10}%` }} />}
            <span>{u.name}</span>
            <small>{researched ? 'done' : running ? `${Math.floor(progress / 10)}%` : `$${u.cost}`}</small>
          </button>
        );
      })}
    </div>
  );
}

function describeEffect(kind: string, pct: number): string {
  switch (kind) {
    case 'damagePct':
      return `+${pct}% weapon damage`;
    case 'hpPct':
      return `+${pct}% unit HP`;
    case 'salvagePct':
      return `+${pct}% credits from wrecks`;
    case 'vehicleEnergyResistPct':
      return `vehicles take ${pct}% less Energy damage`;
    case 'coverageRadiusPct':
      return `+${pct}% network coverage radius`;
    case 'recompileRefundPct':
      return `Recompile refunds ${pct}% instead`;
    case 'shieldPct':
      return `+${pct}% shield capacity`;
    case 'growSpeedPct':
      return `structures grow ${pct}% faster`;
    default:
      return kind;
  }
}

function StructureActions({ state, h }: { state: ClientState; h: number }) {
  return (
    <div class="actions">
      <button onClick={() => state.send({ type: 'repair', target: h })}>
        Repair <kbd>Alt+R</kbd>
      </button>
      <button onClick={() => state.send({ type: 'sell', target: h })}>
        Sell <kbd>Alt+S</kbd>
      </button>
    </div>
  );
}

let stalledSince = 0;

/** Multiplayer: waiting-for-opponent, desync and disconnect notices. */
function NetOverlays({ state }: { state: ClientState }) {
  const cur = state.cur;
  const stalled = cur ? cur.a[H.stalled] === 1 : false;
  const now = performance.now();
  if (!stalled) stalledSince = 0;
  else if (stalledSince === 0) stalledSince = now;
  const waiting = stalled && now - stalledSince > 500;
  const download = () => {
    if (!state.desync) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([state.desync.report], { type: 'application/json' }));
    a.download = `signal-fall-desync-${state.desync.tick}.json`;
    a.click();
  };
  return (
    <>
      {waiting && !state.peerLost && (
        <div class="net-overlay" data-testid="net-waiting">
          Waiting for your opponent…
        </div>
      )}
      {state.desync && (
        <div class="desync-banner" data-testid="desync">
          The match went out of sync at tick {state.desync.tick}.
          <button onClick={download}>Download report</button>
        </div>
      )}
      {state.peerLost && (
        <div class="menu-overlay" data-testid="peer-lost">
          <div class="menu">
            <h2>Opponent disconnected</h2>
            <p class="muted">The connection to your opponent was lost.</p>
            <button onClick={() => (location.href = location.pathname)}>Back to menu</button>
          </div>
        </div>
      )}
    </>
  );
}

function EndScreen({ state }: { state: ClientState }) {
  const cur = state.cur;
  if (!cur || cur.a[1] !== 1) return null;
  const won = cur.a[2] === state.players[state.localPlayer]?.team;
  return (
    <div class="menu-overlay" data-testid="end-screen">
      <div class="menu">
        <h2>{won ? 'Victory' : 'Defeat'}</h2>
        {!state.multiplayer && <button onClick={() => location.reload()}>Play again</button>}
        <button onClick={() => (location.href = location.pathname)}>New skirmish</button>
      </div>
    </div>
  );
}

function Menu({ state, input, audio }: { state: ClientState; input: Input; audio: GameAudio }) {
  const [, force] = useReducer((n: number, _: undefined) => n + 1, 0);
  const slider = (label: string, kind: 'music' | 'sfx') => (
    <label class="slider">
      {label}
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(audio.settings[kind] * 100)}
        data-testid={`volume-${kind}`}
        onInput={(e) => {
          if (!audio.started) void audio.unlock();
          audio.set(kind, Number((e.currentTarget as HTMLInputElement).value) / 100);
          force(undefined);
        }}
      />
      <span>{Math.round(audio.settings[kind] * 100)}</span>
    </label>
  );
  const fullscreen = async () => {
    await document.documentElement.requestFullscreen();
    // Keyboard Lock lets the game receive Ctrl+W/T/N-style chords in fullscreen (Chromium).
    const kb = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard;
    await kb?.lock?.().catch(() => undefined);
  };
  return (
    <div class="menu-overlay" data-testid="menu">
      <div class="menu">
        <h2>{state.multiplayer ? 'Menu' : 'Paused'}</h2>
        <button onClick={() => input.toggleMenu()}>Resume</button>
        <button
          data-testid="menu-codex"
          onClick={() => {
            state.codexOpen = true;
            state.changed();
          }}
        >
          Codex
        </button>
        <button onClick={fullscreen}>Fullscreen</button>
        {slider('Music', 'music')}
        {slider('Effects', 'sfx')}
        <button
          data-testid="menu-credits"
          onClick={() => {
            state.creditsOpen = true;
            state.changed();
          }}
        >
          Credits
        </button>
        <button
          onClick={() => {
            state.send({ type: 'surrender' });
            input.toggleMenu();
          }}
        >
          Surrender
        </button>
      </div>
    </div>
  );
}
