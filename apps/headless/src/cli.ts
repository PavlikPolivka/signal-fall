#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
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
  process.stdout.write(USAGE);
  return command === undefined || command === 'help' || command === '--help' ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
