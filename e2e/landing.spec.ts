import { expect, test } from '@playwright/test';

test('the landing page introduces the game and leads into it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.tagline')).toContainText('One crystal');
  for (const name of ['Holdout', 'Halcyon', 'Choir']) await expect(page.locator('.faction h3', { hasText: name })).toBeVisible();
  await expect(page.locator('.shot img')).toHaveCount(5);
  // Screenshots open large and close with Escape.
  await page.locator('.shot').first().click();
  await expect(page.locator('.lightbox img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);
  await page.getByTestId('play-now').click();
  await expect(page).toHaveURL(/\/play\/$/);
  await expect(page.getByTestId('home')).toBeVisible();
  expect(errors).toEqual([]);
});

test('old links into the game still work (room codes, live matches)', async ({ page }) => {
  await page.goto('/?room=ABCD');
  await expect(page).toHaveURL(/\/play\/\?room=ABCD$/);
  await expect(page.getByTestId('mp-code')).toHaveValue('ABCD');
});

test('the privacy page is linked and readable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.locator('h1')).toHaveText('Privacy');
  await expect(page.locator('main')).toContainText('Supabase');
});
