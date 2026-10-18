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
         --points <none|some>  capture points on the maps (default none)
         --crates          crates drop on the maps
         --hill            king of the hill
         --seed <n>        first seed (default 1)
         --minutes <n>     time limit per match (default 30)
         --threads <n>     worker threads (default cores - 1)
         --out <file>      CSV path (default stdout summary only)
         --min-win <pct>   exit 1 unless side A wins at least this percent
         --max-win <pct>   exit 1 if side A wins more than this percent
  balance-report  Every faction pairing (Hard vs Hard) and Hard vs Easy per faction: writes
         balance.json (CI publishes it; the game's Codex shows it) and the CSVs.
         Exits 1 outside 45-55% per pairing or under 90% Hard vs Easy.
         --matches <n>     matches per pairing (default 300)
         --easy <n>        Hard vs Easy matches per faction (default 200)
         --normal <n>      Normal vs Normal matches per pairing, shown not gated (default 100)
         --out <file>      JSON path (default balance.json)
         --csv <dir>       where the CSVs go (default .)
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
  if (command === 'balance-report') {
    void balanceReport(rest);
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
      points: { type: 'string', default: 'none' },
      crates: { type: 'boolean', default: false },
      hill: { type: 'boolean', default: false },
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
    points: values.points === 'some' ? 'some' : 'none',
    crates: values.crates,
    hill: values.hill,
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

const UNIT_TOP = 3;

/**
 * Every faction pairing (Hard vs Hard) plus Hard vs Easy per faction. Writes balance.json, which CI
 * publishes and the game's Codex shows, and a CSV per run. Exits 1 outside the 45-55% / 90% gates.
 */
async function balanceReport(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      matches: { type: 'string', default: '300' },
      easy: { type: 'string', default: '200' },
      normal: { type: 'string', default: '100' },
      out: { type: 'string', default: 'balance.json' },
      csv: { type: 'string', default: '.' },
    },
  });
  const factions: FactionId[] = ['holdout', 'halcyon', 'choir'];
  const pct = (n: number, of: number) => Math.round((n * 1000) / Math.max(1, of)) / 10;
  const run = async (sides: [Side, Side], matches: number) => {
    const outcomes = await runParallel(batchSpecs({ matches, sides, size: 'M', seed: 1, maxMinutes: 30 }));
    writeFileSync(`${values.csv}/balance-${sides[0].faction}-${sides[0].difficulty}-${sides[1].faction}-${sides[1].difficulty}.csv`, toCsv(sides, outcomes));
    return outcomes;
  };
  let ok = true;
  const pairings = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const sides: [Side, Side] = [
        { faction: factions[i]!, difficulty: 'hard' },
        { faction: factions[j]!, difficulty: 'hard' },
      ];
      const outcomes = await run(sides, Number(values.matches));
      const s = summarize(sides, outcomes);
      const winPct = pct(s.winsA, outcomes.length);
      if (winPct < 45 || winPct > 55) ok = false;
      const side = (k: 0 | 1) => {
        const units = new Map<string, number>();
        const strategies: Record<string, { wins: number; matches: number }> = {};
        for (const o of outcomes) {
          for (const p of o.units[k].split(' ')) {
            const [u, n] = p.split(':');
            if (u && n) units.set(u, (units.get(u) ?? 0) + Number(n));
          }
          const st = (strategies[o.strategies[k]] ??= { wins: 0, matches: 0 });
          st.matches++;
          if (o.winner === k) st.wins++;
        }
        return {
          faction: sides[k].faction,
          harvested: Math.round(outcomes.reduce((t, o) => t + o.harvested[k], 0) / outcomes.length),
          topUnits: [...units.entries()].sort((x, y) => y[1] - x[1]).slice(0, UNIT_TOP).map(([u]) => u),
          strategies,
        };
      };
      pairings.push({ a: side(0), b: side(1), winsA: s.winsA, winsB: s.winsB, draws: s.draws, winPctA: winPct, avgMinutes: s.avgMinutes });
      console.log(`${sides[0].faction} vs ${sides[1].faction}: ${s.winsA}-${s.winsB} (${s.draws} draws) · A wins ${winPct}%`);
    }
  }
  // Normal AI does not use abilities, much like a player who doesn't micro: shown, not gated.
  const normal = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const sides: [Side, Side] = [
        { faction: factions[i]!, difficulty: 'normal' },
        { faction: factions[j]!, difficulty: 'normal' },
      ];
      const outcomes = await run(sides, Number(values.normal));
      const s = summarize(sides, outcomes);
      normal.push({ a: sides[0].faction, b: sides[1].faction, winsA: s.winsA, winsB: s.winsB, draws: s.draws, winPctA: pct(s.winsA, outcomes.length), avgMinutes: s.avgMinutes });
      console.log(`normal ${sides[0].faction} vs ${sides[1].faction}: A wins ${pct(s.winsA, outcomes.length)}%`);
    }
  }
  const easy = [];
  for (const f of factions) {
    const sides: [Side, Side] = [
      { faction: f, difficulty: 'hard' },
      { faction: f, difficulty: 'easy' },
    ];
    const outcomes = await run(sides, Number(values.easy));
    const winPct = pct(summarize(sides, outcomes).winsA, outcomes.length);
    if (winPct < 90) ok = false;
    easy.push({ faction: f, winPct, matches: outcomes.length });
    console.log(`${f} hard vs easy: ${winPct}%`);
  }
  const report = {
    commit: process.env.GITHUB_SHA ?? null,
    date: new Date().toISOString(),
    matchesPerPairing: Number(values.matches),
    gate: { min: 45, max: 55, easyMin: 90 },
    ok,
    pairings,
    normal,
    easy,
  };
  writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
  console.log(ok ? 'balance OK' : 'balance outside the gates');
  if (!ok) process.exitCode = 1;
}
