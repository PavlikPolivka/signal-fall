/** Debug: contact sheet of rendered icons. tsx sheet.ts <dir> <out.png> */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [dir, out] = process.argv.slice(2) as [string, string];
const files = readdirSync(dir).filter((f) => f.endsWith('.color.png')).sort();
const S = 160;
const cols = 8;
const rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(
  files.map((f) => sharp(join(dir, f)).trim({ threshold: 1 }).resize(S, S, { fit: 'contain', background: '#2a313a' }).flatten({ background: '#2a313a' }).png().toBuffer()),
);
await sharp({ create: { width: cols * S, height: rows * S, channels: 3, background: '#2a313a' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * S, top: Math.floor(i / cols) * S })))
  .png()
  .toFile(out);
console.log(files.map((f) => f.split('.')[0]).join(' '));
