import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('taking a capture point is announced', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/play/?points=some&size=S&ai=none&seed=21');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur?.points().length > 0);
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    const own: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h) && s.isUnit(h)) {
        own.push(h);
        x = s.field(h, 4) >> 10;
        y = s.field(h, 5) >> 10;
      }
    }
    // The point nearest to us.
    const pts = s.cur.points() as { x: number; y: number }[];
    pts.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const p = pts[0]!;
    s.send({ type: 'move', units: own, x: (p.x << 10) + 512 + 1024, y: (p.y << 10) + 512 });
    s.post({ type: 'speed', speed: 8 });
  });
  await expect(page.getByTestId('alert')).toContainText('Capture point taken', { timeout: 90_000 });
});
