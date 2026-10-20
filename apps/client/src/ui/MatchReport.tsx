import { useState } from 'preact/hooks';
import type { ClientState } from '../game/state';
import { TEAM_COLORS } from '../game/state';
import type { MatchStats, StatPoint } from '../game/scenario';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const minutes = (tick: number) => tick / 1200;
const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US'));

type Metric = { key: keyof StatPoint; label: string; hint: string };
const CHARTS: Metric[] = [
  { key: 'income', label: 'Income', hint: 'Echo harvested so far' },
  { key: 'army', label: 'Army value', hint: 'Cost of the armed units alive' },
  { key: 'valueKilled', label: 'Destroyed', hint: 'Value of enemy units and buildings destroyed' },
  { key: 'valueLost', label: 'Lost', hint: 'Value of own units and buildings lost' },
];

/** A simple multi-line chart: one line per player over match time. */
function Chart({ stats, metric, names }: { stats: MatchStats; metric: keyof StatPoint; names: string[] }) {
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 12, t: 10, b: 24 };
  const samples = stats.samples;
  const maxT = Math.max(1, samples[samples.length - 1]?.tick ?? 1);
  // Round the scale up to a 1/2/5 step so the axis reads 0, 5k, 10k... rather than odd numbers.
  const raw = Math.max(1, ...samples.flatMap((s) => s.players.map((p) => p[metric] as number)));
  const mag = 10 ** Math.floor(Math.log10(raw / 4));
  const stepV = [1, 2, 5, 10].map((k) => k * mag).find((v) => v * 4 >= raw) ?? 10 * mag;
  const maxV = stepV * 4;
  const x = (t: number) => pad.l + ((W - pad.l - pad.r) * t) / maxT;
  const y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / maxV;
  const mins = Math.floor(minutes(maxT));
  const step = mins > 20 ? 5 : mins > 8 ? 2 : 1;
  return (
    <svg class="report-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric} over time`}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(maxV * f)} y2={y(maxV * f)} class="grid" />
          <text x={pad.l - 6} y={y(maxV * f) + 4} class="axis" text-anchor="end">
            {fmt(Math.round(maxV * f))}
          </text>
        </g>
      ))}
      {Array.from({ length: Math.floor(mins / step) + 1 }, (_, i) => i * step).map((m) => (
        <text x={x(m * 1200)} y={H - 6} class="axis" text-anchor="middle">
          {m}:00
        </text>
      ))}
      {stats.players.map((_, p) => (
        <polyline
          points={samples.map((s) => `${x(s.tick).toFixed(1)},${y(s.players[p]![metric] as number).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={hex(TEAM_COLORS[p % TEAM_COLORS.length]!)}
          stroke-width="2.5"
          stroke-linejoin="round"
        >
          <title>{names[p]}</title>
        </polyline>
      ))}
    </svg>
  );
}

/** Post-game breakdown: who did what, and how the match went over time. */
export function MatchReport({ state, onClose }: { state: ClientState; onClose: () => void }) {
  const [chart, setChart] = useState<keyof StatPoint>('income');
  const stats = state.stats;
  if (!stats) {
    return (
      <div class="menu-overlay" data-testid="match-report">
        <div class="menu">
          <p class="muted">Collecting the numbers…</p>
        </div>
      </div>
    );
  }
  const last = stats.samples[stats.samples.length - 1]!;
  const winner = state.cur && state.cur.a[1] === 1 ? (state.cur.a[2] ?? -1) : -1;
  const names = stats.players.map((p, i) => {
    const faction = state.rules.factions[p.faction]!.name;
    const seat = state.seats[i];
    const who = seat ? (seat.kind === 'agent' ? `🤖 ${seat.label} (AI agent)` : seat.label) : i === state.localPlayer && !state.spectator ? 'You' : `Player ${i + 1}`;
    return `${who} · ${faction}`;
  });
  // [label, value, lower is better]
  const rows: [string, (s: StatPoint) => number, boolean][] = [
    ['Echo harvested', (s) => s.income, false],
    ['Units built', (s) => s.built, false],
    ['Units destroyed', (s) => s.unitsKilled, false],
    ['Units lost', (s) => s.unitsLost, true],
    ['Buildings destroyed', (s) => s.structuresKilled, false],
    ['Buildings lost', (s) => s.structuresLost, true],
    ['Value destroyed', (s) => s.valueKilled, false],
    ['Value lost', (s) => s.valueLost, true],
  ];
  // Habits over the whole match (every sample): lower is better for each.
  const n = Math.max(1, stats.samples.length);
  const each = (f: (s: StatPoint) => number) => last.players.map((_, i) => stats.samples.reduce((a, smp) => a + f(smp.players[i]!), 0));
  const mss = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs) % 60).padStart(2, '0')}`;
  const habits: [string, string, number[], (v: number) => string][] = [
    ['Factory idle time', 'Time a barracks, factory or airfield stood with nothing queued (each tab counts)', each((s) => s.idleTabs).map((v) => (v * stats.interval) / 20), mss],
    ['Credits held (average)', 'Money not spent is an army not built', each((s) => s.credits).map((v) => Math.round(v / n)), (v) => `◆${v.toLocaleString('en-US')}`],
    ['Time above ◆3,000', 'How long more than ◆3,000 sat unspent', each((s) => (s.credits > 3000 ? 1 : 0)).map((v) => (v * stats.interval) / 20), mss],
  ];
  const tips = state.spectator || state.replay ? [] : coaching(stats, state.localPlayer, habits[0]![2], habits[1]![2]);
  const duration = `${Math.floor(last.tick / 1200)}:${String(Math.floor(last.tick / 20) % 60).padStart(2, '0')}`;
  return (
    <div class="menu-overlay" data-testid="match-report" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="report">
        <header>
          <h2>Match report</h2>
          <span class="muted">{duration}</span>
          <button class="close" onClick={onClose}>
            Close
          </button>
        </header>
        <table class="report-table">
          <thead>
            <tr>
              <th />
              {names.map((n, i) => (
                <th style={{ color: hex(TEAM_COLORS[i % TEAM_COLORS.length]!) }}>
                  {n}
                  {winner >= 0 && stats.players[i]!.team === winner ? ' 🏆' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get, lowerBetter]) => {
              const values = last.players.map(get);
              const best = lowerBetter ? Math.min(...values) : Math.max(...values);
              const tied = values.every((v) => v === best);
              return (
                <tr>
                  <td>{label}</td>
                  {values.map((v) => (
                    <td class={v === best && !tied ? 'best' : ''}>{v.toLocaleString('en-US')}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tbody data-testid="report-habits">
            {habits.map(([label, title, values, show]) => {
              const best = Math.min(...values);
              const tied = values.every((v) => v === best);
              return (
                <tr title={title}>
                  <td>{label}</td>
                  {values.map((v) => (
                    <td class={v === best && !tied ? 'best' : ''}>{show(v)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {stats.actions && last.tick > 0 && (
            <tbody>
              <tr>
                <td title="Orders per minute of game time (people only)">Actions per minute</td>
                {stats.actions.map((a, i) => (
                  <td>{state.seats[i]?.kind === 'ai' ? '—' : Math.round((a * 1200) / last.tick)}</td>
                ))}
              </tr>
            </tbody>
          )}
        </table>
        {tips.length > 0 && (
          <div class="report-tips" data-testid="report-tips">
            <h3>Next time</h3>
            <ul>
              {tips.map((t) => (
                <li>{t}</li>
              ))}
            </ul>
          </div>
        )}
        <nav class="report-tabs">
          {CHARTS.map((c) => (
            <button class={chart === c.key ? 'active' : ''} title={c.hint} onClick={() => setChart(c.key)} data-chart={c.key}>
              {c.label}
            </button>
          ))}
        </nav>
        <Chart stats={stats} metric={chart} names={names} />
      </div>
    </div>
  );
}

/**
 * Three things to do better, from the report: each check scores how far off the player was, and the
 * worst three are shown (nothing when the match went well on every count).
 */
function coaching(stats: MatchStats, me: number, idleSecs: number[], heldAvg: number[]): string[] {
  const last = stats.samples[stats.samples.length - 1]!;
  const mine = last.players[me];
  if (!mine) return [];
  const myTeam = stats.players[me]?.team;
  const foes = last.players.filter((_, i) => stats.players[i]?.team !== myTeam);
  if (foes.length === 0) return [];
  const best = (f: (s: StatPoint) => number) => Math.max(...foes.map(f));
  const secs = (last.tick / 20) || 1;
  const mmss = (v: number) => `${Math.floor(v / 60)}:${String(Math.round(v) % 60).padStart(2, '0')}`;
  const out: [number, string][] = [];
  const idle = idleSecs[me] ?? 0;
  if (idle > secs * 0.25)
    out.push([idle / secs, `Your factories stood idle for ${mmss(idle)}. Keep something queued: Ctrl+click a unit to repeat it, or Shift+click for five.`]);
  const held = heldAvg[me] ?? 0;
  if (held > 2000) out.push([held / 4000, `You held ◆${held.toLocaleString('en-US')} on average. Money in the bank fights nobody: build another factory and spend it.`]);
  const income = best((s) => s.income);
  if (income > 0 && mine.income < income * 0.8)
    out.push([1 - mine.income / income, `The enemy harvested ◆${(income - mine.income).toLocaleString('en-US')} more. Take a second Echo field early, with two or three harvesters per refinery.`]);
  if (mine.valueLost > mine.valueKilled * 1.5 && mine.valueLost > 2000)
    out.push([Math.min(2, mine.valueLost / Math.max(1, mine.valueKilled)) / 2, 'You lost much more than you destroyed. Fight next to your defenses, focus fire on one target, and pull hurt units back.']);
  const built = best((s) => s.built);
  if (built > 0 && mine.built < built * 0.7) out.push([1 - mine.built / built, `You built ${mine.built} units to their ${built}. More barracks and factories build faster: each extra one speeds up its tab.`]);
  return out.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, t]) => t);
}
