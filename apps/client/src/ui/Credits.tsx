import licensesRaw from '../../../../assets/LICENSES.json?raw';

interface Entry {
  files?: string;
  title: string;
  source: string;
  author: string;
  license: string;
}

const licenses = JSON.parse(licensesRaw) as { entries: Entry[]; bundled?: Entry[] };

/** Libraries shipped in the game bundle. */
const LIBRARIES: Entry[] = [
  { title: 'PixiJS', source: 'pixijs.com', author: 'PixiJS team', license: 'MIT' },
  { title: 'Preact', source: 'preactjs.com', author: 'Jason Miller and contributors', license: 'MIT' },
  { title: 'Zod', source: 'zod.dev', author: 'Colin McDonnell and contributors', license: 'MIT' },
];

/** Tools used to make the assets (not shipped). */
const TOOLS: Entry[] = [
  { title: 'Blender', source: 'blender.org', author: 'Blender Foundation', license: 'GPL-2.0-or-later (tool only; renders are ours)' },
  { title: 'sharp', source: 'sharp.pixelplumbing.com', author: 'Lovell Fuller and contributors', license: 'Apache-2.0' },
  { title: 'maxrects-packer', source: 'npm: maxrects-packer', author: 'Gio Mo', license: 'MIT' },
  { title: 'Piper TTS', source: 'github.com/rhasspy/piper', author: 'Michael Hansen and contributors', license: 'MIT (tool only); voices norman, cori and ljspeech trained on public-domain recordings' },
  { title: 'FFmpeg', source: 'ffmpeg.org', author: 'FFmpeg developers', license: 'LGPL/GPL (tool only)' },
  { title: 'Meshy', source: 'meshy.ai', author: 'Meshy', license: 'AI 3D model generation (tool; generated models owned by the project on a paid plan)' },
  { title: 'ambientCG', source: 'ambientcg.com', author: 'Lennart Demes', license: 'CC0 (terrain and material textures)' },
  { title: 'Poly Haven', source: 'polyhaven.com', author: 'Amal Kumar, Dario Barresi, Gonçalo Felício, Greg Zaal, GurJas Studios, Jack Mava, James Ray Cock, Jenelle van Heerden, John Hutcheson, Jorge Camacho, Josh Dean, Juniix, Monsta3D, MP, Raunox, Rico Cilliers, Riley Queen, Rob Tuytel, Sean Buckley, Serhii Khromov', license: 'CC0 (3D scans used for map props, trees and city buildings)' },
];

function Section({ title, items }: { title: string; items: Entry[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul class="credits-list">
        {items.map((e) => (
          <li>
            <b>{e.title}</b>
            <span>{e.author}</span>
            <span class="muted">
              {e.source} · {e.license}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Credits, generated from assets/LICENSES.json plus the shipped libraries. */
export function Credits({ onClose }: { onClose: () => void }) {
  return (
    <div class="codex-overlay" data-testid="credits" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="codex credits">
        <header class="codex-head">
          <h1>Credits</h1>
          <button class="close" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div class="codex-body prose">
          <p class="lead">Signal Fall — a browser RTS. Code, models, textures, sound and music are made for the game and released under the MIT license.</p>
          <Section
            title="Game assets"
            items={[
              ...licenses.entries,
              { title: 'Sound effects and music', source: 'Synthesized at runtime (apps/client/src/audio)', author: 'Signal Fall contributors', license: 'MIT' },
            ]}
          />
          {licenses.bundled && <Section title="Typefaces" items={licenses.bundled} />}
          <Section title="Libraries" items={LIBRARIES} />
          <Section title="Made with" items={TOOLS} />
        </div>
      </div>
    </div>
  );
}
