import { useEffect, useState } from 'preact/hooks';
import { go, isFullscreen, onFullscreenChange, toggleFullscreen } from '../nav';
import type { Rules } from '@signal-fall/data';
import type { Difficulty, StrategyName } from '@signal-fall/ai';
import { clock, recentMatches, savedGame } from '../game/saves';
import { Codex } from './Codex';
import { DailyPanel } from './Daily';
import { Editor } from './Editor';
import { Campaign } from './Campaign';
import { Changes } from './Changes';
import { Logo } from './Logo';
import { MenuVideo } from './Video';
import { parseReplay, type Replay } from '../game/scenario';
import { Credits } from './Credits';
import { Choice, MapSettings, randomSeed, type MapChoice } from './MapSettings';
import { Account } from './Account';
import { Stats } from './Stats';
import { account, backend, type Account as AccountInfo } from '../net/backend';
import type { LobbyMap, LobbyMode } from '../net/lobby';

export interface SkirmishSettings extends MapChoice {
  /** 1v1, 2v2 (you and an AI ally against two AIs), or free-for-all against two or three AIs. */
  mode: '1v1' | '2v2' | 'ffa3' | 'ffa4' | 'survival';
  /** Survival: alone or with an AI ally, and how big the waves get. */
  survivalAlly?: boolean;
  survivalLevel?: 'easy' | 'normal' | 'hard';
  faction: number;
  enemyFaction: number;
  /** Enemy AI difficulty. */
  difficulty: Difficulty;
  allyFaction: number;
  allyDifficulty: Difficulty;
  enemy2Faction: number;
  /** Enemy AI personality (a fixed strategy), or random per match. */
  personality?: StrategyName | 'random';
  /** Lighting: day, dusk or night (looks only). */
  time?: 'day' | 'dusk' | 'night';
  /** Seats left for people instead of the AI: the match then opens as a multiplayer room. */
  people?: SeatKey[];
}

/** The seats beside yours, by role. */
export type SeatKey = 'ally' | 'enemy' | 'enemy2' | 'enemy3';

/** A room set up on the Play screen: what the host's lobby starts with. */
export interface RoomPreset {
  mode: LobbyMode;
  faction: number;
  /** Seats 1, 2, ... (yours is 0). */
  slots: { kind: 'ai' | 'open'; faction: number; difficulty: Difficulty }[];
  map: Partial<LobbyMap> & { seed: number };
}

/** The seats a mode has beside yours, in lobby order. */
function seatsOf(s: SkirmishSettings): SeatKey[] {
  if (s.mode === '2v2') return ['ally', 'enemy', 'enemy2'];
  if (s.mode === 'ffa3') return ['enemy', 'enemy2'];
  if (s.mode === 'ffa4') return ['enemy', 'enemy2', 'enemy3'];
  if (s.mode === 'survival') return s.survivalAlly ? ['ally'] : [];
  return ['enemy'];
}

function seatFaction(s: SkirmishSettings, k: SeatKey): number {
  return k === 'ally' || k === 'enemy3' ? s.allyFaction : k === 'enemy' ? s.enemyFaction : s.enemy2Faction;
}

/** Seats given to people, in this mode. */
const peopleSeats = (s: SkirmishSettings) => seatsOf(s).filter((k) => s.people?.includes(k));

export function roomPreset(s: SkirmishSettings): RoomPreset {
  return {
    mode: s.mode === 'survival' ? 'coop' : s.mode,
    faction: s.faction,
    slots: seatsOf(s).map((k) => ({ kind: s.people?.includes(k) ? 'open' : 'ai', faction: seatFaction(s, k), difficulty: k === 'ally' ? s.allyDifficulty : s.difficulty })),
    map: { size: s.size, biome: s.biome, resources: s.resources, terrain: s.terrain, points: s.points, crates: s.crates, hill: s.hill, custom: s.custom, seed: s.seed },
  };
}

const DIFFICULTY_OPTIONS: [Difficulty, string][] = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
  ['brutal', 'Brutal'],
];

/** What each AI level does, in the setup screen. */
const DIFFICULTY_INFO: Record<Difficulty, string> = {
  easy: 'Builds slowly and attacks with small groups from about minute 6. Never scouts, raids or uses abilities. For learning the game.',
  normal: 'A steady opponent: scouts, picks units that counter yours and attacks from minute 4, but does not raid or use abilities.',
  hard: 'Plays like a good player: fast, raids your harvesters, retreats from lost fights, focuses fire and uses every ability.',
  brutal: 'Hard, plus 25% more income from every harvest. The only level that cheats.',
};

/** AI personalities: each always plays one strategy. */
export const PERSONALITIES: [StrategyName | 'random', string, string][] = [
  ['random', 'Random', 'A different plan every match'],
  ['balanced', 'Steady Sam', 'Even economy and army, attacks when ready'],
  ['rush', 'Rusher Rita', 'Cheap units early and often'],
  ['tech', 'Tech Tara', 'Builds up, then comes with heavy units'],
  ['turtle', 'Turtle Tomas', 'Walls in behind defenses, attacks late and hard'],
  ['raider', 'Raider Rex', 'Fast units and air hunting your harvesters'],
];

/** One-click setups; the map seed is fresh each time. */
const PRESETS: { id: string; label: string; title: string; patch: Partial<SkirmishSettings> }[] = [
  { id: 'quick', label: 'Quick match', title: 'Small open map with normal Echo: a short match', patch: { size: 'S', terrain: 'open', resources: 'normal' } },
  { id: 'long', label: 'Long game', title: 'Large map with rich Echo and choke points: room to expand and tech up', patch: { size: 'L', terrain: 'choke', resources: 'rich' } },
  { id: 'rush', label: 'Rush', title: 'Small map, little Echo: build fast and strike first', patch: { size: 'S', terrain: 'open', resources: 'low' } },
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

/** Continue the saved skirmish, or watch one of the last matches played in this browser. */
function SavedAndRecent({ onReplay }: { onReplay: (r: Replay) => void }) {
  const save = savedGame();
  const recent = recentMatches();
  const [open, setOpen] = useState(false);
  if (!save && recent.length === 0) return null;
  const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div class="saved" data-testid="saved">
      {save && (
        <button class="continue" data-testid="continue" onClick={() => go(`${location.pathname}?continue=1`)}>
          Continue: {save.meta.label} at {clock(save.meta.tick)} <span class="muted">({when(save.meta.at)})</span>
        </button>
      )}
      {recent.length > 0 && (
        <button class="link" data-testid="recent-toggle" onClick={() => setOpen(!open)}>
          Recent matches ({recent.length})
        </button>
      )}
      {open && (
        <ul class="recent" data-testid="recent">
          {recent.map((r) => (
            <li>
              <span>
                {r.meta.label} · {clock(r.meta.tick)} · <span class="muted">{when(r.meta.at)}</span>
              </span>
              <button onClick={() => onReplay(parseReplay(r.json))}>Watch</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The menu frame: background video, the logo on top, content anchored to the bottom. */
/** Top-right corner of every menu: in and out of fullscreen (it now lasts from menu to match and back). */
function FullscreenButton() {
  const [on, setOn] = useState(isFullscreen());
  useEffect(() => onFullscreenChange(() => setOn(isFullscreen())), []);
  if (!document.fullscreenEnabled && !on) return null;
  return (
    <button
      class="fullscreen-btn"
      data-testid="menu-fullscreen"
      title={on ? 'Leave fullscreen' : 'Fullscreen'}
      aria-label={on ? 'Leave fullscreen' : 'Fullscreen'}
      onClick={() => void toggleFullscreen().catch(() => undefined)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
      </svg>
    </button>
  );
}

export function MenuScreen({ testid, children }: { testid: string; children: preact.ComponentChildren }) {
  return (
    <div class="setup" data-testid={testid}>
      <MenuVideo />
      <header class="setup-head">
        <Logo size={56} />
      </header>
      <FullscreenButton />
      <div class="setup-body">{children}</div>
    </div>
  );
}

/** Main menu: Campaign, Play (against the AI and/or friends), Join a game, the daily challenge; Codex, replays, intro and credits. */
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
  /** Join a game, or (with a preset from the Play screen) host a room set up like that. */
  onMultiplayer: (preset?: RoomPreset) => void;
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
  const [editor, setEditor] = useState(false);
  const [campaign, setCampaign] = useState(() => new URLSearchParams(location.search).get('menu') === 'campaign');
  // `?menu=campaign&brief=<id>` (Next mission on the end screen): that mission's briefing, read aloud.
  const [brief] = useState(() => new URLSearchParams(location.search).get('brief'));
  const [replayError, setReplayError] = useState<string | null>(null);
  const [codex, setCodex] = useState(false);
  // ?menu=credits (from the landing page) opens the credits.
  const [credits, setCredits] = useState(() => new URLSearchParams(location.search).get('menu') === 'credits');
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

  if (skirmish) return <Skirmish rules={rules} onStart={onStart} onHost={onMultiplayer} onBack={() => setSkirmish(false)} />;
  if (editor) return <Editor onBack={() => setEditor(false)} />;
  if (campaign) return <Campaign brief={brief} onBack={() => setCampaign(false)} onPlay={(m) => go(`${location.pathname}?mission=${m.id}`)} />;

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
        <SavedAndRecent onReplay={onReplay} />
        <div class="home-actions">
          <button class="mp-btn" onClick={() => setCampaign(true)} data-testid="open-campaign">
            Campaign
          </button>
          <button class="start" onClick={() => setSkirmish(true)} data-testid="open-skirmish" title="Set up a match: against the AI, with friends, or both">
            Play
          </button>
          <button class="mp-btn" onClick={() => onMultiplayer()} data-testid="open-multiplayer" title="Join a friend's room, an open game or a ranked match">
            Join a game
          </button>
          <DailyPanel />
        </div>
        <nav class="setup-links">
          <button onClick={() => go(`${location.pathname}?tutorial=1`)} data-testid="open-tutorial" title="Learn to play in eight short steps">
            Tutorial
          </button>
          <button onClick={() => setEditor(true)} data-testid="open-editor" title="Make your own maps and share them as a code">
            Map editor
          </button>
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
function Skirmish({ rules, onStart, onHost, onBack }: { rules: Rules; onStart: (s: SkirmishSettings) => void; onHost: (p: RoomPreset) => void; onBack: () => void }) {
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
      // Seats for people are chosen fresh each time.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, people: undefined }));
    } catch {
      // Private mode etc.: settings just aren't remembered.
    }
    // A seat for a person: the same match, as a room others join.
    if (peopleSeats(s).length > 0) onHost(roomPreset(s));
    else onStart(s);
  };
  /** Who plays a seat: the AI, or a person who joins the room. */
  const by = (k: SeatKey) => (
    <div class="choice seat-by" data-testid={`by-${k}`}>
      <span class="label" />
      <div class="seg">
        {(
          [
            ['ai', 'AI'],
            ['person', 'A player'],
          ] as const
        ).map(([v, label]) => (
          <button
            class={(s.people?.includes(k) ? 'person' : 'ai') === v ? 'active' : ''}
            data-value={v}
            onClick={() => set({ people: v === 'person' ? [...(s.people ?? []).filter((x) => x !== k), k] : (s.people ?? []).filter((x) => x !== k) })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
  const hosting = peopleSeats(s).length > 0;

  return (
    <MenuScreen testid="setup">
      <div class="setup-panel wide">
        <h1>Play</h1>
        <p class="muted small setup-sub">Against the AI, with friends, or both: leave a seat to a player and the match opens as a room they join with a code.</p>
        <div class="setup-cols">
          <section>
            <h2>Sides</h2>
            <Choice
              label="Mode"
              value={s.mode}
              options={[
                ['1v1', '1 vs 1'],
                ['2v2', '2 vs 2'],
                ['ffa3', 'FFA 3'],
                ['ffa4', 'FFA 4'],
                ['survival', 'Survival'],
              ]}
              onChange={(v) => set({ mode: v })}
              testid="mode"
            />
            {s.mode === 'survival' && (
              <>
                <Choice
                  label="Waves"
                  value={s.survivalLevel ?? 'normal'}
                  options={[
                    ['easy', 'Easy'],
                    ['normal', 'Normal'],
                    ['hard', 'Hard'],
                  ]}
                  onChange={(v) => set({ survivalLevel: v })}
                  testid="survival-level"
                />
                <Choice
                  label="Ally"
                  value={s.survivalAlly ? 'yes' : 'no'}
                  options={[
                    ['no', 'Alone'],
                    ['yes', 'With an AI ally'],
                  ]}
                  onChange={(v) => set({ survivalAlly: v === 'yes' })}
                  testid="survival-ally"
                />
                <p class="setup-note">Hold out through 15 waves from the map edges; the first comes at 2:30. The waves are made of the "Opponent" faction.</p>
              </>
            )}
            <Choice label="You play" value={s.faction} options={factions} onChange={(v) => set({ faction: v })} testid="faction" />
            {(s.mode === '2v2' || (s.mode === 'survival' && s.survivalAlly)) && (
              <>
                <Choice label="Ally" value={s.allyFaction} options={factions} onChange={(v) => set({ allyFaction: v })} testid="ally" />
                {by('ally')}
                <Choice label="Ally skill" value={s.allyDifficulty} options={DIFFICULTY_OPTIONS} onChange={(v) => set({ allyDifficulty: v })} testid="ally-difficulty" />
              </>
            )}
            <Choice label={s.mode === '1v1' ? 'Opponent' : s.mode === 'survival' ? 'The waves' : 'Enemy 1'} value={s.enemyFaction} options={factions} onChange={(v) => set({ enemyFaction: v })} testid="enemy" />
            {s.mode !== 'survival' && by('enemy')}
            {s.mode !== '1v1' && s.mode !== 'survival' && (
              <>
                <Choice label="Enemy 2" value={s.enemy2Faction} options={factions} onChange={(v) => set({ enemy2Faction: v })} testid="enemy2" />
                {by('enemy2')}
              </>
            )}
            {s.mode === 'ffa4' && (
              <>
                <Choice label="Enemy 3" value={s.allyFaction} options={factions} onChange={(v) => set({ allyFaction: v })} testid="enemy3" />
                {by('enemy3')}
              </>
            )}
            {s.mode !== 'survival' && (
              <>
            <Choice label="Difficulty" value={s.difficulty} options={DIFFICULTY_OPTIONS} onChange={(v) => set({ difficulty: v })} testid="difficulty" />
            <p class="setup-note" data-testid="difficulty-info">{DIFFICULTY_INFO[s.difficulty]}</p>
            <Choice
              label="Opponent style"
              value={s.personality ?? 'random'}
              options={PERSONALITIES.map(([v, label]) => [v, label] as [StrategyName | 'random', string])}
              onChange={(v) => set({ personality: v })}
              testid="personality"
            />
            <p class="setup-note">{PERSONALITIES.find(([v]) => v === (s.personality ?? 'random'))![2]}</p>
              </>
            )}
          </section>
          <section>
            <h2>Map</h2>
            <div class="presets" data-testid="presets">
              {PRESETS.map((p) => (
                <button title={p.title} data-testid={`preset-${p.id}`} onClick={() => set({ ...p.patch, seed: randomSeed() })}>
                  {p.label}
                </button>
              ))}
            </div>
            <MapSettings value={s} onChange={set} players={s.mode === '2v2' || s.mode === 'ffa4' ? 4 : s.mode === 'ffa3' ? 3 : 2} />
            <Choice
              label="Time of day"
              value={s.time ?? 'day'}
              options={[
                ['day', 'Day'],
                ['dusk', 'Dusk'],
                ['night', 'Night'],
              ]}
              onChange={(v) => set({ time: v })}
              testid="time"
            />
          </section>
        </div>
        <div class="setup-foot">
          <button class="codex-btn" onClick={onBack} data-testid="back">
            Back
          </button>
          <button class="start" onClick={start} data-testid="start">
            {hosting ? 'Create room' : 'Start match'}
          </button>
        </div>
      </div>
    </MenuScreen>
  );
}
