import { useEffect, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import type { Difficulty } from '@signal-fall/ai';
import { Codex } from './Codex';
import { Changes } from './Changes';
import { Logo } from './Logo';
import { MenuVideo } from './Video';
import { parseReplay, type Replay } from '../game/scenario';
import { Credits } from './Credits';
import { Choice, MapSettings, randomSeed, type MapChoice } from './MapSettings';
import { Account } from './Account';
import { Stats } from './Stats';
import { account, backend, type Account as AccountInfo } from '../net/backend';

export interface SkirmishSettings extends MapChoice {
  /** 1v1, or 2v2: you and an AI ally against two AIs. */
  mode: '1v1' | '2v2';
  faction: number;
  enemyFaction: number;
  /** Enemy AI difficulty. */
  difficulty: Difficulty;
  allyFaction: number;
  allyDifficulty: Difficulty;
  enemy2Faction: number;
}

const DIFFICULTY_OPTIONS: [Difficulty, string][] = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
  ['brutal', 'Brutal'],
];

const STORAGE_KEY = 'signal-fall.setup';

/** The last skirmish setup (also what a rematch replays). */
export function loadSaved(): Partial<SkirmishSettings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SkirmishSettings>;
  } catch {
    return {};
  }
}

/** The menu frame: background video, the logo on top, content anchored to the bottom. */
export function MenuScreen({ testid, children }: { testid: string; children: preact.ComponentChildren }) {
  return (
    <div class="setup" data-testid={testid}>
      <MenuVideo />
      <header class="setup-head">
        <Logo size={56} />
      </header>
      <div class="setup-body">{children}</div>
    </div>
  );
}

/** Main menu: Skirmish vs AI or Multiplayer, plus the Codex, replays, intro and credits. */
export function Setup({
  rules,
  onStart,
  onMultiplayer,
  onIntro,
  onReplay,
  notice,
}: {
  rules: Rules;
  onStart: (s: SkirmishSettings) => void;
  onMultiplayer: () => void;
  /** One-line message to show on the menu (e.g. after returning from an email link). */
  notice?: string | null;
  /** Play the intro cutscene (absent when there is no intro video). */
  onIntro?: () => void;
  /** Watch a replay file. */
  onReplay: (r: Replay) => void;
}) {
  // `?menu=skirmish` (New skirmish on the end screen) opens the skirmish setup directly.
  const [skirmish, setSkirmish] = useState(() => new URLSearchParams(location.search).get('menu') === 'skirmish');
  useEffect(() => {
    if (location.search.includes('menu=')) history.replaceState(null, '', location.pathname);
  }, []);
  const [changes, setChanges] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [codex, setCodex] = useState(false);
  const [credits, setCredits] = useState(false);
  const [accountOpen, setAccountOpen] = useState(!!notice);
  const [statsOpen, setStatsOpen] = useState(false);
  useEffect(() => {
    if (notice) setAccountOpen(true);
  }, [notice]);
  const [me, setMe] = useState<AccountInfo | null>(null);
  useEffect(() => {
    const sb = backend();
    if (sb) void account(sb).then(setMe, () => undefined);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCodex(false);
      setChanges(false);
      setCredits(false);
      setAccountOpen(false);
      setStatsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const openReplay = async (file: File | undefined) => {
    if (!file) return;
    try {
      onReplay(parseReplay(await file.text()));
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : String(e));
    }
  };

  if (skirmish) return <Skirmish rules={rules} onStart={onStart} onBack={() => setSkirmish(false)} />;

  return (
    <MenuScreen testid="home">
      <div class="home">
        {me && (
          <button class="home-me" onClick={() => setAccountOpen(true)} data-testid="home-me">
            Playing as <b>{me.name}</b>
            <span class={me.guest ? 'tag' : 'tag good'}>{me.guest ? 'guest' : 'account'}</span>
          </button>
        )}
        {notice && <p class="home-notice">{notice}</p>}
        <div class="home-actions">
          <button class="start" onClick={() => setSkirmish(true)} data-testid="open-skirmish">
            Skirmish vs AI
          </button>
          <button class="mp-btn" onClick={onMultiplayer} data-testid="open-multiplayer">
            Multiplayer
          </button>
        </div>
        <nav class="setup-links">
          <button onClick={() => setCodex(true)} data-testid="open-codex">
            Codex
          </button>
          <button onClick={() => setChanges(true)} data-testid="open-changes">
            What's new
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
          <button onClick={() => setStatsOpen(true)} data-testid="open-stats">
            Stats
          </button>
          <button onClick={() => setAccountOpen(true)} data-testid="open-account">
            Account
          </button>
          <button onClick={() => setCredits(true)} data-testid="open-credits">
            Credits
          </button>
        </nav>
        {replayError && <p class="mp-status">{replayError}</p>}
      </div>
      {codex && <Codex rules={rules} onClose={() => setCodex(false)} />}
      {changes && <Changes onClose={() => setChanges(false)} />}
      {credits && <Credits onClose={() => setCredits(false)} />}
      {accountOpen && <Account onClose={() => setAccountOpen(false)} onChange={setMe} />}
      {statsOpen && <Stats rules={rules} onClose={() => setStatsOpen(false)} />}
    </MenuScreen>
  );
}

/** Skirmish setup: sides and difficulty on the left, the map on the right. Remembered between visits. */
function Skirmish({ rules, onStart, onBack }: { rules: Rules; onStart: (s: SkirmishSettings) => void; onBack: () => void }) {
  const [s, setS] = useState<SkirmishSettings>(() => ({
    mode: '1v1',
    faction: 0,
    enemyFaction: 1,
    difficulty: 'normal',
    allyFaction: 2,
    allyDifficulty: 'normal',
    enemy2Faction: 0,
    seed: randomSeed(),
    size: 'M',
    biome: 'wasteland',
    resources: 'normal',
    terrain: 'normal',
    ...loadSaved(),
  }));
  const set = (patch: Partial<SkirmishSettings>) => setS((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.codex-overlay')) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const factions: [number, string][] = rules.factions.map((f) => [f.index, f.name]);

  const start = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // Private mode etc.: settings just aren't remembered.
    }
    onStart(s);
  };

  return (
    <MenuScreen testid="setup">
      <div class="setup-panel wide">
        <h1>Skirmish vs AI</h1>
        <div class="setup-cols">
          <section>
            <h2>Sides</h2>
            <Choice
              label="Mode"
              value={s.mode}
              options={[
                ['1v1', '1 vs 1'],
                ['2v2', '2 vs 2'],
              ]}
              onChange={(v) => set({ mode: v })}
              testid="mode"
            />
            <Choice label="You play" value={s.faction} options={factions} onChange={(v) => set({ faction: v })} testid="faction" />
            {s.mode === '2v2' && (
              <>
                <Choice label="Ally" value={s.allyFaction} options={factions} onChange={(v) => set({ allyFaction: v })} testid="ally" />
                <Choice label="Ally skill" value={s.allyDifficulty} options={DIFFICULTY_OPTIONS} onChange={(v) => set({ allyDifficulty: v })} testid="ally-difficulty" />
              </>
            )}
            <Choice label={s.mode === '2v2' ? 'Enemy 1' : 'Opponent'} value={s.enemyFaction} options={factions} onChange={(v) => set({ enemyFaction: v })} testid="enemy" />
            {s.mode === '2v2' && <Choice label="Enemy 2" value={s.enemy2Faction} options={factions} onChange={(v) => set({ enemy2Faction: v })} testid="enemy2" />}
            <Choice label="Difficulty" value={s.difficulty} options={DIFFICULTY_OPTIONS} onChange={(v) => set({ difficulty: v })} testid="difficulty" />
          </section>
          <section>
            <h2>Map</h2>
            <MapSettings value={s} onChange={set} players={s.mode === '2v2' ? 4 : 2} />
          </section>
        </div>
        <div class="setup-foot">
          <button class="codex-btn" onClick={onBack} data-testid="back">
            Back
          </button>
          <button class="start" onClick={start} data-testid="start">
            Start match
          </button>
        </div>
      </div>
    </MenuScreen>
  );
}
