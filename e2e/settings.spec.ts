import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('first-match tips follow progress and can be hidden', async ({ page }) => {
  await page.goto('/play/?seed=3&size=S&ai=easy&speed=4');
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
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.keyboard.press('Backquote');
  await page.getByTestId('menu-section-graphics').click();
  await page.getByTestId('setting-effects-reduced').click();
  await page.getByTestId('menu-section-controls').click();
  await page.getByTestId('setting-scroll').fill('150');
  await page.reload();
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const settings = await page.evaluate(() => (window as unknown as Win).__signalFall.state.settings);
  expect(settings).toMatchObject({ effects: 'reduced', scrollSpeed: 1.5 });
});

test('a key can be rebound in the menu and works in game', async ({ page }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type W = { __signalFall: any };
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as W).__signalFall?.state?.cur);
  await page.keyboard.press('Backquote');
  await page.screenshot({ path: 'test-results/pause-menu.png' });
  await page.getByTestId('menu-section-controls').click();
  await page.click('[data-testid=menu-keys]');
  await page.click('[data-action=stop]');
  await page.keyboard.press('KeyK');
  await expect(page.locator('[data-action=stop]')).toHaveText('K');
  // A clash is refused.
  await page.click('[data-action=hold]');
  await page.keyboard.press('KeyK');
  await expect(page.getByTestId('keys')).toContainText('already does');
  await page.keyboard.press('Escape');
  await page.getByText('Done').click();
  await page.keyboard.press('Backquote');
  await page.evaluate(() => {
    const s = (window as unknown as W).__signalFall.state;
    const out: number[] = [];
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h) && s.isUnit(h)) out.push(h);
    }
    s.select(out);
  });
  await page.keyboard.press('KeyK');
  expect(await page.evaluate(() => (window as unknown as W).__signalFall.state.sent.at(-1)?.type)).toBe('stop');
  await page.evaluate(() => localStorage.removeItem('signalfall.settings'));
});

test('money left idle for a minute gets a tip to spend it', async ({ page }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type W = { __signalFall: any };
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as W).__signalFall?.state?.cur);
  await page.evaluate(() => (window as unknown as W).__signalFall.state.post({ type: 'speed', speed: 8 }));
  await expect(page.getByTestId('hint-situation')).toContainText('sitting idle', { timeout: 30_000 });
});

test('reduced flashing calms the interface and stays set', async ({ page }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type W = { __signalFall: any };
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as W).__signalFall?.state?.cur);
  await page.keyboard.press('Backquote');
  await page.getByTestId('menu-section-interface').click();
  await page.getByTestId('setting-calmFlashes-on').click();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-calm'))).toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as W).__signalFall?.state?.cur);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-calm'))).toBe(true);
});
