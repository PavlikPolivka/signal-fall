import { expect, test, type Page } from '@playwright/test';

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
  await touch(page, 'pointerdown', at!.x, at!.y);
  await touch(page, 'pointerup', at!.x, at!.y);
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length)).toBeGreaterThan(0);
  // Long press: deselect.
  await touch(page, 'pointerdown', 300, 300);
  // Hold until the long press registers (slow CI machines take a while).
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length), { timeout: 10_000 }).toBe(0);
  await touch(page, 'pointerup', 300, 300);
});
