import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('save a skirmish and continue it from the main menu', async ({ page }) => {
  await page.goto('/play/?speed=4&ai=none');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  // Deploy the construction vehicle, so the save has an order in it.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h)) return s.select([h]);
    }
  });
  await page.keyboard.press('KeyD');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.roles().get('conyard') === 1);
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.cur.tick > 300);
  await page.keyboard.press('Backquote');
  await page.click('[data-testid=menu-save-game]');
  await expect(page.getByTestId('alert')).toContainText('Game saved');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('signalfall.save')!).meta.tick as number);

  await page.goto('/play/');
  await page.click('[data-testid=continue]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const st = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    return { tick: s.cur.tick as number, conyard: s.roles().get('conyard') as number };
  });
  expect(st.tick).toBeGreaterThanOrEqual(saved);
  expect(st.conyard).toBe(1);
  // Play goes on: the clock keeps running after the fast-forward.
  await page.waitForFunction((t) => (window as unknown as Win).__signalFall.state.cur.tick > t + 20, st.tick);
});
