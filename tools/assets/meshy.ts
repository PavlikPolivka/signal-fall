/**
 * 3D models from Meshy (text to 3D, then textured), recorded so they are generated once.
 *
 *   pnpm --filter @signal-fall/assets meshy [id ...]
 *
 * Prompts live in meshy/models.json. For each entry without a finished refine task, this creates
 * the preview (mesh) and refine (PBR textures) tasks, waits for them, records the task ids in
 * meshy/tasks/<id>.json (one file per model, so several runs can go in parallel) and downloads the
 * GLB to build/meshy/<id>.glb. Entries already done are only downloaded
 * if the GLB is missing. The API key comes from the system keychain (macOS keychain or Linux keyring; service "meshy-api") or MESHY_API_KEY.
 *
 * Team color: prompts ask for bright magenta identification panels; the Blender import keys magenta
 * into the team mask.
 */
import { execFileSync } from 'node:child_process';
import { keychain } from './keychain.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MODELS = join(HERE, 'meshy/models.json');
const TASKS = join(HERE, 'meshy/tasks');
const OUT = join(HERE, 'build/meshy');
const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';

interface Entry {
  prompt: string;
  texture_prompt?: string;
  ai_model?: string;
  /** 't-pose' / 'a-pose' for characters that get rigged and animated. */
  pose_mode?: string;
  preview_id?: string;
  refine_id?: string;
  credits?: number;
}
interface Manifest {
  /** Appended to every prompt of the faction (consistent style). */
  styles: Record<string, string>;
  models: Record<string, Entry & { faction: string }>;
}

function apiKey(): string {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  return keychain('meshy-api');
}
const KEY = apiKey();
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

interface Task {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  model_urls: Record<string, string>;
  thumbnail_url?: string;
  consumed_credits?: number;
  task_error?: { message?: string };
}

async function create(body: object): Promise<string> {
  const r = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`create ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { result: string }).result;
}

async function wait(id: string, label: string): Promise<Task> {
  for (;;) {
    const r = await fetch(`${API}/${id}`, { headers });
    const t = (await r.json()) as Task;
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${label} ${t.status}: ${t.task_error?.message ?? ''}`);
    process.stdout.write(`\r${label} ${t.status} ${t.progress}%   `);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

async function download(url: string, file: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** The committed copy: ~40k triangles, 1024 px JPEG textures, Draco (see blender/meshy_compact.py). */
function compact(id: string): void {
  const dst = join(HERE, 'meshy/models', `${id}.glb`);
  mkdirSync(join(HERE, 'meshy/models'), { recursive: true });
  execFileSync('blender', ['-b', '--factory-startup', '-P', join(HERE, 'blender/meshy_compact.py'), '--', join(OUT, `${id}.glb`), dst], { stdio: 'ignore' });
}

const manifest = JSON.parse(readFileSync(MODELS, 'utf8')) as Manifest;
mkdirSync(OUT, { recursive: true });
mkdirSync(TASKS, { recursive: true });
const only = process.argv.slice(2);

for (const [id, m] of Object.entries(manifest.models)) {
  if (only.length > 0 && !only.includes(id)) continue;
  const glb = join(OUT, `${id}.glb`);
  const taskFile = join(TASKS, `${id}.json`);
  if (existsSync(taskFile)) Object.assign(m, JSON.parse(readFileSync(taskFile, 'utf8')));
  const save = () => writeFileSync(taskFile, JSON.stringify({ preview_id: m.preview_id, refine_id: m.refine_id, credits: m.credits }, null, 2) + '\n');
  if (m.refine_id && existsSync(glb)) {
    if ((m as { kind?: string }).kind !== 'infantry' && !existsSync(join(HERE, 'meshy/models', `${id}.glb`))) compact(id);
    continue;
  }
  const style = manifest.styles[m.faction] ?? '';
  if (!m.preview_id) {
    m.preview_id = await create({
      mode: 'preview',
      prompt: `${m.prompt} ${style}`.slice(0, 800),
      ai_model: m.ai_model ?? 'latest',
      target_formats: ['glb'],
      ...(m.pose_mode ? { pose_mode: m.pose_mode } : {}),
    });
    save();
  }
  const preview = await wait(m.preview_id, `${id} preview`);
  if (!m.refine_id) {
    m.refine_id = await create({
      mode: 'refine',
      preview_task_id: preview.id,
      enable_pbr: true,
      texture_resolution: '2k',
      texture_prompt: (m.texture_prompt ?? `${m.prompt} ${style}`).slice(0, 800),
      target_formats: ['glb'],
    });
    save();
  }
  const refine = await wait(m.refine_id, `${id} refine`);
  m.credits = (preview.consumed_credits ?? 0) + (refine.consumed_credits ?? 0);
  save();
  await download(refine.model_urls.glb!, glb);
  // Characters are rendered from their rigged copy (meshy-rig.ts), not this T-pose.
  if ((m as { kind?: string }).kind !== 'infantry') compact(id);
  if (refine.thumbnail_url) await download(refine.thumbnail_url, join(OUT, `${id}.png`));
  console.log(`\n${id}: ${glb} (${m.credits} credits)`);
}
