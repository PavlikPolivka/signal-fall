import { render } from 'preact';
import { go, onLeave } from './nav';
import { defaultRules } from '@signal-fall/data';
import { ClientState, seatLabels, saveSettings, setColorblind } from './game/state';
import { Input } from './input/input';
import { FX_EVENT, FX_STRIDE } from '@signal-fall/sim';
import { Snapshot, type FromWorker, type ScenarioSpec, type ToWorker } from './protocol';
import type { ScheduledCommand } from '@signal-fall/sim';
import { Renderer, ultraResolution } from './render/renderer';
import { GameAudio, cameraListener } from './audio/audio';
import { App } from './ui/App';
import { AiChat } from './game/aichat';
import { MenuScreen, Setup, loadSaved, seatSkill, type SeatKey, type SkirmishSettings } from './ui/Setup';
import { Multiplayer } from './ui/Multiplayer';
import { campaignDifficulty } from './ui/Campaign';
import { Cutscene, introToPlay, introUrl, markIntroSeen } from './ui/Video';
import { missionById, type Replay } from './game/scenario';
import { addRecent, clock, saveGame, savedGame } from './game/saves';
import { dailyChallenge } from './game/daily';
import { NetSession, SpectatorFeed, degrade } from './net/session';
import { backend, fileDesyncReport, finishEmailLink, submitDaily } from './net/backend';
import { recordMatch, type NetMatch } from './net/history';
import { reportErrors } from './net/errors';
import { RejoinHost, forgetMatch, matchToRejoin, rejoin, rememberMatch, type CatchupData, type Rejoined } from './net/rejoin';
import { matchChannel } from './net/connect';
import type { LinkLike } from './net/lobby';
import type { Difficulty } from '@signal-fall/ai';
import { decodeMap, sizeClass, type Biome, type MapSize, type Resources, type TerrainStyle } from '@signal-fall/mapgen';
import '@fontsource/saira-stencil-one/latin-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './ui/styles.css';

const params = new URLSearchParams(location.search);
// Any game parameter in the URL skips the setup screen (tests, shared links).
const AUTOSTART_KEYS = ['scenario', 'seed', 'speed', 'size', 'biome', 'ai', 'faction', 'enemy', 'spectate', 'mode', 'mapcode'];
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
    points: (params.get('points') ?? 'none') as 'none' | 'some',
    crates: params.get('crates') === '1',
    hill: params.get('hill') === '1',
    revealed: params.get('revealed') === '1',
  };
  // ?mapcode=SF1...: a hand-made map; one AI per other start, everyone on their own team.
  const code = params.get('mapcode');
  if (code) {
    const custom = decodeMap(code);
    const factions = [Number(params.get('faction') ?? 0), Number(params.get('enemy') ?? 1), 2, 0].slice(0, custom.starts.length);
    const level = spectate ?? (ai === 'none' ? null : (ai as Difficulty));
    return { kind, seed, factions, ai: factions.map((_, k) => (k === 0 ? spectate : level)), map: { ...map, size: sizeClass(custom.size), biome: custom.biome, custom: code } };
  }
  // ?mode=ffa3 / ffa4: everyone for themselves, every slot but ours AI.
  if (params.get('mode') === 'ffa3' || params.get('mode') === 'ffa4') {
    const n = params.get('mode') === 'ffa3' ? 3 : 4;
    const factions = (params.get('factions') ?? '0,1,2,0').split(',').map(Number).slice(0, n);
    const level = spectate ?? (ai as Difficulty);
    return { kind, seed, factions, ai: factions.map((_, k) => (k === 0 ? spectate : level)), map };
  }
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
  const map = { size: s.size, biome: s.biome, resources: s.resources, terrain: s.terrain, points: s.points, crates: s.crates, hill: s.hill, custom: s.custom, credits: s.credits, superweapons: s.superweapons, techLimit: s.techLimit, unitCap: s.unitCap, startArmy: s.startArmy, revealed: s.revealed };
  const style = s.personality && s.personality !== 'random' ? s.personality : null;
  // Handicap per slot, in the slot order of each mode (none unless a seat has one).
  const handicaps = (keys: (SeatKey | 'you' | null)[]) => (keys.some((k) => k && s.handicaps?.[k]) ? keys.map((k) => (k && s.handicaps?.[k]) || 100) : undefined);
  // 2v2: you and your ally hold neighbouring corners (slots 0, 1) against slots 2, 3.
  if (s.mode === '2v2')
    return {
      kind: 'skirmish',
      seed: s.seed,
      factions: [s.faction, s.allyFaction, s.enemyFaction, s.enemy2Faction],
      ai: [null, seatSkill(s, 'ally'), seatSkill(s, 'enemy'), seatSkill(s, 'enemy2')],
      teams: [0, 0, 1, 1],
      handicaps: handicaps(['you', 'ally', 'enemy', 'enemy2']),
      map,
      time: s.time,
      personality: [null, null, style, style],
    };
  // Survival: you (and maybe an AI ally) against the waves, which are the last slot.
  if (s.mode === 'survival') {
    const factions = s.survivalAlly ? [s.faction, s.allyFaction, s.enemyFaction] : [s.faction, s.enemyFaction];
    return {
      kind: 'skirmish',
      seed: s.seed,
      factions,
      ai: s.survivalAlly ? [null, seatSkill(s, 'ally'), null] : [null, null],
      teams: s.survivalAlly ? [0, 0, 1] : [0, 1],
      handicaps: handicaps(s.survivalAlly ? ['you', 'ally', null] : ['you', null]),
      survival: s.survivalLevel ?? 'normal',
      map,
      time: s.time,
    };
  }
  // Free-for-all: everyone on their own team.
  if (s.mode === 'ffa3' || s.mode === 'ffa4') {
    const factions = [s.faction, s.enemyFaction, s.enemy2Faction, s.allyFaction].slice(0, s.mode === 'ffa3' ? 3 : 4);
    const enemies = ['enemy', 'enemy2', 'enemy3'] as const;
    return { kind: 'skirmish', seed: s.seed, factions, ai: factions.map((_, k) => (k === 0 ? null : seatSkill(s, enemies[k - 1]!))), handicaps: handicaps(factions.map((_, k) => (k === 0 ? 'you' : enemies[k - 1]!))), map, time: s.time, personality: factions.map((_, k) => (k === 0 ? null : style)) };
  }
  return { kind: 'skirmish', seed: s.seed, factions: [s.faction, s.enemyFaction], ai: [null, seatSkill(s, 'enemy')], handicaps: handicaps(['you', 'enemy']), map, time: s.time, personality: [null, style] };
}

/** ?rematch: the last skirmish setup again (same map, sides and AI), straight into the match. */
function rematch(): ScenarioSpec | null {
  const saved = loadSaved();
  if (!params.has('rematch') || saved.seed === undefined) return null;
  history.replaceState(null, '', location.pathname);
  return scenarioFromSetup(saved as SkirmishSettings);
}
/** ?tutorial: a small map, Holdout against a Choir base that never builds an army. */
const tutorial: ScenarioSpec | null = params.has('tutorial')
  ? { kind: 'skirmish', seed: 4242, factions: [0, 2], ai: [null, null], map: { size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'open' } }
  : null;
/** ?mission=<id>: a campaign mission. */
const missionParam = params.get('mission');
/** Who speaks a mission line (for captions). */
const SPEAKER_NAME = { holdout: 'Varga', halcyon: 'HALCYON', choir: 'The Cantor', thule: 'Thule', okafor: 'Okafor', mags: 'Mags', brann: 'Brann' } as const;
/** ?daily: today's challenge, the same match for everyone. */
const daily = params.has('daily') ? dailyChallenge() : null;
/** Reloaded during a multiplayer match: get back into it. */
let comeback = !autostart && !new URLSearchParams(location.search).has('continue') ? matchToRejoin() : null;
let rejoined: Rejoined | null = null;
/** Players: answers anyone reconnecting to our match. */
let rejoinHost: RejoinHost | null = null;
const catchupWaiters: ((d: CatchupData) => void)[] = [];
/** Players who reconnected (their first link is dead for good). */
const rejoinedSlots = new Set<number>();
/** Listen for players reconnecting, and remember the match so we can rejoin after a reload ourselves. */
function hostRejoins(code: string, scenario: ScenarioSpec): void {
  if (scenario.kind !== 'skirmish') return;
  const humans = scenario.humans ?? [0, 1];
  rememberMatch({ code, slot: localSlot, scenario, names: state.names, humans });
  void matchChannel(code).then(({ signaling, iceServers }) => {
    rejoinHost = new RejoinHost(
      signaling,
      iceServers,
      localSlot,
      humans,
      () =>
        new Promise<CatchupData>((resolve) => {
          catchupWaiters.push(resolve);
          post({ type: 'catchupRequest' });
        }),
      (slot, link, taken) => {
        rejoinedSlots.add(slot);
        netSession?.replaceLink(slot, link);
        // Turns we sent after the catch-up snapshot went down the dead link: send them again.
        post({ type: 'resendOwn', from: taken + 1 });
        state.peerLost = false;
        state.notice(`${state.names[slot] ?? `Player ${slot + 1}`} is back`);
      },
    );
  });
}
/** ?continue: the saved skirmish, picked up where it was saved. */
const resume = params.has('continue') ? (savedGame()?.replay ?? null) : null;
if (params.has('continue')) history.replaceState(null, '', location.pathname);
let scenario: ScenarioSpec | null = (missionParam ? ({ kind: 'mission', id: missionParam, seed: 0, difficulty: campaignDifficulty() } as ScenarioSpec) : null) ?? tutorial ?? (daily ? daily.scenario : null) ?? (autostart ? scenarioFromUrl() : resume ? resume.scenario : rematch());
/** Our player slot (0 unless we joined someone's multiplayer room). */
let localSlot = 0;
/** Multiplayer: connections to the other people by slot, until the worker is running. */
let peerLinks: Map<number, LinkLike> | null = null;
/** Multiplayer: links to the people watching our match (they get every turn). */
let watcherLinks: LinkLike[] = [];
/** Watching someone else's multiplayer match: links to its players. */
let spectateLinks: Map<number, LinkLike> | null = null;
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
/** The room the multiplayer match came from (for a rematch). */
let lastRoom: import('./net/lobby').LobbyState | null = null;
/** Multiplayer: room code and account ids per slot, for the match record. */
let netMatch: NetMatch | null = null;
/** Lobby screen showing instead of the skirmish setup. */
/** Rematch after a multiplayer match: back to the same room (kept for this tab only). */
const REMATCH_KEY = 'signalfall.rematch';
const rematchRoom = (() => {
  try {
    const r = sessionStorage.getItem(REMATCH_KEY);
    sessionStorage.removeItem(REMATCH_KEY);
    return r ? (JSON.parse(r) as { host: boolean; room: import('./net/lobby').LobbyState }) : undefined;
  } catch {
    return undefined;
  }
})();
let multiplayerScreen = new URLSearchParams(location.search).has('room') || !!rematchRoom;
/** A room set up on the Play screen (seats left for people). */
let roomPreset: import('./ui/Setup').RoomPreset | undefined;

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);
reportErrors(() => (!scenario ? 'menu' : replay ? 'replay' : peerLinks ? 'multiplayer' : `${scenario.kind} @${state.cur?.tick ?? 0}`), worker);
const state = new ClientState(defaultRules(), post);
state.spectator = spectate !== null;
state.daily = daily ? daily.label : null;
state.tutorial = !!tutorial;
state.mission = scenario?.kind === 'mission' ? missionById(scenario.id) : null;
state.campaignDifficulty = scenario?.kind === 'mission' ? (scenario.difficulty ?? 'normal') : 'normal';
state.noSuperweapons = scenario?.kind === 'skirmish' && scenario.map.superweapons === false;
state.techLimit = scenario?.kind === 'skirmish' && !!scenario.map.techLimit;
if (scenario?.kind === 'skirmish' && scenario.map.unitCap) state.unitCap = scenario.map.unitCap;
function aiSeats(s: Extract<ScenarioSpec, { kind: 'skirmish' }>): number[] {
  return s.ai.flatMap((d, k) => (d && !s.humans?.includes(k) ? [k] : []));
}
/** Optional AI chatter in a skirmish against the AI (not online, not replays). */
const aiChat = scenario?.kind === 'skirmish' && !peerLinks && !replay ? new AiChat(state, aiSeats(scenario)) : null;
state.rematch = () => {
  if (!lastRoom) return;
  const me = lastRoom.slots[localSlot]?.player?.id;
  try {
    sessionStorage.setItem(REMATCH_KEY, JSON.stringify({ host: me === lastRoom.host, room: lastRoom }));
  } catch {
    return;
  }
  go(location.pathname);
};
state.applySettings = () => {
  saveSettings(state.settings);
  renderer.effects.reduced = state.settings.effects === 'reduced';
  renderer.effects.calm = state.settings.calmFlashes;
  renderer.weather.enabled = state.settings.effects !== 'reduced';
  renderer.setGraphics(state.settings.graphics);
  setColorblind(state.settings.colorblind);
  document.documentElement.toggleAttribute('data-calm', state.settings.calmFlashes);
  document.documentElement.toggleAttribute('data-large-cursor', state.settings.largeCursor);
  input?.useFactionCursors();
  input?.setMode(state.mode);
  if (mounted) renderer.app.ticker.maxFPS = state.settings.batterySaver ? 30 : 0;
  input?.reloadBindings();
  document.documentElement.style.setProperty('--ui-scale', String(state.settings.uiScale / 100));
  state.changed();
};
state.saveReplay = () => post({ type: 'saveReplay' });
state.saveGame = () => post({ type: 'saveReplay', purpose: 'save' });
state.dropPeers = () => {
  for (const p of state.net?.waitingOn ?? []) post({ type: 'dropPeer', player: p });
};
state.requestStats = () => post({ type: 'requestStats' });
state.replaySpeed = (speed) => {
  if (!state.replay) return;
  state.replay.speed = speed;
  post({ type: 'speed', speed });
  state.changed();
};
const renderer = new Renderer(state);
renderer.effects.reduced = state.settings.effects === 'reduced';
renderer.effects.calm = state.settings.calmFlashes;
document.documentElement.toggleAttribute('data-calm', state.settings.calmFlashes);
document.documentElement.toggleAttribute('data-large-cursor', state.settings.largeCursor);
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
/** Autosave cadence (5 minutes of game time) and the next tick due. */
const AUTOSAVE_TICKS = 5 * 60 * 20;
let nextAutosave = 0;
// In fullscreen the next screen loads in a frame over this page: stop everything here first.
onLeave(() => {
  worker.terminate();
  audio.close();
  netSession?.close();
  rejoinHost?.close();
  render(null, root);
  if (mounted) renderer.app.destroy(true);
});

async function mountGame(host: HTMLDivElement): Promise<void> {
  // Ultra on a high-DPI screen: 2x sprites (chosen before the first sheet loads; a change applies next match).
  renderer.lib.hiDpi = state.settings.graphics === 'ultra' && ultraResolution() >= 1.5;
  await renderer.init(host);
  renderer.setGraphics(state.settings.graphics);
  renderer.app.ticker.maxFPS = state.settings.batterySaver ? 30 : 0;
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
      if (msg.purpose === 'autosave') {
        // Quietly, into the same slot Continue picks up (a full or blocked storage just skips it).
        saveGame(msg.json, meta);
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
    if (msg.type === 'final' && daily && msg.winnerTeam === state.players[0]?.team) {
      // A daily challenge win: on the board (fastest counts).
      const sb = backend();
      state.dailyResult = { ticks: msg.tick, best: null };
      if (sb) void submitDaily(sb, msg.tick, msg.hash).then((best) => {
        state.dailyResult = { ticks: msg.tick, best };
        state.changed();
      });
    }
    if (msg.type === 'final') {
      // Over: nothing to rejoin after a reload.
      forgetMatch();
      rejoinHost?.close();
      rejoinHost = null;
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
    if (msg.type === 'catchup') {
      for (const w of catchupWaiters.splice(0)) w({ log: msg.log, taken: msg.taken, inputs: msg.inputs });
      return;
    }
    if (msg.type === 'dropped') {
      state.peerLost = false;
      state.names[msg.player] = `${state.names[msg.player] ?? `Player ${msg.player + 1}`} (AI)`;
      state.seats[msg.player] = { kind: 'ai', label: 'AI (Normal), took over' };
      state.notice(`${state.names[msg.player]} took over the seat`);
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
      renderer.night.setTime((params.get('time') as 'day' | 'dusk' | 'night' | null) ?? time ?? state.mission?.time ?? 'day');
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
      // Skirmish against the AI: saved every 5 minutes, so a closed tab can be continued.
      const tick = state.cur?.tick ?? 0;
      if (scenario?.kind === 'skirmish' && !state.multiplayer && !replay && !state.spectator && tick >= nextAutosave) {
        if (nextAutosave > 0) post({ type: 'saveReplay', purpose: 'autosave' });
        nextAutosave = tick - (tick % AUTOSAVE_TICKS) + AUTOSAVE_TICKS;
      }
      state.onSnapshot(new Snapshot(msg.buf), msg.fog, msg.echo);
      aiChat?.update();
      if (msg.fx) {
        renderer.effects.ingest(msg.fx);
        audio.ingest(msg.fx);
        // Mission lines: spoken, and shown as a caption.
        if (state.mission)
          for (let i = 0; i + FX_STRIDE <= msg.fx.length; i += FX_STRIDE)
            if (msg.fx[i] === FX_EVENT.mission) {
              const n = msg.fx[i + 1]!;
              const line = state.mission.lines[n];
              if (!line) continue;
              state.caption = { text: `${SPEAKER_NAME[line[0]]}: ${line[1]}`, time: performance.now() + 2500 };
              audio.playLine(`campaign/${state.mission.id}/line_${n}.mp3`);
              state.changed();
            }
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
    // A link that dies after its player came back (reload) no longer matters.
    for (const [slot, l] of peerLinks) l.onFailed = () => !rejoinedSlots.has(slot) && lost();
    void Promise.all([Promise.all(links.map((l) => l.ready)), Promise.all(watcherLinks.map((l) => l.ready))]).then(([dgrams, watchers]) => {
      const netsim = params.get('netsim');
      netSession = new NetSession(
        dgrams.map((d) => (netsim ? degrade(d, netsim) : d)),
        (m) => post({ type: 'net', msg: m }),
        watchers,
        [...peerLinks!.keys()],
      );
      if (lastRoom && scenario) hostRejoins(lastRoom.code, scenario);
      netSession.onPeerLost = lost;
      netSession.onPeerBack = () => {
        state.peerLost = false;
        state.changed();
      };
      netSession.onChat = (m) => {
        // Team messages only count from teammates.
        if (m.team && state.players[m.player]?.team !== state.players[localSlot]?.team) return;
        state.addChat(m.player, m.text.slice(0, 200), m.team, m.at);
      };
      state.sendChat = (text, team, at) => {
        netSession?.send({ kind: 'chat', player: localSlot, team, text: text.slice(0, 200), at });
        state.addChat(localSlot, text.slice(0, 200), team, at);
      };
    });
  } else if (rejoined && comeback && scenario?.kind === 'skirmish') {
    // Back in after a reload: new links to everyone, then play on from where they are.
    const back = rejoined;
    state.multiplayer = true;
    netSession = new NetSession([...back.links.values()], (m) => post({ type: 'net', msg: m }), [], [...back.links.keys()]);
    netSession.onPeerLost = () => {
      state.peerLost = true;
      state.changed();
    };
    netSession.onPeerBack = () => {
      state.peerLost = false;
      state.changed();
    };
    netSession.onChat = (m) => {
      if (m.team && state.players[m.player]?.team !== state.players[localSlot]?.team) return;
      state.addChat(m.player, m.text.slice(0, 200), m.team, m.at);
    };
    state.sendChat = (text, team, at) => {
      netSession?.send({ kind: 'chat', player: localSlot, team, text: text.slice(0, 200), at });
      state.addChat(localSlot, text.slice(0, 200), team, at);
    };
    post({
      type: 'start',
      scenario,
      localPlayer: localSlot,
      net: { peers: scenario.humans ?? [0, 1] },
      rejoin: { log: back.log, taken: back.taken, inputs: back.inputs, ownNext: back.ownNext },
    });
    // Turns that came in while we were catching up go to the worker now, after its start.
    back.release((m) => netSession?.deliver(m));
    hostRejoins(comeback.code, scenario);
  } else if (spectateLinks && scenario?.kind === 'skirmish') {
    // Watching a multiplayer match: the players' turns arrive over the links and play as a live replay.
    state.spectator = true;
    state.replay = { endTick: 0, verified: null, speed: 1, paused: false, live: true };
    const live: Replay = { format: 'signal-fall-replay', version: 1, scenario, localPlayer: 0, commands: [], endTick: 0, hash: 0 };
    post({ type: 'start', scenario, localPlayer: 0, replay: live, live: true });
    const players = [...(scenario.humans ?? [])].sort((a, b) => a - b);
    void Promise.all([...spectateLinks.values()].map((l) => l.ready)).then((dgrams) => {
      const feed = new SpectatorFeed(dgrams, players);
      feed.onTurns = (commands, until) => post({ type: 'live', commands, until });
      feed.start();
      state.liveStatus = 'live';
    });
  } else if (replay) {
    state.spectator = true;
    const rs = replay.scenario;
    if (rs.kind === 'skirmish' && rs.factions.length === 2 && !rs.survival) {
      const m = rs.map;
      const q = new URLSearchParams({ seed: String(rs.seed), size: m.size, biome: m.biome, resources: m.resources, terrain: m.terrain, faction: String(rs.factions[replay.localPlayer === 1 ? 1 : 0]), enemy: String(rs.factions[replay.localPlayer === 1 ? 0 : 1]), ai: 'normal' });
      if (m.custom) q.set('mapcode', m.custom);
      state.playThisMap = () => go(`${location.pathname}?${q.toString()}`);
    }
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
let rejoining = false;
function renderUi(): void {
  if (!scenario && comeback) {
    const m = comeback;
    render(
      <MenuScreen testid="rejoining">
        <div class="setup-panel">
          <h1>Rejoining your match…</h1>
          <p class="muted">Connecting to the other players and catching up.</p>
          <button
            class="codex-btn"
            onClick={() => {
              forgetMatch();
              go(location.pathname);
            }}
          >
            Leave the match
          </button>
        </div>
      </MenuScreen>,
      root,
    );
    if (rejoining) return;
    rejoining = true;
    void matchChannel(m.code)
      .then(({ signaling, iceServers }) => rejoin(signaling, iceServers, m).finally(() => signaling.close()))
      .then(
        (r) => {
          rejoined = r;
          scenario = m.scenario;
          localSlot = m.slot;
          state.names = m.names;
          renderUi();
        },
        () => {
          forgetMatch();
          comeback = null;
          accountNotice = 'Could not rejoin the match: it may have ended.';
          renderUi();
        },
      );
    return;
  }
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
        rematch={rematchRoom}
        preset={roomPreset}
        rules={state.rules}
        onBack={() => {
          multiplayerScreen = false;
          roomPreset = undefined;
          renderUi();
        }}
        onStart={(sc, slot, links, room, watchers) => {
          scenario = sc;
          state.names = room.slots.map((x) => x.player?.name ?? null);
          if (slot < 0) {
            spectateLinks = links;
            renderUi();
            return;
          }
          localSlot = slot;
          peerLinks = links;
          watcherLinks = watchers;
          netMatch = { room: room.code, uids: room.slots.map((x) => x.player?.uid ?? null) };
          state.names = room.slots.map((x) => x.player?.name ?? null);
          lastRoom = room;
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
        onMultiplayer={(preset) => {
          roomPreset = preset;
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
