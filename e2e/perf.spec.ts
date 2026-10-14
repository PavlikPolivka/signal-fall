import { expect, test } from '@playwright/test';

// M2 acceptance: 400 placeholder units at 60 FPS. Needs a real GPU; on GPU-less
// machines (CI runners use SwiftShader) only the main-thread frame cost is checked.

test('400 units render at 60 FPS', async ({ page }) => {
  await page.goto('/play/?scenario=stress&units=200');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: { entityCount: number } | null } } }).__signalFall.state.cur?.entityCount);
  await page.waitForTimeout(2000);
  const r = await page.evaluate(
    () =>
      new Promise<{ fps: number; units: number; gpu: string; frameMs: number }>((resolve) => {
        const sf = (window as unknown as { __signalFall: { state: { cur: { entityCount: number }; frameMs: number } } }).__signalFall;
        const gl = document.createElement('canvas').getContext('webgl')!;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
          else resolve({ fps: (frames * 1000) / (performance.now() - t0), units: sf.state.cur.entityCount, gpu, frameMs: sf.state.frameMs });
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`400-unit render: ${r.fps.toFixed(1)} fps, ${r.frameMs.toFixed(2)} ms/frame JS, ${r.gpu}`);
  expect(r.units).toBeGreaterThanOrEqual(390);
  // Render prep must fit comfortably in a 16.7 ms frame on any machine.
  expect(r.frameMs).toBeLessThan(8);
  if (!/SwiftShader|llvmpipe/i.test(r.gpu)) expect(r.fps).toBeGreaterThanOrEqual(58);
});
