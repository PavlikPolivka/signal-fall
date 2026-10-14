/**
 * Design kit: writes brand/ (vector logos with outlined text, PNG sizes, favicons,
 * app icons, a social image) from the mark geometry the game uses.
 *
 *   pnpm --filter @signal-fall/assets brand
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import { BRAND_COLORS, MARK_BARS, MARK_FALLING, MARK_VIEWBOX } from '../../apps/client/src/ui/mark';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'brand');
const PUBLIC = join(ROOT, 'apps/client/public');
const require = createRequire(import.meta.url);
const fontFile = require.resolve('@fontsource/saira-stencil-one/files/saira-stencil-one-latin-400-normal.woff');
const fontBuf = readFileSync(fontFile);
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

interface Palette {
  /** One-color variants draw every bar solid. */
  solid?: boolean;
  bars: string;
  fall: string;
  signal: string;
  signalWord: string;
}
const PALETTES: Record<string, Palette> = {
  // For dark backgrounds (the game's own look).
  dark: { bars: BRAND_COLORS.gold, signalWord: BRAND_COLORS.gold, fall: BRAND_COLORS.bone, signal: BRAND_COLORS.signal },
  // For light backgrounds: deeper gold and ink.
  light: { bars: '#a8801c', signalWord: '#a8801c', fall: '#14181d', signal: '#0a9fbd' },
  'mono-white': { solid: true, bars: '#ffffff', signalWord: '#ffffff', fall: '#ffffff', signal: '#ffffff' },
  'mono-black': { solid: true, bars: '#000000', signalWord: '#000000', fall: '#000000', signal: '#000000' },
};

const r = (n: number) => Math.round(n * 100) / 100;

/** The mark as SVG elements, scaled to `h` px tall at (x, y). */
function markSvg(p: Palette, x: number, y: number, h: number): string {
  const s = h / MARK_VIEWBOX.height;
  const f = MARK_FALLING;
  const bars = MARK_BARS.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${p.bars}"${b.opacity < 1 && !p.solid ? ` fill-opacity="${b.opacity}"` : ''}/>`).join('');
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s * 1000) / 1000})">${bars}<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" fill="${p.signal}" transform="rotate(${f.angle} ${f.cx} ${f.cy})"/></g>`;
}

/** Outlined text: the path data and its advance width, baseline at y. */
function textPath(text: string, x: number, y: number, size: number): { d: string; width: number } {
  const spacing = 0.04 * size; // the game's letter-spacing: 0.04em
  let cx = x;
  let d = '';
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    d += g.getPath(cx, y, size).toPathData(2);
    cx += (g.advanceWidth! / font.unitsPerEm) * size + spacing;
  }
  return { d, width: cx - x - spacing };
}

const capHeight = (size: number) => ((font.tables.os2 as { sCapHeight?: number }).sCapHeight ?? font.unitsPerEm * 0.7) / font.unitsPerEm * size;

/** Wordmark "SIGNAL FALL" at font size `size`, baseline y. */
function words(p: Palette, x: number, y: number, size: number): { svg: string; width: number } {
  const a = textPath('SIGNAL', x, y, size);
  const space = (font.charToGlyph(' ').advanceWidth! / font.unitsPerEm) * size + 0.08 * size;
  const b = textPath('FALL', x + a.width + space, y, size);
  return { svg: `<path d="${a.d}" fill="${p.signalWord}"/><path d="${b.d}" fill="${p.fall}"/>`, width: a.width + space + b.width };
}

const svgDoc = (w: number, h: number, body: string, bg?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(w)} ${r(h)}" width="${r(w)}" height="${r(h)}">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}${body}</svg>\n`;

/** Horizontal lockup: mark, then the words, as in the game's menus. */
function horizontal(p: Palette, bg?: string): string {
  const F = 100;
  const cap = capHeight(F);
  const pad = 0.3 * F;
  const markH = 0.9 * F;
  const markW = (markH * MARK_VIEWBOX.width) / MARK_VIEWBOX.height;
  const top = pad + Math.max(0, (markH - cap) / 2);
  const baseline = top + cap;
  const markY = baseline - cap / 2 - markH / 2;
  const gap = 0.25 * F;
  const w = words(p, pad + markW + gap, baseline, F);
  return svgDoc(pad * 2 + markW + gap + w.width, baseline + pad + Math.max(0, (markH - cap) / 2), markSvg(p, pad, markY, markH) + w.svg, bg);
}

/** Stacked lockup: a large mark above the words. */
function stacked(p: Palette, bg?: string): string {
  const F = 100;
  const cap = capHeight(F);
  const pad = 0.3 * F;
  const probe = words(p, 0, 0, F);
  const markH = 2.2 * F;
  const markW = (markH * MARK_VIEWBOX.width) / MARK_VIEWBOX.height;
  const width = Math.max(probe.width, markW) + pad * 2;
  const mark = markSvg(p, (width - markW) / 2, pad, markH);
  const baseline = pad + markH + 0.35 * F + cap;
  const w = words(p, (width - probe.width) / 2, baseline, F);
  return svgDoc(width, baseline + pad, mark + w.svg, bg);
}

function wordmark(p: Palette, bg?: string): string {
  const F = 100;
  const cap = capHeight(F);
  const pad = 0.2 * F;
  const w = words(p, pad, pad + cap, F);
  return svgDoc(w.width + pad * 2, cap + pad * 2, w.svg, bg);
}

/** The mark alone, centered on a square, with `padPct` space around it. */
function markSquare(p: Palette, padPct: number, bg?: string, radius = 0): string {
  const S = 100;
  const inner = S * (1 - (2 * padPct) / 100);
  const h = (inner * MARK_VIEWBOX.height) / MARK_VIEWBOX.width;
  const body = markSvg(p, (S - inner) / 2, (S - h) / 2, h);
  const back = bg ? `<rect width="${S}" height="${S}" rx="${radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${back}${body}</svg>\n`;
}

const write = (rel: string, data: string | Buffer) => {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const png = async (svg: string, width: number, height?: number) => sharp(Buffer.from(svg), { density: 600 }).resize(width, height).png({ compressionLevel: 9 }).toBuffer();

// --- vector ---
const vectors: Record<string, (p: Palette) => string> = { logo: (p) => horizontal(p), 'logo-stacked': (p) => stacked(p), wordmark: (p) => wordmark(p), mark: (p) => markSquare(p, 4) };
for (const [name, make] of Object.entries(vectors)) for (const [variant, p] of Object.entries(PALETTES)) write(`svg/${name}-${variant}.svg`, make(p));

// --- PNG sizes ---
for (const [name, make] of Object.entries(vectors)) {
  const widths = name === 'mark' ? [16, 32, 64, 128, 256, 512, 1024] : [256, 512, 1024, 2048];
  for (const [variant, p] of Object.entries(PALETTES)) for (const w of widths) write(`png/${name}-${variant}-${w}.png`, await png(make(p), w));
}

// --- favicons and app icons (the mark on night, rounded) ---
const night = BRAND_COLORS.night;
const icon = markSquare(PALETTES.dark!, 14, night, 18);
const maskable = markSquare(PALETTES.dark!, 22, night, 0); // safe zone for Android masks
write('icons/favicon.svg', icon);
write('icons/favicon-16.png', await png(icon, 16));
write('icons/favicon-32.png', await png(icon, 32));
write('icons/apple-touch-icon.png', await png(markSquare(PALETTES.dark!, 14, night, 0), 180));
write('icons/icon-192.png', await png(icon, 192));
write('icons/icon-512.png', await png(icon, 512));
write('icons/icon-maskable-512.png', await png(maskable, 512));

// --- social image: key art, darkened, with the logo ---
const art = await sharp(join(PUBLIC, 'assets/ui/keyart.jpg')).resize(1200, 630, { fit: 'cover' }).toBuffer();
const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0c10" stop-opacity="0.15"/><stop offset="0.55" stop-color="#0a0c10" stop-opacity="0.35"/><stop offset="1" stop-color="#0a0c10" stop-opacity="0.92"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>`);
const logo = await png(horizontal(PALETTES.dark!), 760);
const logoMeta = await sharp(logo).metadata();
const og = await sharp(art)
  .composite([
    { input: shade, left: 0, top: 0 },
    { input: logo, left: Math.round((1200 - 760) / 2), top: 630 - logoMeta.height! - 70 },
  ])
  .jpeg({ quality: 85, mozjpeg: true })
  .toBuffer();
write('social/og-image.jpg', og);

// --- what the site uses ---
for (const f of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) copyFileSync(join(OUT, 'icons', f), join(PUBLIC, f));
copyFileSync(join(OUT, 'social/og-image.jpg'), join(PUBLIC, 'og-image.jpg'));
console.log('brand kit written to', OUT);
