import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('first-match tips follow progress and can be hidden', async ({ page }) => {
  await page.goto('/?seed=3&size=S&ai=easy&speed=4');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await expect(page.getByTestId('hints')).toContainText('deploy');
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
  await expect(page.getByTestId('hints')).toContainText('build power', { ignoreCase: true, timeout: 10_000 });
  await page.getByTestId('hints').getByRole('button').click();
  await expect(page.getByTestId('hints')).toHaveCount(0);
});

test('settings persist across reloads', async ({ page }) => {
  await page.goto('/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.keyboard.press('Backquote');
  await page.getByTestId('setting-effects-reduced').click();
  await page.getByTestId('setting-scroll').fill('150');
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const settings = await page.evaluate(() => (window as unknown as Win).__signalFall.state.settings);
  expect(settings).toMatchObject({ effects: 'reduced', scrollSpeed: 1.5 });
});
