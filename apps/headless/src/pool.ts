import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { MatchOutcome, MatchSpec } from './balance';

/** Run matches across worker threads (round-robin split), reporting progress. */
export function runParallel(specs: MatchSpec[], threads = Math.max(1, cpus().length - 1), onResult?: (done: number) => void): Promise<MatchOutcome[]> {
  const n = Math.min(threads, specs.length);
  const chunks: MatchSpec[][] = Array.from({ length: n }, () => []);
  specs.forEach((s, i) => chunks[i % n]!.push(s));
  const results: MatchOutcome[] = [];
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL('./balance-worker.ts', import.meta.url), { workerData: chunk, execArgv: ['--import', 'tsx'] });
          w.on('message', (o: MatchOutcome) => {
            results.push(o);
            onResult?.(results.length);
          });
          w.on('error', reject);
          w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
        }),
    ),
  ).then(() => results.sort((a, b) => a.seed - b.seed));
}
