/**
 * Photo terrain textures per biome from ambientCG (CC0), graded to the game's look.
 *
 *   pnpm --filter @signal-fall/assets terrain-photo
 *
 * Downloads each material's 1K color map once (cached in tools/assets/build/cc0/), then writes
 * apps/client/public/assets/terrain/<biome>/{ground,ground2,rough,road,plaza}.jpg (1024x1024, tileable)
 * and cliff.jpg (1024x512, tileable horizontally). Water stays procedural (terrain.ts): it animates.
 * Grading keeps the ground darker and less saturated than the units so they stay readable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'apps/client/public/assets/terrain');
const CACHE = join(ROOT, 'tools/assets/build/cc0');

/** Grade: brightness, saturation and contrast multipliers, and a tint mixed in (0-1). */
interface Grade {
  brightness: number;
  saturation: number;
  /** Below 1 flattens busy photos so units stay readable on top (default 0.85). */
  contrast?: number;
  tint?: [number, number, number];
  tintAmount?: number;
}

type Slot = 'ground' | 'ground2' | 'rough' | 'road' | 'plaza' | 'cliff';

const BIOMES: Record<string, Record<Slot, [string, Grade]>> = {
  wasteland: {
    ground: ['Ground102', { brightness: 0.82, saturation: 0.8 }],
    ground2: ['Ground079S', { brightness: 0.74, saturation: 0.75 }],
    rough: ['Ground105', { brightness: 0.72, saturation: 0.8, contrast: 0.75 }],
    road: ['Ground054', { brightness: 0.8, saturation: 0.7 }],
    plaza: ['Concrete039', { brightness: 0.78, saturation: 0.6 }],
    cliff: ['Rock061', { brightness: 0.9, saturation: 0.85 }],
  },
  city: {
    ground: ['Concrete044D', { brightness: 0.78, saturation: 0.6 }],
    ground2: ['Concrete036', { brightness: 0.62, saturation: 0.5 }],
    rough: ['Ground110', { brightness: 0.75, saturation: 0.65, contrast: 0.7 }],
    road: ['Road013A', { brightness: 1.05, saturation: 0.6 }],
    plaza: ['Concrete008', { brightness: 0.62, saturation: 0.5 }],
    cliff: ['Rock050', { brightness: 0.95, saturation: 0.7 }],
  },
  crystal: {
    ground: ['Rock062', { brightness: 0.85, saturation: 0.5, tint: [92, 74, 140], tintAmount: 0.3 }],
    ground2: ['Gravel040', { brightness: 0.75, saturation: 0.5, tint: [80, 70, 130], tintAmount: 0.3 }],
    rough: ['Rock035', { brightness: 1.0, saturation: 0.6, tint: [70, 60, 120], tintAmount: 0.25 }],
    road: ['Gravel043', { brightness: 0.7, saturation: 0.4, tint: [96, 86, 140], tintAmount: 0.3 }],
    plaza: ['Concrete036', { brightness: 0.55, saturation: 0.4, tint: [90, 80, 150], tintAmount: 0.35 }],
    cliff: ['Rock030', { brightness: 0.9, saturation: 0.6, tint: [90, 60, 150], tintAmount: 0.3 }],
  },
};

/** The material's 1K color map, downloaded once. */
async function colorMap(id: string): Promise<Buffer> {
  const file = join(CACHE, `${id}.jpg`);
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(CACHE, { recursive: true });
  const meta = (await (await fetch(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData`)).json()) as {
    foundAssets: { downloadFolders: { default: { downloadFiletypeCategories: { zip: { downloads: { attribute: string; fullDownloadPath: string }[] } } } } }[];
  };
  const zipUrl = meta.foundAssets[0]!.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find((d) => d.attribute === '1K-JPG')!.fullDownloadPath;
  const zip = join(CACHE, `${id}.zip`);
  writeFileSync(zip, Buffer.from(await (await fetch(zipUrl)).arrayBuffer()));
  const name = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').find((n) => n.endsWith('_Color.jpg'))!;
  writeFileSync(file, execFileSync('unzip', ['-p', zip, name], { maxBuffer: 64 << 20 }));
  return readFileSync(file);
}

async function graded(id: string, g: Grade, width: number, height: number): Promise<Buffer> {
  let img = sharp(await colorMap(id)).resize(1024, 1024).modulate({ brightness: g.brightness, saturation: g.saturation });
  const c = g.contrast ?? 0.85;
  img = sharp(await img.toBuffer()).linear(c, 128 * (1 - c) * g.brightness);
  if (g.tint && g.tintAmount) {
    // Mix toward the tint: out = in * (1 - a) + tint * a, via a linear transform per channel.
    const a = g.tintAmount;
    img = img.linear([1 - a, 1 - a, 1 - a], g.tint.map((c) => c * a));
  }
  // A cliff is a horizontal band: the top half of the (tileable) map stays tileable left to right.
  if (height < 1024) img = sharp(await img.toBuffer()).extract({ left: 0, top: 0, width, height });
  return img.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}

for (const [biome, slots] of Object.entries(BIOMES)) {
  mkdirSync(join(OUT, biome), { recursive: true });
  for (const [slot, [id, grade]] of Object.entries(slots) as [Slot, [string, Grade]][]) {
    const h = slot === 'cliff' ? 512 : 1024;
    writeFileSync(join(OUT, biome, `${slot}.jpg`), await graded(id, grade, 1024, h));
    console.log(`${biome}/${slot}.jpg  <- ambientCG ${id}`);
  }
}
