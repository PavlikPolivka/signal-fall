// Records marketing gameplay clips with Playwright (placeholder art, pre-M6).
// Usage: node tools/video/record.mjs [baseUrl]   -> media/*.mp4
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = join(process.cwd(), 'media');
const RAW = join(OUT, 'raw');
mkdirSync(RAW, { recursive: true });
const SIZE = { width: 1920, height: 1080 };
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function clip(name, run) {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: RAW, size: SIZE } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(name, e.message));
  await run(page);
  const video = page.video();
  await ctx.close();
  const webm = join(RAW, `${name}.webm`);
  renameSync(await video.path(), webm);
  const mp4 = join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  console.log('wrote', mp4);
}

const sf = (page, fn, arg) => page.evaluate(fn, arg);
const ready = (page) => page.waitForFunction(() => window.__signalFall?.state?.cur);

/**
 * Camera director: follow the fight (shots in flight), otherwise the densest
 * cluster of combat units, easing toward it.
 */
async function direct(page) {
  await sf(page, () => {
    const s = window.__signalFall.state;
    const r = window.__signalFall.renderer;
    const c = s.cur;
    if (!c) return;
    const pts = [];
    for (let i = 0; i < c.projectileCount; i++) {
      const p = c.proj(i);
      pts.push([c.get(p, 2), c.get(p, 3)]);
    }
    if (pts.length === 0) {
      for (let i = 0; i < c.entityCount; i++) {
        const o = c.ent(i);
        if (c.get(o, 1) !== 1 || !s.rules.units[c.get(o, 2)].weapon) continue;
        pts.push([c.get(o, 4), c.get(o, 5)]);
      }
    }
    if (pts.length === 0) return;
    // Densest point: most other points within 8 tiles; then average that neighbourhood.
    const R = 8 * 1024;
    let best = pts[0], bestN = -1;
    for (const p of pts) {
      let n = 0;
      for (const q of pts) if (Math.abs(p[0] - q[0]) < R && Math.abs(p[1] - q[1]) < R) n++;
      if (n > bestN) { bestN = n; best = p; }
    }
    let x = 0, y = 0, n = 0;
    for (const q of pts) if (Math.abs(best[0] - q[0]) < R && Math.abs(best[1] - q[1]) < R) { x += q[0]; y += q[1]; n++; }
    const tx = ((x / n - y / n) / 1024) * 32, ty = ((x / n + y / n) / 1024) * 16;
    r.camera.x += (tx - r.camera.x) * 0.18;
    r.camera.y += (ty - r.camera.y) * 0.18;
    r.clampCamera();
  });
}

const only = process.argv[3];
async function maybeClip(name, run) {
  if (!only || name.startsWith(only)) await clip(name, run);
}

// 1. Setup screen -> base building with hotkeys.
await maybeClip('01-setup-and-base', async (page) => {
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-testid=setup]');
  await page.waitForTimeout(1200);
  for (const [group, value] of [['biome', 'wasteland'], ['size', 'S'], ['difficulty', 'normal']]) {
    await page.click(`[data-testid=${group}] [data-value=${value}]`);
    await page.waitForTimeout(500);
  }
  await page.click('[data-testid=start]');
  await ready(page);
  await page.waitForTimeout(1200);
  await sf(page, () => { const s = window.__signalFall.state; const c = s.cur; for (let i = 0; i < c.entityCount; i++) { const h = c.get(c.ent(i), 0); if (s.isOwn(h)) return s.select([h]); } });
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyD');
  await page.waitForTimeout(1000);
  const box = await page.locator('[data-testid=game] canvas').boundingBox();
  const build = async (key, id) => {
    await page.keyboard.press('KeyB');
    await page.waitForTimeout(400);
    await page.keyboard.press(key);
    await page.locator(`[data-item=${id}]`).and(page.locator('.ready')).waitFor({ timeout: 60000 });
    await page.click(`[data-item=${id}]`);
    for (let dy = -120; dy <= 200; dy += 24) for (let dx = -280; dx <= 200; dx += 24) {
      const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
      await page.mouse.move(x, y);
      const ok = await sf(page, () => { const i = window.__signalFall.input; const c = i.cursor(); return c && i.placementAt(c.x, c.y)?.error === null; });
      if (ok) { await page.waitForTimeout(300); await page.mouse.click(x, y); return; }
    }
  };
  await build('KeyP', 'dynamo');
  await build('KeyR', 'smelter');
  await build('KeyB', 'bunkhouse');
  await page.keyboard.press('KeyI'); await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyI'); await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyI'); await page.keyboard.press('KeyG');
  await page.waitForTimeout(9000);
});

// 2. Formation attack: an army crosses the map in formation and hits the enemy base.
await maybeClip('02-formation-assault', async (page) => {
  await page.goto(BASE + '/?scenario=sandbox&units=40&speed=1.5');
  await ready(page);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+KeyA');
  await page.waitForTimeout(800);
  await sf(page, () => { const s = window.__signalFall.state; s.send({ type: 'attackMove', units: s.selectedUnits(), x: 82 * 1024, y: 12 * 1024 }); });
  await page.keyboard.down('Shift');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Shift');
  for (let t = 0; t < 70; t++) {
    await sf(page, () => { const s = window.__signalFall.state; const r = window.__signalFall.renderer; const h = s.selection.filter((x) => s.off(x) >= 0); if (!h.length) return; let x = 0, y = 0; for (const u of h) { x += s.field(u, 4); y += s.field(u, 5); } const tx = (x - y) / h.length / 1024 * 32, ty = (x + y) / h.length / 1024 * 16; r.camera.x += (tx - r.camera.x) * 0.2; r.camera.y += (ty - r.camera.y) * 0.2; });
    await page.waitForTimeout(400);
  }
});

// 3. AI vs AI (Hard), spectated: economy, waves, base defense.
await maybeClip('03-ai-vs-ai', async (page) => {
  await page.goto(BASE + '/?spectate=hard&size=S&biome=crystal&seed=21&speed=3');
  await ready(page);
  await sf(page, () => { window.__signalFall.renderer.camera.zoom = 1.1; });
  for (let t = 0; t < 600; t++) {
    await direct(page);
    await page.waitForTimeout(200);
  }
});

await browser.close();
rmSync(RAW, { recursive: true, force: true });
console.log(readdirSync(OUT));
