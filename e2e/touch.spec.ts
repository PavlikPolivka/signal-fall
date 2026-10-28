import { devices, expect, test, type Page } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

/** Fire touch pointer events on the battlefield (one finger). */
async function touch(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, id = 7) {
  await page.evaluate(
    ([type, x, y, id]) => {
      const c = document.querySelector('[data-testid=game] canvas')!;
      const r = c.getBoundingClientRect();
      const target = type === 'pointerdown' ? c : window;
      target.dispatchEvent(new PointerEvent(type as string, { pointerId: id as number, pointerType: 'touch', clientX: r.left + (x as number), clientY: r.top + (y as number), bubbles: true, button: 0 }));
    },
    [type, x, y, id] as const,
  );
}

/** A quick tap: down and up in one go, so a slow test machine can't stretch it into a long press. */
async function tap(page: Page, x: number, y: number) {
  await page.evaluate(
    ([x, y]) => {
      const c = document.querySelector('[data-testid=game] canvas')!;
      const r = c.getBoundingClientRect();
      const o = { pointerId: 9, pointerType: 'touch', clientX: r.left + x!, clientY: r.top + y!, bubbles: true, button: 0 };
      c.dispatchEvent(new PointerEvent('pointerdown', o));
      window.dispatchEvent(new PointerEvent('pointerup', o));
    },
    [x, y] as const,
  );
}

test('touch: drag pans, tap selects, long press backs out', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const cam0 = await page.evaluate(() => ({ ...(window as unknown as Win).__signalFall.renderer.camera }));
  await touch(page, 'pointerdown', 400, 300);
  for (let i = 1; i <= 5; i++) await touch(page, 'pointermove', 400 - i * 30, 300);
  await touch(page, 'pointerup', 250, 300);
  const cam1 = await page.evaluate(() => ({ ...(window as unknown as Win).__signalFall.renderer.camera }));
  expect(cam1.x).toBeGreaterThan(cam0.x + 100);
  await expect(page.getByTestId('touch-bar')).toBeVisible();
  // Tap one of our units.
  const at = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    const r = (window as unknown as Win).__signalFall.renderer;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (!s.isOwn(h) || !s.isUnit(h)) continue;
      const p = r.screenOf(h);
      if (p && p.x > 50 && p.y > 50 && p.x < r.width - 50 && p.y < r.height - 50) return p;
    }
    return null;
  });
  expect(at).not.toBeNull();
  await tap(page, at!.x, at!.y);
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length)).toBeGreaterThan(0);
  // Long press: deselect.
  await touch(page, 'pointerdown', 300, 300);
  // Hold until the long press registers (slow CI machines take a while).
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length), { timeout: 10_000 }).toBe(0);
  await touch(page, 'pointerup', 300, 300);
});

// The iPad preset minus its browser choice (a test group can't switch browsers; the test runs on WebKit).
const { defaultBrowserType: _browser, ...IPAD } = devices['iPad Pro 11 landscape']!;

test.describe('iPad', () => {
  test.use(IPAD);
  test('a tap builds without a card; a long press opens the card with cancel, a tap outside closes it; fullscreen explains the home screen', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'iPad is Safari');
    await page.goto('/play/');
    await page.tap('[data-testid=menu-fullscreen]');
    await expect(page.getByTestId('home-screen-note')).toContainText('Add to Home Screen');
    await page.goto('/play/?seed=8&size=S&ai=easy');
    await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur);
    await page.evaluate(() => {
      const s = (window as unknown as { __signalFall: { state: any } }).__signalFall.state; // eslint-disable-line @typescript-eslint/no-explicit-any
      for (let i = 0; i < s.cur.entityCount; i++) {
        const h = s.cur.get(s.cur.ent(i), 0);
        if (s.isOwn(h)) return s.send({ type: 'deploy', units: [h] });
      }
    });
    await expect(page.locator('[data-item=dynamo]')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.locator('[data-item=dynamo]').tap();
    await expect(page.locator('.card-anchor')).toHaveCount(0);
    // Keyboard letters are hidden on a touch screen.
    await expect(page.locator('[data-item=dynamo] .key')).toBeHidden();
    const b = page.locator('[data-item=bunkhouse]');
    await b.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
    // Hold until the long press opens the card (on slow CI frames its timer fires late).
    await expect(page.getByTestId('item-card-actions')).toBeVisible({ timeout: 10_000 });
    await b.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
    await b.dispatchEvent('click');
    await expect(page.getByTestId('item-card-actions')).toBeVisible();
    await page.touchscreen.tap(300, 400);
    await expect(page.locator('.card-anchor')).toHaveCount(0);
  });
});
