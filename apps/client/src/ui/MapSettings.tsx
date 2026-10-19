import { useEffect, useMemo, useRef } from 'preact/hooks';
import { HANDMADE_MAPS } from '../game/maps';
import { savedMaps } from '../game/saves';
import { customToGenerated, decodeMap, generateMap, type Biome, type MapSize, type Resources, type TerrainStyle } from '@signal-fall/mapgen';
import { BIOME_COLORS } from '../render/renderer';
import { TEAM_COLORS } from '../game/state';

export interface MapChoice {
  size: MapSize;
  biome: Biome;
  resources: Resources;
  terrain: TerrainStyle;
  seed: number;
  /** Capture points on the map. */
  points?: 'none' | 'some';
  /** Crates drop now and then. */
  crates?: boolean;
  /** King of the hill: hold the center to win. */
  hill?: boolean;
  /** A hand-made map (its share code) instead of a generated one. */
  custom?: string;
}

export const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export const BIOME_NAMES: Record<Biome, string> = { wasteland: 'Wasteland', city: 'Ruined city', crystal: 'Crystal fields' };

export function Choice<T extends string | number>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  testid: string;
  disabled?: boolean;
}) {
  return (
    <div class="choice">
      <span class="label">{props.label}</span>
      <div class="seg" data-testid={props.testid}>
        {props.options.map(([v, text]) => (
          <button
            class={v === props.value ? 'active' : ''}
            disabled={props.disabled && v !== props.value}
            onClick={() => props.onChange(v)}
            data-value={String(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Players a map code is for (0 if it doesn't decode). */
function safePlayers(code: string): number {
  try {
    return decodeMap(code).starts.length;
  } catch {
    return 0;
  }
}

/**
 * Map options and a live preview. Used by the skirmish setup and the
 * multiplayer lobby (where only the host may change them).
 */
export function MapSettings({ value, onChange, players = 2 }: { value: MapChoice; onChange?: (patch: Partial<MapChoice>) => void; players?: number }) {
  const readOnly = !onChange;
  const set = (patch: Partial<MapChoice>) => onChange?.(patch);
  // Hand-made maps that fit this many players: the shipped ones and the player's own.
  const choices = [...HANDMADE_MAPS, ...savedMaps().map((m) => ({ ...m, players: safePlayers(m.code) }))].filter((m) => m.players === players);
  const custom = value.custom && choices.some((m) => m.code === value.custom) ? value.custom : undefined;
  const map = useMemo(
    () =>
      custom
        ? customToGenerated(decodeMap(custom))
        : generateMap({ seed: value.seed, size: value.size, players, biome: value.biome, resources: value.resources, terrain: value.terrain, points: value.points, hill: value.hill }),
    [custom, value.seed, value.size, value.biome, value.resources, value.terrain, value.points, value.hill, players],
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
    for (const p of map.points ?? []) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
    }
    map.starts.forEach((p, k) => {
      ctx.fillStyle = `#${TEAM_COLORS[k]!.toString(16).padStart(6, '0')}`;
      ctx.fillRect(p.x - 3, p.y - 3, 7, 7);
    });
  }, [map]);

  return (
    <div class="map-settings">
      {choices.length > 0 && (
        <label class="choice">
          <span class="label">Map</span>
          <select value={custom ?? ''} data-testid="map-pick" disabled={readOnly} onChange={(e) => set({ custom: (e.currentTarget as HTMLSelectElement).value || undefined })}>
            <option value="">Generated (from the seed)</option>
            {choices.map((m) => (
              <option value={m.code}>{m.name}</option>
            ))}
          </select>
        </label>
      )}
      {!custom && (
        <>
          <Choice label="Map size" value={value.size} options={[['S', 'Small'], ['M', 'Medium'], ['L', 'Large']]} onChange={(v) => set({ size: v })} testid="size" disabled={readOnly} />
          <Choice
            label="Biome"
            value={value.biome}
            options={(Object.keys(BIOME_NAMES) as Biome[]).map((b) => [b, BIOME_NAMES[b]])}
            onChange={(v) => set({ biome: v })}
            testid="biome"
            disabled={readOnly}
          />
          <Choice
            label="Resources"
            value={value.resources}
            options={[['low', 'Low'], ['normal', 'Normal'], ['rich', 'Rich']]}
            onChange={(v) => set({ resources: v })}
            testid="resources"
            disabled={readOnly}
          />
          <Choice
            label="Terrain"
            value={value.terrain}
            options={[
              ['open', 'Open'],
              ['normal', 'Normal'],
              ['choke', 'Chokepoints'],
            ]}
            onChange={(v) => set({ terrain: v })}
            testid="terrain"
            disabled={readOnly}
          />
          <Choice
            label="Capture points"
            value={value.points ?? 'none'}
            options={[
              ['none', 'None'],
              ['some', 'Derricks, towers, depots'],
            ]}
            onChange={(v) => set({ points: v })}
            testid="points"
            disabled={readOnly}
          />
          <Choice
            label="Victory"
            value={value.hill ? 'hill' : 'destroy'}
            options={[
              ['destroy', 'Destroy every enemy building'],
              ['hill', 'King of the hill (or destroy)'],
            ]}
            onChange={(v) => set({ hill: v === 'hill' })}
            testid="victory"
            disabled={readOnly}
          />
        </>
      )}
      <Choice
        label="Crates"
        value={value.crates ? 'on' : 'off'}
        options={[
          ['off', 'Off'],
          ['on', 'Now and then'],
        ]}
        onChange={(v) => set({ crates: v === 'on' })}
        testid="crates"
        disabled={readOnly}
      />
      {!custom && (
        <div class="choice">
          <span class="label">Seed</span>
          <div class="seed">
            <input
              type="number"
              value={value.seed}
              readOnly={readOnly}
              data-testid="seed"
              // Every keystroke counts: a re-render (a lobby update) before the field loses focus would put the old seed back.
              onInput={(e) => set({ seed: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
            />
            {!readOnly && (
              <button onClick={() => set({ seed: randomSeed() })} data-testid="seed-random">
                Random
              </button>
            )}
          </div>
        </div>
      )}
      <div class="setup-map">
        <canvas ref={canvas} width={460} height={460} data-testid="map-preview" />
        <div class="setup-map-info">
          <b>
            {map.width}×{map.height}
          </b>
          <span>{BIOME_NAMES[map.biome]}</span>
          {custom ? (
            <span class="muted">hand-made: {choices.find((m) => m.code === custom)?.name}</span>
          ) : (
            <>
              <span class="muted">{map.symmetry.replace('mirror', 'mirror ').replace('rotate180', 'rotated')} symmetry</span>
              <span class="muted">seed {map.seedUsed}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
