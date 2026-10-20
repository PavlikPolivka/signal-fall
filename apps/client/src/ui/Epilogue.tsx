import { useEffect } from 'preact/hooks';
import type { CampaignSpec } from '../game/scenario';
import { campaignDifficulty, campaignProgress, markMissionWon, useBriefingVoice } from './Campaign';

/**
 * The campaign is won: the epilogue (art, read aloud, each paragraph lit as it is spoken), what was
 * achieved, and the way on.
 */
export function Epilogue({
  campaign,
  onCredits,
  onClose,
  closeLabel = 'Back to the campaign',
  justWon,
}: {
  campaign: CampaignSpec;
  onCredits: () => void;
  onClose: () => void;
  closeLabel?: string;
  /** The mission just won (counted even before it is saved). */
  justWon?: string;
}) {
  const ep = campaign.epilogue!;
  const voice = useBriefingVoice({ id: `epilogue-${campaign.id}`, briefing: ep.paragraphs });
  useEffect(() => {
    if (justWon) markMissionWon(justWon);
    voice.play();
    return () => voice.stop();
  }, []);
  const done = campaignProgress();
  if (justWon) done.add(justWon);
  const won = campaign.missions.filter((m) => done.has(m.id)).length;
  const difficulty = { story: 'Story', normal: 'Normal', hard: 'Hard' }[campaignDifficulty()];
  return (
    <div class="menu-overlay epilogue-overlay" data-testid="epilogue">
      <div class={`epilogue briefing-panel speaker-${ep.speaker} ${voice.playing ? 'reading' : ''}`}>
        <div class="briefing-art">
          <img src={`${import.meta.env.BASE_URL}assets/missions/epilogue-${campaign.id}.webp`} alt="" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
          <div class="briefing-title">
            <div class="briefing-kicker">Campaign complete · {campaign.title}</div>
            <h2>{ep.title}</h2>
          </div>
        </div>
        <div class="briefing-text">
          {ep.paragraphs.map((p, i) => (
            <p class={voice.current === i ? 'spoken' : voice.playing && i > voice.current ? 'ahead' : ''}>{p}</p>
          ))}
        </div>
        <p class="epilogue-record" data-testid="epilogue-record">
          {won} of {campaign.missions.length} missions won · {difficulty}
        </p>
        <div class="briefing-actions">
          <button class="start" onClick={onClose} data-testid="epilogue-close">
            {closeLabel}
          </button>
          <button onClick={onCredits} data-testid="epilogue-credits">
            Credits
          </button>
          <button onClick={() => (voice.playing ? voice.stop() : voice.play())}>{voice.playing ? 'Stop' : '▶ Listen'}</button>
        </div>
      </div>
    </div>
  );
}
