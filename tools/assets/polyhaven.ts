/**
 * Map props from Poly Haven (CC0): download each listed model (1k glTF) once and keep a compact
 * copy for the repo.
 *
 *   pnpm --filter @signal-fall/assets polyhaven
 *
 * Reads props/polyhaven.json, downloads into build/polyhaven/<id>/, writes props/models/<id>.glb
 * (blender/meshy_compact.py with 15k triangles and 512 px textures) and props/credits.json (authors).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// `tris` overrides the triangle budget per model (trees and shrubs need their leaves).
const LIST = JSON.parse(readFileSync(join(HERE, 'props/polyhaven.json'), 'utf8')) as { models: string[]; tris?: Record<string, number> };
const RAW = join(HERE, 'build/polyhaven');
const OUT = join(HERE, 'props/models');
mkdirSync(OUT, { recursive: true });

interface FileEntry {
  url: string;
  include?: Record<string, { url: string }>;
}

const credits: Record<string, Record<string, string>> = existsSync(join(HERE, 'props/credits.json')) ? JSON.parse(readFileSync(join(HERE, 'props/credits.json'), 'utf8')) : {};
for (const id of LIST.models) {
  const out = join(OUT, `${id}.glb`);
  const dir = join(RAW, id);
  const gltf = join(dir, `${id}_1k.gltf`);
  if (!existsSync(gltf)) {
    const files = (await (await fetch(`https://api.polyhaven.com/files/${id}`)).json()) as { gltf: Record<string, { gltf: FileEntry }> };
    const entry = files.gltf['1k']!.gltf;
    mkdirSync(dir, { recursive: true });
    writeFileSync(gltf, Buffer.from(await (await fetch(entry.url)).arrayBuffer()));
    for (const [rel, f] of Object.entries(entry.include ?? {})) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), Buffer.from(await (await fetch(f.url)).arrayBuffer()));
    }
  }
  if (!credits[id]) credits[id] = ((await (await fetch(`https://api.polyhaven.com/info/${id}`)).json()) as { authors: Record<string, string> }).authors;
  if (!existsSync(out)) {
    execFileSync('blender', ['-b', '--factory-startup', '-P', join(HERE, 'blender/meshy_compact.py'), '--', gltf, out], {
      stdio: 'ignore',
      env: { ...process.env, SF_TRIS: String(LIST.tris?.[id] ?? 15000), SF_TEXTURE: '512' },
    });
  }
  console.log(id);
}
writeFileSync(join(HERE, 'props/credits.json'), JSON.stringify(credits, null, 2) + '\n');
