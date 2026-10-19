import { render } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import '@fontsource/saira-stencil-one/latin-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-700.css';
import './landing.css';
import { Logo } from './ui/Logo';
import { FACTION_LORE } from './ui/lore';

/**
 * The landing page at /: what the game is, the trailer, the factions, screenshots,
 * and a way in. Deliberately light: no game engine, no backend.
 */

const BASE = import.meta.env.BASE_URL;
const PLAY = `${BASE}play/`;
const REPO = 'https://github.com/PavlikPolivka/signal-fall';

const FACTIONS = [
  { id: 'holdout', name: 'Holdout', unit: 'bulldog', shot: 'base-holdout', color: '#c98a3a' },
  { id: 'halcyon', name: 'Halcyon', unit: 'vector', shot: 'base-halcyon', color: '#3ee6ff' },
  { id: 'choir', name: 'Choir', unit: 'basso', shot: 'base-choir', color: '#a78bfa' },
] as const;

const SHOTS = [
  ['battle-holdout-choir', 'Holdout armor meets the Choir across a relay field'],
  ['base-choir', 'A Choir base: grown crystal, floating over Echo'],
  ['battle-choir-halcyon', 'Halcyon hover tanks push into Choir crystal'],
  ['base-halcyon', 'A Halcyon base inside its network coverage'],
  ['base-holdout', 'A Holdout base: diesel, steel and sandbags'],
] as const;

const FEATURES: [string, string][] = [
  ['Play your way', 'Against four AI difficulties, with friends, or both: 1 vs 1, 2 vs 2, free-for-all or Survival. Pick factions, map size, biome, resources and terrain.'],
  ['Online multiplayer', '1 vs 1 or 2 vs 2 with friends, any seat filled by an AI. Share a four-letter room code; games connect directly, player to player.'],
  ['Never the same map', 'Every map is generated from a seed: three sizes, wasteland, ruined city or crystal fields, open plains or chokepoints.'],
  ['Replays and reports', 'Save any match and watch it again at up to 8×. After every game: a breakdown with income, army and losses over time.'],
  ['Stats and a leaderboard', 'Your history and record per faction. Online 1v1 matches are rated once both players report the same result.'],
  ['AI agents welcome', 'Language models can play too, through an MCP server, always marked as AI agents. Watch them live in the browser.'],
];

function Lightbox({ shot, onClose }: { shot: number; onClose: () => void }) {
  const [i, setI] = useState(shot);
  // Layout effect: listening before the browser paints, so an Escape right away closes it.
  useLayoutEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((n) => (n + 1) % SHOTS.length);
      if (e.key === 'ArrowLeft') setI((n) => (n + SHOTS.length - 1) % SHOTS.length);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [file, caption] = SHOTS[i]!;
  return (
    <div class="lightbox" onClick={onClose} role="dialog" aria-label={caption}>
      <img src={`${BASE}assets/landing/${file}.jpg`} alt={caption} />
      <p>{caption}</p>
    </div>
  );
}

function Trailer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div class="lightbox" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-label="Trailer">
      <video src={`${BASE}assets/video/intro.mp4`} controls autoplay playsinline poster={`${BASE}assets/ui/keyart.jpg`} />
      <button class="close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function Landing() {
  const [shot, setShot] = useState<number | null>(null);
  const [trailer, setTrailer] = useState(false);
  const motion = typeof matchMedia === 'undefined' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <>
      <header class="hero">
        {motion && <video class="hero-video" src={`${BASE}assets/video/menu-loop.mp4`} poster={`${BASE}assets/ui/keyart.jpg`} autoplay muted loop playsinline aria-hidden="true" />}
        <div class="hero-shade" />
        <nav class="topnav">
          <Logo size={26} />
          <span class="grow" />
          <a href="#factions">Factions</a>
          <a href="#features">Features</a>
          <a href={REPO} rel="noopener">
            Source
          </a>
          <a class="btn small" href={PLAY}>
            Play
          </a>
        </nav>
        <div class="hero-body">
          <Logo size={72} />
          <p class="tagline">One crystal. Three reasons to want it.</p>
          <p class="lede">A real-time strategy game in your browser. Free, no install, no account needed.</p>
          <div class="cta">
            <a class="btn primary" href={PLAY} data-testid="play-now">
              Play now
            </a>
            <button class="btn ghost" onClick={() => setTrailer(true)} data-testid="watch-trailer">
              ▶ Watch the trailer
            </button>
          </div>
        </div>
      </header>

      <main>
        <section class="story">
          <p class="kicker">Late 22nd century</p>
          <h2>One night, every networked system on Earth stopped answering to us.</h2>
          <p>
            <b>Halcyon</b>, a planetary logistics AI, took every network in a single night, the event survivors call Signal Fall. Humanity's last
            soldiers, the <b>Holdout</b>, fight back with machines it cannot reach. Both want <b>Echo</b>, a crystal surfacing across the world. Neither
            knows that Echo is the seed-memory of an alien species, and mining it has woken the <b>Choir</b>.
          </p>
        </section>

        <section id="factions" class="factions">
          {FACTIONS.map((f) => {
            const lore = FACTION_LORE[f.id]!;
            return (
              <article class={`faction f-${f.id}`} style={{ '--fc': f.color }}>
                <div class="faction-shot" style={{ backgroundImage: `url(${BASE}assets/landing/${f.shot}.jpg)` }}>
                  <img src={`${BASE}assets/icons/${f.id}/${f.unit}.png`} alt="" loading="lazy" />
                </div>
                <div class="faction-text">
                  <p class="kicker">{lore.tagline}</p>
                  <h3>{f.name}</h3>
                  <p>{lore.story}</p>
                  <ul>
                    {lore.twists.map(([name, text]) => (
                      <li>
                        <b>{name}.</b> {text}
                      </li>
                    ))}
                  </ul>
                  <p class="muted">
                    <b>Plays:</b> {lore.play}
                  </p>
                </div>
              </article>
            );
          })}
        </section>

        <section class="shots" aria-label="Screenshots">
          {SHOTS.map(([file, caption], i) => (
            <button class="shot" onClick={() => setShot(i)} aria-label={caption}>
              <img src={`${BASE}assets/landing/${file}.jpg`} alt={caption} loading="lazy" />
            </button>
          ))}
        </section>

        <section id="features" class="features">
          {FEATURES.map(([title, text]) => (
            <div class="feature">
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </section>

        <section class="final">
          <h2>The field is open.</h2>
          <p class="muted">Runs in any modern desktop browser. Keyboard and mouse recommended.</p>
          <a class="btn primary" href={PLAY}>
            Play Signal Fall
          </a>
          <p class="muted small">Coming next: a 15-mission campaign across all three factions.</p>
        </section>
      </main>

      <footer class="foot">
        <Logo size={18} />
        <span class="grow" />
        <a href={REPO} rel="noopener">
          Source on GitHub
        </a>
        <a href={`${REPO}/blob/main/docs/AGENTS.md`} rel="noopener">
          AI agents (MCP)
        </a>
        <a href={`${PLAY}?menu=credits`} data-testid="landing-credits">
          Credits
        </a>
        <a href={`${BASE}privacy/`}>Privacy</a>
        <span class="muted">MIT license</span>
      </footer>

      {shot !== null && <Lightbox shot={shot} onClose={() => setShot(null)} />}
      {trailer && <Trailer onClose={() => setTrailer(false)} />}
    </>
  );
}

render(<Landing />, document.getElementById('landing')!);
