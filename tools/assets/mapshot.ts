/** Debug: render generated maps to PNG (top-down). tsx mapshot.ts <outdir> */
import { join } from 'node:path';
import sharp from 'sharp';
import { generateMap, type Biome } from '@signal-fall/mapgen';

const out = process.argv[2] ?? '.';
const COL = [[110, 95, 70], [90, 80, 65], [60, 55, 50], [40, 80, 110], [85, 70, 60], [80, 70, 75]];
const tiles: string[] = [];
const S = 3;
let k = 0;
for (const players of [2, 2, 2, 4]) {
  for (const biome of ['city', 'wasteland', 'crystal'] as Biome[]) {
    const m = generateMap({ seed: 11 + k * 7, size: 'M', players, biome, resources: 'normal', terrain: 'normal' });
    k++;
    const n = m.width;
    const px = Buffer.alloc(n * S * n * S * 3);
    for (let y = 0; y < n * S; y++)
      for (let x = 0; x < n * S; x++) {
        const i = Math.floor(y / S) * n + Math.floor(x / S);
        let c = COL[m.terrain[i]!]!;
        if (m.surface[i] === 1) c = [150, 140, 120];
        if (m.surface[i] === 2) c = [70, 130, 150];
        if (m.surface[i] === 3) c = [180, 170, 150];
        if (m.landmark[i]) c = [220, 60, 60];
        if (m.echo[i]) c = [40, 220, 230];
        const o = (y * n * S + x) * 3;
        px[o] = c[0]!;
        px[o + 1] = c[1]!;
        px[o + 2] = c[2]!;
      }
    for (const s of m.starts) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const o = ((s.y * S + dy) * n * S + s.x * S + dx) * 3;
      px[o] = 255; px[o + 1] = 255; px[o + 2] = 0;
    }
    const file = join(out, `map-${k}-${players}-${biome}-${m.symmetry}.png`);
    await sharp(px, { raw: { width: n * S, height: n * S, channels: 3 } }).png().toFile(file);
    tiles.push(file);
  }
}
const W = 384;
await sharp({ create: { width: W * 3 + 12, height: W * 4 + 18, channels: 3, background: '#000' } })
  .composite(tiles.map((f, i) => ({ input: f, left: (i % 3) * (W + 6), top: Math.floor(i / 3) * (W + 6) })))
  .png()
  .toFile(join(out, 'sheet.png'));
console.log(tiles.map((t) => t.split('/').pop()).join(' '));
