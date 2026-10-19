import { useEffect, useRef, useState } from 'preact/hooks';
import { MISSIONS, type CampaignDifficulty, type MissionSpec } from '../game/scenario';
import { MenuScreen } from './Setup';

const PROGRESS_KEY = 'signalfall.campaign';
const ACTS = ['', 'Act I: The Holdout', 'Act II: Halcyon', 'Act III: The Choir', 'Finale'];
const ACT_TABS = ['', 'Act I', 'Act II', 'Act III', 'Finale'];

/** Missions won in this browser (by id). */
export function campaignProgress(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markMissionWon(id: string): void {
  const done = campaignProgress();
  done.add(id);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
  } catch {
    // Not kept.
  }
}

const DIFFICULTY_KEY = 'signalfall.campaignDifficulty';
const DIFFICULTIES: [CampaignDifficulty, string, string][] = [
  ['story', 'Story', 'Smaller enemy waves, a weaker enemy AI and 3,000 extra credits: for the story.'],
  ['normal', 'Normal', 'The campaign as designed: it gets harder as you go.'],
  ['hard', 'Hard', 'Half again as many attackers, and a sharper enemy AI.'],
];

/** The chosen campaign difficulty (Normal unless changed). */
export function campaignDifficulty(): CampaignDifficulty {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    return v === 'story' || v === 'hard' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

function setCampaignDifficulty(v: CampaignDifficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, v);
  } catch {
    // Not kept.
  }
}

/** The next mission after this one, if any. */
export function nextMission(id: string): MissionSpec | null {
  const i = MISSIONS.findIndex((m) => m.id === id);
  return MISSIONS[i + 1] ?? null;
}

/** Play a briefing line from the generated voice files (one per paragraph), one after another. */
function useBriefingVoice(mission: MissionSpec | null): { playing: boolean; current: number; play: () => void; stop: () => void } {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState(-1);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setCurrent(-1);
  };
  useEffect(() => stop, [mission?.id]);
  const play = () => {
    if (!mission) return;
    stop();
    let i = 0;
    const next = () => {
      if (i >= mission.briefing.length) return setCurrent(-1);
      const a = new Audio(`${import.meta.env.BASE_URL}assets/voice/campaign/${mission.id}/brief_${i}.mp3`);
      audio.current = a;
      setCurrent(i);
      i++;
      a.onended = next;
      a.onerror = next;
      // Autoplay can be blocked until the page gets a click: then the text simply stays readable.
      void a.play().catch(() => setCurrent(-1));
    };
    next();
  };
  return { playing: current >= 0, current, play, stop };
}

/** The campaign: missions by act (each unlocked by winning the one before), and a briefing for the chosen one. */
export function Campaign({ onBack, onPlay, brief }: { onBack: () => void; onPlay: (m: MissionSpec) => void; brief?: string | null }) {
  const done = campaignProgress();
  const firstOpen = MISSIONS.findIndex((m) => !done.has(m.id));
  const briefed = brief ? (MISSIONS.find((m) => m.id === brief) ?? null) : null;
  const [chosen, setChosen] = useState<MissionSpec | null>(briefed ?? MISSIONS[firstOpen < 0 ? 0 : firstOpen]!);
  // Straight from the last mission: only the briefing, read aloud, until "All missions" opens the list.
  const [focus, setFocus] = useState(!!briefed);
  // One act at a time (no scrolling): the act of the mission shown.
  const [act, setAct] = useState(() => chosen?.act ?? 1);
  const voice = useBriefingVoice(chosen);
  useEffect(() => {
    if (briefed) voice.play();
  }, []);
  const [difficulty, setDifficulty] = useState(campaignDifficulty());
  const index = chosen ? MISSIONS.indexOf(chosen) : -1;
  return (
    <MenuScreen testid="campaign">
      <div class={`campaign ${focus ? 'focus' : ''}`}>
        {!focus && (
        <div class="campaign-list">
          <h1>Campaign</h1>
          <div class="seg act-tabs" data-testid="act-tabs">
            {[1, 2, 3, 4].map((a) => (
              <button class={act === a ? 'active' : ''} data-act={a} title={ACTS[a]} onClick={() => setAct(a)}>
                {ACT_TABS[a]}
              </button>
            ))}
          </div>
          <section>
            <h3>{ACTS[act]}</h3>
            {MISSIONS.map((m, i) =>
              m.act !== act ? null : (
                <button
                  class={`mission ${chosen?.id === m.id ? 'active' : ''} ${done.has(m.id) ? 'won' : ''}`}
                  disabled={i > 0 && !done.has(MISSIONS[i - 1]!.id) && !done.has(m.id)}
                  data-mission={m.id}
                  onClick={() => setChosen(m)}
                >
                  <span>{i + 1}.</span> {m.title} {done.has(m.id) && <b>✓</b>}
                </button>
              ),
            )}
          </section>
          <button class="codex-btn" onClick={onBack} data-testid="back">
            Back
          </button>
        </div>
        )}
        {chosen && (
          <div class={`briefing-panel speaker-${chosen.speaker} ${voice.playing ? 'reading' : ''}`} data-testid="mission-briefing">
            <div class="briefing-art">
              <img
                key={chosen.id}
                src={`${import.meta.env.BASE_URL}assets/missions/${chosen.id}.webp`}
                alt=""
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
              <div class="briefing-title">
                <div class="briefing-kicker">
                  Mission {index + 1} · {ACTS[chosen.act]}
                </div>
                <h2>{chosen.title}</h2>
              </div>
            </div>
            {chosen.briefing.map((p, i) => (
              <p class={voice.current === i ? 'spoken' : voice.playing && i > voice.current ? 'ahead' : ''}>{p}</p>
            ))}
            <h3>Objectives</h3>
            <ul>
              {chosen.objectives.map((o) => (
                <li>{o.text}</li>
              ))}
            </ul>
            <div class="choice campaign-difficulty" data-testid="campaign-difficulty">
              <span class="label">Difficulty</span>
              <div class="seg">
                {DIFFICULTIES.map(([id, label, hint]) => (
                  <button
                    class={difficulty === id ? 'active' : ''}
                    title={hint}
                    data-difficulty={id}
                    onClick={() => {
                      setCampaignDifficulty(id);
                      setDifficulty(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span class="muted small">{DIFFICULTIES.find(([id]) => id === difficulty)![2]}</span>
            </div>
            <div class="briefing-actions">
              <button onClick={() => (voice.playing ? voice.stop() : voice.play())} data-testid="briefing-voice">
                {voice.playing ? 'Stop' : '▶ Listen'}
              </button>
              <button
                class="start"
                data-testid="mission-start"
                onClick={() => {
                  voice.stop();
                  onPlay(chosen);
                }}
              >
                Start mission
              </button>
              {focus && (
                <button
                  data-testid="all-missions"
                  onClick={() => {
                    voice.stop();
                    setFocus(false);
                  }}
                >
                  All missions
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </MenuScreen>
  );
}
