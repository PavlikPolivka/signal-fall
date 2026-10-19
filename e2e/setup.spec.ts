import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('skirmish setup starts a game with the chosen options', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-skirmish]');
  await expect(page.locator('[data-testid=setup]')).toBeVisible();
  await page.click('[data-testid=biome] [data-value=city]');
  await page.click('[data-testid=size] [data-value=S]');
  await page.click('[data-testid=difficulty] [data-value=easy]');
  await page.fill('[data-testid=seed]', '4242');
  await expect(page.locator('[data-testid=map-preview]')).toBeVisible();
  await page.click('[data-testid=start]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.ready);
  const st = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    return { biome: s.biome, width: s.width, players: s.players.length };
  });
  expect(st).toEqual({ biome: 'city', width: 96, players: 2 });
  // Settings are remembered for next time.
  await page.goto('/play/');
  await page.click('[data-testid=open-skirmish]');
  await expect(page.locator('[data-testid=biome] [data-value=city]')).toHaveClass(/active/);
  // Back returns to the main menu.
  await page.click('[data-testid=back]');
  await expect(page.getByTestId('home')).toBeVisible();
});

test('the menu backdrop video keeps playing across menu screens', async ({ page }) => {
  await page.goto('/play/');
  const video = page.locator('.menu-backdrop video.on');
  // The loop video is optional (the key art stays without it).
  await video.first().waitFor({ timeout: 5000 }).catch(() => undefined);
  test.skip((await video.count()) === 0, 'no menu video in this build');
  // Tag both video elements; a remount would replace them.
  await page.evaluate(() => document.querySelectorAll<HTMLVideoElement & { tag?: number }>('.menu-backdrop video').forEach((v) => (v.tag = 1)));
  await page.click('[data-testid=open-skirmish]');
  await page.click('[data-testid=back]');
  await page.click('[data-testid=open-multiplayer]');
  // Same elements, and one of them is playing (the loop may have crossfaded to the other meanwhile).
  expect(await page.locator('.menu-backdrop').count()).toBe(1);
  const state = () =>
    page.evaluate(() => {
      const vs = Array.from(document.querySelectorAll<HTMLVideoElement & { tag?: number }>('.menu-backdrop video'));
      return { count: vs.length, tagged: vs.filter((v) => v.tag === 1).length, playing: vs.filter((v) => !v.paused).length };
    });
  expect(await state()).toMatchObject({ count: 2, tagged: 2 });
  // Polled: mid-crossfade on a slow software-rendered runner, neither may be playing for a moment.
  await expect.poll(async () => (await state()).playing, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('free-for-all: four players, each on their own team', async ({ page }) => {
  await page.goto('/play/?mode=ffa4&ai=easy');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur);
  const teams = await page.evaluate(() => (window as unknown as { __signalFall: { state: { players: { team: number }[] } } }).__signalFall.state.players.map((p) => p.team));
  expect(teams).toEqual([0, 1, 2, 3]);
});

test('the daily challenge starts the same match for everyone today', async ({ page }) => {
  await page.goto('/play/');
  await expect(page.getByTestId('daily')).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png' });
  await page.click('[data-testid=open-daily]');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur);
  const st = await page.evaluate(() => {
    const s = (window as unknown as { __signalFall: { state: { daily: string | null; players: unknown[] } } }).__signalFall.state;
    return { daily: s.daily, players: s.players.length };
  });
  expect(st.daily).toContain('vs');
  expect(st.players).toBe(2);
});

test('a hand-made map can be picked for a skirmish', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-skirmish]');
  const option = page.locator('[data-testid=map-pick] option', { hasText: 'Crossroads' });
  await page.selectOption('[data-testid=map-pick]', { value: (await option.getAttribute('value'))! });
  await expect(page.getByTestId('seed')).toHaveCount(0);
  await page.click('[data-testid=start]');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur, null, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __signalFall: { state: { width: number; biome: string } } }).__signalFall.state.width)).toBe(128);
});

test('survival: the wave counter shows the waves to come', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-skirmish]');
  await page.click('[data-testid=mode] [data-value=survival]');
  await page.click('[data-testid=start]');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur, null, { timeout: 30_000 });
  await expect(page.getByTestId('wave-counter')).toContainText('Wave 0/15');
});
