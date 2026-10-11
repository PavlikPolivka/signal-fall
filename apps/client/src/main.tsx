import { render } from 'preact';
import { defaultRules } from '@signal-fall/data';
import { ClientState } from './game/state';
import { Input } from './input/input';
import { Snapshot, type FromWorker, type ScenarioSpec, type ToWorker } from './protocol';
import { Renderer } from './render/renderer';
import { App } from './ui/App';
import { Setup, type SkirmishSettings } from './ui/Setup';
import type { Difficulty } from '@signal-fall/ai';
import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';
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

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);
const state = new ClientState(defaultRules(), post);
state.spectator = spectate !== null;
const renderer = new Renderer(state);
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
    if (msg.type === 'ready') {
      state.width = msg.width;
      state.height = msg.height;
      state.terrain = msg.terrain;
      state.decoration = msg.decoration;
      state.biome = msg.biome;
      state.mapSeed = msg.mapSeed;
      state.players = msg.players;
      state.localPlayer = msg.localPlayer;
      renderer.buildMap();
      // Load rendered art for the factions in this match (placeholders draw until it arrives).
      for (const p of msg.players) void renderer.lib.loadFaction(state.rules.factions[p.faction]!.id);
      state.ready = true;
    } else {
      const first = state.cur === null;
      state.onSnapshot(new Snapshot(msg.buf), msg.fog, msg.echo);
      if (first) input?.run('jumpToBase');
    }
  };
  post({ type: 'start', scenario: scenario!, localPlayer: 0, speed: Number(params.get('speed') ?? 1) });
}

const root = document.getElementById('app')!;
let mounted = false;
function renderUi(): void {
  if (!scenario) {
    render(
      <Setup
        rules={state.rules}
        onStart={(settings) => {
          scenario = scenarioFromSetup(settings);
          renderUi();
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

// Test and debugging hook.
Object.assign(window, { __signalFall: { state, renderer, get input() { return input; } } });
