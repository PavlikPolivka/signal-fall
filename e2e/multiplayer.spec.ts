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
  const hostContext = await browser.newContext();
  const guestContext = online ? await browser.newContext() : hostContext;
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  for (const p of [host, guest]) p.on('pageerror', (e) => console.error(e.message));

  await host.goto(`/?netsim=${NETSIM}`);
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  await guest.goto(`/?netsim=${NETSIM}`);
  await guest.click('[data-testid=open-multiplayer]');
  await guest.fill('[data-testid=mp-code]', code);
  await guest.click('[data-testid=mp-join]');
  await guest.click('[data-testid=mp-faction] [data-value=choir]');

  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 20_000 });
  await expect(host.getByTestId('lobby')).toContainText('Choir');
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
  await hostContext.close();
  if (online) await guestContext.close();
});
