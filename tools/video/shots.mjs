// Map screenshots for art review. Usage: node tools/video/shots.mjs <outDir> [baseUrl]
// Each shot: biome, seed, players, view center (fraction of map), zoom.
import { chromium } from '@playwright/test';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '.';
const BASE = process.argv[3] ?? 'http://localhost:4173';
const SHOTS = [
  ['wasteland', 11, 0.5, 0.5, 0.6],
  ['wasteland', 21, 0.5, 0.5, 0.6],
  ['city', 11, 0.5, 0.5, 0.6],
  ['city', 4, 0.5, 0.5, 0.6],
  ['crystal', 11, 0.5, 0.5, 0.6],
  ['crystal', 33, 0.35, 0.5, 0.8],
];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [biome, seed, fx, fy, zoom] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  page.on('pageerror', (e) => console.error(biome, e.message));
  page.on('console', (m) => m.type() === 'warning' && console.log(biome, m.text()));
  await page.goto(`${BASE}/?seed=${seed}&biome=${biome}&spectate=easy`);
  await page.waitForFunction(() => window.__signalFall?.state?.cur);
  await page.waitForFunction(() => window.__signalFall.renderer.propsReady, null, { timeout: 20000 });
  await page.evaluate(([fx, fy, zoom]) => {
    const { renderer: r, state: s } = window.__signalFall;
    r.camera.zoom = zoom;
    r.centerOnSim(s.width * 1024 * fx, s.height * 1024 * fy);
  }, [fx, fy, zoom]);
  await page.waitForTimeout(600);
  const file = join(OUT, `shot-${biome}-${seed}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  await page.close();
}
await browser.close();
