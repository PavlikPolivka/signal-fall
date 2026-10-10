import { expect, test, type Page } from '@playwright/test';

// M3 smoke test: deploy, build power -> refinery -> barracks through hotkeys and
// the sidebar, place each with the mouse, then train a unit from the barracks.

// The page exposes a debug hook; tests poke at it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

const sf = <T>(page: Page, fn: () => T) => page.evaluate(fn);

async function placeReady(page: Page, id: string): Promise<void> {
  await page.click(`[data-item=${id}]`);
  const box = (await page.locator('[data-testid=game] canvas').boundingBox())!;
  for (let dy = -200; dy <= 200; dy += 16) {
    for (let dx = -260; dx <= 260; dx += 16) {
      const x = box.x + box.width / 2 + dx;
      const y = box.y + box.height / 2 + dy;
      await page.mouse.move(x, y);
      const ok = await page.evaluate(() => {
        const i = (window as unknown as Win).__signalFall.input;
        const c = i.cursor();
        return c ? i.placementAt(c.x, c.y)?.error === null : false;
      });
      if (ok) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error(`no valid spot for ${id}`);
}

async function buildWithHotkey(page: Page, key: string, id: string): Promise<void> {
  await page.keyboard.press('KeyB');
  await page.keyboard.press(key);
  await expect(page.locator(`[data-item=${id}]`)).toHaveClass(/ready/, { timeout: 30_000 });
  await placeReady(page, id);
  await expect(page.locator(`[data-item=${id}]`)).not.toHaveClass(/ready/);
}

test('build a base and train a unit with hotkeys', async ({ page }) => {
  await page.goto('/?speed=4');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  // Select the construction vehicle and deploy it.
  await sf(page, () => {
    const s = (window as unknown as Win).__signalFall.state;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h)) return s.select([h]);
    }
  });
  await page.keyboard.press('KeyD');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.roles().get('conyard') === 1);

  await buildWithHotkey(page, 'KeyP', 'dynamo');
  await buildWithHotkey(page, 'KeyR', 'smelter');
  await buildWithHotkey(page, 'KeyB', 'bunkhouse');
  await expect(page.locator('[data-testid=power]')).toContainText('/');

  // Select the barracks and queue two Grunts with G.
  await sf(page, () => {
    const s = (window as unknown as Win).__signalFall.state;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h) && s.ruleOf(h).id === 'bunkhouse') return s.select([h]);
    }
  });
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyG');
  await page.waitForFunction(
    () => {
      const s = (window as unknown as Win).__signalFall.state;
      let grunts = 0;
      for (let i = 0; i < s.cur.entityCount; i++) {
        const h = s.cur.get(s.cur.ent(i), 0);
        if (s.isOwn(h) && s.ruleOf(h).id === 'grunt') grunts++;
      }
      return grunts === 2;
    },
    undefined,
    { timeout: 30_000 },
  );
  // The refinery's harvester is earning money.
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.cur.player(0, 0) > 5400, undefined, { timeout: 60_000 });
});
