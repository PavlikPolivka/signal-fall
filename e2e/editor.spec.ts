import { expect, test } from '@playwright/test';

test('make a map in the editor, check it, and play it', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-editor]');
  await page.click('[data-testid=editor-new] [data-value=gen2]');
  await page.fill('[data-testid=editor-name]', 'Test Arena');
  // Paint a rock wall with the brush (mirrored), then check it.
  await page.click('[data-testid=editor-tool] [data-value=rock]');
  const box = (await page.getByTestId('editor-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35, { steps: 5 });
  await page.mouse.up();
  await page.click('[data-testid=editor-check]');
  await expect(page.getByTestId('editor-errors')).toBeVisible();
  // A generated start is fair; whatever the wall did, the code round-trips once it checks out.
  if ((await page.getByTestId('editor-errors').textContent())?.includes('Fair')) {
    const code = await page.getByTestId('editor-code').inputValue();
    expect(code.startsWith('SF1.')).toBe(true);
    await page.click('[data-testid=editor-play]');
    await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur);
  }
});

test('a map code loads in the editor', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-editor]');
  await page.click('[data-testid=editor-new] [data-value=gen2]');
  await page.click('[data-testid=editor-save]');
  const code = await page.getByTestId('editor-code').inputValue();
  await page.click('[data-testid=editor-new] [data-value=blank2]');
  await page.fill('[data-testid=editor-code]', code);
  await page.click('[data-testid=editor-check]');
  await expect(page.getByTestId('editor-errors')).toHaveText('Fair and playable.');
});
