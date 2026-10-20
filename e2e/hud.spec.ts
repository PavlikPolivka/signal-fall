import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('idle army counter selects the idle units; tabs show queued counts', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await expect(page.getByTestId('unit-cap')).toHaveText(/^\d+\/200$/);
  await expect(page.getByTestId('power')).toHaveAttribute('title', /Biggest users: .*\nLow power: building and training run at 50%/);
  const idle = page.getByTestId('idle-army');
  await expect(idle).toContainText('idle');
  await idle.click();
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length)).toBeGreaterThan(0);
  // Queue power on the Build tab: its badge shows 1.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    s.send({ type: 'build', category: 'structures', item: s.rules.structureIndex.get('dynamo') });
  });
  await expect(page.locator('[data-tab=structures] .tab-badge')).toHaveText('1', { timeout: 15_000 });
  // A disabled button says why.
  await expect(page.locator('[data-item=smelter]')).toHaveAttribute('aria-label', /another building is being built/);
  await page.hover('[data-item=smelter]');
  await expect(page.getByTestId('item-blocked')).toHaveText('Wait: another building is being built');
});

test('events land in the log, and the pause menu briefs the player', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur);
  await page.evaluate(() => (window as unknown as { __signalFall: { state: { alert: (t: string, x: number, y: number) => void } } }).__signalFall.state.alert('Base under attack', 40 * 1024, 40 * 1024));
  await page.click('[data-testid=log-btn]');
  await expect(page.getByTestId('event-log')).toContainText('Base under attack');
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('briefing')).toContainText('Destroy every enemy building');
  await page.click('[data-testid=menu-surrender]');
  await expect(page.getByTestId('surrender-confirm')).toBeVisible();
});

test('right-click on a selection card drops one of that type, Shift+right-click all of them', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.keyboard.press('Control+KeyA');
  const count = () => page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length as number);
  const before = await count();
  const card = page.locator('[data-testid=selection-groups] .cell').filter({ has: page.locator('.count') }).first();
  const inCard = Number(await card.locator('.count').textContent());
  await card.click({ button: 'right' });
  expect(await count()).toBe(before - 1);
  await card.click({ button: 'right', modifiers: ['Shift'] });
  expect(await count()).toBe(before - inCard);
});

test('hovering an Echo field shows how much is left in it', async ({ page }) => {
  await page.goto('/play/?ai=none&size=S');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const tile = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    const t = (s.echo as Uint8Array).findIndex((v: number) => v > 0);
    s.hoverEcho = t;
    s.changed();
    return t;
  });
  expect(tile).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId('echo-card')).toContainText(/crystals left · worth ◆/);
});
