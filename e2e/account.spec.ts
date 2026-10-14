import { expect, test } from '@playwright/test';

const online = !!process.env.SUPABASE_URL;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

test('the account panel explains itself without the online service', async ({ page }) => {
  test.skip(online, 'offline build only');
  await page.goto('/play/');
  await page.click('[data-testid=open-account]');
  await expect(page.getByTestId('account-offline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('account')).toHaveCount(0);
});

test('a guest renames, saves the account by email, and becomes permanent', async ({ page, request }) => {
  test.skip(!online, 'needs a Supabase stack (SUPABASE_URL)');
  await page.goto('/play/');
  await expect(page.getByTestId('home-me')).toContainText('guest');
  await page.click('[data-testid=open-account]');
  const name = `Tester${Math.floor(Math.random() * 1e6)}`;
  await page.fill('[data-testid=account-name]', name);
  await page.click('[data-testid=account-rename]');
  await expect(page.getByTestId('account-notice')).toContainText('Name saved');
  await expect(page.getByTestId('home-me')).toContainText(name);

  const email = `${name.toLowerCase()}@example.com`;
  await page.fill('[data-testid=account-email]', email);
  await page.click('[data-testid=account-save]');
  await expect(page.getByTestId('account-notice')).toContainText('Check your email');
  await expect(page.getByTestId('account-pending')).toContainText(email);

  // Open the confirmation link from the local mail catcher.
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json()) as { messages: { ID: string }[] };
        if (!list.messages?.length) return false;
        const msg = (await (await request.get(`${MAILPIT}/api/v1/message/${list.messages[0]!.ID}`)).json()) as { Text: string; HTML: string };
        link = /(https?:\/\/[^\s"<>]+verify[^\s"<>]+)/.exec(msg.Text || msg.HTML)?.[1]?.replace(/&amp;/g, '&');
        return !!link;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.goto(link!);
  await expect(page.getByTestId('account')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.home-notice')).toContainText('Account saved');
  await expect(page.getByTestId('account-email-shown')).toContainText(email);
  await expect(page.getByTestId('home-me')).toContainText(name);
  await expect(page.getByTestId('home-me')).toContainText('account');
  expect(page.url()).not.toContain('access_token');
});
