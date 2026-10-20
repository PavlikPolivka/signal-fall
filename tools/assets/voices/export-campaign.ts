/** Writes campaign.json (every briefing paragraph and mission line, with its speaker) for campaign.py. */
import { writeFileSync } from 'node:fs';
import { CAMPAIGNS, MISSIONS } from '../../../packages/scenario/src/missions';

const out = MISSIONS.map((m) => ({
  id: m.id,
  brief: m.briefing.map((text) => ({ speaker: m.speaker, text })),
  lines: m.lines.map(([speaker, text]) => ({ speaker, text })),
}));
// Each campaign's epilogue, read like a briefing: voice/campaign/epilogue-<campaign>/brief_<n>.mp3.
for (const c of CAMPAIGNS)
  if (c.epilogue) out.push({ id: `epilogue-${c.id}`, brief: c.epilogue.paragraphs.map((text) => ({ speaker: c.epilogue!.speaker, text })), lines: [] });
writeFileSync(new URL('./campaign.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('missions', out.length);
