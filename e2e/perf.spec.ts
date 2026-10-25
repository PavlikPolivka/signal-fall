import { expect, test } from '@playwright/test';

// Frame rates need the GPU to themselves: these run one at a time.
test.describe.configure({ mode: 'serial' });

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

// The 60 fps guard (2026-10-25). Firefox fell to 13 fps in a 400-unit battle for two reasons that no
// frame counter on a fast Chrome shows: a draw call per unit (team colors multiplied live) and a CSS
// blend over the game canvas (Firefox recomposited the build list every frame). These checks hold on
// any machine, GPU or not; the frame-time check needs a real GPU (macOS here, Metal).
type Perf = { __signalFall: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe('60 fps guard', () => {
  test.use({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });

  test('a 400-unit battle draws in a handful of draw calls, with no CSS blending over the game', async ({ page }) => {
    await page.goto('/play/?scenario=stress&units=200');
    await page.waitForFunction(() => (window as unknown as Perf).__signalFall.state.cur?.entityCount > 390);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(
      () =>
        new Promise<{ draws: number; blended: string[] }>((resolve) => {
          const gl = (window as unknown as Perf).__signalFall.renderer.app.renderer.gl as WebGL2RenderingContext;
          let draws = 0;
          const drawElements = gl.drawElements.bind(gl);
          const drawArrays = gl.drawArrays.bind(gl);
          gl.drawElements = (...a: Parameters<typeof gl.drawElements>) => (draws++, drawElements(...a));
          gl.drawArrays = (...a: Parameters<typeof gl.drawArrays>) => (draws++, drawArrays(...a));
          let frames = 0;
          const tick = () => {
            if (++frames < 60) return requestAnimationFrame(tick);
            gl.drawElements = drawElements;
            gl.drawArrays = drawArrays;
            // Anything visible in the match that the browser must blend live over the canvas.
            const blended: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>('.layout *'))) {
              const cs = getComputedStyle(el);
              if (el.offsetParent === null) continue;
              if (cs.mixBlendMode !== 'normal' || (cs.backdropFilter && cs.backdropFilter !== 'none')) blended.push(`${el.className || el.tagName}: ${cs.mixBlendMode} ${cs.backdropFilter}`);
            }
            resolve({ draws: draws / frames, blended });
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`battle: ${r.draws.toFixed(1)} draw calls per frame`);
    expect(r.blended).toEqual([]);
    expect(r.draws).toBeLessThan(40);
  });

  test('a 400-unit battle holds 60 fps on a real GPU', async ({ page }) => {
    await page.goto('/play/?scenario=stress&units=200');
    await page.waitForFunction(() => (window as unknown as Perf).__signalFall.state.cur?.entityCount > 390);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(
      () =>
        new Promise<{ fps: number; median: number; p95: number; gpu: string; frameMs: number }>((resolve) => {
          const gl = document.createElement('canvas').getContext('webgl')!;
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
          const times: number[] = [];
          let last = performance.now();
          const t0 = last;
          const tick = () => {
            const now = performance.now();
            times.push(now - last);
            last = now;
            if (now - t0 < 4000) return requestAnimationFrame(tick);
            times.sort((a, b) => a - b);
            resolve({ fps: times.length / 4, median: times[times.length >> 1]!, p95: times[Math.floor(times.length * 0.95)]!, gpu, frameMs: (window as unknown as Perf).__signalFall.state.frameMs });
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`battle: ${r.fps.toFixed(0)} fps, median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, js ${r.frameMs.toFixed(2)} ms, ${r.gpu}`);
    // The game's own work per frame stays well inside a 60 fps frame on any machine.
    expect(r.frameMs).toBeLessThan(6);
    test.skip(/SwiftShader|llvmpipe/i.test(r.gpu), 'frame times need a real GPU');
    expect(r.fps).toBeGreaterThanOrEqual(58);
    expect(r.p95).toBeLessThan(20);
  });
});
