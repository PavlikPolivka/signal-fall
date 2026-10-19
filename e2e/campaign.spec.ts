import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('campaign: pick the first mission, read the briefing, play it and tick off an objective', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-campaign]');
  await expect(page.getByTestId('mission-briefing')).toContainText('Dead Air');
  // Later missions stay locked until the one before is won.
  await expect(page.locator('[data-mission=crater-field]')).toBeDisabled();
  // One act at a time, in tabs.
  await expect(page.locator('[data-mission=initialization]')).toHaveCount(0);
  await page.click('[data-testid=act-tabs] [data-act="2"]');
  await expect(page.locator('[data-mission=initialization]')).toBeVisible();
  await page.screenshot({ path: 'test-results/campaign-list.png' });
  await page.click('[data-testid=act-tabs] [data-act="1"]');
  await page.click('[data-testid=mission-start]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur, null, { timeout: 30_000 });
  await expect(page.getByTestId('mission-panel')).toContainText('Deploy the Homestead');
  // Only what this mission unlocks shows in the sidebar.
  await page.keyboard.press('KeyV');
  await expect(page.locator('[data-item=bulldog]')).toHaveCount(0);
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h) && s.ruleOf(h).id === 'homestead') return s.select([h]);
    }
  });
  await page.keyboard.press('KeyD');
  await expect(page.locator('[data-testid=mission-panel] [data-objective="0"]')).toHaveClass(/done/, { timeout: 20_000 });
});

test('campaign: objectives are marked on the map, and clicking one looks at it', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-campaign]');
  // The difficulty choice is kept for the missions.
  await page.click('[data-testid=campaign-difficulty] [data-difficulty=hard]');
  await expect(page.locator('[data-testid=campaign-difficulty] [data-difficulty=hard]')).toHaveClass(/active/);
  await page.goto('/play/?mission=cut-the-cable');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur, null, { timeout: 30_000 });
  await expect(page.getByTestId('mission-panel')).toContainText('Hard');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.cur.markers().length >= 3, null, { timeout: 20_000 });
  const before = await page.evaluate(() => (window as unknown as Win).__signalFall.state.cur.markers().filter((m: { objective: number }) => m.objective === 1).length);
  expect(before).toBe(3);
  await page.locator('[data-testid=mission-panel] [data-objective="1"] button').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/campaign-markers.png' });
});

test('campaign: Next mission opens its briefing, read aloud, with the mission list a click away', async ({ page }) => {
  await page.goto('/play/?menu=campaign&brief=diesel-and-iron');
  await expect(page.getByTestId('mission-briefing')).toContainText('Mission 2');
  await expect(page.getByTestId('mission-briefing')).toContainText('Diesel and Iron');
  await expect(page.locator('.campaign-list')).toHaveCount(0);
  // The mission's painting heads the briefing.
  await expect.poll(() => page.locator('.briefing-art img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: 'test-results/campaign-briefing.png' });
  await page.click('[data-testid=all-missions]');
  await expect(page.locator('.campaign-list')).toBeVisible();
  await expect(page.locator('[data-mission=diesel-and-iron]')).toHaveClass(/active/);
});

test('fullscreen survives going from a match to the menus and into the next match', async ({ page }) => {
  await page.goto('/play/?mission=dead-air');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur, null, { timeout: 30_000 });
  await page.evaluate(() => document.documentElement.requestFullscreen());
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.send({ type: 'surrender' }));
  await page.click('[data-testid=end-campaign]');
  const frame = page.frameLocator('[data-testid=screen-frame]');
  await expect(frame.getByTestId('mission-briefing')).toBeVisible();
  await expect(page).toHaveURL(/menu=campaign/);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await frame.getByTestId('mission-start').click();
  await expect(frame.getByTestId('mission-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/mission=/);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
});

test('menus have a fullscreen button in the corner', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=menu-fullscreen]');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.click('[data-testid=menu-fullscreen]');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
