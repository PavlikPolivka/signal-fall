import { expect, test } from '@playwright/test';

test('codex opens from setup and the in-game menu, and lists data-driven units', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-codex]');
  await expect(page.locator('[data-testid=codex]')).toContainText('Signal Fall');
  await page.click('[data-codex-tab=units]');
  await expect(page.locator('[data-codex-unit=bulldog]')).toContainText('Main battle tank');
  await page.click('[data-codex-tab=buildings]');
  await expect(page.locator('[data-codex-building=smelter]')).toContainText('Harvesters unload here');
  await page.click('[data-codex-tab=controls]');
  await expect(page.locator('[data-testid=codex]')).toContainText('Cycle stance');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=codex]')).toHaveCount(0);

  await page.goto('/play/?ai=none');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { ready: boolean } } }).__signalFall.state.ready);
  await page.keyboard.press('Backquote'); // the menu key
  await page.click('[data-testid=menu-codex]');
  await expect(page.locator('[data-testid=codex]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=codex]')).toHaveCount(0);
});

test('credits list the asset licenses', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-credits]');
  const credits = page.getByTestId('credits');
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('Unit and building sprites');
  await expect(credits).toContainText('Saira Stencil One');
  await page.keyboard.press('Escape');
  await expect(credits).toBeHidden();
});

const SIDE = (faction: string, units: string[]) => ({ faction, harvested: 90000, topUnits: units, strategies: { rush: { wins: 5, matches: 10 } } });
const REPORT = {
  commit: '0123456789abcdef',
  date: '2026-10-16T12:00:00Z',
  matchesPerPairing: 300,
  gate: { min: 45, max: 55, easyMin: 90 },
  ok: false,
  pairings: [{ a: SIDE('holdout', ['bulldog']), b: SIDE('halcyon', ['vector']), winsA: 150, winsB: 148, draws: 2, winPctA: 50, avgMinutes: 11 }],
  easy: [{ faction: 'holdout', winPct: 98, matches: 200 }],
};

test('codex explains faction differences, building rules and balance', async ({ page }) => {
  // The Balance tab reads CI's published results.
  await page.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ json: REPORT }));
  await page.goto('/play/');
  await page.click('[data-testid=open-codex]');
  const codex = page.getByTestId('codex');
  await page.click('[data-codex-tab=compare]');
  await expect(codex).toContainText('How the factions differ');
  await expect(codex).toContainText('Choir in a match');
  await page.screenshot({ path: 'test-results/codex-compare.png' });
  await page.click('[data-codex-tab=howto]');
  await expect(codex).toContainText('Where you can build');
  await expect(codex).toContainText('far seed');
  await expect(codex).toContainText('Salvage Crews');
  await expect(codex).toContainText('Daily challenge');
  await expect(codex).toContainText('Long Tom');
  await page.click('[data-codex-tab=balance]');
  await expect(codex.getByTestId('balance-report')).toContainText('Holdout vs Halcyon');
  await expect(codex.getByTestId('balance-report')).toContainText('Bulldog');
  await page.screenshot({ path: 'test-results/codex-balance.png' });
});

test("what's new shows the change notes", async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-changes]');
  const changes = page.getByTestId('changes');
  await expect(changes.locator('h2').last()).toContainText('UTC');
  await expect(changes.locator('li').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/changes.png' });
  await page.keyboard.press('Escape');
  await expect(changes).toBeHidden();
});

test('?menu=skirmish opens the skirmish setup (New skirmish on the end screen)', async ({ page }) => {
  await page.goto('/play/?menu=skirmish');
  await expect(page.getByTestId('back')).toBeVisible();
  await expect(page).toHaveURL(/\/play\/$/);
});

test('main menu links fit on one line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/play/');
  const tops = await page.locator('.home .setup-links > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await page.screenshot({ path: 'test-results/home-links.png', clip: { x: 0, y: 500, width: 900, height: 300 } });
});

test('codex search finds a unit and how to beat it', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-codex]');
  await page.fill('[data-testid=codex-search]', 'bulldog');
  const results = page.getByTestId('codex-results');
  await expect(results).toContainText('Bulldog');
  await expect(results).toContainText('How to beat it');
});

test('the landing page links to the credits', async ({ page }) => {
  await page.goto('/play/?menu=credits');
  await expect(page.getByTestId('credits')).toContainText('Unit and building sprites');
});
