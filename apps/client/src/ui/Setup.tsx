import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import type { Difficulty } from '@signal-fall/ai';
import { generateMap, type Biome, type MapSize, type Resources, type TerrainStyle } from '@signal-fall/mapgen';
import { BIOME_COLORS } from '../render/renderer';
import { TEAM_COLORS } from '../game/state';
import { Codex } from './Codex';
import { Logo } from './Logo';
import { MenuVideo } from './Video';
import { parseReplay, type Replay } from '../game/scenario';
import { Credits } from './Credits';

export interface SkirmishSettings {
  faction: number;
  enemyFaction: number;
  difficulty: Difficulty;
  seed: number;
  size: MapSize;
  biome: Biome;
  resources: Resources;
  terrain: TerrainStyle;
}

const STORAGE_KEY = 'signal-fall.setup';

function loadSaved(): Partial<SkirmishSettings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SkirmishSettings>;
  } catch {
    return {};
  }
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

function Choice<T extends string | number>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; testid: string }) {
  return (
    <div class="choice">
      <span class="label">{props.label}</span>
      <div class="seg" data-testid={props.testid}>
        {props.options.map(([v, text]) => (
          <button class={v === props.value ? 'active' : ''} onClick={() => props.onChange(v)} data-value={String(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Setup({
  rules,
  onStart,
  onMultiplayer,
  onIntro,
  onReplay,
}: {
  rules: Rules;
  onStart: (s: SkirmishSettings) => void;
  onMultiplayer: () => void;
  /** Play the intro cutscene (absent when there is no intro video). */
  onIntro?: () => void;
  /** Watch a replay file. */
  onReplay: (r: Replay) => void;
}) {
  const [replayError, setReplayError] = useState<string | null>(null);
  const openReplay = async (file: File | undefined) => {
    if (!file) return;
    try {
      onReplay(parseReplay(await file.text()));
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : String(e));
    }
  };
  const [s, setS] = useState<SkirmishSettings>(() => ({
    faction: 0,
    enemyFaction: 1,
    difficulty: 'normal',
    seed: randomSeed(),
    size: 'M',
    biome: 'wasteland',
    resources: 'normal',
    terrain: 'normal',
    ...loadSaved(),
  }));
  const set = (patch: Partial<SkirmishSettings>) => setS((prev) => ({ ...prev, ...patch }));
  const [codex, setCodex] = useState(false);
  const [credits, setCredits] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCodex(false);
      setCredits(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const factions: [number, string][] = rules.factions.map((f) => [f.index, f.name]);

  const map = useMemo(
    () => generateMap({ seed: s.seed, size: s.size, players: 2, biome: s.biome, resources: s.resources, terrain: s.terrain }),
    [s.seed, s.size, s.biome, s.resources, s.terrain],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const n = map.width;
    const tile = document.createElement('canvas');
    tile.width = n;
    tile.height = n;
    const tctx = tile.getContext('2d')!;
    const img = tctx.createImageData(n, n);
    const palette = BIOME_COLORS[map.biome]!;
    for (let i = 0; i < n * n; i++) {
      const color = map.echo[i] ? 0x3ee6ff : palette[map.terrain[i]!]!;
      img.data.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255], i * 4);
    }
    tctx.putImageData(img, 0, 0);
    const size = c.width;
    const scale = size / (2 * n);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    // Isometric diamond, like the game view.
    ctx.setTransform(scale, scale * 0.5, -scale, scale * 0.5, size / 2, size / 4);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, 0, 0);
    map.starts.forEach((p, k) => {
      ctx.fillStyle = `#${TEAM_COLORS[k]!.toString(16).padStart(6, '0')}`;
      ctx.fillRect(p.x - 3, p.y - 3, 7, 7);
    });
  }, [map]);

  const start = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // Private mode etc.: settings just aren't remembered.
    }
    onStart({ ...s, seed: map.seedUsed });
  };

  return (
    <div class="setup" data-testid="setup">
      <MenuVideo />
      <div class="setup-panel">
        <Logo />
        <p class="muted">Skirmish vs AI</p>
        <Choice label="You play" value={s.faction} options={factions} onChange={(v) => set({ faction: v })} testid="faction" />
        <Choice label="Opponent" value={s.enemyFaction} options={factions} onChange={(v) => set({ enemyFaction: v })} testid="enemy" />
        <Choice
          label="Difficulty"
          value={s.difficulty}
          options={[
            ['easy', 'Easy'],
            ['normal', 'Normal'],
            ['hard', 'Hard'],
            ['brutal', 'Brutal'],
          ]}
          onChange={(v) => set({ difficulty: v })}
          testid="difficulty"
        />
        <Choice label="Map size" value={s.size} options={[['S', 'Small'], ['M', 'Medium'], ['L', 'Large']]} onChange={(v) => set({ size: v })} testid="size" />
        <Choice
          label="Biome"
          value={s.biome}
          options={[
            ['wasteland', 'Wasteland'],
            ['city', 'Ruined city'],
            ['crystal', 'Crystal fields'],
          ]}
          onChange={(v) => set({ biome: v })}
          testid="biome"
        />
        <Choice label="Resources" value={s.resources} options={[['low', 'Low'], ['normal', 'Normal'], ['rich', 'Rich']]} onChange={(v) => set({ resources: v })} testid="resources" />
        <Choice
          label="Terrain"
          value={s.terrain}
          options={[
            ['open', 'Open'],
            ['normal', 'Normal'],
            ['choke', 'Chokepoints'],
          ]}
          onChange={(v) => set({ terrain: v })}
          testid="terrain"
        />
        <div class="choice">
          <span class="label">Seed</span>
          <div class="seed">
            <input
              type="number"
              value={s.seed}
              data-testid="seed"
              onChange={(e) => set({ seed: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
            />
            <button onClick={() => set({ seed: randomSeed() })}>Random</button>
          </div>
        </div>
        <div class="setup-map">
          <canvas ref={canvas} width={460} height={460} data-testid="map-preview" />
          <div class="setup-map-info">
            <b>
              {map.width}×{map.height}
            </b>
            <span>{s.biome === 'city' ? 'Ruined city' : s.biome === 'crystal' ? 'Crystal fields' : 'Wasteland'}</span>
            <span class="muted">{map.symmetry.replace('mirror', 'mirror ').replace('rotate180', 'rotated')} symmetry</span>
            <span class="muted">seed {map.seedUsed}</span>
          </div>
        </div>
        <div class="setup-actions">
          <button class="start" onClick={start} data-testid="start">
            Play vs AI
          </button>
          <button class="mp-btn" onClick={onMultiplayer} data-testid="open-multiplayer">
            Multiplayer
          </button>
        </div>
        <nav class="setup-links">
          <button onClick={() => setCodex(true)} data-testid="open-codex">
            Codex
          </button>
          <label class="file-btn" data-testid="watch-replay">
            Watch a replay
            <input type="file" accept=".json,application/json" onChange={(e) => void openReplay((e.currentTarget as HTMLInputElement).files?.[0])} />
          </label>
          {onIntro && (
            <button onClick={onIntro} data-testid="watch-intro">
              Intro
            </button>
          )}
          <button onClick={() => setCredits(true)} data-testid="open-credits">
            Credits
          </button>
        </nav>
        {replayError && <p class="mp-status">{replayError}</p>}
      </div>
      {codex && <Codex rules={rules} onClose={() => setCodex(false)} />}
      {credits && <Credits onClose={() => setCredits(false)} />}
    </div>
  );
}
