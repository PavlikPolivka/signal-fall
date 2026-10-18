import { useRef } from 'preact/hooks';
import type { ClientState } from '../game/state';
import type { Renderer } from '../render/renderer';

interface Step {
  title: string;
  text: string;
  done: (s: ClientState, r: Renderer, start: { x: number; y: number }) => boolean;
}

const roles = (s: ClientState, role: string) => s.roles().get(role as never) ?? 0;

function ownCount(s: ClientState, pred: (h: number) => boolean): number {
  const cur = s.cur;
  if (!cur) return 0;
  let n = 0;
  for (let i = 0; i < cur.entityCount; i++) {
    const h = cur.get(cur.ent(i), 0);
    if (s.isOwn(h) && pred(h)) n++;
  }
  return n;
}

/** The tutorial, step by step; each step ticks off when you have done it. */
const STEPS: Step[] = [
  {
    title: 'Look around',
    text: 'Move the camera: arrow keys, the mouse at the screen edge, or drag on the minimap (top right).',
    done: (_s, r, start) => Math.abs(r.camera.x - start.x) + Math.abs(r.camera.y - start.y) > 300,
  },
  {
    title: 'Set up your base',
    text: 'Click your construction vehicle to select it, then press D (Deploy). It unfolds into your construction yard.',
    done: (s) => roles(s, 'conyard') > 0,
  },
  {
    title: 'Power',
    text: 'Press B (Build), then P for a power plant, and click a spot next to your yard. It builds itself there.',
    done: (s) => roles(s, 'power') > 0,
  },
  {
    title: 'Money',
    text: 'Press B, then R for a refinery, placed near the blue Echo crystals. Its harvester gathers Echo into credits.',
    done: (s) => roles(s, 'refinery') > 0,
  },
  {
    title: 'An army',
    text: 'Build a barracks (B, then B). Then press I (Infantry) and G four times: four Grunts.',
    done: (s) => ownCount(s, (h) => s.isUnit(h) && s.ruleOf(h).id === 'grunt') >= 4,
  },
  {
    title: 'Group them',
    text: 'Drag a box around your Grunts to select them, then press Ctrl+1. Now 1 selects them again any time.',
    done: (s) => s.controlGroups[1]!.length >= 3,
  },
  {
    title: 'Attack',
    text: 'The enemy base is at the far side of the map. Select your army and click the ground near it: they attack-move there, fighting what they meet.',
    done: (s) => s.sent.some((c) => c.type === 'attackMove' || c.type === 'attack'),
  },
  {
    title: 'Win',
    text: 'Destroy every enemy building to win. Their guns hit infantry hard: build a factory (B, F) and tanks (V, then a letter) to break through.',
    done: (s) => s.cur?.a[1] === 1,
  },
];

export function Tutorial({ state, renderer }: { state: ClientState; renderer: Renderer }) {
  // Steps stay done once done; the camera start is where the match began.
  const done = useRef(new Set<number>());
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!state.cur) return null;
  start.current ??= { x: renderer.camera.x, y: renderer.camera.y };
  STEPS.forEach((st, i) => {
    if (!done.current.has(i) && st.done(state, renderer, start.current!)) done.current.add(i);
  });
  const next = STEPS.findIndex((_, i) => !done.current.has(i));
  if (next < 0) return null;
  const step = STEPS[next]!;
  return (
    <div class="tutorial" data-testid="tutorial" data-step={next}>
      <div class="tutorial-progress">
        {STEPS.map((_, i) => (
          <i class={done.current.has(i) ? 'done' : i === next ? 'now' : ''} />
        ))}
      </div>
      <b>
        {next + 1}. {step.title}
      </b>
      <p>{step.text}</p>
    </div>
  );
}
