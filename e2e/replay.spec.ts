import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('save a replay from a match, load it, and it reproduces the final state', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?seed=11&size=S&ai=easy&speed=4');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  // Play a little: deploy the construction vehicle, start a power plant.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    const c = s.cur;
    const own: number[] = [];
    for (let i = 0; i < c.entityCount; i++) {
      const h = c.get(c.ent(i), 0);
      if (s.isOwn(h) && s.isUnit(h)) own.push(h);
    }
    s.send({ type: 'deploy', units: own });
  });
  await page.waitForTimeout(2000);
  await page.keyboard.press('KeyB');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(6000);

  await page.keyboard.press('Backquote');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=menu-save-replay]')]);
  const file = await download.path();

  await page.goto('/');
  await page.setInputFiles('[data-testid=watch-replay] input', file);
  await expect(page.getByTestId('replay-bar')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('replay-bar').getByText('8×').click();
  await expect(page.getByTestId('replay-verified')).toBeVisible({ timeout: 90_000 });
});
