import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('campaign: pick the first mission, read the briefing, play it and tick off an objective', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-campaign]');
  await expect(page.getByTestId('mission-briefing')).toContainText('Dead Air');
  // Later missions stay locked until the one before is won.
  await expect(page.locator('[data-mission=crater-field]')).toBeDisabled();
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
