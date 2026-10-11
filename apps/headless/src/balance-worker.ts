import { parentPort, workerData } from 'node:worker_threads';
import { playMatch, type MatchSpec } from './balance';

for (const spec of workerData as MatchSpec[]) parentPort!.postMessage(playMatch(spec));
