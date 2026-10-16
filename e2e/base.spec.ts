import { expect, test, type Page } from '@playwright/test';

// M3 smoke test: deploy, build power -> refinery -> barracks through hotkeys and
// the sidebar, place each with the mouse, then train a unit from the barracks.

// The page exposes a debug hook; tests poke at it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

const sf = <T>(page: Page, fn: () => T) => page.evaluate(fn);

/** With a placement ghost up, click the first valid spot near the middle of the view. */
async function clickValidSpot(page: Page, id: string): Promise<void> {
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

const owned = (page: Page, id: string) =>
  page.evaluate((rid) => {
    const s = (window as unknown as Win).__signalFall.state;
    let n = 0;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h) && s.ruleOf(h).id === rid) n++;
    }
    return n;
  }, id);

/** Place-first: B + key shows the ghost, one click picks the spot, and it places itself when built. */
async function buildWithHotkey(page: Page, key: string, id: string): Promise<void> {
  const before = await owned(page, id);
  await page.keyboard.press('KeyB');
  await page.keyboard.press(key);
  await expect(page.getByTestId('placing-hint')).toContainText('Click where to build');
  await clickValidSpot(page, id);
  await expect.poll(() => owned(page, id), { timeout: 40_000 }).toBe(before + 1);
}

test('build a base and train a unit with hotkeys', async ({ page }) => {
  await page.goto('/play/?speed=4&ai=none');
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
  // Sticky tab: I once, then G G G queues three more (no I before each).
  await sf(page, () => (window as unknown as Win).__signalFall.state.select([]));
  await page.keyboard.press('KeyI');
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyG');
  await expect(page.getByTestId('mode')).toContainText('Infantry');
  // Queued or already trained: at 4x speed they may finish before we look.
  await expect.poll(() => owned(page, 'grunt'), { timeout: 30_000 }).toBe(5);
  // A letter that is not on the tab closes it.
  await page.keyboard.press('KeyX');
  await expect(page.getByTestId('mode')).not.toContainText('Infantry');
  // The refinery's harvester is earning money.
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.cur.player(0, 0) > 5400, undefined, { timeout: 60_000 });
});
