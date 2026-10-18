import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('the tutorial walks through the first steps as they are done', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-tutorial]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const step = () => page.getByTestId('tutorial').getAttribute('data-step');
  await expect(page.getByTestId('tutorial')).toContainText('Look around');
  // 1. Move the camera.
  await page.evaluate(() => (window as unknown as Win).__signalFall.renderer.camera.x += 600);
  await expect.poll(step).toBe('1');
  // 2. Deploy.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h)) return s.select([h]);
    }
  });
  await page.keyboard.press('KeyD');
  await expect.poll(step, { timeout: 20_000 }).toBe('2');
  await expect(page.getByTestId('tutorial')).toContainText('Power');
  // The first-match tips stay out of the way.
  await expect(page.getByTestId('hints')).toHaveCount(0);
});
