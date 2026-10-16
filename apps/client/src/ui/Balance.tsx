import { useEffect, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';

/** Where CI publishes the latest balance run (see the `balance` job in .github/workflows/ci.yml). */
export const BALANCE_URL = 'https://raw.githubusercontent.com/PavlikPolivka/signal-fall/balance-data/balance.json';
const REPO = 'https://github.com/PavlikPolivka/signal-fall';

interface Side {
  faction: string;
  harvested: number;
  topUnits: string[];
  strategies: Record<string, { wins: number; matches: number }>;
}
interface Report {
  commit: string | null;
  date: string;
  matchesPerPairing: number;
  gate: { min: number; max: number; easyMin: number };
  ok: boolean;
  pairings: { a: Side; b: Side; winsA: number; winsB: number; draws: number; winPctA: number; avgMinutes: number }[];
  /** Normal AI against Normal AI: no abilities, like a player who doesn't micro. Not gated. */
  normal?: { a: string; b: string; winsA: number; winsB: number; draws: number; winPctA: number; avgMinutes: number }[];
  easy: { faction: string; winPct: number; matches: number }[];
}

const STRATEGY_ORDER = ['rush', 'balanced', 'raider', 'tech', 'turtle'];

/** The latest balance results from CI, fetched live. */
export function BalanceReport({ rules }: { rules: Rules }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(BALANCE_URL, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<Report>) : Promise.reject(new Error(String(r.status)))))
      .then(setReport, () => setError(true));
  }, []);
  const faction = (id: string) => rules.factions.find((f) => f.id === id)?.name ?? id;
  const unit = (id: string) => rules.units[rules.unitIndex.get(id) ?? -1]?.name ?? id;

  if (error) return <p class="muted" data-testid="balance-error">The latest balance results could not be loaded. Try again later.</p>;
  if (!report) return <p class="muted">Loading the latest balance results…</p>;
  const { gate } = report;
  const inGate = (pct: number) => pct >= gate.min && pct <= gate.max;
  return (
    <article class="prose balance" data-testid="balance-report">
      <h2>How the factions stand</h2>
      <p>
        Hard AI against Hard AI, {report.matchesPerPairing} matches per pairing on medium maps. The sides swap start positions and the biomes rotate.
        The AI plays by exactly the same rules as players. A pairing counts as balanced when each side wins {gate.min}–{gate.max}%.
      </p>
      <p class="muted">
        Measured {new Date(report.date).toLocaleString()} by the automatic checks
        {report.commit && (
          <>
            {' '}
            on{' '}
            <a href={`${REPO}/commit/${report.commit}`} target="_blank" rel="noopener">
              {report.commit.slice(0, 7)}
            </a>
          </>
        )}
        . {report.ok ? 'Every pairing is within the target.' : 'Not every pairing is within the target yet: tuning continues.'}
      </p>
      <table class="md-table">
        <thead>
          <tr>
            <th>Pairing</th>
            <th>Wins</th>
            <th>First side wins</th>
            <th>Average match</th>
          </tr>
        </thead>
        <tbody>
          {report.pairings.map((p) => (
            <tr>
              <td>
                {faction(p.a.faction)} vs {faction(p.b.faction)}
              </td>
              <td>
                {p.winsA}–{p.winsB}
                {p.draws ? `, ${p.draws} draws` : ''}
              </td>
              <td class={inGate(p.winPctA) ? 'good' : 'bad'}>
                <b>{p.winPctA}%</b>
              </td>
              <td>{p.avgMinutes} min</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Economy and armies</h3>
      <p>Average Echo harvested per match, and the units each side built most:</p>
      <table class="md-table">
        <thead>
          <tr>
            <th>Faction</th>
            <th>Against</th>
            <th>Harvested</th>
            <th>Most built</th>
          </tr>
        </thead>
        <tbody>
          {report.pairings.flatMap((p) =>
            [
              [p.a, p.b],
              [p.b, p.a],
            ].map(([s, vs]) => (
              <tr>
                <td>{faction(s!.faction)}</td>
                <td>{faction(vs!.faction)}</td>
                <td>${s!.harvested.toLocaleString('en-US')}</td>
                <td>{s!.topUnits.map(unit).join(', ')}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <h3>AI strategies</h3>
      <p>Each AI picks one strategy per match. Wins out of matches played with it:</p>
      <table class="md-table">
        <thead>
          <tr>
            <th>Faction</th>
            <th>Against</th>
            {STRATEGY_ORDER.map((s) => (
              <th>{s[0]!.toUpperCase() + s.slice(1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.pairings.flatMap((p) =>
            [
              [p.a, p.b],
              [p.b, p.a],
            ].map(([s, vs]) => (
              <tr>
                <td>{faction(s!.faction)}</td>
                <td>{faction(vs!.faction)}</td>
                {STRATEGY_ORDER.map((name) => {
                  const st = s!.strategies[name];
                  return <td>{st ? `${st.wins}/${st.matches}` : '—'}</td>;
                })}
              </tr>
            )),
          )}
        </tbody>
      </table>
      {report.normal && report.normal.length > 0 && (
        <>
          <h3>Without abilities</h3>
          <p>
            Normal AI against Normal AI. Normal never uses abilities (blink, phase, Dig In, Override), much like a player who doesn't micro. Shown for
            reference; the target applies to Hard.
          </p>
          <table class="md-table">
            <thead>
              <tr>
                <th>Pairing</th>
                <th>Wins</th>
                <th>First side wins</th>
                <th>Average match</th>
              </tr>
            </thead>
            <tbody>
              {report.normal.map((p) => (
                <tr>
                  <td>
                    {faction(p.a)} vs {faction(p.b)}
                  </td>
                  <td>
                    {p.winsA}–{p.winsB}
                    {p.draws ? `, ${p.draws} draws` : ''}
                  </td>
                  <td class={inGate(p.winPctA) ? 'good' : 'bad'}>{p.winPctA}%</td>
                  <td>{p.avgMinutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Difficulty</h3>
      <p>
        Hard beats Easy: {report.easy.map((e) => `${faction(e.faction)} ${e.winPct}%`).join(', ')} ({report.easy[0]?.matches ?? 0} matches each).
      </p>
    </article>
  );
}
