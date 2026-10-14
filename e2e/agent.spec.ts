import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { AgentMatch } from '@signal-fall/agent/src/match';
import { translate } from '@signal-fall/agent/src/act';
import { observe, unitIds } from '@signal-fall/agent/src/observe';

test('a replay of an AI agent match marks the agent', async ({ page }, info) => {
  // An agent opens like the guide says, against the easy AI, for two minutes.
  const m = new AgentMatch({
    factions: [1, 0],
    seats: [{ kind: 'agent', agent: { name: 'Test Agent', model: 'scripted' } }, { kind: 'ai', difficulty: 'easy' }],
    seed: 21,
    map: { size: 'S' },
  });
  const { seat } = m.claim(0);
  const o = observe(m, seat);
  const deploy = translate(m.sim.world, seat, { do: 'deploy', units: [unitIds(o)[0]!] });
  if ('cmd' in deploy) m.queue(seat, [deploy.cmd]);
  for (let turn = 0; turn < 24; turn++) void m.endTurn(seat);
  const file = info.outputPath('agent-replay.json');
  writeFileSync(file, JSON.stringify(m.replay(0)));

  await page.goto('/play/');
  await page.setInputFiles('[data-testid=watch-replay] input', file);
  const seats = page.getByTestId('replay-seats');
  await expect(seats).toContainText('AI agent', { timeout: 20_000 });
  await expect(seats).toContainText('Test Agent');
  await expect(seats).toContainText('AI (Easy)');
  await expect(seats.locator('.seat.agent')).toHaveAttribute('title', /scripted/);
  await page.getByTestId('replay-bar').getByText('8×').click();
  await expect(page.getByTestId('replay-verified')).toBeVisible({ timeout: 60_000 });
});
