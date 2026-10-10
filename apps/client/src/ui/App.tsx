import { useEffect, useReducer, useRef } from 'preact/hooks';
import { KIND } from '@signal-fall/sim';
import type { StructureRule, UnitRule } from '@signal-fall/data';
import { E } from '../protocol';
import { TEAM_COLORS, type ClientState, type SidebarTab } from '../game/state';
import type { Input } from '../input/input';
import type { Renderer } from '../render/renderer';
import { chordLabel } from '../input/keymap';
import { isoX, isoY } from '../game/iso';

const FX = 1024;

function useStateVersion(state: ClientState): void {
  const [, force] = useReducer((n: number, _: undefined) => n + 1, 0);
  useEffect(() => state.subscribe(() => force(undefined)), [state]);
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function App(props: { state: ClientState; input: Input; renderer: Renderer; gameHost: (el: HTMLDivElement) => void }) {
  const { state } = props;
  useStateVersion(state);
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hostRef.current) props.gameHost(hostRef.current);
  }, []);
  return (
    <div class="layout">
      <TopBar state={state} input={props.input} />
      <div class="game" ref={hostRef} data-testid="game" />
      <BottomPanel state={state} input={props.input} />
      <Sidebar state={state} renderer={props.renderer} />
      {state.menuOpen && <Menu state={state} input={props.input} />}
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
      <span class={`alert ${fresh ? 'on' : ''}`} data-testid="alert">
        {fresh ? alert.text : ''}
      </span>
      <span class="fps" data-testid="fps">{state.fps} fps</span>
      <button class="menu-btn" onClick={() => input.toggleMenu()} title="Menu (Esc)">
        Menu <kbd>Esc</kbd>
      </button>
    </header>
  );
}

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'structures', label: 'Build' },
  { id: 'defenses', label: 'Defense' },
  { id: 'infantry', label: 'Infantry' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'air', label: 'Air' },
];

function Sidebar({ state, renderer }: { state: ClientState; renderer: Renderer }) {
  const faction = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]!;
  const credits = state.cur?.credits(state.localPlayer) ?? 0;
  const items: (UnitRule | StructureRule)[] =
    state.sidebarTab === 'structures' || state.sidebarTab === 'defenses'
      ? faction.structures.map((i) => state.rules.structures[i]!).filter((s) => s.category === state.sidebarTab)
      : faction.units.map((i) => state.rules.units[i]!).filter((u) => u.tab === state.sidebarTab);
  return (
    <aside class="sidebar" data-faction={faction.id}>
      <Minimap state={state} renderer={renderer} />
      <div class="economy">
        <div class="credits" data-testid="credits">
          ${credits.toLocaleString('en-US')}
        </div>
        <div class="power" title="Power (M3)">
          <div class="power-bar" />
        </div>
      </div>
      <nav class="tabs" data-testid="sidebar-tabs">
        {TABS.map((t) => (
          <button class={state.sidebarTab === t.id ? 'active' : ''} data-tab={t.id} onClick={() => ((state.sidebarTab = t.id), state.changed())}>
            {t.label}
          </button>
        ))}
      </nav>
      {(state.mode === 'buildMenu' || state.mode === 'defenseMenu') && (
        <div class="hint" data-testid="menu-hint">
          Press a letter to build · Esc to cancel
        </div>
      )}
      <div class="grid">
        {items.map((it) => (
          <button class="item" disabled title={`${it.name} — ${it.cost} (production arrives in M3)`}>
            <span class={`name ${faction.monospaceNames ? 'mono' : ''}`}>{it.name}</span>
            <span class="cost">{it.cost}</span>
            {it.key && <kbd class="key">{it.key}</kbd>}
          </button>
        ))}
      </div>
      <div class="mode" data-testid="mode">
        {state.mode !== 'normal' ? `Mode: ${state.mode}` : ''}
      </div>
    </aside>
  );
}

function Minimap({ state, renderer }: { state: ClientState; renderer: Renderer }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
        const colors = [[61, 74, 51], [90, 82, 56], [94, 95, 99], [35, 70, 106], [71, 60, 56], [85, 80, 74]];
        for (let i = 0; i < w * h; i++) {
          const c = colors[state.terrain[i]!]!;
          img.data.set([c[0]!, c[1]!, c[2]!, 255], i * 4);
        }
        bctx.putImageData(img, 0, 0);
        baseReady = true;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, SIZE, SIZE);
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
    const id = setInterval(draw, 200);
    const click = (e: PointerEvent) => {
      if (!state.ready) return;
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * SIZE;
      const py = ((e.clientY - r.top) / r.height) * SIZE;
      const scale = SIZE / (state.width + state.height);
      // Invert the diamond transform.
      const a = (px - state.height * scale) / scale;
      const b = (py - SIZE * 0.25) / (scale * 0.5);
      const u = (a + b) / 2;
      const v = (b - a) / 2;
      renderer.camera.x = isoX(u, v);
      renderer.camera.y = isoY(u, v);
      renderer.clampCamera();
    };
    canvas.addEventListener('pointerdown', click);
    return () => {
      clearInterval(id);
      canvas.removeEventListener('pointerdown', click);
    };
  }, [state, renderer]);
  return <canvas class="minimap" ref={ref} width={220} height={220} data-testid="minimap" />;
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
                  <span>{state.ruleOf(h).name.slice(0, 3)}</span>
                  <i style={{ width: `${hp * 100}%` }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div class="commands" data-testid="command-card">
        {COMMANDS.map((c) => (
          <button disabled={!own} class={state.mode === c.action ? 'active' : ''} onClick={() => input.run(c.action)} title={c.label}>
            {c.label}
            <kbd>{chordLabel(c.key)}</kbd>
          </button>
        ))}
      </div>
    </footer>
  );
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
      <div class="portrait" style={{ background: hex(TEAM_COLORS[state.field(h, E.owner) % TEAM_COLORS.length]!) }} />
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
      </div>
    </div>
  );
}

function Menu({ state, input }: { state: ClientState; input: Input }) {
  const fullscreen = async () => {
    await document.documentElement.requestFullscreen();
    // Keyboard Lock lets the game receive Ctrl+W/T/N-style chords in fullscreen (Chromium).
    const kb = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard;
    await kb?.lock?.().catch(() => undefined);
  };
  return (
    <div class="menu-overlay" data-testid="menu">
      <div class="menu">
        <h2>Paused</h2>
        <button onClick={() => input.toggleMenu()}>Resume</button>
        <button onClick={fullscreen}>Fullscreen</button>
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
