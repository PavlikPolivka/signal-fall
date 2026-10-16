import { test, type Page } from '@playwright/test';

// Landing page screenshots (apps/client/public/assets/landing/*.jpg): AI vs AI matches,
// captured from the 1280x720 game view. Re-run whenever the art changes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };
const OUT = 'apps/client/public/assets/landing';
const FACTION = { holdout: 0, halcyon: 1, choir: 2 } as const;

async function match(page: Page, a: number, b: number, seed: number): Promise<void> {
  // Sidebar 276 px and bottom panel 176 px around a 1280x720 game view.
  await page.setViewportSize({ width: 1556, height: 930 });
  await page.goto(`/play/?spectate=hard&faction=${a}&enemy=${b}&seed=${seed}&size=S&speed=8`);
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.ready);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86, clip: { x: 0, y: 34, width: 1280, height: 720 } });
}

/** Look at the biggest fight: the unit with the most enemies within 8 tiles. Returns how many. */
async function centerOnFight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sf = (window as unknown as Win).__signalFall;
    const s = sf.state;
    const c = s.cur;
    const units: { x: number; y: number; team: number }[] = [];
    for (let i = 0; i < c.entityCount; i++) {
      const h = c.get(c.ent(i), 0);
      if (!s.isUnit(h)) continue;
      units.push({ x: s.field(h, 4), y: s.field(h, 5), team: s.teamOf(h) });
    }
    let best = { n: 0, x: 0, y: 0 };
    for (const u of units) {
      let n = 0;
      for (const v of units) if (v.team !== u.team && Math.hypot(v.x - u.x, v.y - u.y) < 8 * 1024) n++;
      if (n > best.n) best = { n, x: u.x, y: u.y };
    }
    if (best.n > 0) sf.input.renderer.centerOnSim(best.x, best.y);
    return best.n;
  });
}

for (const [name, f] of Object.entries(FACTION)) {
  test(`base-${name}`, async ({ page }) => {
    await match(page, f, f, 4);
    await page.waitForTimeout(22_000);
    await shot(page, `base-${name}`);
  });
}

for (const [name, a, b] of [
  ['battle-holdout-choir', 0, 2],
  ['battle-choir-halcyon', 2, 1],
] as const) {
  test(name, async ({ page }) => {
    await match(page, a, b, 7);
    // Wait for a real clash (the first waves meet around minute 4-5).
    for (let t = 0; t < 60; t++) {
      await page.waitForTimeout(1000);
      if ((await centerOnFight(page)) >= 8) break;
    }
    await shot(page, name);
  });
}
