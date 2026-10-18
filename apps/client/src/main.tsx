import { render } from 'preact';
import { defaultRules } from '@signal-fall/data';
import { ClientState, seatLabels, saveSettings, setColorblind } from './game/state';
import { Input } from './input/input';
import { Snapshot, type FromWorker, type ScenarioSpec, type ToWorker } from './protocol';
import type { ScheduledCommand } from '@signal-fall/sim';
import { Renderer } from './render/renderer';
import { GameAudio, cameraListener } from './audio/audio';
import { App } from './ui/App';
import { MenuScreen, Setup, loadSaved, type SkirmishSettings } from './ui/Setup';
import { Multiplayer } from './ui/Multiplayer';
import { Cutscene, introToPlay, introUrl, markIntroSeen } from './ui/Video';
import type { Replay } from './game/scenario';
import { addRecent, clock, saveGame, savedGame } from './game/saves';
import { NetSession, degrade } from './net/session';
import { backend, fileDesyncReport, finishEmailLink } from './net/backend';
import { recordMatch, type NetMatch } from './net/history';
import { reportErrors } from './net/errors';
import type { LinkLike } from './net/lobby';
import type { Difficulty } from '@signal-fall/ai';
import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';
import '@fontsource/saira-stencil-one/latin-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './ui/styles.css';

const params = new URLSearchParams(location.search);
// Any game parameter in the URL skips the setup screen (tests, shared links).
const AUTOSTART_KEYS = ['scenario', 'seed', 'speed', 'size', 'biome', 'ai', 'faction', 'enemy', 'spectate', 'mode'];
/** Spectator mode: both sides are AI at this difficulty, no fog. Great for watching and recording. */
const spectate = params.get('spectate') as Difficulty | null;
const autostart = AUTOSTART_KEYS.some((k) => params.has(k));

function scenarioFromUrl(): ScenarioSpec {
  const kind = params.get('scenario') ?? 'skirmish';
  const seed = Number(params.get('seed') ?? 7);
  if (kind !== 'skirmish') {
    return { kind: kind === 'stress' ? 'stress' : 'sandbox', seed, unitsPerSide: Number(params.get('units') ?? (kind === 'stress' ? 200 : 24)) };
  }
  const ai = params.get('ai') ?? 'normal';
  const map = {
    size: (params.get('size') ?? 'M') as MapSize,
    biome: (params.get('biome') ?? 'wasteland') as Biome,
    resources: (params.get('resources') ?? 'normal') as Resources,
    terrain: (params.get('terrain') ?? 'normal') as TerrainStyle,
  };
  // ?mode=2v2[&factions=0,2,1,0]: slots 0+1 against 2+3; every slot but ours is AI (all of them when spectating).
  if (params.get('mode') === '2v2') {
    const factions = (params.get('factions') ?? '0,2,1,0').split(',').map(Number);
    const level = spectate ?? (ai as Difficulty);
    return { kind, seed, factions, ai: [spectate, level, level, level], teams: [0, 0, 1, 1], map };
  }
  return {
    kind,
    seed,
    factions: [Number(params.get('faction') ?? 0), Number(params.get('enemy') ?? 1)],
    ai: [spectate, spectate ?? (ai === 'none' ? null : (ai as Difficulty))],
    map,
  };
}

/** Where the camera was in a replay, per replay (seed, length and final hash identify it). */
const replayCameraKey = (r: Replay) => `signalfall.replaycam.${r.scenario.seed}.${r.endTick}.${r.hash}`;
function replayCamera(r: Replay): { x: number; y: number; zoom: number } | null {
  try {
    return JSON.parse(localStorage.getItem(replayCameraKey(r)) ?? 'null') as { x: number; y: number; zoom: number } | null;
  } catch {
    return null;
  }
}

function scenarioFromSetup(s: SkirmishSettings): ScenarioSpec {
  const map = { size: s.size, biome: s.biome, resources: s.resources, terrain: s.terrain };
  const style = s.personality && s.personality !== 'random' ? s.personality : null;
  // 2v2: you and your ally hold neighbouring corners (slots 0, 1) against slots 2, 3.
  if (s.mode === '2v2')
    return {
      kind: 'skirmish',
      seed: s.seed,
      factions: [s.faction, s.allyFaction, s.enemyFaction, s.enemy2Faction],
      ai: [null, s.allyDifficulty, s.difficulty, s.difficulty],
      teams: [0, 0, 1, 1],
      map,
      time: s.time,
      personality: [null, null, style, style],
    };
  return { kind: 'skirmish', seed: s.seed, factions: [s.faction, s.enemyFaction], ai: [null, s.difficulty], map, time: s.time, personality: [null, style] };
}

/** ?rematch: the last skirmish setup again (same map, sides and AI), straight into the match. */
function rematch(): ScenarioSpec | null {
  const saved = loadSaved();
  if (!params.has('rematch') || saved.seed === undefined) return null;
  history.replaceState(null, '', location.pathname);
  return scenarioFromSetup(saved as SkirmishSettings);
}
/** ?continue: the saved skirmish, picked up where it was saved. */
const resume = params.has('continue') ? (savedGame()?.replay ?? null) : null;
if (params.has('continue')) history.replaceState(null, '', location.pathname);
let scenario: ScenarioSpec | null = autostart ? scenarioFromUrl() : resume ? resume.scenario : rematch();
/** Our player slot (0 unless we joined someone's multiplayer room). */
let localSlot = 0;
/** Multiplayer: connections to the other people by slot, until the worker is running. */
let peerLinks: Map<number, LinkLike> | null = null;
/** Watching a recorded match. */
let replay: Replay | null = null;
let netSession: NetSession | null = null;
/** Live spectating: ?watch=<stream URL> of an agent server (docs/AGENTS.md). */
const watchStream = params.get('watch');
/** Live chunks that arrived before the worker started. */
let liveBuffer: Extract<ToWorker, { type: 'live' }>[] | null = watchStream ? [] : null;
function sendLive(msg: Extract<ToWorker, { type: 'live' }>): void {
  if (state.replay) state.replay.endTick = msg.until;
  if (liveBuffer) liveBuffer.push(msg);
  else post(msg);
  state.changed();
}
/** Multiplayer: room code and account ids per slot, for the match record. */
let netMatch: NetMatch | null = null;
/** Lobby screen showing instead of the skirmish setup. */
let multiplayerScreen = new URLSearchParams(location.search).has('room');

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);
reportErrors(() => (!scenario ? 'menu' : replay ? 'replay' : peerLinks ? 'multiplayer' : `${scenario.kind} @${state.cur?.tick ?? 0}`), worker);
const state = new ClientState(defaultRules(), post);
state.spectator = spectate !== null;
state.applySettings = () => {
  saveSettings(state.settings);
  renderer.effects.reduced = state.settings.effects === 'reduced';
  renderer.weather.enabled = state.settings.effects !== 'reduced';
  renderer.setGraphics(state.settings.graphics);
  setColorblind(state.settings.colorblind);
  input?.reloadBindings();
  document.documentElement.style.setProperty('--ui-scale', String(state.settings.uiScale / 100));
  state.changed();
};
state.saveReplay = () => post({ type: 'saveReplay' });
state.saveGame = () => post({ type: 'saveReplay', purpose: 'save' });
state.requestStats = () => post({ type: 'requestStats' });
state.replaySpeed = (speed) => {
  if (!state.replay) return;
  state.replay.speed = speed;
  post({ type: 'speed', speed });
  state.changed();
};
const renderer = new Renderer(state);
renderer.effects.reduced = state.settings.effects === 'reduced';
renderer.weather.enabled = state.settings.effects !== 'reduced';
const audio = new GameAudio(
  state,
  state.rules,
  cameraListener(() => ({ ...renderer.camera, w: renderer.width || window.innerWidth, h: renderer.height || window.innerHeight })),
);
state.muted = audio.settings.muted;
state.toggleMute = () => {
  state.muted = audio.toggleMute();
  state.changed();
};
// Browsers only allow audio after a user gesture.
const unlockAudio = () => {
  void audio.unlock();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
let input: Input | null = null;

async function mountGame(host: HTMLDivElement): Promise<void> {
  await renderer.init(host);
  renderer.setGraphics(state.settings.graphics);
  input = new Input(state, renderer, renderer.app.canvas);
  renderer.placementGhost = () => {
    const c = input?.cursor();
    return c && input ? input.placementAt(c.x, c.y) : null;
  };
  renderer.cursorPoint = () => {
    const c = input?.cursor();
    return c && input ? input.simPoint(c.x, c.y) : null;
  };
  renderUi();
  let fpsFrames = 0;
  let fpsStart = performance.now();
  renderer.app.ticker.add((t) => {
    const t0 = performance.now();
    input?.update(t.deltaMS / 1000);
    renderer.frame();
    audio.update();
    state.frameMs = state.frameMs * 0.95 + (performance.now() - t0) * 0.05;
    fpsFrames++;
    const now = performance.now();
    if (now - fpsStart >= 500) {
      state.fps = Math.round((fpsFrames * 1000) / (now - fpsStart));
      fpsFrames = 0;
      fpsStart = now;
      state.changed();
    }
  });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    if (msg.type === 'net') {
      netSession?.send(msg.msg);
      return;
    }
    if (msg.type === 'replay') {
      const label = state.players.map((p) => state.rules.factions[p.faction]!.name).join(' vs ');
      const meta = { at: Date.now(), tick: state.cur?.tick ?? 0, label };
      if (msg.purpose === 'save') {
        if (saveGame(msg.json, meta)) state.notice(`Game saved at ${clock(meta.tick)}`);
        else state.warn('Could not save: browser storage is full or blocked');
        return;
      }
      if (msg.purpose === 'recent') {
        addRecent(msg.json, meta);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([msg.json], { type: 'application/json' }));
      a.download = `signal-fall-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.sfreplay.json`;
      a.click();
      return;
    }
    if (msg.type === 'final') {
      // Keep the replay in the recent-matches list on the main menu.
      if (!replay) post({ type: 'saveReplay', purpose: 'recent' });
      // Match history (online builds; not for spectating or replays).
      const sb = backend();
      if (sb && scenario?.kind === 'skirmish' && !replay && !state.spectator)
        void recordMatch(sb, scenario, localSlot, msg, state.stats, netMatch).then((err) => err && console.warn('match not recorded:', err));
      return;
    }
    if (msg.type === 'stats') {
      state.stats = msg.stats;
      state.changed();
      return;
    }
    if (msg.type === 'replayEnd') {
      if (state.replay) state.replay.verified = msg.ok;
      state.changed();
      return;
    }
    if (msg.type === 'netStatus') {
      state.net = { delayTurns: msg.delayTurns, rtt: msg.rtt, waitingOn: msg.waitingOn };
      return;
    }
    if (msg.type === 'desync') {
      state.desync = { tick: msg.tick, report: msg.report };
      state.changed();
      console.error(`desync at tick ${msg.tick}: local ${msg.local} vs player ${msg.player} ${msg.remote}`);
      // File it with the backend (when there is one) so it can be replayed and fixed.
      const sb = backend();
      if (sb) void fileDesyncReport(sb, null, msg.tick, msg.local, msg.remote, msg.report);
      return;
    }
    if (msg.type === 'ready') {
      state.width = msg.width;
      state.height = msg.height;
      state.terrain = msg.terrain;
      state.decoration = msg.decoration;
      state.surface = msg.surface;
      state.landmark = msg.landmark;
      state.biome = msg.biome;
      state.mapSeed = msg.mapSeed;
      state.players = msg.players;
      state.localPlayer = msg.localPlayer;
      renderer.buildMap();
      renderer.weather.setBiome(msg.biome);
      const lit = replay ? replay.scenario : scenario;
      const time = lit?.kind === 'skirmish' ? lit.time : null;
      renderer.night.setTime((params.get('time') as 'day' | 'dusk' | 'night' | null) ?? time ?? 'day');
      // Load rendered art for the factions in this match (placeholders draw until it arrives).
      for (const p of msg.players) {
        const id = state.rules.factions[p.faction]!.id;
        void renderer.lib.loadFaction(id).then(() => {
          if (!renderer.lib.has(id)) return;
          state.art.add(id);
          state.changed();
        });
      }
      state.ready = true;
    } else if (msg.type === 'snapshot') {
      const first = state.cur === null;
      state.onSnapshot(new Snapshot(msg.buf), msg.fog, msg.echo);
      if (msg.fx) {
        renderer.effects.ingest(msg.fx);
        audio.ingest(msg.fx);
      }
      if (first) {
        input?.useFactionCursors();
        // A replay watched before opens where the camera was left.
        const cam = replay ? replayCamera(replay) : null;
        if (cam) Object.assign(renderer.camera, cam);
        else input?.run('jumpToBase');
        if (replay) {
          const key = replayCameraKey(replay);
          setInterval(() => {
            try {
              localStorage.setItem(key, JSON.stringify(renderer.camera));
            } catch {
              // Not remembered.
            }
          }, 2000);
        }
      }
    }
  };
  if (peerLinks && scenario?.kind === 'skirmish') {
    const links = [...peerLinks.values()];
    state.multiplayer = true;
    post({ type: 'start', scenario, localPlayer: localSlot, net: { peers: scenario.humans ?? [0, 1] } });
    const lost = () => {
      state.peerLost = true;
      state.changed();
    };
    for (const l of links) l.onFailed = lost;
    void Promise.all(links.map((l) => l.ready)).then((dgrams) => {
      const netsim = params.get('netsim');
      netSession = new NetSession(
        dgrams.map((d) => (netsim ? degrade(d, netsim) : d)),
        (m) => post({ type: 'net', msg: m }),
      );
      netSession.onPeerLost = lost;
    });
  } else if (replay) {
    state.spectator = true;
    const live = !!watchStream;
    state.replay = { endTick: replay.endTick, verified: null, speed: 1, paused: false, live };
    post({ type: 'start', scenario: replay.scenario, localPlayer: replay.localPlayer, replay, live });
    if (live) {
      for (const m of liveBuffer ?? []) post(m);
      liveBuffer = null;
    }
  } else post({ type: 'start', scenario: scenario!, localPlayer: 0, speed: Number(params.get('speed') ?? 1), resume: resume ?? undefined });
  const shown = replay ? replay.scenario : scenario;
  if (shown) state.seats = seatLabels(shown, replay ? replay.localPlayer : localSlot, state.spectator);
}

const root = document.getElementById('app')!;
/** Intro cutscene URL once known (enables the replay button on the setup screen). */
let intro: string | null = null;
void introUrl().then((u) => {
  intro = u;
  if (u && !scenario) renderUi();
});
/** Message after returning from an account email link, shown on the main menu once. */
let accountNotice: string | null = null;
let mounted = false;
function renderUi(): void {
  if (!scenario && watchStream) {
    render(
      <MenuScreen testid="watch-connecting">
        <div class="setup-panel">
          <h1>Live match</h1>
          <p class="mp-status">{state.liveStatus === 'lost' ? 'Could not reach the match stream.' : 'Connecting to the match…'}</p>
          <p class="muted small">{watchStream}</p>
          <a class="codex-btn" href={location.pathname}>
            Back to the menu
          </a>
        </div>
      </MenuScreen>,
      root,
    );
    return;
  }
  if (!scenario && multiplayerScreen) {
    render(
      <Multiplayer
        rules={state.rules}
        onBack={() => {
          multiplayerScreen = false;
          renderUi();
        }}
        onStart={(sc, slot, links, room) => {
          scenario = sc;
          localSlot = slot;
          peerLinks = links;
          netMatch = { room: room.code, uids: room.slots.map((x) => x.player?.uid ?? null) };
          renderUi();
        }}
      />,
      root,
    );
    return;
  }
  if (!scenario) {
    render(
      <Setup
        notice={accountNotice}
        onReplay={(r) => {
          replay = r;
          scenario = r.scenario;
          renderUi();
        }}
        onIntro={
          intro
            ? () =>
                render(
                  <Cutscene
                    src={intro!}
                    onDone={() => {
                      markIntroSeen();
                      renderUi();
                    }}
                  />,
                  root,
                )
            : undefined
        }
        onMultiplayer={() => {
          multiplayerScreen = true;
          renderUi();
        }}
        rules={state.rules}
        onStart={(settings) => {
          void (async () => {
            const begin = () => {
              scenario = scenarioFromSetup(settings);
              renderUi();
            };
            // The intro plays once, before the first match.
            const intro = await introToPlay();
            if (!intro) return begin();
            render(
              <Cutscene
                src={intro}
                onDone={() => {
                  markIntroSeen();
                  begin();
                }}
              />,
              root,
            );
          })();
        }}
      />,
      root,
    );
    return;
  }
  render(
    <App
      state={state}
      input={input ?? placeholderInput}
      renderer={renderer}
      audio={audio}
      gameHost={(el) => {
        if (mounted) return;
        mounted = true;
        void mountGame(el);
      }}
    />,
    root,
  );
}

// Before the canvas exists, UI buttons are inert.
const placeholderInput = { run: () => undefined, toggleMenu: () => undefined } as unknown as Input;
renderUi();
// Live spectating: follow an agent server's match stream (docs/AGENTS.md).
if (watchStream) {
  state.liveStatus = 'connecting';
  let knownUntil = 0;
  const es = new EventSource(watchStream);
  type Turn = { commands: ScheduledCommand[]; until: number; hash?: number; over?: boolean };
  const turn = (d: Turn) => {
    // After a reconnect the stream starts over: only take what is new.
    sendLive({ type: 'live', commands: d.commands.filter((c) => c.tick >= knownUntil), until: d.until, hash: d.over ? d.hash : undefined });
    knownUntil = d.until;
    if (d.over) {
      state.liveStatus = 'ended';
      es.close();
    }
  };
  es.addEventListener('start', (ev) => {
    const d = JSON.parse((ev as MessageEvent<string>).data) as Turn & { scenario: ScenarioSpec };
    if (!replay) {
      replay = { format: 'signal-fall-replay', version: 1, scenario: d.scenario, localPlayer: 0, commands: [], endTick: d.until, hash: 0 };
      scenario = d.scenario;
      renderUi();
    }
    state.liveStatus = 'live';
    turn(d);
  });
  es.addEventListener('turn', (ev) => turn(JSON.parse((ev as MessageEvent<string>).data) as Turn));
  es.addEventListener('end', (ev) => turn({ ...(JSON.parse((ev as MessageEvent<string>).data) as Turn), over: true }));
  es.onerror = () => {
    if (state.liveStatus === 'ended') return;
    state.liveStatus = 'lost';
    state.changed();
    if (!scenario) renderUi();
  };
}

// Back from an account email link (confirm / sign in): take the session, then say so on the menu.
const sbAtStart = backend();
if (sbAtStart && !scenario)
  void finishEmailLink(sbAtStart).then((msg) => {
    if (!msg || scenario) return;
    accountNotice = msg;
    renderUi();
  });

// Test and debugging hook.
Object.assign(window, { __signalFall: { state, renderer, audio, get input() { return input; } } });
