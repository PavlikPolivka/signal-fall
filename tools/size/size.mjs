// Initial-load size budget: what a browser downloads to play one match (worst case).
// Run after `pnpm --filter @signal-fall/client build`. Exits 1 over budget.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET = 15 * 1024 * 1024;
const DIST = fileURLToPath(new URL('../../apps/client/dist', import.meta.url));

function size(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, f) => sum + size(join(path, f)), 0);
}
const dirs = (path) => readdirSync(path).filter((f) => statSync(join(path, f)).isDirectory());
const max = (path) => Math.max(0, ...dirs(path).map((d) => size(join(path, d))));

const assets = join(DIST, 'assets');
const code = readdirSync(assets)
  .filter((f) => /\.(js|css|woff2)$/.test(f))
  .reduce((sum, f) => sum + size(join(assets, f)), 0);
const sprites = dirs(join(assets, 'sprites'))
  // The 2x sets replace the 1x ones on Ultra (and are smaller), so they never add to a load.
  .filter((d) => d !== 'props' && !d.endsWith('@2x'))
  .map((d) => size(join(assets, 'sprites', d)))
  .sort((a, b) => b - a);
const parts = {
  'code + fonts': code,
  'sprites (two largest factions)': (sprites[0] ?? 0) + (sprites[1] ?? 0),
  'map props': size(join(assets, 'sprites', 'props')),
  'terrain (largest biome + noise)': max(join(assets, 'terrain')) + size(join(assets, 'terrain', 'noise.png')),
  'icons (largest faction)': max(join(assets, 'icons')),
};
const total = Object.values(parts).reduce((a, b) => a + b, 0);
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
for (const [k, v] of Object.entries(parts)) console.log(`${k.padEnd(34)} ${mb(v)}`);
console.log(`${'total'.padEnd(34)} ${mb(total)} of ${mb(BUDGET)}`);
if (total > BUDGET) {
  console.error('over the initial-load budget');
  process.exit(1);
}
