import { useEffect, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import { backend, signIn } from '../net/backend';
import { leaderboard, myMatches, myRating, myRecords, type MatchRow, type RecordRow, type Standing } from '../net/history';

type Tab = 'history' | 'records' | 'leaderboard';

const DIFFICULTIES = ['easy', 'normal', 'hard', 'brutal'];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function duration(ticks: number, rate: number): string {
  const s = Math.floor(ticks / rate);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

const pct = (w: number, l: number) => (w + l === 0 ? '–' : `${Math.round((100 * w) / (w + l))}%`);

/** Match history, personal records per faction and difficulty, and the multiplayer leaderboard. */
export function Stats({ rules, onClose }: { rules: Rules; onClose: () => void }) {
  const sb = backend();
  const [tab, setTab] = useState<Tab>('history');
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [board, setBoard] = useState<Standing[] | null>(null);
  const [mine, setMine] = useState<{ id: string; rating: number; wins: number; losses: number } | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rate = rules.constants.tickRate;
  const fname = (i: number) => rules.factions[i]?.name ?? '?';

  useEffect(() => {
    if (!sb) return;
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    void signIn(sb).then(setMe, fail);
    if (tab === 'history' && !matches) void myMatches(sb).then(setMatches, fail);
    if (tab === 'records' && !records) void myRecords(sb).then(setRecords, fail);
    if (tab === 'leaderboard' && !board) {
      void leaderboard(sb).then(setBoard, fail);
      void myRating(sb).then(setMine, fail);
    }
  }, [tab]);

  const totals = records?.reduce((t, r) => ({ wins: t.wins + r.wins, losses: t.losses + r.losses, draws: t.draws + r.draws, ticks: t.ticks + r.ticks }), { wins: 0, losses: 0, draws: 0, ticks: 0 });

  return (
    <div class="codex-overlay" data-testid="stats" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="codex stats">
        <header class="codex-head">
          <h1>Stats</h1>
          <nav>
            {(
              [
                ['history', 'Match history'],
                ['records', 'Records'],
                ['leaderboard', 'Leaderboard'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button class={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-stats-tab={id}>
                {label}
              </button>
            ))}
          </nav>
          <button class="close" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div class="codex-body prose">
          {!sb ? (
            <p class="lead" data-testid="stats-offline">
              Match history and the leaderboard need the online service, which this build does not have.
            </p>
          ) : error ? (
            <p class="mp-status">{error}</p>
          ) : tab === 'history' ? (
            !matches ? (
              <p class="muted">Loading…</p>
            ) : matches.length === 0 ? (
              <p class="muted" data-testid="stats-empty">
                No matches yet. Finished matches against the AI or other players show up here.
              </p>
            ) : (
              <table class="stats-table" data-testid="stats-history">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Opponent</th>
                    <th>Factions</th>
                    <th>Length</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr>
                      <td class="muted">{when(m.createdAt)}</td>
                      <td>
                        {m.kind === 'skirmish' ? `AI (${cap(m.aiDifficulty ?? '')})` : m.opponentName}
                        {m.kind === 'multiplayer' && (
                          <span class="tag" title={m.rated ? 'Both players reported the same result' : 'Waiting for the opponent’s report'}>
                            {m.rated ? 'rated' : 'unconfirmed'}
                          </span>
                        )}
                      </td>
                      <td>
                        {fname(m.faction)} <span class="muted">vs</span> {fname(m.opponentFaction)}
                      </td>
                      <td>{duration(m.ticks, rate)}</td>
                      <td class={`result ${m.result}`}>{cap(m.result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : tab === 'records' ? (
            !records ? (
              <p class="muted">Loading…</p>
            ) : (
              <div data-testid="stats-records">
                {totals && (
                  <p class="lead">
                    {totals.wins} wins, {totals.losses} losses{totals.draws ? `, ${totals.draws} draws` : ''} · {duration(totals.ticks, rate)} played
                  </p>
                )}
                <h3>Against the AI</h3>
                <table class="stats-table">
                  <thead>
                    <tr>
                      <th>Playing</th>
                      {DIFFICULTIES.map((d) => (
                        <th>{cap(d)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.factions.map((f) => (
                      <tr>
                        <td>{f.name}</td>
                        {DIFFICULTIES.map((d) => {
                          const rs = records.filter((r) => r.kind === 'skirmish' && r.faction === f.index && r.aiDifficulty === d);
                          const w = rs.reduce((n, r) => n + r.wins, 0);
                          const l = rs.reduce((n, r) => n + r.losses, 0);
                          return (
                            <td title={`${pct(w, l)} won`}>
                              {w + l ? (
                                <>
                                  <b>{w}</b>–{l}
                                </>
                              ) : (
                                <span class="muted">–</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>Against players</h3>
                <table class="stats-table">
                  <thead>
                    <tr>
                      <th>Playing</th>
                      {rules.factions.map((f) => (
                        <th>vs {f.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.factions.map((f) => (
                      <tr>
                        <td>{f.name}</td>
                        {rules.factions.map((o) => {
                          const r = records.find((x) => x.kind === 'multiplayer' && x.faction === f.index && x.opponentFaction === o.index);
                          return <td>{r ? `${r.wins}–${r.losses}` : <span class="muted">–</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : !board ? (
            <p class="muted">Loading…</p>
          ) : (
            <div data-testid="stats-leaderboard">
              <p class="muted small">
                Rated 1v1 multiplayer (Elo, everyone starts at 1200). A match counts once both players’ games report the same result. Only saved accounts
                are listed.
              </p>
              {mine && !board.some((s) => s.id === mine.id) && (
                <p class="small">
                  Your rating: <b>{mine.rating}</b> ({mine.wins}–{mine.losses}). Save your account (Account in the main menu) to appear here.
                </p>
              )}
              {board.length === 0 ? (
                <p class="muted">Nobody is ranked yet.</p>
              ) : (
                <table class="stats-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Rating</th>
                      <th>W–L</th>
                      <th>Won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.map((s, i) => (
                      <tr class={s.id === me ? 'me' : ''}>
                        <td class="muted">{i + 1}</td>
                        <td>{s.name}</td>
                        <td>
                          <b>{s.rating}</b>
                        </td>
                        <td>
                          {s.wins}–{s.losses}
                        </td>
                        <td>{pct(s.wins, s.losses)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
