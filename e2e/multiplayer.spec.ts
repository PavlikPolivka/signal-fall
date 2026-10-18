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

  // Chat: Enter, type, Enter; the other side reads it. Alt+click pings the map for your team.
  await host.keyboard.press('Enter');
  await host.fill('[data-testid=chat-input]', 'gl hf');
  await host.press('[data-testid=chat-input]', 'Enter');
  await expect(guest.getByTestId('chat')).toContainText('gl hf');
  const box = (await host.locator('[data-testid=game] canvas').boundingBox())!;
  // Pings are for teammates: the host sees its own, the opponent nothing.
  const pings = (p: Page) => p.evaluate(() => (window as unknown as { __signalFall: { state: { mapPings: unknown[] } } }).__signalFall.state.mapPings.length);
  // A slow software-rendered page can drop the first click: try until one lands.
  await expect
    .poll(async () => {
      await host.keyboard.down('Alt');
      await host.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await host.keyboard.up('Alt');
      const n = await pings(host);
      return n;
    }, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await guest.waitForTimeout(1500);
  expect(await pings(guest)).toBe(0);

  // The guest gives up: both see the end, and online the match is recorded and rated.
  await guest.evaluate(() => (window as unknown as { __signalFall: { state: { send: (c: unknown) => void } } }).__signalFall.state.send({ type: 'surrender' }));
  for (const p of [host, guest]) await expect(p.getByTestId('end-screen')).toBeVisible({ timeout: 30_000 });
  if (!online) {
    // Rematch: both go back to the same room, the guest keeps its seat and faction, the map is kept.
    await host.click('[data-testid=end-mp-rematch]');
    await guest.click('[data-testid=end-mp-rematch]');
    await expect(host.getByTestId('room-code')).toHaveText(code, { timeout: 20_000 });
    await expect(host.getByTestId('seat-1')).toContainText('Choir', { timeout: 20_000 });
    await expect(guest.locator('[data-testid=mp-map] [data-testid=seed]')).toHaveValue('777');
    await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 20_000 });
  }
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
  // A team ping reaches the teammate (Bob), not the other team (Cat).
  await host.evaluate(() => (window as unknown as { __signalFall: { state: { sendChat: (t: string, team: boolean, at: unknown) => void } } }).__signalFall.state.sendChat('', true, { x: 30 * 1024, y: 30 * 1024 }));
  const pings = (p: Page) => p.evaluate(() => (window as unknown as { __signalFall: { state: { mapPings: unknown[] } } }).__signalFall.state.mapPings.length);
  await expect.poll(() => pings(a)).toBe(1);
  expect(await pings(b)).toBe(0);
  await ctx.close();
});

test('a player who leaves can be replaced by the AI, and the match goes on', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!!process.env.SUPABASE_URL, 'offline test (one browser profile)');
  test.setTimeout(180_000);
  type W = { __signalFall: { state: { cur: { tick: number } | null; seats: { label: string }[] } } };
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const [host, guest] = await Promise.all([ctx.newPage(), ctx.newPage()]);
  await host.goto('/play/');
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  await guest.goto('/play/');
  await guest.click('[data-testid=open-multiplayer]');
  await guest.fill('[data-testid=mp-code]', code);
  await guest.click('[data-testid=mp-join]');
  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 20_000 });
  await host.click('[data-testid=mp-start]');
  await host.waitForFunction(() => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > 100, null, { timeout: 60_000 });
  await guest.close();
  await expect(host.getByTestId('peer-lost')).toBeVisible({ timeout: 30_000 });
  const stalled = await host.evaluate(() => (window as unknown as W).__signalFall.state.cur!.tick);
  await host.click('[data-testid=replace-with-ai]');
  await expect(host.getByTestId('peer-lost')).toHaveCount(0, { timeout: 10_000 });
  await host.waitForFunction((t) => (window as unknown as W).__signalFall.state.cur!.tick > t + 100, stalled, { timeout: 60_000 });
  expect(await host.evaluate(() => (window as unknown as W).__signalFall.state.seats[1]?.label)).toContain('AI');
  await ctx.close();
});

test('a public room shows in Open games and can be joined from there', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!process.env.SUPABASE_URL, 'needs the backend (room listing)');
  test.setTimeout(120_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await host.goto('/play/');
  await host.click('[data-testid=open-multiplayer]');
  await host.fill('[data-testid=mp-name]', 'Lister');
  await host.click('[data-testid=mp-create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  await host.check('[data-testid=mp-public] input');
  await guest.goto('/play/');
  await guest.click('[data-testid=open-multiplayer]');
  await expect(guest.getByTestId(`open-game-${code}`)).toBeVisible({ timeout: 20_000 });
  await guest.click(`[data-testid=open-game-${code}]`);
  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 30_000 });
  await hostCtx.close();
  await guestCtx.close();
});

test('a spectator joins with the code and watches the match as it is played', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!!process.env.SUPABASE_URL, 'offline test (one browser profile)');
  test.setTimeout(180_000);
  type W = { __signalFall: { state: { cur: { tick: number; a: Int32Array } | null; send: (c: unknown) => void; spectator: boolean } } };
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const [host, guest, watcher] = await Promise.all([ctx.newPage(), ctx.newPage(), ctx.newPage()]);
  await host.goto('/play/');
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  await guest.goto('/play/');
  await guest.click('[data-testid=open-multiplayer]');
  await guest.fill('[data-testid=mp-code]', code);
  await guest.click('[data-testid=mp-join]');
  await watcher.goto('/play/');
  await watcher.click('[data-testid=open-multiplayer]');
  await watcher.fill('[data-testid=mp-name]', 'Fan');
  await watcher.fill('[data-testid=mp-code]', code);
  await watcher.click('[data-testid=mp-watch]');
  await expect(host.getByTestId('mp-spectators')).toContainText('Fan', { timeout: 20_000 });
  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 30_000 });
  await host.click('[data-testid=mp-start]');
  await watcher.waitForFunction(() => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > 200, null, { timeout: 90_000 });
  expect(await watcher.evaluate(() => (window as unknown as W).__signalFall.state.spectator)).toBe(true);
  // The players never wait on the spectator, and the end reaches it too.
  await guest.evaluate(() => (window as unknown as W).__signalFall.state.send({ type: 'surrender' }));
  await expect(watcher.getByTestId('end-screen')).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

test('a player who reloads the page rejoins the running match and stays in sync', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!!process.env.SUPABASE_URL, 'offline test (one browser profile)');
  test.setTimeout(180_000);
  type W = { __signalFall: { state: { cur: { tick: number } | null; send: (c: unknown) => void; localPlayer: number } } };
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const [host, guest] = await Promise.all([ctx.newPage(), ctx.newPage()]);
  for (const p of [host, guest]) p.on('pageerror', (e) => console.error(e.message));
  await host.goto('/play/');
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  await guest.goto('/play/');
  await guest.click('[data-testid=open-multiplayer]');
  await guest.fill('[data-testid=mp-code]', code);
  await guest.click('[data-testid=mp-join]');
  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 20_000 });
  await host.click('[data-testid=mp-start]');
  await guest.waitForFunction(() => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > 150, null, { timeout: 60_000 });
  await play(host, 0);
  await play(guest, 100);
  await host.waitForTimeout(1000);
  const before = await host.evaluate(() => (window as unknown as W).__signalFall.state.cur!.tick);
  await guest.reload();
  // Back in the match, in the same seat, past where it was, and in step with the host.
  await guest
    .waitForFunction((t) => ((window as unknown as W).__signalFall?.state?.cur?.tick ?? 0) > t + 250, before, { timeout: 90_000 })
    .catch(async (e: unknown) => {
      // On failure, show where each side is stuck (tick, who it waits on).
      type D = { __signalFall?: { state?: { cur?: { tick: number }; net?: unknown; peerLost?: boolean } } };
      const info = await Promise.all([host, guest].map((p) => p.evaluate(() => { const s = (window as unknown as D).__signalFall?.state; return { tick: s?.cur?.tick, net: s?.net, lost: s?.peerLost }; })));
      console.log('rejoin stuck', before, JSON.stringify(info));
      throw e;
    });
  expect(await guest.evaluate(() => (window as unknown as W).__signalFall.state.localPlayer)).toBe(1);
  await play(guest, 101);
  await host.waitForFunction((t) => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > t + 400, before, { timeout: 90_000 });
  for (const p of [host, guest]) await expect(p.getByTestId('desync')).toHaveCount(0);
  await expect(host.getByTestId('peer-lost')).toHaveCount(0);
  await ctx.close();
});

test('two players in the ranked queue are paired and the match starts by itself', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!process.env.SUPABASE_URL, 'needs the backend (queue)');
  test.setTimeout(120_000);
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 640, height: 400 } }), browser.newContext({ viewport: { width: 640, height: 400 } })]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const p of pages) {
    await p.goto('/play/');
    await p.click('[data-testid=open-multiplayer]');
    await p.click('[data-testid=mp-ranked]');
  }
  for (const p of pages) await p.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall.state.cur !== null, null, { timeout: 60_000 });
  const slots = await Promise.all(pages.map((p) => p.evaluate(() => (window as unknown as { __signalFall: { state: { localPlayer: number } } }).__signalFall.state.localPlayer)));
  expect(slots.sort()).toEqual([0, 1]);
  for (const c of contexts) await c.close();
});

test('free-for-all: three people, three teams, in sync', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebRTC loopback is exercised in Chromium');
  test.skip(!!process.env.SUPABASE_URL, 'offline mesh test (one browser profile)');
  test.setTimeout(180_000);
  type W = { __signalFall: { state: { cur: { tick: number } | null; players: { team: number }[]; localPlayer: number } } };
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const [host, a, b] = await Promise.all([ctx.newPage(), ctx.newPage(), ctx.newPage()]);
  await host.goto('/play/');
  await host.click('[data-testid=open-multiplayer]');
  await host.click('[data-testid=mp-create]');
  await host.click('[data-testid=mp-mode] [data-value="ffa3"]');
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  for (const p of [a, b]) {
    await p.goto('/play/');
    await p.click('[data-testid=open-multiplayer]');
    await p.fill('[data-testid=mp-code]', code);
    await p.click('[data-testid=mp-join]');
  }
  await expect(host.getByTestId('mp-start')).toBeEnabled({ timeout: 30_000 });
  await host.click('[data-testid=mp-start]');
  for (const p of [host, a, b]) await p.waitForFunction(() => ((window as unknown as W).__signalFall.state.cur?.tick ?? 0) > 250, null, { timeout: 120_000 });
  const views = await Promise.all([host, a, b].map((p) => p.evaluate(() => ({ teams: (window as unknown as W).__signalFall.state.players.map((x) => x.team), me: (window as unknown as W).__signalFall.state.localPlayer }))));
  expect(views.map((v) => v.me).sort()).toEqual([0, 1, 2]);
  for (const v of views) expect(v.teams).toEqual([0, 1, 2]);
  for (const p of [host, a, b]) await expect(p.getByTestId('desync')).toHaveCount(0);
  await ctx.close();
});
