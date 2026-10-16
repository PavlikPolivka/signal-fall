/**
 * Rig a generated character and bake its animations with Meshy.
 *
 *   pnpm --filter @signal-fall/assets meshy-rig <id> [...]
 *
 * Needs the character's refine task (meshy/tasks/<id>.json, from meshy.ts with pose_mode t-pose).
 * Remeshes it to 30k faces (rigging's limit is 320k), rigs it, then requests the game's clips merged into one GLB (idle, walk, fire, death; Meshy library
 * action ids below) and downloads it to build/meshy/<id>.anim.glb. Task ids are recorded in the same
 * task file, so a run resumes and nothing is paid for twice.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const API = 'https://api.meshy.ai/openapi/v1';


/** Meshy animation library ids: walk-and-shoot (also idle and fire frames) and death. */
export const CLIPS = { walk: 690, death: 184 } as const;

const KEY = process.env.MESHY_API_KEY ?? execFileSync('security', ['find-generic-password', '-s', 'meshy-api', '-a', 'signal-fall', '-w']).toString().trim();
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

interface Task {
  status: string;
  progress: number;
  result?: Record<string, string>;
  task_error?: { message?: string };
}

async function create(path: string, body: object, base = API): Promise<string> {
  const r = await fetch(`${base}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { result: string }).result;
}

async function wait(path: string, id: string, label: string, base = API): Promise<Task> {
  for (;;) {
    const t = (await (await fetch(`${base}/${path}/${id}`, { headers })).json()) as Task;
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${label} ${t.status}: ${t.task_error?.message ?? ''}`);
    process.stdout.write(`\r${label} ${t.status} ${t.progress}%   `);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

for (const id of process.argv.slice(2)) {
  const file = join(HERE, 'meshy/tasks', `${id}.json`);
  const task = JSON.parse(readFileSync(file, 'utf8')) as { refine_id: string; remesh_id?: string; rig_id?: string; anim_id?: string };
  const save = () => writeFileSync(file, JSON.stringify(task, null, 2) + '\n');
  const out = join(HERE, 'build/meshy', `${id}.anim.glb`);
  if (task.anim_id && existsSync(out)) continue;
  // Rigging takes at most 320k faces: remesh first (a 30 px soldier needs far fewer anyway).
  if (!task.remesh_id) {
    task.remesh_id = await create('remesh', { input_task_id: task.refine_id, target_polycount: 30000, target_formats: ['glb'] });
    save();
  }
  await wait('remesh', task.remesh_id, `${id} remesh`);
  if (!task.rig_id) {
    task.rig_id = await create('rigging', { input_task_id: task.remesh_id, height_meters: 1.75 });
    save();
  }
  await wait('rigging', task.rig_id, `${id} rig`);
  if (!task.anim_id) {
    task.anim_id = await create('animations', { rig_task_id: task.rig_id, action_ids: Object.values(CLIPS) });
    save();
  }
  const anim = await wait('animations', task.anim_id, `${id} animate`);
  const url = anim.result?.animation_glb_url;
  if (!url) throw new Error(`${id}: no animation GLB in ${JSON.stringify(anim.result)}`);
  writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
  // The committed copy: 1024 px JPEG textures, Draco (the rig and clips are kept).
  execFileSync('blender', ['-b', '--factory-startup', '-P', join(HERE, 'blender/meshy_compact.py'), '--', out, join(HERE, 'meshy/models', `${id}.anim.glb`)], { stdio: 'ignore' });
  console.log(`\n${id}: ${out}`);
}
