import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { defaultRules } from '@signal-fall/data';
import { goldenHash } from '@signal-fall/sim';

// The same match must produce the same final state hash in Node and in every browser engine.

let bundle = '';
let nodeHash = 0;

test.beforeAll(async () => {
  const out = await build({
    stdin: {
      contents: `import { defaultRules } from '@signal-fall/data';
import { goldenHash } from '@signal-fall/sim';
globalThis.__golden = () => goldenHash(defaultRules());`,
      resolveDir: process.cwd() + '/packages/sim',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    write: false,
    target: 'es2022',
  });
  bundle = out.outputFiles[0]!.text;
  nodeHash = goldenHash(defaultRules());
});

test('golden match hash is identical to Node', async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });
  const browserHash = await page.evaluate(() => (globalThis as unknown as { __golden: () => number }).__golden());
  expect(browserHash).toBe(nodeHash);
});
