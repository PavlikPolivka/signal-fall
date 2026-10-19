/** Writes campaign.json (every briefing paragraph and mission line, with its speaker) for campaign.py. */
import { writeFileSync } from 'node:fs';
import { MISSIONS } from '../../../packages/scenario/src/missions';

const out = MISSIONS.map((m) => ({
  id: m.id,
  brief: m.briefing.map((text) => ({ speaker: m.speaker, text })),
  lines: m.lines.map(([speaker, text]) => ({ speaker, text })),
}));
writeFileSync(new URL('./campaign.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('missions', out.length);
