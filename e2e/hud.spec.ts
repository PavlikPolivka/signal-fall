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

test('dragging with a wall picked lays a whole line, piece by piece', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.evaluate(() => (window as unknown as Win).__signalFall.input.run('jumpToBase'));
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyW');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.placing !== null);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const x = box.x + box.width / 2 + 120;
  const y = box.y + box.height / 2 + 80;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 50, { steps: 5 });
  await page.mouse.move(x + 200, y + 100, { steps: 5 });
  await page.mouse.up();
  const st = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    return { planned: s.wallPlan?.tiles.length ?? 0, built: s.sent.filter((c: { type: string }) => c.type === 'build').length };
  });
  expect(st.built).toBe(1);
  expect(st.planned).toBeGreaterThanOrEqual(2);
  // Once the first piece has placed itself, the next one is ordered.
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.post({ type: 'speed', speed: 4 }));
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.sent.filter((c: { type: string }) => c.type === 'build').length >= 2, null, { timeout: 30_000 });
});

test('a power-hungry building can be switched off and on from its panel', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const h = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      const r = s.ruleOf(h);
      if (s.isOwn(h) && r.kind === 'structure' && r.power < 0) {
        s.select([h]);
        return h;
      }
    }
    return -1;
  });
  expect(h).toBeGreaterThanOrEqual(0);
  await page.getByTestId('power-toggle').click();
  await expect(page.getByTestId('power-toggle')).toHaveText('Power on');
  await page.getByTestId('power-toggle').click();
  await expect(page.getByTestId('power-toggle')).toHaveText('Power off');
});

test('Alt+click pings the map for an AI ally in a 2v2', async ({ page }) => {
  await page.goto('/play/?mode=2v2&size=S&ai=easy');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Alt');
  const sent = await page.evaluate(() => (window as unknown as Win).__signalFall.state.sent.some((c: { type: string }) => c.type === 'ping'));
  expect(sent).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.mapPings.length)).toBeGreaterThan(0);
});
