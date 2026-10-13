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
        </table>
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
