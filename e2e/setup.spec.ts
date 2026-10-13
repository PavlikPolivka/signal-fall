import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('skirmish setup starts a game with the chosen options', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid=open-skirmish]');
  await expect(page.locator('[data-testid=setup]')).toBeVisible();
  await page.click('[data-testid=biome] [data-value=city]');
  await page.click('[data-testid=size] [data-value=S]');
  await page.click('[data-testid=difficulty] [data-value=easy]');
  await page.fill('[data-testid=seed]', '4242');
  await page.locator('[data-testid=seed]').dispatchEvent('change');
  await expect(page.locator('[data-testid=map-preview]')).toBeVisible();
  await page.click('[data-testid=start]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.ready);
  const st = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    return { biome: s.biome, width: s.width, players: s.players.length };
  });
  expect(st).toEqual({ biome: 'city', width: 96, players: 2 });
  // Settings are remembered for next time.
  await page.goto('/');
  await page.click('[data-testid=open-skirmish]');
  await expect(page.locator('[data-testid=biome] [data-value=city]')).toHaveClass(/active/);
  // Back returns to the main menu.
  await page.click('[data-testid=back]');
  await expect(page.getByTestId('home')).toBeVisible();
});

test('the menu backdrop video keeps playing across menu screens', async ({ page }) => {
  await page.goto('/');
  const video = page.locator('.menu-backdrop video.on');
  // The loop video is optional (the key art stays without it).
  await video.first().waitFor({ timeout: 5000 }).catch(() => undefined);
  test.skip((await video.count()) === 0, 'no menu video in this build');
  await page.evaluate(() => ((document.querySelector('.menu-backdrop video.on') as HTMLVideoElement & { tag?: number }).tag = 1));
  const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.click('[data-testid=open-skirmish]');
  await page.click('[data-testid=back]');
  await page.click('[data-testid=open-multiplayer]');
  // Same element, still running: no restart, no blink.
  expect(await page.locator('.menu-backdrop').count()).toBe(1);
  expect(await page.locator('.menu-backdrop video').count()).toBe(2);
  const after = await page.evaluate(() => {
    const v = Array.from(document.querySelectorAll<HTMLVideoElement & { tag?: number }>('.menu-backdrop video')).find((x) => x.tag === 1)!;
    return { t: v.currentTime, paused: v.paused };
  });
  expect(after.paused).toBe(false);
  expect(after.t).toBeGreaterThan(before);
});
