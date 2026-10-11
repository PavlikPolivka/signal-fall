#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import type { Difficulty } from '@signal-fall/ai';
import type { FactionId } from '@signal-fall/data';
import { batchSpecs, summarize, toCsv, type Side } from './balance';
import { runParallel } from './pool';
import { parseFactions, runBench, runMatch } from './run';

const USAGE = `signal-fall <command> [options]

Commands:
  run    Run a headless match and print state hashes
         --seed <n>        match seed (default 1)
         --ticks <n>       ticks to simulate (default 1200 = 1 min)
         --factions <a,b>  factions per player (default holdout,halcyon)
         --size <n>        map size in tiles (default 96)
         --json            print the full result as JSON
  bench  Tick the 400-unit benchmark battle and report timings
         --ticks <n>       ticks to measure (default 400)
  balance  Play AI vs AI matches in parallel and write a CSV
         --a <faction:difficulty>   side A (default holdout:hard)
         --b <faction:difficulty>   side B (default holdout:easy)
         --matches <n>     number of matches (default 50); sides alternate start positions
         --size <S|M|L>    map size (default M)
         --seed <n>        first seed (default 1)
         --minutes <n>     time limit per match (default 30)
         --threads <n>     worker threads (default cores - 1)
         --out <file>      CSV path (default stdout summary only)
         --min-win <pct>   exit 1 unless side A wins at least this percent
         --max-win <pct>   exit 1 if side A wins more than this percent
`;

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === 'run') {
    const { values } = parseArgs({
      args: rest,
      options: {
        seed: { type: 'string', default: '1' },
        ticks: { type: 'string', default: '1200' },
        factions: { type: 'string', default: 'holdout,halcyon' },
        size: { type: 'string', default: '96' },
        json: { type: 'boolean', default: false },
      },
    });
    const result = runMatch({
      seed: Number(values.seed),
      ticks: Number(values.ticks),
      factions: parseFactions(values.factions),
      size: Number(values.size),
    });
    if (values.json) console.log(JSON.stringify(result));
    else {
      const hex = (h: number) => h.toString(16).padStart(8, '0');
      console.log(`ticks ${result.ticks}  final hash ${hex(result.finalHash)}  ${result.ms.toFixed(1)} ms`);
    }
    return 0;
  }
  if (command === 'bench') {
    const { values } = parseArgs({ args: rest, options: { ticks: { type: 'string', default: '400' } } });
    const r = runBench(Number(values.ticks));
    console.log(`${r.units} units, ${r.ticks} ticks: avg ${r.avgMs.toFixed(3)} ms, max ${r.maxMs.toFixed(2)} ms`);
    return r.avgMs <= 4 ? 0 : 1;
  }
  if (command === 'balance') {
    void balance(rest);
    return 0;
  }
  process.stdout.write(USAGE);
  return command === undefined || command === 'help' || command === '--help' ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));

function parseSide(s: string): Side {
  const [faction, difficulty] = s.split(':') as [FactionId, Difficulty];
  return { faction, difficulty };
}

async function balance(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      a: { type: 'string', default: 'holdout:hard' },
      b: { type: 'string', default: 'holdout:easy' },
      matches: { type: 'string', default: '50' },
      size: { type: 'string', default: 'M' },
      seed: { type: 'string', default: '1' },
      minutes: { type: 'string', default: '30' },
      threads: { type: 'string' },
      out: { type: 'string' },
      'min-win': { type: 'string' },
      'max-win': { type: 'string' },
    },
  });
  const sides: [Side, Side] = [parseSide(values.a), parseSide(values.b)];
  parseFactions(`${sides[0].faction},${sides[1].faction}`);
  const specs = batchSpecs({
    matches: Number(values.matches),
    sides,
    size: values.size as 'S' | 'M' | 'L',
    seed: Number(values.seed),
    maxMinutes: Number(values.minutes),
  });
  const start = Date.now();
  const outcomes = await runParallel(specs, values.threads ? Number(values.threads) : undefined, (done) => {
    if (done % 10 === 0 || done === specs.length) process.stderr.write(`\r${done}/${specs.length} matches`);
  });
  process.stderr.write('\n');
  if (values.out) writeFileSync(values.out, toCsv(sides, outcomes));
  const s = summarize(sides, outcomes);
  const pctA = Math.round((s.winsA * 1000) / outcomes.length) / 10;
  console.log(
    `${values.a} vs ${values.b}: ${s.winsA}-${s.winsB} (${s.draws} draws) · A wins ${pctA}% · avg ${s.avgMinutes} min · ${((Date.now() - start) / 1000).toFixed(0)} s`,
  );
  const min = values['min-win'];
  if (min !== undefined && pctA < Number(min)) process.exitCode = 1;
  const max = values['max-win'];
  if (max !== undefined && pctA > Number(max)) process.exitCode = 1;
}
