import { expect, test, type Page } from '@playwright/test';

// Two clients in one browser: BroadcastChannel signaling, a real WebRTC data channel,
// and both sides' outgoing traffic degraded to 150 ms one-way latency, 40 ms jitter and 5% loss.
const NETSIM = `150,40,5${process.env.MP_RELAY ? '&relay=1' : ''}`;

async function tick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __signalFall: { state: { cur: { tick: number } | null } } }).__signalFall.state.cur?.tick ?? 0);
}

/** Send a few orders for this client's own units: deploy, then wander. */
async function play(page: Page, round: number): Promise<void> {
  await page.evaluate((k) => {
    interface View {
      entityCount: number;
      ent(i: number): number;
      get(o: number, f: number): number;
    }
    const s = (
      window as unknown as {
        __signalFall: { state: { cur: View; isOwn(h: number): boolean; isUnit(h: number): boolean; send(c: unknown): void } };
      }
    ).__signalFall.state;
    const c = s.cur;
    const own: number[] = [];
    for (let i = 0; i < c.entityCount; i++) {
      const h = c.get(c.ent(i), 0);
      if (s.isOwn(h) && s.isUnit(h)) own.push(h);
    }
    if (own.length === 0) return;
    if (k === 0) s.send({ type: 'deploy', units: own });
    else s.send({ type: 'move', units: own, x: ((k * 7) % 40 + 20) * 1024, y: ((k * 13) % 40 + 20) * 1024 });
  }, round);
}

test('two clients play a networked match over a lossy link without desync', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.setTimeout(240_000);
  // Online (Supabase signaling): two separate browser profiles, like two players. Offline: two tabs of one profile.
  const online = !!process.env.SUPABASE_URL;
  // Small windows: on CI the pages render in software, and full-size frames starve the lockstep loop.
  const small = { viewport: { width: 640, height: 400 } };
  const hostContext = await browser.newContext(small);
  const guestContext = online ? await browser.newContext(small) : hostContext;
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  for (const p of [host, guest]) p.on('pageerror', (e) => console.error(e.message));

  await host.goto(`/play/?netsim=${NETSIM}`);
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  await guest.goto(`/play/?netsim=${NETSIM}`);
  await guest.click('[data-testid=open-multiplayer]');
  await guest.fill('[data-testid=mp-code]', code);
  await guest.click('[data-testid=mp-join]');
  await guest.click('[data-testid=mp-faction] [data-value=choir]');

  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 20_000 });
  await expect(host.getByTestId('lobby')).toContainText('Choir');
  // The host picks the map; the guest sees it (read-only).
  await host.click('[data-testid=mp-map] [data-testid=size] [data-value=S]');
  await host.fill('[data-testid=mp-map] [data-testid=seed]', '777');
  await host.locator('[data-testid=mp-map] [data-testid=seed]').dispatchEvent('change');
  await expect(guest.locator('[data-testid=mp-map] [data-testid=size] [data-value=S]')).toHaveClass(/active/);
  await expect(guest.locator('[data-testid=mp-map] [data-testid=seed]')).toHaveValue('777');
  await expect(guest.locator('[data-testid=mp-map] [data-testid=seed-random]')).toHaveCount(0);
  await host.click('[data-testid=mp-start]');

  for (const p of [host, guest]) await p.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall.state.cur !== null);
  for (let round = 0; round < 12; round++) {
    await play(host, round);
    await play(guest, round + 100);
    await host.waitForTimeout(1500);
  }
  // Both advance past several hash exchanges (every 100 ticks) however slow the machine renders, and agree.
  for (const p of [host, guest])
    await p.waitForFunction(() => ((window as unknown as { __signalFall: { state: { cur: { tick: number } | null } } }).__signalFall.state.cur?.tick ?? 0) > 400, null, {
      timeout: 90_000,
    });
  const [a, b] = [await tick(host), await tick(guest)];
  expect(Math.min(a, b)).toBeGreaterThan(400);
  for (const p of [host, guest]) {
    await expect(p.getByTestId('desync')).toHaveCount(0);
    await expect(p.getByTestId('net-badge')).toContainText('ping');
    // The simulated 150 ms each way is really there.
    const rtt = await p.evaluate(() => (window as unknown as { __signalFall: { state: { net: { rtt: number } | null } } }).__signalFall.state.net?.rtt ?? 0);
    expect(rtt).toBeGreaterThan(250);
  }
  // Each client controls a different side.
  const slots = await Promise.all([host, guest].map((p) => p.evaluate(() => (window as unknown as { __signalFall: { state: { localPlayer: number } } }).__signalFall.state.localPlayer)));
  expect(slots).toEqual([0, 1]);

  // The guest gives up: both see the end, and online the match is recorded and rated.
  await guest.evaluate(() => (window as unknown as { __signalFall: { state: { send: (c: unknown) => void } } }).__signalFall.state.send({ type: 'surrender' }));
  for (const p of [host, guest]) await expect(p.getByTestId('end-screen')).toBeVisible({ timeout: 30_000 });
  if (online) {
    await host.waitForTimeout(2000);
    await host.goto('/play/');
    await host.click('[data-testid=open-stats]');
    await expect(host.getByTestId('stats-history')).toContainText('Win');
    await expect(host.getByTestId('stats-history')).toContainText('rated');
  }
  await hostContext.close();
  if (online) await guestContext.close();
});

test('2v2: three people and an AI over a full mesh stay in sync', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!!process.env.SUPABASE_URL, 'offline mesh test (one browser profile)');
  test.setTimeout(240_000);
  // Three software-rendered tabs starve a small CI runner: keep each one tiny (render cost follows pixels).
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const [host, a, b] = await Promise.all([ctx.newPage(), ctx.newPage(), ctx.newPage()]);
  for (const p of [host, a, b]) p.on('pageerror', (e) => console.error(e.message));

  await host.goto(`/play/?netsim=${NETSIM}`);
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  await host.click('[data-testid=mp-mode] [data-value="2v2"]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  for (const p of [a, b]) {
    await p.goto(`/play/?netsim=${NETSIM}`);
    await p.click('[data-testid=open-multiplayer]');
    await p.fill('[data-testid=mp-code]', code);
    await p.click('[data-testid=mp-join]');
    await expect(p.getByTestId('lobby')).toBeVisible();
  }
  // Seats fill in order: Bob next to the host, Cat on the other team; Cat moves to the last seat.
  await expect(host.getByTestId('seat-2')).not.toHaveClass(/open/, { timeout: 15_000 });
  await b.click('[data-testid=seat-3-take]');
  await expect(host.getByTestId('seat-2')).toHaveClass(/open/);
  await host.click('[data-testid=seat-2-ai]');
  await host.selectOption('[data-testid=seat-2-difficulty]', 'easy');
  await b.click('[data-testid=mp-faction] [data-value=halcyon]');
  await expect(a.getByTestId('seat-2')).toContainText('easy');
  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 30_000 });
  await host.click('[data-testid=mp-start]');

  type W = { __signalFall: { state: { cur: { tick: number } | null; localPlayer: number; players: { team: number; faction: number }[] } } };
  for (const p of [host, a, b]) await p.waitForFunction(() => (window as unknown as W).__signalFall.state.cur !== null, null, { timeout: 30_000 });
  for (let round = 0; round < 4; round++) {
    for (const [i, p] of [host, a, b].entries()) await play(p, round + i * 100);
    await host.waitForTimeout(1500);
  }
  for (const p of [host, a, b]) await p.waitForFunction(() => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > 300, null, { timeout: 120_000 });
  const views = await Promise.all(
    [host, a, b].map((p) =>
      p.evaluate(() => {
        const s = (window as unknown as W).__signalFall.state;
        return { slot: s.localPlayer, teams: s.players.map((x) => x.team), factions: s.players.map((x) => x.faction) };
      }),
    ),
  );
  expect(views.map((v) => v.slot)).toEqual([0, 1, 3]);
  for (const v of views) {
    expect(v.teams).toEqual([0, 0, 1, 1]);
    expect(v.factions[3]).toBe(1); // Cat picked Halcyon
  }
  for (const p of [host, a, b]) await expect(p.getByTestId('desync')).toHaveCount(0);
  await ctx.close();
});
