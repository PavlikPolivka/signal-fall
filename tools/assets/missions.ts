/**
 * Mission art: one 16:9 image per campaign mission, generated with Gemini's image model from the prompts in
 * missions/images.json (the shared `style` plus the mission's own prompt).
 *
 *   pnpm --filter @signal-fall/assets missions [ids...]   # only missing images, or these ids again
 *
 * Writes the full original to build/missions/<id>.png (git ignores it) and a compact WebP for the game to
 * apps/client/public/assets/missions/<id>.webp. A regenerated image keeps the old one as missions/old/<id>_vN.webp
 * (committed, not shipped); the originals go to the `mission-art-originals` GitHub release.
 * The API key comes from the system keychain (macOS keychain or Linux keyring; service "gemini-api", account "signal-fall") or GEMINI_API_KEY.
 */
import { keychain } from './keychain.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'missions/images.json'), 'utf8')) as { model: string; style: string; missions: Record<string, string> };
const outDir = join(here, '../../apps/client/public/assets/missions');
const rawDir = join(here, 'build/missions');
const oldDir = join(here, 'missions/old');
mkdirSync(outDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });
mkdirSync(oldDir, { recursive: true });

function apiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  return keychain('gemini-api');
}
const KEY = apiKey();

async function generate(prompt: string): Promise<Buffer> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } },
    }),
  });
  const body = (await res.json()) as { error?: { message: string }; candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[] };
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error(`no image in the reply: ${JSON.stringify(body).slice(0, 300)}`);
  return Buffer.from(part.inlineData.data, 'base64');
}

/** Keep the image being replaced as <id>_vN. */
function keepOld(id: string): void {
  const cur = join(outDir, `${id}.webp`);
  if (!existsSync(cur)) return;
  let n = 1;
  while (existsSync(join(oldDir, `${id}_v${n}.webp`))) n++;
  copyFileSync(cur, join(oldDir, `${id}_v${n}.webp`));
  if (existsSync(join(rawDir, `${id}.png`))) copyFileSync(join(rawDir, `${id}.png`), join(rawDir, `${id}_v${n}.png`));
}

const asked = process.argv.slice(2);
const ids = asked.length > 0 ? asked : Object.keys(config.missions).filter((id) => !existsSync(join(outDir, `${id}.webp`)));
for (const id of ids) {
  const prompt = config.missions[id];
  if (!prompt) throw new Error(`no prompt for ${id}`);
  process.stdout.write(`${id}… `);
  const raw = await generate(`${config.style}\n\nScene: ${prompt}`);
  if (asked.length > 0) keepOld(id);
  writeFileSync(join(rawDir, `${id}.png`), raw);
  await sharp(raw).resize(1600, 900, { fit: 'cover' }).webp({ quality: 78 }).toFile(join(outDir, `${id}.webp`));
  console.log('done');
}
