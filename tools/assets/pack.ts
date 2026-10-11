/**
 * Pack rendered sprite frames into PixiJS spritesheets.
 *
 *   pnpm --filter @signal-fall/assets pack holdout
 *
 * Reads tools/assets/build/raw/<faction>/manifest.json + 2x PNG passes, downsamples
 * to 1x, trims transparent borders, packs into 2048x2048 pages and writes:
 *   apps/client/public/assets/sprites/<faction>/atlas-<n>.png + atlas-<n>.json
 *   apps/client/public/assets/sprites/<faction>/catalog.json  (sprite metadata)
 *   apps/client/public/assets/icons/<faction>/<id>.png        (sidebar icons / portraits)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MaxRectsPacker } from 'maxrects-packer';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const faction = process.argv[2] ?? 'holdout';
const RAW = join(ROOT, 'tools/assets/build/raw', faction);
const OUT = join(ROOT, 'apps/client/public/assets/sprites', faction);
const ICONS = join(ROOT, 'apps/client/public/assets/icons', faction);
const PASSES = ['color', 'mask', 'shadow'] as const;
const PAGE = 2048;
const ICON_PX = 128;
/** Direction used for icons: facing the viewer (straight down the screen = sim 45 degrees). */
const ICON_DIR = { 8: 1, 16: 2 } as Record<number, number>;

interface SpriteEntry {
  kind: 'infantry' | 'vehicle' | 'air' | 'building';
  frame: number;
  dirs?: number;
  anims?: Record<string, number>;
  turret: boolean;
  footprint?: [number, number];
  frames: string[];
}

interface Manifest {
  faction: string;
  sprites: Record<string, SpriteEntry>;
}

interface Packed {
  name: string;
  png: Buffer;
  w: number;
  h: number;
  /** Trim offset inside the 1x source frame. */
  ox: number;
  oy: number;
  source: number;
}

const manifest: Manifest = JSON.parse(readFileSync(join(RAW, 'manifest.json'), 'utf8'));

async function load(frame: string, pass: string, size: number): Promise<Packed | null> {
  const file = join(RAW, `${frame.replaceAll('/', '_')}.${pass}.png`);
  let img: ReturnType<typeof sharp>;
  try {
    img = sharp(file);
  } catch {
    return null;
  }
  let half: Buffer;
  try {
    half = await img.resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  } catch {
    return null; // pass not rendered (e.g. no shadow for turrets)
  }
  if (pass === 'mask') {
    // White RGB, alpha = how much team color: the client multiplies this, tinted, over the color pass.
    for (let i = 0; i < half.length; i += 4) {
      const a = Math.round((half[i]! * half[i + 3]!) / 255);
      half[i] = 255;
      half[i + 1] = 255;
      half[i + 2] = 255;
      half[i + 3] = a;
    }
  }
  // Trim to the alpha bounding box.
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (half[(y * size + x) * 4 + 3]! > 2) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // empty (e.g. no team color on this part)
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const png = await sharp(half, { raw: { width: size, height: size, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .png()
    .toBuffer();
  return { name: `${frame}.${pass}`, png, w, h, ox: x0, oy: y0, source: size };
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  rmSync(ICONS, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ICONS, { recursive: true });

  const items: Packed[] = [];
  for (const [id, entry] of Object.entries(manifest.sprites)) {
    for (const frame of entry.frames) {
      for (const pass of PASSES) {
        const p = await load(frame, pass, entry.frame);
        if (p) items.push(p);
      }
    }
    process.stdout.write(`\r${id.padEnd(16)} ${items.length} frames`);
  }
  process.stdout.write('\n');

  const packer = new MaxRectsPacker(PAGE, PAGE, 2, { smart: true, pot: true, square: false, allowRotation: false });
  packer.addArray(items.map((p) => ({ width: p.w, height: p.h, data: p })) as never);
  let page = 0;
  for (const bin of packer.bins) {
    const image = `atlas-${page}.png`;
    const frames: Record<string, unknown> = {};
    const comps = bin.rects.map((r) => {
      const p = (r as unknown as { data: Packed }).data;
      frames[p.name] = {
        frame: { x: r.x, y: r.y, w: p.w, h: p.h },
        rotated: false,
        trimmed: true,
        spriteSourceSize: { x: p.ox, y: p.oy, w: p.w, h: p.h },
        sourceSize: { w: p.source, h: p.source },
        anchor: { x: 0.5, y: 0.5 },
      };
      return { input: p.png, left: r.x, top: r.y };
    });
    await sharp({ create: { width: bin.width, height: bin.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(comps)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(join(OUT, image));
    writeFileSync(join(OUT, `atlas-${page}.json`), JSON.stringify({ frames, meta: { image, size: { w: bin.width, h: bin.height }, scale: 1, format: 'RGBA8888' } }));
    page++;
  }

  // Catalog the client needs to pick frames.
  const catalog = {
    faction,
    pages: page,
    sprites: Object.fromEntries(
      Object.entries(manifest.sprites).map(([id, e]) => [id, { kind: e.kind, frame: e.frame, dirs: e.dirs ?? 1, anims: e.anims ?? {}, turret: e.turret, footprint: e.footprint }]),
    ),
  };
  writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));

  // Icons: hull/body (+ turret) composited, facing the viewer, trimmed and fit to ICON_PX.
  for (const [id, e] of Object.entries(manifest.sprites)) {
    const dir = e.kind === 'building' ? 0 : (ICON_DIR[e.dirs ?? 16] ?? 0);
    const base = e.kind === 'building' ? `${id}/body/built/00/0` : `${id}/hull/${Object.keys(e.anims ?? { idle: 1 })[0]}/${String(dir).padStart(2, '0')}/0`;
    const layers = [base];
    if (e.turret) layers.push(`${id}/turret/idle/${String(e.kind === 'building' ? 2 : dir).padStart(2, '0')}/0`);
    const size = e.frame * 2;
    const comps = layers.map((l) => ({ input: join(RAW, `${l.replaceAll('/', '_')}.color.png`) }));
    const composed = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(comps)
      .png()
      .toBuffer();
    await sharp(composed).trim({ threshold: 1 }).resize(ICON_PX, ICON_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(join(ICONS, `${id}.png`));
  }
  console.log(`packed ${items.length} frames into ${page} page(s); icons for ${Object.keys(manifest.sprites).length} sprites`);
}

await main();
