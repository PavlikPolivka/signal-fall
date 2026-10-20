import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { go, toggleFullscreen } from '../nav';
import { HILL_TICKS, KIND, MARKER, POINT } from '@signal-fall/sim';
import type { StructureRule, UnitRule } from '@signal-fall/data';
import { E, H, P, P_HILL } from '../protocol';
import { SUPER_WARN, TEAM_COLORS, type ClientState, type SidebarTab } from '../game/state';
import type { Input } from '../input/input';
import { BIOME_COLORS, type Renderer } from '../render/renderer';
import { chordLabel, chordOf, withOverrides } from '../input/keymap';
import { ACTION_LABEL } from './Codex';
import { GAME_SPEEDS, STANCE_NAMES } from '../input/input';
import { EntityCard, ItemCard } from './InfoCard';
import { Codex } from './Codex';
import { isoX, isoY } from '../game/iso';
import { Icon } from './Icon';
import { describeEffect, money, roleName, roleNames } from '../game/names';
import { Credits } from './Credits';
import { MatchReport } from './MatchReport';
import type { GameAudio } from '../audio/audio';
import { FACTION_TIPS, GENERAL_TIPS } from './tips';
import { DailyBoard } from './Daily';
import { Tutorial } from './Tutorial';
import { markMissionWon, nextMission } from './Campaign';
import { clock } from '../game/saves';

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
      {!state.ready && <Loading state={state} />}
      {state.caption && performance.now() - state.caption.time < 3500 && (
        <div class="caption" data-testid="caption">
          {state.caption.text}
        </div>
      )}
      <EndScreen state={state} />
      {state.multiplayer && <NetOverlays state={state} />}
      {state.multiplayer && <Chat state={state} />}
      {state.touched && <TouchBar state={state} input={props.input} />}
      {state.replay && <ReplayBar state={state} />}
      {state.reportOpen && (
        <MatchReport
          state={state}
          onClose={() => {
            state.reportOpen = false;
            state.changed();
          }}
        />
      )}
      {state.tutorial && <Tutorial state={state} renderer={props.renderer} />}
      {state.mission && <MissionPanel state={state} input={props.input} />}
      {!state.tutorial && !state.mission && !state.multiplayer && !state.replay && !state.spectator && state.settings.hints && <Hints state={state} />}
    </div>
  );
}

function TopBar({ state, input }: { state: ClientState; input: Input }) {
  const tick = state.cur?.tick ?? 0;
  const secs = Math.floor(tick / 20);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const alert = state.alerts[state.alerts.length - 1];
  const fresh = alert && performance.now() - alert.time < 6000;
  const idle = state.cur && !state.spectator ? input.idleUnits() : { harvesters: [], army: [] };
  return (
    <header class="topbar">
      <span class="timer" data-testid="timer" title="Game time · your clock">
        {time}
        <small>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </span>
      {state.gameSpeed !== 1 && (
        <span class="speed-badge" data-testid="speed-badge" title="Game speed (- and = change it)">
          {state.gameSpeed}×
        </span>
      )}
      {!state.spectator && <ArmyCounts state={state} />}
      <HillScore state={state} />
      <SuperTimers state={state} />
      <WaveCounter state={state} />
      {idle.harvesters.length > 0 && (
        <button class="idle-btn warn" data-testid="idle-harvesters" title="Idle harvesters: click (or E) to jump to one" onClick={() => input.selectIdle('harvesters')}>
          {idle.harvesters.length} idle harvester{idle.harvesters.length > 1 ? 's' : ''}
        </button>
      )}
      {idle.army.length > 0 && (
        <button class="idle-btn" data-testid="idle-army" title="Army units with no orders: click to select them and look" onClick={() => input.selectIdle('army')}>
          {idle.army.length} idle
        </button>
      )}
      <span class={`alert ${fresh ? 'on' : ''} ${alert?.kind ?? ''}`} data-testid="alert">
        {fresh ? alert.text : ''}
      </span>
      {state.log.length > 0 && (
        <button
          class={`log-btn ${state.logOpen ? 'active' : ''}`}
          data-testid="log-btn"
          title="Recent events: click one to look (Space jumps to the latest)"
          onClick={() => {
            state.logOpen = !state.logOpen;
            state.changed();
          }}
        >
          Log {state.log.length}
        </button>
      )}
      {state.logOpen && <EventLog state={state} input={input} />}
      {state.net && (
        <span class="net-badge" data-testid="net-badge" title="Round trip and input delay">
          ping {state.net.rtt >= 0 ? `${Math.round(state.net.rtt)} ms` : '…'} · delay {state.net.delayTurns}
        </span>
      )}
      <span class="fps" data-testid="fps">{state.fps} fps</span>
      <button class="mute-btn" data-testid="mute" onClick={() => state.toggleMute()} title={state.muted ? 'Sound off: click to unmute (Ctrl+M)' : 'Sound on: click to mute (Ctrl+M)'}>
        {state.muted ? '🔇' : '🔊'}
      </button>
      <button class="menu-btn" onClick={() => input.toggleMenu()} title="Menu (`)">
        Menu <kbd>`</kbd>
      </button>
    </header>
  );
}

/** The last 20 match events, newest first; clicking one with a place looks there. */
function EventLog({ state, input }: { state: ClientState; input: Input }) {
  const time = (t: number) => `${Math.floor(t / 1200)}:${String(Math.floor(t / 20) % 60).padStart(2, '0')}`;
  return (
    <div class="event-log" data-testid="event-log">
      {[...state.log].reverse().map((a) => (
        <button
          class={a.kind}
          disabled={a.x < 0}
          onClick={() => {
            input.lookAt(a.x, a.y);
            state.logOpen = false;
            state.changed();
          }}
        >
          <span>{time(a.tick)}</span>
          {a.text}
        </button>
      ))}
    </div>
  );
}

/** Survival: which wave, out of how many, and when the next comes. */
function WaveCounter({ state }: { state: ClientState }) {
  const cur = state.cur;
  if (!cur || !cur.a[H.waves]) return null;
  const wave = cur.a[H.wave]!;
  const waves = cur.a[H.waves]!;
  const next = cur.a[H.waveIn]!;
  const clock = (t: number) => `${Math.floor(t / 1200)}:${String(Math.floor(t / 20) % 60).padStart(2, '0')}`;
  return (
    <span class={`wave-counter ${next >= 0 && next < 200 ? 'soon' : ''}`} data-testid="wave-counter" title="Survival: hold out through every wave">
      Wave {wave}/{waves}
      {next >= 0 ? <> · next in {clock(next)}</> : <> · last one: finish them</>}
    </span>
  );
}

/** King of the hill: how long each side has held the hill, out of the time that wins. */
function HillScore({ state }: { state: ClientState }) {
  const cur = state.cur;
  if (!cur || !cur.points().some((p) => p.kind === POINT.hill)) return null;
  const clock = (t: number) => `${Math.floor(t / 1200)}:${String(Math.floor(t / 20) % 60).padStart(2, '0')}`;
  const teams = [...new Set(state.players.map((p) => p.team))];
  return (
    <span class="hill-score" data-testid="hill-score" title={`King of the hill: hold the flag for ${clock(HILL_TICKS)} in total to win`}>
      ⚑
      {teams.map((t) => {
        const k = state.players.findIndex((p) => p.team === t);
        const held = cur.player(k, P_HILL);
        return (
          <span class="hill-team">
            <i style={{ width: `${Math.min(100, (held * 100) / HILL_TICKS)}%`, background: hex(TEAM_COLORS[k % TEAM_COLORS.length]!) }} />
            <b>{clock(held)}</b>
          </span>
        );
      })}
    </span>
  );
}

const mss = (t: number) => `${Math.floor(Math.ceil(t / 20) / 60)}:${String(Math.ceil(t / 20) % 60).padStart(2, '0')}`;

/** Every standing superweapon's charge, in each owner's color: they are public, so nobody gets surprised. */
function SuperTimers({ state }: { state: ClientState }) {
  if (!state.cur) return null;
  const rows = state.players.map((_, k) => ({ k, status: state.superStatus(k), rule: state.superweaponRule(k) })).filter((r) => r.status >= 0 && r.rule?.superweapon);
  if (rows.length === 0) return null;
  return (
    <span class="super-timers" data-testid="super-timers">
      {rows.map(({ k, status, rule }) => (
        <span
          class={`super-timer ${status === 0 ? 'ready' : status <= SUPER_WARN ? 'imminent' : status < 60 * 20 ? 'soon' : ''}`}
          data-testid={`super-timer-${k}`}
          style={{ borderColor: hex(TEAM_COLORS[k % TEAM_COLORS.length]!) }}
          title={`${state.names[k] ?? `Player ${k + 1}`}: ${rule!.name} (${rule!.superweapon!.name})${status === 0 ? ' is charged' : ` charges in ${mss(status)}`}`}
        >
          ☢ <b>{status === 0 ? 'Ready' : mss(status)}</b>
        </span>
      ))}
    </span>
  );
}

/** Own army at a glance: how many of each combat unit type (click a type to select them all). */
function ArmyCounts({ state }: { state: ClientState }) {
  const cur = state.cur;
  if (!cur) return null;
  const counts = new Map<number, number[]>();
  for (let i = 0; i < cur.entityCount; i++) {
    const o = cur.ent(i);
    if (cur.get(o, E.owner) !== state.localPlayer || cur.get(o, E.kind) !== KIND.unit) continue;
    const type = cur.get(o, E.type);
    if (!state.rules.units[type]!.weapon) continue;
    const list = counts.get(type) ?? [];
    list.push(cur.get(o, E.handle));
    counts.set(type, list);
  }
  if (counts.size === 0) return null;
  const faction = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]!;
  const color = TEAM_COLORS[state.localPlayer % TEAM_COLORS.length]!;
  return (
    <span class="army-counts" data-testid="army-counts">
      {[...counts].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([type, list]) => {
        const rule = state.rules.units[type]!;
        return (
          <button class="army-count" title={`${list.length} × ${rule.name}: click to select them all`} onClick={() => state.select(list)}>
            <Icon state={state} faction={faction.id} id={artId(rule)} color={color} />
            <b>{list.length}</b>
          </button>
        );
      })}
    </span>
  );
}

/** Credits readout that counts toward the real number instead of jumping; hover for income. */
function CreditsReadout({ state, credits }: { state: ClientState; credits: number }) {
  const shown = useRef(credits);
  const [, force] = useReducer((n: number, _: undefined) => n + 1, 0);
  useEffect(() => {
    if (shown.current === credits) return;
    let raf = 0;
    const step = () => {
      const d = credits - shown.current;
      // Close a fifth of the gap per frame, at least 1: big spends roll, small ones tick.
      shown.current += Math.abs(d) <= 1 ? d : Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 5));
      force(undefined);
      if (shown.current !== credits) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [credits]);
  const income = state.incomePerMinute();
  return (
    <div class="credits" data-testid="credits" data-value={credits} title={`Income: ${money(income)} per minute from harvesting`}>
      {money(shown.current)}
    </div>
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
const UNIT_MENU_LABEL: Record<string, string> = { infantryMenu: 'Infantry', vehicleMenu: 'Vehicles', airMenu: 'Air' };


function Sidebar({ state, input, renderer }: { state: ClientState; input: Input; renderer: Renderer }) {
  const faction = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]!;
  const cur = state.cur;
  const credits = cur?.credits(state.localPlayer) ?? 0;
  const produced = cur?.player(state.localPlayer, 2) ?? 0;
  const used = cur?.player(state.localPlayer, 3) ?? 0;
  const roles = state.roles();
  const structureTab = state.sidebarTab === 'structures' || state.sidebarTab === 'defenses';
  // Missions unlock things as the campaign goes on.
  const allowed = (id: string) =>
    (!state.mission?.allow || state.mission.allow.includes(id)) && !(state.noSuperweapons && state.rules.structures[state.rules.structureIndex.get(id) ?? -1]?.role === 'superweapon');
  const items: (UnitRule | StructureRule)[] = structureTab
    ? faction.structures.map((i) => state.rules.structures[i]!).filter((s) => s.category === state.sidebarTab && allowed(s.id))
    : faction.units.map((i) => state.rules.units[i]!).filter((u) => u.tab === state.sidebarTab && allowed(u.id));
  const tabIndex = state.sidebarTab === 'infantry' ? 0 : state.sidebarTab === 'vehicles' ? 1 : 2;
  const bq = cur && structureTab ? cur.buildQueue(state.localPlayer, state.sidebarTab === 'structures' ? 0 : 1) : null;
  const pq = cur && !structureTab ? cur.productionQueue(state.localPlayer, tabIndex) : null;
  const teamColor = TEAM_COLORS[state.localPlayer % TEAM_COLORS.length]!;
  const art = state.art.has(faction.id);
  const emergency = !structureTab && tabIndex === 1 && state.emergencyRebuild(roles);
  const hasProducer = structureTab ? (roles.get('conyard') ?? 0) > 0 : (roles.get(tabIndex === 0 ? 'barracks' : tabIndex === 1 ? 'factory' : 'airfield') ?? 0) > 0 || emergency;
  return (
    <aside class="sidebar" data-faction={faction.id}>
      <Minimap state={state} renderer={renderer} input={input} radar={(roles.get('radar') ?? 0) > 0 && !state.lowPower} />
      <div class="economy">
        <CreditsReadout state={state} credits={credits} />
        <div class={`power ${used > produced ? 'low' : ''}`} title={`Power ${produced} produced / ${used} used`} data-testid="power">
          <div class="power-bar" style={{ width: `${Math.min(100, (used / Math.max(1, produced)) * 100)}%` }} />
          <span>
            {used}/{produced}
          </span>
        </div>
      </div>
      {faction.power && <PowerButton state={state} input={input} />}
      <SuperweaponButton state={state} input={input} />
      <nav class="tabs" data-testid="sidebar-tabs">
        {TABS.map((t) => {
          // Badge: how much is queued on the tab; a dot when its producer stands idle.
          const unitTab = t.id === 'infantry' ? 0 : t.id === 'vehicles' ? 1 : t.id === 'air' ? 2 : -1;
          const producer = unitTab < 0 ? 'conyard' : unitTab === 0 ? 'barracks' : unitTab === 1 ? 'factory' : 'airfield';
          const queued = !cur ? 0 : unitTab >= 0 ? cur.productionQueue(state.localPlayer, unitTab).items.length : cur.buildQueue(state.localPlayer, t.id === 'structures' ? 0 : 1).item >= 0 ? 1 : 0;
          const idle = queued === 0 && (roles.get(producer) ?? 0) > 0 && t.id !== 'defenses';
          return (
            <button
              class={`${state.sidebarTab === t.id ? 'active' : ''} ${idle ? 'idle' : ''}`}
              data-tab={t.id}
              title={`${t.label} (${t.key}, then the item's letter)${idle ? ': nothing in production' : queued ? `: ${queued} queued` : ''}`}
              onClick={() => ((state.sidebarTab = t.id), state.changed())}
            >
              <span>{t.label}</span>
              <kbd>{t.key}</kbd>
              {queued > 0 && <b class="tab-badge">{queued}</b>}
              {idle && <i class="tab-idle" />}
            </button>
          );
        })}
      </nav>
      {MENU_MODES.includes(state.mode) && (
        <div class="hint" data-testid="menu-hint">
          Press a letter · Esc cancels
        </div>
      )}
      {state.placing && (
        <div class="hint" data-testid="placing-hint">
          {state.placing.planned
            ? 'Click where to build it · click the icon again to start without a spot · Esc cancels'
            : 'Click to place · right-click or Esc to cancel'}
        </div>
      )}
      {emergency && (
        <div class="hint" data-testid="rebuild-hint">
          No construction yard: your refinery can build a {state.rules.units[faction.constructionUnit]!.name} to start again.
        </div>
      )}
      {!hasProducer && (
        <div class="hint muted">
          {structureTab ? 'Deploy your construction vehicle (D) to build.' : `Needs a ${roleName(state.rules, faction.index, tabIndex === 0 ? 'barracks' : tabIndex === 1 ? 'factory' : 'airfield')}.`}
        </div>
      )}
      {hasProducer && !MENU_MODES.includes(state.mode) && !state.placing && (
        <div class="hint muted" data-testid="tab-hint">
          Press {TABS.find((t) => t.id === state.sidebarTab)!.key}, then a letter
        </div>
      )}
      <div class={`grid ${MENU_MODES.includes(state.mode) ? 'keys' : ''} ${art ? 'art' : ''}`} data-testid="build-grid">
        {items.map((it) => {
          // With no construction yard left, the refinery builds the construction vehicle.
          const missing = emergency && it.kind === 'unit' && it.index === faction.constructionUnit ? [] : state.missing(it.requires, roles);
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
          // One superweapon per player.
          const oneOnly = it.kind === 'structure' && state.rules.structures[it.index]!.superweapon !== null && (roles.get('superweapon') ?? 0) > 0 && !ready && progress === 0;
          const disabled = !hasProducer || missing.length > 0 || busy || oneOnly;
          // Why it can't be used now, in one line (requirements are listed on the card already).
          const blockedReason = oneOnly
            ? 'One per player'
            : !hasProducer
              ? `Needs a ${roleNames(state.rules, faction.index, [structureTab ? 'conyard' : tabIndex === 0 ? 'barracks' : tabIndex === 1 ? 'factory' : 'airfield'])}`
              : busy
                ? `Wait: another ${state.rules.structures[it.index]?.category === 'defenses' ? 'defense' : 'building'} is being built`
                : undefined;
          const title = oneOnly
            ? `${it.name} — ${blockedReason}`
            : missing.length > 0
              ? `${it.name} — requires ${roleNames(state.rules, faction.index, missing)}`
              : !hasProducer
                ? `${it.name} — ${blockedReason}`
                : busy
                  ? `${it.name} — ${blockedReason}`
              : `${it.name} — ${money(it.cost)}${it.kind === 'unit' ? ' · click: 1, Shift+click: 5, Ctrl+click: repeat, right-click: cancel one, Shift+right-click: cancel all' : ready ? ` · click to place${state.rules.structures[it.index]!.category === 'defenses' ? ' (Shift+click the map: place and start the next)' : ''}` : ' · right-click: cancel'}`;
          const repeating = it.kind === 'unit' && state.repeat.has(it.index);
          return (
            <button
              class={`item ${ready ? 'ready' : ''} ${progress > 0 && !ready ? 'building' : ''} ${disabled ? 'off' : ''}`}
              aria-disabled={disabled}
              aria-label={title}
              data-item={it.id}
              onMouseEnter={(e) => {
                state.hoverItem = { index: it.index, kind: it.kind, top: (e.currentTarget as HTMLElement).getBoundingClientRect().top, blocked: missing.length > 0 ? undefined : blockedReason };
                state.changed();
              }}
              onMouseLeave={() => {
                state.hoverItem = null;
                state.changed();
              }}
              onClick={(e) => {
                if (disabled) return;
                if (it.kind === 'structure') input.activateStructure(it);
                else if (e.ctrlKey || e.metaKey) input.toggleRepeat(it);
                else input.activateUnit(it, e.shiftKey ? 5 : 1);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (it.kind === 'structure') input.cancelStructure(it);
                else input.cancelUnit(it, e.shiftKey);
              }}
            >
              <Icon state={state} faction={faction.id} id={it.id} color={teamColor} />
              {progress > 0 && !ready && <i class="progress" style={{ '--p': `${progress / 10}%` }} />}
              <span class={`name ${faction.monospaceNames ? 'mono' : ''}`}>{it.name}</span>
              <span class="cost">{ready ? 'READY' : money(it.cost)}</span>
              {it.key && <kbd class="key">{it.key}</kbd>}
              {count > 0 && <b class="count">{count}</b>}
              {repeating && <b class="repeat" data-testid="repeat-badge" title="Repeating: right-click to stop">∞</b>}
            </button>
          );
        })}
      </div>
      <div class="mode" data-testid="mode">
        {state.mode === 'ability'
          ? 'Ability: click a point (blink) or an enemy vehicle (Override)'
          : UNIT_MENU_LABEL[state.mode]
            ? `${UNIT_MENU_LABEL[state.mode]}: press a letter to queue (Shift: 5) · Esc to close`
            : state.mode === 'buildMenu' || state.mode === 'defenseMenu'
              ? 'Press a letter to build'
              : state.mode !== 'normal'
                ? `Mode: ${state.mode}`
                : ''}
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
      // Mission objectives: blinking gold diamonds (green for the unit to protect), area rings. Shown even
      // without a radar: the mission tells you where to go.
      const drawObjectives = () => {
        const cur = state.cur;
        if (!cur || !state.mission) return;
        const on = Math.floor(performance.now() / 400) % 2 === 0;
        for (const m of cur.markers()) {
          const x = m.x / FX;
          const y = m.y / FX;
          ctx.fillStyle = m.kind === MARKER.protect ? '#6dff8a' : on ? '#ffd34d' : '#a07a10';
          ctx.beginPath();
          ctx.moveTo(x, y - 3);
          ctx.lineTo(x + 3, y);
          ctx.lineTo(x, y + 3);
          ctx.lineTo(x - 3, y);
          ctx.fill();
          if (m.kind === MARKER.area) {
            ctx.strokeStyle = '#ffd34d';
            ctx.lineWidth = 1.5 / scale;
            ctx.beginPath();
            ctx.arc(x, y, m.r, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      };
      if (!radarRef.current) {
        // No radar (or low power): static.
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
          ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
        }
        ctx.fillStyle = '#8892a0';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        const marked = !!state.mission && (state.cur?.markers().length ?? 0) > 0;
        ctx.fillText(state.lowPower ? 'LOW POWER' : 'NO RADAR', SIZE / 2, marked ? SIZE - 12 : SIZE / 2);
        if (marked) {
          ctx.setTransform(scale, scale * 0.5, -scale, scale * 0.5, h * scale, SIZE * 0.25);
          drawObjectives();
        }
        return;
      }
      ctx.setTransform(scale, scale * 0.5, -scale, scale * 0.5, h * scale, SIZE * 0.25);
      ctx.drawImage(base, 0, 0);
      // Echo crystals, so fields can be read from the minimap.
      ctx.fillStyle = 'rgba(62,230,255,0.55)';
      for (let i = 0; i < state.echo.length; i++) if (state.echo[i]! > 0) ctx.fillRect(i % w, Math.floor(i / w), 1, 1);
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
          const color = hex(TEAM_COLORS[cur.get(o, E.owner) % TEAM_COLORS.length]!);
          const x = cur.get(o, E.x) / FX;
          const y = cur.get(o, E.y) / FX;
          const kind = cur.get(o, E.kind);
          if (kind === KIND.structure) {
            // Buildings: their footprint as an outlined square.
            const r = state.rules.structures[cur.get(o, E.type)]!;
            ctx.fillStyle = '#05070a';
            ctx.fillRect(x - r.footprintW / 2 - 0.5, y - r.footprintH / 2 - 0.5, r.footprintW + 1, r.footprintH + 1);
            ctx.fillStyle = color;
            ctx.fillRect(x - r.footprintW / 2, y - r.footprintH / 2, r.footprintW, r.footprintH);
          } else if (kind === KIND.unit) {
            // Units: dots sized by class (infantry small, heavy vehicles big).
            const r = state.rules.units[cur.get(o, E.type)]!;
            const size = r.isAir ? 1.8 : r.armor === 0 ? 1.1 : r.armor === 2 ? 2.2 : 1.6;
            ctx.fillStyle = color;
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
          }
        }
      }
      // Capture points: diamonds in the holder's color.
      if (cur)
        for (const p of cur.points()) {
          ctx.fillStyle = p.owner >= 0 ? hex(TEAM_COLORS[p.owner % TEAM_COLORS.length]!) : '#c8ccd2';
          ctx.beginPath();
          ctx.moveTo(p.x + 0.5, p.y - 2);
          ctx.lineTo(p.x + 2.5, p.y + 0.5);
          ctx.lineTo(p.x + 0.5, p.y + 3);
          ctx.lineTo(p.x - 1.5, p.y + 0.5);
          ctx.fill();
        }
      drawObjectives();
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
      // Team pings: rings in the pinger's color.
      for (const p of state.mapPings) {
        const age = (now - p.time) / 5000;
        if (age >= 1) continue;
        ctx.strokeStyle = hex(TEAM_COLORS[p.player % TEAM_COLORS.length]!);
        ctx.globalAlpha = 1 - age;
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.arc(p.x / FX, p.y / FX, 3 + ((age * 5) % 1) * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
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
          <div class="group-grid" data-testid="selection-groups">
            {groups.map((type) => {
              // One card per type: count, combined health, click narrows the selection to it.
              const members = sel.filter((h) => (state.isUnit(h) ? 0 : 10000) + state.field(h, E.type) === type);
              const h = members[0]!;
              const rule = state.ruleOf(h);
              const factionId = state.rules.factions[rule.faction]!.id;
              let hp = 0;
              let max = 0;
              for (const m of members) {
                hp += state.field(m, E.hp);
                max += state.field(m, E.maxHp);
              }
              return (
                <button
                  class={`cell ${type === activeType ? 'active' : ''}`}
                  data-type={type}
                  title={`${members.length} × ${rule.name}: click to select only these, Shift+click to drop them, Tab cycles`}
                  onClick={(e) => state.select(e.shiftKey ? sel.filter((x) => !members.includes(x)) : members)}
                >
                  <Icon state={state} faction={factionId} id={artId(rule)} color={TEAM_COLORS[state.field(h, E.owner) % TEAM_COLORS.length]!} />
                  {!state.art.has(factionId) && <span>{rule.name.slice(0, 3)}</span>}
                  {members.length > 1 && <b class="count">{members.length}</b>}
                  <i style={{ width: `${(hp / Math.max(1, max)) * 100}%` }} />
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
              {ability && ability.cooling > 0 && <i class="cooldown" style={{ width: `${ability.cooling * 100}%` }} />}
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
  uplink: ['Uplink', 'Project network coverage around this unit for 15 s: faster fire, self-repair and Recompile wherever it goes'],
  digIn: ['Dig In', 'Entrench behind sandbags: takes 30% less damage and shoots 1 tile farther, but cannot move. Any order packs up'],
};

/** Which art draws a unit or structure (summoned units borrow another unit's). */
const artId = (rule: { kind: string; id: string; sprite?: string }) => (rule.kind === 'unit' && rule.sprite ? rule.sprite : rule.id);

const POWER_INFO: Record<string, string> = {
  jam: 'Jam: enemy weapons in the area fire 20% slower for 5 s. Holdout is air-gapped and immune',
  awaken: 'Awaken: two shards rise from an Echo field near your structures and fight for you for 20 s',
};

/** The faction's support power: name, cooldown fill, Q; click (or Q) then click the map. */
function PowerButton({ state, input }: { state: ClientState; input: Input }) {
  const power = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]?.power;
  if (!power) return null;
  const status = state.powerStatus();
  const total = power.cooldown;
  const fill = status > 0 ? 1 - status / total : status === 0 ? 1 : 0;
  const label = status === 0 ? 'Ready' : status > 0 ? `${Math.ceil(status / 20)} s` : `Needs ${roleName(state.rules, state.players[state.localPlayer]!.faction, power.requires)}`;
  return (
    <button
      class={`power-btn ${status === 0 ? 'ready' : ''} ${state.mode === 'power' ? 'active' : ''}`}
      data-testid="support-power"
      title={`${POWER_INFO[power.kind] ?? power.name} (Q, then click the map)`}
      onClick={() => input.supportPower()}
    >
      <i style={{ width: `${Math.round(fill * 100)}%` }} />
      <b>{power.name}</b>
      <span>{label}</span>
      <kbd>Q</kbd>
    </button>
  );
}

/** The superweapon: charge fill and time, then click and pick the target. */
function SuperweaponButton({ state, input }: { state: ClientState; input: Input }) {
  const rule = state.superweaponRule();
  const status = state.superStatus();
  if (!rule?.superweapon || status < 0) return null;
  const sw = rule.superweapon;
  const fill = status > 0 ? 1 - status / sw.charge : 1;
  return (
    <button
      class={`power-btn super-btn ${status === 0 ? 'ready' : ''} ${state.mode === 'superweapon' ? 'active' : ''}`}
      data-testid="superweapon"
      title={`${sw.name}: strikes ${sw.radius / 1024} tiles around the point after ${sw.delay / 20} s. Everyone sees the target and your timer.`}
      onClick={() => input.superweapon()}
    >
      <i style={{ width: `${Math.round(fill * 100)}%` }} />
      <b>☢ {sw.name}</b>
      <span>{status === 0 ? 'Ready' : state.lowPower ? `Paused ${mss(status)}` : mss(status)}</span>
    </button>
  );
}

/** Label for the ability button: the selection's ability and its shortest cooldown. */
function abilityInfo(state: ClientState): { label: string; title: string; cooling: number } | null {
  let kind: string | null = null;
  let left = Infinity;
  let full = 1;
  for (const h of state.selectedUnits()) {
    const rule = state.ruleOf(h);
    if (rule.kind !== 'unit') continue;
    const a = rule.abilities.find((x) => x.kind === 'blink' || x.kind === 'phase' || x.kind === 'override' || x.kind === 'digIn' || x.kind === 'uplink');
    if (!a) continue;
    kind ??= a.kind;
    left = Math.min(left, state.field(h, E.abilityLeft));
    if ('cooldown' in a) full = Math.max(full, a.cooldown);
  }
  if (!kind) return null;
  const [name, title] = ABILITY_NAMES[kind]!;
  return { label: left > 0 ? `${name} ${Math.ceil(left / 20)}s` : name, title, cooling: left > 0 ? Math.min(1, left / full) : 0 };
}

/** Control groups 1–9 and 0: click to select, Ctrl+click to assign the current selection. */
function GroupBar({ state }: { state: ClientState }) {
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  return (
    <div class="groups" data-testid="groups" title="Ctrl+1–9 assigns · 1–9 selects · double-tap jumps">
      {order.map((d) => {
        const g = state.controlGroups[d]!;
        // The group's most common type stands for it.
        const tally = new Map<number, number>();
        for (const h of g) if (state.isUnit(h)) tally.set(state.field(h, E.type), (tally.get(state.field(h, E.type)) ?? 0) + 1);
        const main = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
        const rule = main !== undefined ? state.rules.units[main]! : null;
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
            {rule && <Icon state={state} faction={state.rules.factions[rule.faction]!.id} id={artId(rule)} color={TEAM_COLORS[state.localPlayer % TEAM_COLORS.length]!} />}
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

const RANK_NAMES = ['Veteran', 'Elite', 'Heroic'];

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
        <Icon state={state} faction={faction.id} id={artId(rule)} color={TEAM_COLORS[state.field(h, E.owner) % TEAM_COLORS.length]!} />
      </div>
      <div>
        <div class={`title ${faction.monospaceNames ? 'mono' : ''}`}>
          {rule.name} {'★'.repeat(rank)}
          {rank > 0 && <span class="rank-name"> {RANK_NAMES[rank - 1]}</span>}
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
            {state.field(h, E.repairing) === 1 ? ' · repairing' : state.field(h, E.repairing) === 2 ? ' · growing' : ''}
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
        <ItemCard state={state} rule={rule} blocked={item.blocked} />
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
        // Doctrines: the other half of the choice, once researched, closes this one for the match.
        const other = u.excludes ? state.rules.upgradeIndex.get(u.excludes) : undefined;
        const closed = other !== undefined && (done & (1 << other)) !== 0;
        const locked = closed || (pre !== undefined && (done & (1 << pre)) === 0) || state.missing(u.requires, roles).length > 0;
        const running = active === u.index;
        const busy = active >= 0 && !running;
        const effect = describeEffect(u.effect.kind, u.effect.pct);
        return (
          <button
            class={`upgrade ${researched ? 'done' : ''} ${running ? 'building' : ''} ${u.excludes ? 'doctrine' : ''} ${closed ? 'closed' : ''}`}
            disabled={researched || locked || busy}
            data-upgrade={u.id}
            title={`${u.name}: ${effect}. ${money(u.cost)}, ${Math.round(u.researchTicks / 20)} s${u.excludes ? ` · Doctrine: choose this or ${state.rules.upgrades[other!]!.name}, not both` : ''}${closed ? ' (you chose the other)' : locked ? ' (locked)' : ''}${running ? ' · click to cancel' : ''}`}
            onClick={() => state.send(running ? { type: 'cancelResearch' } : { type: 'research', upgrade: u.index })}
          >
            {running && <i class="progress" style={{ '--p': `${progress / 10}%` }} />}
            <span>{u.name}</span>
            <small>{researched ? 'done' : running ? `${Math.floor(progress / 10)}%` : money(u.cost)}</small>
          </button>
        );
      })}
    </div>
  );
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

/** Credits above this for FLOAT_TICKS (a minute) are worth a nudge to spend them. */
const FLOAT_CREDITS = 3000;
const FLOAT_TICKS = 60 * 20;

/** First-match guide: the next useful step, read from what the player has built so far. */
function Hints({ state }: { state: ClientState }) {
  const cur = state.cur;
  if (!cur) return null;
  const roles = state.roles();
  const has = (r: string) => (roles.get(r as never) ?? 0) > 0;
  let army = 0;
  let harvesters = 0;
  for (let i = 0; i < cur.entityCount; i++) {
    const h = cur.get(cur.ent(i), 0);
    if (!state.isOwn(h) || !state.isUnit(h)) continue;
    const r = state.ruleOf(h) as { kind: string; weapon?: unknown; abilities?: { kind: string }[] };
    if (r.kind !== 'unit') continue;
    if (r.weapon) army++;
    if (r.abilities?.some((a) => a.kind === 'harvest')) harvesters++;
  }
  // Situations first: money left idle, refineries short of harvesters.
  const credits = cur.credits(state.localPlayer);
  if (credits <= FLOAT_CREDITS) state.floatSince = -1;
  else if (state.floatSince < 0) state.floatSince = cur.tick;
  const floating = state.floatSince >= 0 && cur.tick - state.floatSince >= FLOAT_TICKS;
  const refineries = roles.get('refinery') ?? 0;
  const situation = floating
    ? `${money(credits)} sitting idle: spend it. Another factory, more units, or a refinery at a new field all pay back.`
    : refineries > 0 && harvesters < refineries * 2 && cur.tick > 3 * 60 * 20
      ? `${harvesters} harvester${harvesters === 1 ? '' : 's'} for ${refineries} refiner${refineries === 1 ? 'y' : 'ies'}: each refinery runs best with two. Build more from your factory.`
      : null;
  const steps: [boolean, string][] = [
    [has('conyard'), 'Select your construction vehicle and press D to deploy your base.'],
    [has('power'), 'To build power, press B, then P, and click where it should go. It builds and places itself.'],
    [has('refinery'), 'Press B, then R for a refinery: it comes with a harvester that turns Echo into credits.'],
    [has('barracks') || has('factory'), 'Build a barracks (B, B) or a vehicle factory (B, F) to make an army.'],
    [(roles.get('refinery') ?? 0) >= 2, 'Money wins matches: build a second refinery (B, R) next to another Echo field, and keep two or three harvesters per refinery.'],
    [army >= 5, "Train units: press I, then a unit's letter once per unit (I, G, G, G queues three). V for vehicles."],
    [false, 'Select your army (drag a box or Ctrl+A) and click an enemy or the ground to attack. Destroy every enemy building to win.'],
  ];
  const next = steps.findIndex(([done]) => !done);
  const [, text] = steps[next]!;
  return (
    <div class="hints" data-testid="hints">
      <b>{situation ? 'Tip' : `Tip ${next + 1}/${steps.length}`}</b>
      <span data-testid={situation ? 'hint-situation' : undefined}>{situation ?? text}</span>
      <button
        title="Hide tips (turn them back on in the menu)"
        onClick={() => {
          state.settings.hints = false;
          state.applySettings();
        }}
      >
        ×
      </button>
    </div>
  );
}

/** Replay playback: speed, pause, progress and the verification result. */
function ReplayBar({ state }: { state: ClientState }) {
  const r = state.replay!;
  const tick = state.cur?.tick ?? 0;
  const time = (t: number) => `${Math.floor(t / 1200)}:${String(Math.floor(t / 20) % 60).padStart(2, '0')}`;
  return (
    <div class="replay-bar" data-testid="replay-bar">
      {r.live ? (
        <b class={`live-badge ${state.liveStatus ?? ''}`} data-testid="live-badge" title={state.liveStatus === 'lost' ? 'Connection to the match lost' : undefined}>
          {state.liveStatus === 'ended' ? 'Ended' : state.liveStatus === 'lost' ? 'Disconnected' : '● Live'}
        </b>
      ) : (
        <b>Replay</b>
      )}
      <span class="mono">
        {time(tick)} / {time(r.endTick)}
      </span>
      <i class="replay-progress">
        <i style={{ width: `${Math.min(100, (tick / Math.max(1, r.endTick)) * 100)}%` }} />
      </i>
      {[0.5, 1, 2, 4, 8].map((sp) => (
        <button class={r.speed === sp ? 'active' : ''} onClick={() => state.replaySpeed(sp)}>
          {sp}×
        </button>
      ))}
      {r.verified === true && (
        <span class="good" data-testid="replay-verified" title="Playback reached exactly the recorded final state">
          ✓ verified
        </span>
      )}
      {r.verified !== null && (
        <button
          data-testid="replay-report"
          onClick={() => {
            state.reportOpen = true;
            state.changed();
          }}
        >
          Report
        </button>
      )}
      {r.verified === false && (
        <span class="bad" data-testid="replay-mismatch">
          ✗ did not reproduce
        </span>
      )}
      {state.seats.length > 0 && (
        <span class="replay-seats" data-testid="replay-seats">
          {state.seats.map((s, k) => (
            <span class={`seat ${s.kind}`} title={s.kind === 'agent' ? `Played by an AI agent${s.model ? ` (${s.model})` : ''}` : undefined}>
              <i class="swatch" style={{ background: `#${TEAM_COLORS[k]!.toString(16).padStart(6, '0')}` }} />
              {s.kind === 'agent' && <b class="agent-tag">AI agent</b>}
              {s.label}
              <span class="muted"> · {state.rules.factions[state.players[k]?.faction ?? 0]?.name}</span>
            </span>
          ))}
        </span>
      )}
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
            <h2>{state.players.length > 2 ? 'A player disconnected' : 'Opponent disconnected'}</h2>
            <p class="muted">The connection was lost. The AI can take over their side so the match goes on (it won't count for the ladder).</p>
            <button data-testid="replace-with-ai" onClick={() => state.dropPeers()} disabled={(state.net?.waitingOn.length ?? 0) === 0}>
              Let the AI take over
            </button>
            <button onClick={() => go(location.pathname)}>Back to menu</button>
          </div>
        </div>
      )}
    </>
  );
}

function EndScreen({ state }: { state: ClientState }) {
  const cur = state.cur;
  const [watching, setWatching] = useState(false);
  // Team games: knocked out (or surrendered) while teammates still fight.
  const out = !!cur && cur.a[1] !== 1 && !state.spectator && !state.replay && cur.player(state.localPlayer, P.defeated) === 1;
  if (out && !watching)
    return (
      <div class="menu-overlay" data-testid="out-screen">
        <div class="menu">
          <h2>You are out</h2>
          <p class="muted">Your team fights on. Watch the rest of the match with your team's vision, or leave.</p>
          <button data-testid="keep-watching" onClick={() => setWatching(true)}>
            Keep watching
          </button>
          <button onClick={() => go(location.pathname)}>Leave match</button>
        </div>
      </div>
    );
  if (!cur || cur.a[1] !== 1) return null;
  const won = cur.a[2] === state.players[state.localPlayer]?.team;
  return (
    <div class="menu-overlay" data-testid="end-screen">
      <div class="menu">
        <h2>{won ? 'Victory' : 'Defeat'}</h2>
        {state.mission && <MissionResult state={state} won={won} />}
        {state.daily && (
          <div class="daily-end" data-testid="daily-end">
            <p>
              Daily challenge: {state.daily}
              {state.dailyResult && (
                <>
                  <br />
                  Your time <b>{clock(state.dailyResult.ticks)}</b>
                  {state.dailyResult.best !== null && state.dailyResult.best < state.dailyResult.ticks && <> · your best today {clock(state.dailyResult.best)}</>}
                </>
              )}
            </p>
            <DailyBoard refresh={state.dailyResult?.best ?? 0} />
          </div>
        )}
        {state.mission && won && nextMission(state.mission.id) && (
          <button class="start" data-testid="end-next-mission" onClick={() => go(`${location.pathname}?menu=campaign&brief=${nextMission(state.mission!.id)!.id}`)}>
            Next mission: {nextMission(state.mission.id)!.title}
          </button>
        )}
        {state.mission && (
          <button data-testid="end-campaign" onClick={() => go(`${location.pathname}?menu=campaign`)}>
            Campaign
          </button>
        )}
        {!state.multiplayer && !state.replay && !state.mission && (
          <button data-testid="end-rematch" onClick={() => go(`${location.pathname}?rematch=1`)}>
            Rematch (same map and sides)
          </button>
        )}
        <button
          data-testid="open-report"
          onClick={() => {
            state.reportOpen = true;
            state.changed();
          }}
        >
          Match report
        </button>
        {!state.replay && (
          <button onClick={() => state.saveReplay()} data-testid="end-save-replay">
            Save replay
          </button>
        )}
        {state.multiplayer && (
          <button data-testid="end-mp-rematch" onClick={() => state.rematch()} title="Back to the same room: same map and seats">
            Rematch
          </button>
        )}
        <button onClick={() => go(`${location.pathname}?menu=skirmish`)} data-testid="end-new-skirmish">
          New skirmish
        </button>
        <button onClick={() => go(location.pathname)} data-testid="end-menu">
          Main menu
        </button>
      </div>
    </div>
  );
}

/**
 * Rebind keys: click an action, press the new key (with Ctrl, Shift or Alt if you like).
 * Number and F-key actions (control groups, camera spots) keep their keys.
 */
function KeyBindings({ state, onClose }: { state: ClientState; onClose: () => void }) {
  const [, force] = useReducer((n: number, _: undefined) => n + 1, 0);
  const [waiting, setWaitingState] = useState<string | null>(null);
  // The listener reads this, so a key pressed right after the click is never missed.
  const waitingRef = useRef<string | null>(null);
  const setWaiting = (a: string | null) => {
    waitingRef.current = a;
    setWaitingState(a);
  };
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const waiting = waitingRef.current;
      if (!waiting) return;
      const map = withOverrides(state.rules.keymap, state.settings.keys);
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return setWaiting(null);
      const chord = chordOf(e);
      if (!chord) return;
      // The same chord may not do two things where both apply (global keys apply everywhere).
      const ctxOf = (a: string) => (['global', 'units', 'base'] as const).find((c) => a in map[c])!;
      const mine = ctxOf(waiting);
      const clash = (['global', 'units', 'base'] as const)
        .filter((c) => c === mine || c === 'global' || mine === 'global')
        .flatMap((c) => Object.entries(map[c]))
        .find(([a, chords]) => a !== waiting && chords.includes(chord));
      if (clash) {
        setError(`${chordLabel(chord)} already does "${ACTION_LABEL[clash[0]] ?? clash[0]}"`);
        return;
      }
      state.settings.keys = { ...state.settings.keys, [waiting]: [chord] };
      state.applySettings();
      setError(null);
      setWaiting(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
  const map = withOverrides(state.rules.keymap, state.settings.keys);
  return (
    <div class="menu-overlay" data-testid="keys">
      <div class="menu keys-menu">
        <h2>Keys</h2>
        <p class="muted">Click an action, then press its new key. Esc cancels.</p>
        {error && <p class="bad">{error}</p>}
        {(
          [
            ['global', 'Anytime'],
            ['units', 'With units selected'],
            ['base', 'Base and production'],
          ] as const
        ).map(([ctx, label]) => (
          <section>
            <h3>{label}</h3>
            <table>
              <tbody>
                {Object.entries(map[ctx]).map(([action, chords]) => {
                  const fixed = chords.some((c) => c.includes('#'));
                  return (
                    <tr>
                      <td>{ACTION_LABEL[action] ?? action}</td>
                      <td>
                        <button
                          class={`key-btn ${waiting === action ? 'active' : ''} ${state.settings.keys[action] ? 'custom' : ''}`}
                          disabled={fixed}
                          data-action={action}
                          onClick={() => {
                            setError(null);
                            setWaiting(action);
                          }}
                        >
                          {waiting === action ? 'Press a key…' : chords.map((c) => chordLabel(c)).join(' / ')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
        <div class="confirm-row">
          <button
            data-testid="keys-reset"
            onClick={() => {
              state.settings.keys = {};
              state.applySettings();
              force(undefined);
            }}
          >
            Reset to defaults
          </button>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** Remembers a won mission (once) and says so. */
function MissionResult({ state, won }: { state: ClientState; won: boolean }) {
  useEffect(() => {
    if (won) markMissionWon(state.mission!.id);
  }, [won]);
  return <p class="muted">{won ? `${state.mission!.title}: mission complete.` : 'Mission failed. Try again from the menu, or with Retry.'}</p>;
}

/** Which marker an objective's next click jumps to (cycles through its targets). */
const objectiveCycle = new Map<number, number>();

/** Campaign mission: the objectives, ticked off as they are done; click one to look at it on the map. */
function MissionPanel({ state, input }: { state: ClientState; input: Input }) {
  const m = state.mission!;
  const status = state.cur?.objectives() ?? [];
  const markers = state.cur?.markers() ?? [];
  return (
    <div class="tutorial mission-panel" data-testid="mission-panel">
      <b>{m.title}</b>
      {state.campaignDifficulty !== 'normal' && <span class="muted small"> · {state.campaignDifficulty === 'story' ? 'Story' : 'Hard'}</span>}
      <ul>
        {m.objectives.map((o, i) => {
          const mine = markers.filter((k) => k.objective === i);
          const label = (
            <>
              {status[i] === 1 ? '✓' : status[i] === 2 ? '✗' : '○'} {o.text}
              {mine.length > 1 && o.kind === 'destroy' && o.count === undefined && <span class="muted"> ({mine.length} left)</span>}
            </>
          );
          return (
            <li class={status[i] === 1 ? 'done' : status[i] === 2 ? 'failed' : ''} data-objective={i}>
              {mine.length > 0 ? (
                <button
                  class="link objective-link"
                  title="Show on the map (click again for the next one)"
                  onClick={() => {
                    const n = (objectiveCycle.get(i) ?? -1) + 1;
                    objectiveCycle.set(i, n);
                    const k = mine[n % mine.length]!;
                    input.lookAt(k.x, k.y);
                  }}
                >
                  {label} <span class="objective-pin">◎</span>
                </button>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ul>
      {markers.length > 0 && <p class="muted small">Gold markers on the map and minimap show where to go. Click an objective to look at it.</p>}
    </div>
  );
}

/** Touch screens: what keys and the right mouse button do elsewhere. */
function TouchBar({ state, input }: { state: ClientState; input: Input }) {
  return (
    <div class="touch-bar" data-testid="touch-bar">
      <button
        class={state.touchBox ? 'active' : ''}
        title="Drag to box-select instead of moving the view"
        onClick={() => {
          state.touchBox = !state.touchBox;
          state.changed();
        }}
      >
        ▢ Box
      </button>
      <button onClick={() => input.run('selectArmy')}>Army</button>
      <button onClick={() => input.run('attackMove')} class={state.mode === 'attackMove' ? 'active' : ''}>
        Attack
      </button>
      <button onClick={() => input.run('stop')}>Stop</button>
      <button onClick={() => input.rightClick(0, 0, false)}>Cancel</button>
    </div>
  );
}

/** Multiplayer chat: recent lines fade out; Enter opens the box, Enter sends, Esc closes. */
function Chat({ state }: { state: ClientState }) {
  const twoTeams = state.players.length > 2;
  const [team, setTeam] = useState(twoTeams);
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.chatOpen) ref.current?.focus();
  }, [state.chatOpen]);
  const now = performance.now();
  const shown = state.chat.filter((c) => state.chatOpen || now - c.time < 12000).slice(-8);
  const close = () => {
    state.chatOpen = false;
    setText('');
    ref.current?.blur();
    state.changed();
  };
  return (
    <div class="chat" data-testid="chat">
      {shown.map((c) => (
        <div class="chat-line">
          <b style={{ color: hex(TEAM_COLORS[c.player % TEAM_COLORS.length]!) }}>{c.name}</b>
          {c.team && twoTeams ? <span class="muted"> (team)</span> : null}: {c.text}
        </div>
      ))}
      {state.chatOpen && (
        <div class="chat-input">
          {twoTeams && (
            <button onClick={() => setTeam(!team)} title="Who reads it">
              {team ? 'Team' : 'All'}
            </button>
          )}
          <input
            ref={ref}
            value={text}
            maxLength={200}
            data-testid="chat-input"
            placeholder="Say something… (Enter sends, Esc closes)"
            onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') close();
              else if (e.key === 'Enter') {
                if (text.trim()) state.sendChat(text.trim(), team);
                close();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/** While the map generates: key art, the factions in this match and a tip. */
function Loading({ state }: { state: ClientState }) {
  const [tip] = useState(() => {
    const faction = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]?.id ?? 'holdout';
    const pool = [...GENERAL_TIPS, ...(FACTION_TIPS[faction] ?? [])];
    return pool[Math.floor(Math.random() * pool.length)]!;
  });
  const names = state.players.map((p) => state.rules.factions[p.faction]?.name).filter(Boolean);
  return (
    <div class="loading" data-testid="loading" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}assets/ui/keyart.jpg)` }}>
      <div class="loading-box">
        <h2>{names.length > 0 ? names.join(' vs ') : 'Preparing the battlefield'}</h2>
        <p class="muted">Generating the map…</p>
        <p class="loading-tip">
          <b>Tip:</b> {tip}
        </p>
      </div>
    </div>
  );
}

/** Pause menu side panel: how to win, tips for your faction and the main keys. */
function Briefing({ state }: { state: ClientState }) {
  const faction = state.rules.factions[state.players[state.localPlayer]?.faction ?? 0]!;
  return (
    <div class="menu briefing" data-testid="briefing">
      {state.mission ? (
        <>
          <h3>{state.mission.title}</h3>
          {state.mission.briefing.map((p) => (
            <p>{p}</p>
          ))}
          <h3>Objectives</h3>
          <ul>
            {state.mission.objectives.map((o) => (
              <li>{o.text}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h3>Objective</h3>
          <p>Destroy every enemy building. Units left alone don't count.</p>
        </>
      )}
      <h3>{faction.name}</h3>
      <ul>
        {(FACTION_TIPS[faction.id] ?? []).map((t) => (
          <li>{t}</li>
        ))}
      </ul>
      <h3>Keys</h3>
      <table class="keys-glance">
        <tbody>
          {[
            ['B / N', 'Build / defense, then a letter'],
            ['I / V / Y', 'Infantry / vehicles / air, then letters'],
            ['Click ground', 'Attack-move the selection'],
            ['M, P, G', 'Move, patrol, guard, then click'],
            ['F', 'Unit ability'],
            ['Q', 'Support power'],
            ['Ctrl+1–9', 'Make a control group'],
            ['Space', 'Jump to alerts'],
            ['Alt', 'Health bars and ranges'],
          ].map(([k, v]) => (
            <tr>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">The Codex has the full keymap.</p>
    </div>
  );
}

/** Pause menu sections: the briefing first, then the settings in small groups. */
const MENU_SECTIONS = [
  ['briefing', 'Briefing'],
  ['sound', 'Sound'],
  ['graphics', 'Graphics'],
  ['controls', 'Controls'],
  ['interface', 'Interface'],
] as const;
type MenuSection = (typeof MENU_SECTIONS)[number][0];

function Menu({ state, input, audio }: { state: ClientState; input: Input; audio: GameAudio }) {
  const [, force] = useReducer((n: number, _: undefined) => n + 1, 0);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const briefing = !state.replay && !state.spectator;
  const [section, setSection] = useState<MenuSection>(briefing ? 'briefing' : 'sound');
  if (keysOpen) return <KeyBindings state={state} onClose={() => setKeysOpen(false)} />;
  const slider = (label: string, kind: 'music' | 'sfx' | 'voice') => (
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
  return (
    <div class="menu-overlay" data-testid="menu">
      <div class="menu-pair">
        <div class="menu menu-nav">
          <h2>{state.multiplayer ? 'Menu' : 'Paused'}</h2>
          <button class="start" onClick={() => input.toggleMenu()}>
            Resume
          </button>
          <nav class="menu-sections">
            {MENU_SECTIONS.filter(([id]) => id !== 'briefing' || briefing).map(([id, label]) => (
              <button class={section === id ? 'active' : ''} data-testid={`menu-section-${id}`} onClick={() => setSection(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div class="menu-actions">
            {!state.replay && !state.multiplayer && !state.spectator && (
              <button data-testid="menu-save-game" onClick={() => state.saveGame()} title="Continue it later from the main menu">
                Save game
              </button>
            )}
            {!state.replay && (
              <button data-testid="menu-save-replay" onClick={() => state.saveReplay()}>
                Save replay
              </button>
            )}
            <button
              data-testid="menu-codex"
              onClick={() => {
                state.codexOpen = true;
                state.changed();
              }}
            >
              Codex
            </button>
            <button
              data-testid="menu-credits"
              onClick={() => {
                state.creditsOpen = true;
                state.changed();
              }}
            >
              Credits
            </button>
            {confirmSurrender ? (
              <div class="confirm-row" data-testid="surrender-confirm">
                <span>Give up this match?</span>
                <button
                  class="danger"
                  data-testid="surrender-yes"
                  onClick={() => {
                    state.send({ type: 'surrender' });
                    setConfirmSurrender(false);
                    input.toggleMenu();
                  }}
                >
                  Surrender
                </button>
                <button onClick={() => setConfirmSurrender(false)}>Keep playing</button>
              </div>
            ) : (
              <button data-testid="menu-surrender" onClick={() => setConfirmSurrender(true)}>
                Surrender
              </button>
            )}
          </div>
        </div>
        {section === 'briefing' && briefing && <Briefing state={state} />}
        {section === 'sound' && (
          <div class="menu menu-panel" data-testid="menu-panel-sound">
            <h3>Sound</h3>
            {slider('Music', 'music')}
            {slider('Effects', 'sfx')}
            {slider('Announcer', 'voice')}
            {(
              [
                ['unitVoices', 'Unit voices', 'Units reply when you select or order them'],
                ['subtitles', 'Subtitles', 'Show what the announcer says'],
              ] as const
            ).map(([key, label, title]) => (
              <div class="seg-row" title={title}>
                <span>{label}</span>
                {[true, false].map((v) => (
                  <button
                    class={state.settings[key] === v ? 'active' : ''}
                    data-testid={`setting-${key}-${v ? 'on' : 'off'}`}
                    onClick={() => {
                      state.settings[key] = v;
                      state.applySettings();
                    }}
                  >
                    {v ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {section === 'graphics' && (
          <div class="menu menu-panel" data-testid="menu-panel-graphics">
            <h3>Graphics</h3>
            <div class="seg-row" title="Lower settings run faster on older computers. Ultra draws at your screen's full sharpness (Retina and other high-DPI screens) with sharper sprites from the next match; it needs a strong graphics card">
              <span>Graphics</span>
              {(['ultra', 'high', 'balanced', 'performance'] as const).map((v) => (
                <button
                  class={state.settings.graphics === v ? 'active' : ''}
                  data-testid={`setting-graphics-${v}`}
                  onClick={() => {
                    state.settings.graphics = v;
                    state.applySettings();
                  }}
                >
                  {v === 'ultra' ? 'Ultra' : v === 'high' ? 'High' : v === 'balanced' ? 'Balanced' : 'Performance'}
                </button>
              ))}
            </div>
            <div class="seg-row">
              <span>Visual effects</span>
              {(['full', 'reduced'] as const).map((v) => (
                <button
                  class={state.settings.effects === v ? 'active' : ''}
                  data-testid={`setting-effects-${v}`}
                  onClick={() => {
                    state.settings.effects = v;
                    state.applySettings();
                  }}
                >
                  {v === 'full' ? 'Full' : 'Reduced'}
                </button>
              ))}
            </div>
            <button onClick={() => void toggleFullscreen().catch(() => undefined)}>Fullscreen</button>
          </div>
        )}
        {section === 'controls' && (
          <div class="menu menu-panel" data-testid="menu-panel-controls">
            <h3>Controls</h3>
            <label class="slider">
              Scroll
              <input
                type="range"
                min={50}
                max={200}
                step={10}
                value={Math.round(state.settings.scrollSpeed * 100)}
                data-testid="setting-scroll"
                onInput={(e) => {
                  state.settings.scrollSpeed = Number((e.currentTarget as HTMLInputElement).value) / 100;
                  state.applySettings();
                }}
              />
              <span>{Math.round(state.settings.scrollSpeed * 100)}%</span>
            </label>
            <div class="seg-row">
              <span>Wheel zoom</span>
              {[false, true].map((v) => (
                <button
                  class={state.settings.invertWheel === v ? 'active' : ''}
                  data-testid={`setting-wheel-${v ? 'inverted' : 'normal'}`}
                  onClick={() => {
                    state.settings.invertWheel = v;
                    state.applySettings();
                  }}
                >
                  {v ? 'Inverted' : 'Normal'}
                </button>
              ))}
            </div>
            {!state.multiplayer && !state.replay && (
              <div class="seg-row" title="Skirmish only (- and = in game)">
                <span>Game speed</span>
                {GAME_SPEEDS.map((v) => (
                  <button class={state.gameSpeed === v ? 'active' : ''} data-testid={`setting-speed-${v}`} onClick={() => state.setGameSpeed(v)}>
                    {v}×
                  </button>
                ))}
              </div>
            )}
            <button data-testid="menu-keys" onClick={() => setKeysOpen(true)}>
              Key bindings
            </button>
          </div>
        )}
        {section === 'interface' && (
          <div class="menu menu-panel" data-testid="menu-panel-interface">
            <h3>Interface</h3>
            <label class="slider">
              Interface
              <input
                type="range"
                min={80}
                max={140}
                step={10}
                value={state.settings.uiScale}
                data-testid="setting-ui-scale"
                onInput={(e) => {
                  state.settings.uiScale = Number((e.currentTarget as HTMLInputElement).value);
                  state.applySettings();
                }}
              />
              <span>{state.settings.uiScale}%</span>
            </label>
            {(
              [
                ['colorblind', 'Team colors', 'Color-blind friendly team colors'],
              ] as const
            ).map(([key, label, title]) => (
              <div class="seg-row" title={title}>
                <span>{label}</span>
                {[true, false].map((v) => (
                  <button
                    class={state.settings[key] === v ? 'active' : ''}
                    data-testid={`setting-${key}-${v ? 'on' : 'off'}`}
                    onClick={() => {
                      state.settings[key] = v;
                      state.applySettings();
                    }}
                  >
                    {key === 'colorblind' ? (v ? 'Color-blind' : 'Standard') : v ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
            ))}
            <div class="seg-row">
              <span>Hints</span>
              {[true, false].map((v) => (
                <button
                  class={state.settings.hints === v ? 'active' : ''}
                  onClick={() => {
                    state.settings.hints = v;
                    state.applySettings();
                  }}
                >
                  {v ? 'On' : 'Off'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
