import { useEffect, useRef, useState } from 'preact/hooks';
import { go } from '../nav';
import { TERRAIN } from '@signal-fall/sim';
import { BUILD_AREA, customToGenerated, decodeMap, encodeMap, generateMap, validateMap, type Biome, type CustomMap } from '@signal-fall/mapgen';
import { BIOME_COLORS } from '../render/renderer';
import { TEAM_COLORS } from '../game/state';
import { MenuScreen } from './Setup';
import { Choice } from './MapSettings';
import { savedMaps, storeMaps } from '../game/saves';

type Tool = 'ground' | 'rough' | 'rock' | 'water' | 'cliff' | 'ruins' | 'echo' | 'noecho' | 'start';
type Mirror = 'none' | 'h' | 'v' | 'rot' | 'quad';

const TOOLS: [Tool, string][] = [
  ['ground', 'Ground'],
  ['rough', 'Rough'],
  ['rock', 'Rock'],
  ['cliff', 'Cliff'],
  ['water', 'Water'],
  ['ruins', 'Ruins'],
  ['echo', 'Echo'],
  ['noecho', 'Remove Echo'],
  ['start', 'Start'],
];
const TERRAIN_OF: Partial<Record<Tool, number>> = { ground: TERRAIN.ground, rough: TERRAIN.rough, rock: TERRAIN.rock, water: TERRAIN.water, cliff: TERRAIN.cliff, ruins: TERRAIN.ruins };

function blank(size: number, players: number, biome: Biome): CustomMap {
  const m = size - 1;
  const corners = [
    { x: 16, y: 16 },
    { x: m - 16, y: m - 16 },
    { x: m - 16, y: 16 },
    { x: 16, y: m - 16 },
  ];
  return { name: 'My map', size, biome, terrain: new Uint8Array(size * size), echo: new Uint8Array(size * size), starts: corners.slice(0, players) };
}

/** Every tile the symmetry makes equal to (x, y), including itself. */
function images(x: number, y: number, n: number, mirror: Mirror): [number, number][] {
  const m = n - 1;
  const all: [number, number][] =
    mirror === 'h' ? [[x, y], [m - x, y]] : mirror === 'v' ? [[x, y], [x, m - y]] : mirror === 'rot' ? [[x, y], [m - x, m - y]] : mirror === 'quad' ? [[x, y], [m - y, x], [m - x, m - y], [y, m - x]] : [[x, y]];
  return all.filter(([a, b], i) => all.findIndex(([c, d]) => c === a && d === b) === i);
}

/**
 * The map editor: paint terrain and Echo, place starts, mirror as you paint, check it, play it, and
 * share it as a code.
 */
export function Editor({ onBack }: { onBack: () => void }) {
  const [map, setMap] = useState<CustomMap>(() => blank(128, 2, 'wasteland'));
  const [tool, setTool] = useState<Tool>('rock');
  const [brush, setBrush] = useState(3);
  const [mirror, setMirror] = useState<Mirror>('rot');
  const [startIdx, setStartIdx] = useState(0);
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(savedMaps);
  const canvas = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const SIZE = 640;

  // Draw the map, top-down.
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const n = map.size;
    const img = ctx.createImageData(n, n);
    const palette = BIOME_COLORS[map.biome]!;
    for (let i = 0; i < n * n; i++) {
      let col = palette[map.terrain[i]!]!;
      if (map.echo[i]! > 0) col = 0x1aa0b8 + Math.min(15, map.echo[i]!) * 0x000300;
      img.data.set([(col >> 16) & 255, (col >> 8) & 255, col & 255, 255], i * 4);
    }
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = n;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(tmp, 0, 0, SIZE, SIZE);
    const k = SIZE / n;
    map.starts.forEach((s, i) => {
      const color = `#${TEAM_COLORS[i % TEAM_COLORS.length]!.toString(16).padStart(6, '0')}`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect((s.x - BUILD_AREA / 2) * k, (s.y - BUILD_AREA / 2) * k, BUILD_AREA * k, BUILD_AREA * k);
      ctx.fillStyle = color;
      ctx.fillRect((s.x - 1.5) * k, (s.y - 1.5) * k, 3 * k, 3 * k);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(String(i + 1), (s.x + 2) * k, (s.y - 2) * k);
    });
  }, [map, version]);

  const paintAt = (ev: PointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const n = map.size;
    const tx = Math.floor(((ev.clientX - r.left) / r.width) * n);
    const ty = Math.floor(((ev.clientY - r.top) / r.height) * n);
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) return;
    if (tool === 'start') {
      // The chosen start, and the others it mirrors to.
      const imgs = images(tx, ty, n, mirror);
      const starts = map.starts.map((s) => ({ ...s }));
      imgs.forEach(([x, y], j) => {
        const k = (startIdx + j) % starts.length;
        starts[k] = { x: Math.max(13, Math.min(n - 14, x)), y: Math.max(13, Math.min(n - 14, y)) };
      });
      // Starts need flat open ground to build on.
      for (const s of starts)
        for (let y = s.y - BUILD_AREA / 2; y < s.y + BUILD_AREA / 2; y++)
          for (let x = s.x - BUILD_AREA / 2; x < s.x + BUILD_AREA / 2; x++) {
            map.terrain[y * n + x] = TERRAIN.ground;
            map.echo[y * n + x] = 0;
          }
      setMap({ ...map, starts });
      return;
    }
    const half = brush >> 1;
    for (let dy = -half; dy <= half; dy++)
      for (let dx = -half; dx <= half; dx++) {
        if (dx * dx + dy * dy > half * half + half) continue;
        for (const [x, y] of images(tx + dx, ty + dy, n, mirror)) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const i = y * n + x;
          if (tool === 'echo') {
            map.terrain[i] = TERRAIN.ground;
            map.echo[i] = Math.max(map.echo[i]!, 12 - 2 * Math.max(Math.abs(dx), Math.abs(dy)));
          } else if (tool === 'noecho') map.echo[i] = 0;
          else {
            map.terrain[i] = TERRAIN_OF[tool]!;
            if (tool !== 'ground') map.echo[i] = 0;
          }
        }
      }
    setVersion((v) => v + 1);
  };

  const fresh = (m: CustomMap) => {
    setMap(m);
    setErrors(null);
    setCode('');
    setVersion((v) => v + 1);
  };

  return (
    <MenuScreen testid="editor">
      <div class="editor">
        <div class="editor-canvas">
          <canvas
            ref={canvas}
            width={SIZE}
            height={SIZE}
            data-testid="editor-canvas"
            onPointerDown={(e) => {
              painting.current = true;
              (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
              paintAt(e);
            }}
            onPointerMove={(e) => painting.current && tool !== 'start' && paintAt(e)}
            onPointerUp={() => (painting.current = false)}
          />
        </div>
        <div class="editor-side">
          <h1>Map editor</h1>
          <label class="choice">
            <span class="label">Name</span>
            <input value={map.name} maxLength={40} data-testid="editor-name" onInput={(e) => setMap({ ...map, name: (e.currentTarget as HTMLInputElement).value })} />
          </label>
          <Choice
            label="New"
            value=""
            options={[
              ['blank2', 'Blank 1v1'],
              ['blank4', 'Blank 4 players'],
              ['gen2', 'Generated 1v1'],
              ['gen4', 'Generated 4'],
            ]}
            onChange={(v) => {
              const players = v.endsWith('4') ? 4 : 2;
              if (v.startsWith('blank')) fresh(blank(map.size, players, map.biome));
              else {
                const g = generateMap({ seed: Math.floor(Math.random() * 1e6), size: map.size <= 100 ? 'S' : map.size <= 140 ? 'M' : 'L', players, biome: map.biome, resources: 'normal', terrain: 'normal' });
                fresh({ name: map.name, size: g.width, biome: map.biome, terrain: g.terrain.slice(), echo: g.echo.map((x) => Math.min(15, x)), starts: g.starts });
              }
              setMirror(players === 4 ? 'quad' : 'rot');
            }}
            testid="editor-new"
          />
          <Choice
            label="Size"
            value={map.size}
            options={[
              [96, 'Small'],
              [128, 'Medium'],
              [160, 'Large'],
            ]}
            onChange={(v) => fresh(blank(v, map.starts.length, map.biome))}
            testid="editor-size"
          />
          <Choice
            label="Biome"
            value={map.biome}
            options={[
              ['wasteland', 'Wasteland'],
              ['city', 'Ruined city'],
              ['crystal', 'Crystal fields'],
            ]}
            onChange={(v) => setMap({ ...map, biome: v })}
            testid="editor-biome"
          />
          <Choice label="Tool" value={tool} options={TOOLS} onChange={setTool} testid="editor-tool" />
          {tool === 'start' ? (
            <Choice label="Start" value={startIdx} options={map.starts.map((_, i) => [i, String(i + 1)] as [number, string])} onChange={setStartIdx} testid="editor-start" />
          ) : (
            <Choice
              label="Brush"
              value={brush}
              options={[
                [1, '1'],
                [3, '3'],
                [5, '5'],
                [9, '9'],
              ]}
              onChange={setBrush}
              testid="editor-brush"
            />
          )}
          <Choice
            label="Mirror"
            value={mirror}
            options={[
              ['none', 'Off'],
              ['h', '↔'],
              ['v', '↕'],
              ['rot', 'Turn 180°'],
              ['quad', 'Four-way'],
            ]}
            onChange={setMirror}
            testid="editor-mirror"
          />
          <div class="editor-actions">
            <button
              data-testid="editor-check"
              onClick={() => {
                const errs = validateMap(customToGenerated(map));
                setErrors(errs);
                if (errs.length === 0) setCode(encodeMap(map));
              }}
            >
              Check
            </button>
            <button
              data-testid="editor-play"
              onClick={() => {
                const errs = validateMap(customToGenerated(map));
                setErrors(errs);
                if (errs.length > 0) return;
                go(`${location.pathname}?ai=normal&mapcode=${encodeURIComponent(encodeMap(map))}`);
              }}
            >
              Play vs AI
            </button>
            <button
              data-testid="editor-save"
              onClick={() => {
                const c = encodeMap(map);
                const list = [{ name: map.name, code: c }, ...saved.filter((x) => x.name !== map.name)].slice(0, 30);
                storeMaps(list);
                setSaved(list);
                setCode(c);
              }}
            >
              Save
            </button>
          </div>
          {errors !== null && (
            <p class={errors.length ? 'bad small' : 'good small'} data-testid="editor-errors">
              {errors.length === 0 ? 'Fair and playable.' : errors.slice(0, 4).join(' · ')}
            </p>
          )}
          <label class="choice">
            <span class="label">Code</span>
            <textarea
              class="editor-code"
              value={code}
              placeholder="Paste a map code here to load it"
              data-testid="editor-code"
              onInput={(e) => {
                const text = (e.currentTarget as HTMLTextAreaElement).value;
                setCode(text);
                try {
                  fresh(decodeMap(text));
                  setCode(text);
                } catch {
                  // Not a code (yet).
                }
              }}
            />
          </label>
          {saved.length > 0 && (
            <ul class="editor-saved">
              {saved.map((s) => (
                <li>
                  <button class="link" onClick={() => fresh(decodeMap(s.code))}>
                    {s.name}
                  </button>
                  <button
                    class="link"
                    title="Delete"
                    onClick={() => {
                      const list = saved.filter((x) => x !== s);
                      storeMaps(list);
                      setSaved(list);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button class="codex-btn" onClick={onBack} data-testid="back">
            Back
          </button>
        </div>
      </div>
    </MenuScreen>
  );
}
