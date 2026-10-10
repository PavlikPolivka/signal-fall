import { render } from 'preact';
import { defaultRules } from '@signal-fall/data';
import { ClientState } from './game/state';
import { Input } from './input/input';
import { Snapshot, type FromWorker, type ScenarioSpec, type ToWorker } from './protocol';
import { Renderer } from './render/renderer';
import { App } from './ui/App';
import './ui/styles.css';

const params = new URLSearchParams(location.search);
const kind = params.get('scenario') ?? 'skirmish';
const seed = Number(params.get('seed') ?? 7);
const scenario: ScenarioSpec =
  kind === 'skirmish'
    ? { kind, seed, factions: [Number(params.get('faction') ?? 0), Number(params.get('enemy') ?? 1)] }
    : { kind: kind === 'stress' ? 'stress' : 'sandbox', seed, unitsPerSide: Number(params.get('units') ?? (kind === 'stress' ? 200 : 24)) };

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);
const state = new ClientState(defaultRules(), post);
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
    input?.update(t.deltaMS / 1000);
    renderer.frame();
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
      state.players = msg.players;
      state.localPlayer = msg.localPlayer;
      renderer.buildMap();
      state.ready = true;
    } else {
      const first = state.cur === null;
      state.onSnapshot(new Snapshot(msg.buf), msg.fog, msg.echo);
      if (first) input?.run('jumpToBase');
    }
  };
  post({ type: 'start', scenario, localPlayer: 0, speed: Number(params.get('speed') ?? 1) });
}

const root = document.getElementById('app')!;
let mounted = false;
function renderUi(): void {
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
