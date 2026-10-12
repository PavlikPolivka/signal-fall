import { expect, test, type Page } from '@playwright/test';

type Win = { __signalFall: { state: any; renderer: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('[data-testid=game] canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Select own entities matching a rule id (or all own units). */
async function selectOwn(page: Page, id?: string): Promise<number> {
  return page.evaluate((ruleId) => {
    const s = (window as unknown as Win).__signalFall.state;
    const c = s.cur;
    const out: number[] = [];
    for (let i = 0; i < c.entityCount; i++) {
      const h = c.get(c.ent(i), 0);
      if (!s.isOwn(h)) continue;
      if (ruleId ? s.ruleOf(h).id === ruleId : s.isUnit(h)) out.push(h);
    }
    s.select(ruleId ? out.slice(0, 1) : out);
    return s.selection.length;
  }, id);
}

test.describe('mouse', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?scenario=sandbox');
    await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
    // Look at open ground away from both armies.
    await page.evaluate(() => (window as unknown as Win).__signalFall.renderer.centerOnSim(48 * 1024, 70 * 1024));
  });

  test('right-click clears the selection', async ({ page }) => {
    expect(await selectOwn(page)).toBeGreaterThan(0);
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length)).toBe(0);
  });

  test('left-clicking the ground with a barracks selected sets its rally point', async ({ page }) => {
    expect(await selectOwn(page, 'bunkhouse')).toBe(1);
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y);
    const last = await page.evaluate(() => {
      const s = (window as unknown as Win).__signalFall.state;
      return { type: s.sent[s.sent.length - 1]?.type, selected: s.selection.length };
    });
    expect(last).toEqual({ type: 'rally', selected: 1 });
  });

  test('left-clicking the ground with units selected attack-moves them', async ({ page }) => {
    await selectOwn(page);
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y);
    expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.sent.at(-1)?.type)).toBe('attackMove');
  });
});
