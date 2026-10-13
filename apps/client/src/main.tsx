import { render } from 'preact';
import { defaultRules } from '@signal-fall/data';
import { ClientState, saveSettings } from './game/state';
import { Input } from './input/input';
import { Snapshot, type FromWorker, type ScenarioSpec, type ToWorker } from './protocol';
import { Renderer } from './render/renderer';
import { GameAudio, cameraListener } from './audio/audio';
import { App } from './ui/App';
import { Setup, type SkirmishSettings } from './ui/Setup';
import { Multiplayer } from './ui/Multiplayer';
import { Cutscene, introToPlay, introUrl, markIntroSeen } from './ui/Video';
import type { Replay } from './game/scenario';
import { NetSession, degrade } from './net/session';
import { backend, fileDesyncReport, finishEmailLink } from './net/backend';
import { recordMatch, type NetMatch } from './net/history';
import type { PeerLink } from './net/webrtc';
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
const AUTOSTART_KEYS = ['scenario', 'seed', 'speed', 'size', 'biome', 'ai', 'faction', 'enemy', 'spectate'];
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
  return {
    kind,
    seed,
    factions: [Number(params.get('faction') ?? 0), Number(params.get('enemy') ?? 1)],
    ai: [spectate, spectate ?? (ai === 'none' ? null : (ai as Difficulty))],
    map: {
      size: (params.get('size') ?? 'M') as MapSize,
      biome: (params.get('biome') ?? 'wasteland') as Biome,
      resources: (params.get('resources') ?? 'normal') as Resources,
      terrain: (params.get('terrain') ?? 'normal') as TerrainStyle,
    },
  };
}

function scenarioFromSetup(s: SkirmishSettings): ScenarioSpec {
  return {
    kind: 'skirmish',
    seed: s.seed,
    factions: [s.faction, s.enemyFaction],
    ai: [null, s.difficulty],
    map: { size: s.size, biome: s.biome, resources: s.resources, terrain: s.terrain },
  };
}

let scenario: ScenarioSpec | null = autostart ? scenarioFromUrl() : null;
/** Our player slot (0 unless we joined someone's multiplayer room). */
let localSlot = 0;
/** Multiplayer: the connection to the opponent, until the worker is running. */
let peerLink: PeerLink | null = null;
/** Watching a recorded match. */
let replay: Replay | null = null;
let netSession: NetSession | null = null;
/** Multiplayer: room code and account ids per slot, for the match record. */
let netMatch: NetMatch | null = null;
/** Lobby screen showing instead of the skirmish setup. */
let multiplayerScreen = new URLSearchParams(location.search).has('room');

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);
const state = new ClientState(defaultRules(), post);
state.spectator = spectate !== null;
state.applySettings = () => {
  saveSettings(state.settings);
  renderer.effects.reduced = state.settings.effects === 'reduced';
  state.changed();
};
state.saveReplay = () => post({ type: 'saveReplay' });
state.requestStats = () => post({ type: 'requestStats' });
state.replaySpeed = (speed) => {
  if (!state.replay) return;
  state.replay.speed = speed;
  post({ type: 'speed', speed });
  state.changed();
};
const renderer = new Renderer(state);
renderer.effects.reduced = state.settings.effects === 'reduced';
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
  input = new Input(state, renderer, renderer.app.canvas);
  renderer.placementGhost = () => {
    const c = input?.cursor();
    return c && input ? input.placementAt(c.x, c.y) : null;
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
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([msg.json], { type: 'application/json' }));
      a.download = `signal-fall-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.sfreplay.json`;
      a.click();
      return;
    }
    if (msg.type === 'final') {
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
      if (first) input?.run('jumpToBase');
    }
  };
  if (peerLink) {
    const link = peerLink;
    state.multiplayer = true;
    post({ type: 'start', scenario: scenario!, localPlayer: localSlot, net: { peers: [0, 1] } });
    void link.ready.then((d) => {
      const netsim = params.get('netsim');
      netSession = new NetSession(netsim ? degrade(d, netsim) : d, (m) => post({ type: 'net', msg: m }));
      netSession.onPeerLost = () => {
        state.peerLost = true;
        state.changed();
      };
      link.onFailed = () => {
        state.peerLost = true;
        state.changed();
      };
    });
  } else if (replay) {
    state.spectator = true;
    state.replay = { endTick: replay.endTick, verified: null, speed: 1, paused: false };
    post({ type: 'start', scenario: replay.scenario, localPlayer: replay.localPlayer, replay });
  } else post({ type: 'start', scenario: scenario!, localPlayer: 0, speed: Number(params.get('speed') ?? 1) });
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
  if (!scenario && multiplayerScreen) {
    render(
      <Multiplayer
        rules={state.rules}
        onBack={() => {
          multiplayerScreen = false;
          renderUi();
        }}
        onStart={(sc, slot, link, room) => {
          scenario = sc;
          localSlot = slot;
          peerLink = link;
          netMatch = { room: room.code, uids: [...room.players].sort((a, b) => a.slot - b.slot).map((p) => p.uid ?? null) };
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
