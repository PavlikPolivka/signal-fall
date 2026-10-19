import { it } from 'vitest';

// Campaign tuning aid, off by default: plays every mission with the built-in AI as the player and prints
// how it went. The AI ignores objectives (it never hunts relays or escorts WREN), so read it as pressure,
// not as a pass mark. CAMPAIGN_RUN=1 MISSIONS=dead-air,recompile LEVELS=easy,normal pnpm --filter @signal-fall/scenario exec vitest run test/campaign-run.test.ts --silent=false
import { attachAi, type Difficulty } from '@signal-fall/ai';
import { createSim, MISSIONS } from '../src';

const only = process.env.MISSIONS?.split(',');
const levels = (process.env.LEVELS ?? 'easy,normal').split(',') as Difficulty[];
it.runIf(process.env.CAMPAIGN_RUN)('run missions with the AI as the player', () => {
  for (const m of MISSIONS) {
    if (only && !only.includes(m.id)) continue;
    for (const lvl of levels) {
      const { sim, extras } = createSim({ kind: 'mission', id: m.id, seed: 0 });
      attachAi(sim, 0, lvl, extras.starts);
      const w = sim.world;
      const maxTick = 30 * 1200;
      let firstLoss = -1;
      while (!w.ended && sim.tick < maxTick) {
        sim.step();
        if (firstLoss < 0 && w.players[0]!.stats.structuresLost > 0) firstLoss = sim.tick;
      }
      const won = w.ended && w.winnerTeam === w.players[0]!.team;
      const p = w.players[0]!;
      const min = (t: number) => (t / 1200).toFixed(1);
      process.stdout.write(`${m.id.padEnd(18)} ${lvl.padEnd(6)} ${w.ended ? (won ? 'WON ' : 'LOST') : 'TIME'} at ${min(sim.tick)}m  objectives=${w.mission!.status.join('')}  lostUnits=${p.stats.unitsLost} lostStruct=${p.stats.structuresLost} killed=${p.stats.unitsKilled} firstStructLoss=${firstLoss < 0 ? '-' : min(firstLoss)}\n`);
    }
  }
}, 3_600_000);
