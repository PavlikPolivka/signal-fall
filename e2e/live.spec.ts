import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { AgentMatch } from '@signal-fall/agent/src/match';
import { MatchManager } from '@signal-fall/agent/src/server';
import { spectate } from '@signal-fall/agent/src/spectate';
import { translate } from '@signal-fall/agent/src/act';
import { observe } from '@signal-fall/agent/src/observe';

type W = { __signalFall: { state: { cur: { tick: number } | null; replay: { live?: boolean } | null } } };

test('follow an agent match live, to the verified end', async ({ page }) => {
  test.setTimeout(120_000);
  const manager = new MatchManager();
  let server!: Server;
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (!spectate(manager, base, req, res)) res.writeHead(404).end();
    }).listen(0, resolve);
  });
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const match = new AgentMatch({
    factions: [2, 0],
    seats: [{ kind: 'agent', agent: { name: 'Live Agent' } }, { kind: 'ai', difficulty: 'easy' }],
    seed: 5,
    map: { size: 'S' },
    turnTicks: 40,
  });
  manager.matches.set(match.id, match);
  const { seat } = match.claim(0);
  const deploy = translate(match.sim.world, seat, { do: 'deploy', units: [observe(match, seat).units[0]!.id] });
  if ('cmd' in deploy) match.queue(seat, [deploy.cmd]);
  for (let i = 0; i < 5; i++) await match.endTurn(seat);

  // The browser joins mid-match and catches up.
  await page.goto(`/play/?watch=${encodeURIComponent(`${base}/matches/${match.id}/stream`)}`);
  await expect(page.getByTestId('live-badge')).toContainText('Live', { timeout: 20_000 });
  await expect(page.getByTestId('replay-seats')).toContainText('Live Agent');
  // Turns keep coming; the watcher follows.
  const timer = setInterval(() => void match.endTurn(seat), 250);
  await page.waitForFunction(() => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > 400, null, { timeout: 60_000 });
  clearInterval(timer);
  // The agent gives up: the stream ends with the final hash and the watcher verifies it.
  const surrender = translate(match.sim.world, seat, { do: 'surrender' });
  if ('cmd' in surrender) match.queue(seat, [surrender.cmd]);
  await match.endTurn(seat);
  expect(match.over).toBe(true);
  await page.getByTestId('replay-bar').getByText('8×').click();
  await expect(page.getByTestId('live-badge')).toContainText('Ended', { timeout: 20_000 });
  await expect(page.getByTestId('replay-verified')).toBeVisible({ timeout: 60_000 });
  server.close();
});
