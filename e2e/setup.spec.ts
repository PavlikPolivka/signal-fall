import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('skirmish setup starts a game with the chosen options', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid=setup]')).toBeVisible();
  await page.click('[data-testid=biome] [data-value=city]');
  await page.click('[data-testid=size] [data-value=S]');
  await page.click('[data-testid=difficulty] [data-value=easy]');
  await page.fill('[data-testid=seed]', '4242');
  await page.locator('[data-testid=seed]').dispatchEvent('change');
  await expect(page.locator('[data-testid=map-preview]')).toBeVisible();
  await page.click('[data-testid=start]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.state.ready);
  const st = await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    return { biome: s.biome, width: s.width, players: s.players.length };
  });
  expect(st).toEqual({ biome: 'city', width: 96, players: 2 });
  // Settings are remembered for next time.
  await page.goto('/');
  await expect(page.locator('[data-testid=biome] [data-value=city]')).toHaveClass(/active/);
});
