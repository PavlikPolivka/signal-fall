import { useEffect, useState } from 'preact/hooks';
import { backend, dailyBoard } from '../net/backend';
import { clock } from '../game/saves';
import { dailyChallenge, today } from '../game/daily';

type Board = Awaited<ReturnType<typeof dailyBoard>>;

/** Today's fastest wins (online only). */
export function DailyBoard({ refresh = 0 }: { refresh?: number }) {
  const [board, setBoard] = useState<Board | null>(null);
  useEffect(() => {
    const sb = backend();
    if (sb) void dailyBoard(sb, today()).then(setBoard, () => undefined);
  }, [refresh]);
  if (!board) return null;
  if (board.top.length === 0) return <p class="muted small">No wins yet today. Be the first.</p>;
  return (
    <ol class="daily-board" data-testid="daily-board">
      {board.top.map((r) => (
        <li class={r.me ? 'me' : ''}>
          <span>#{r.rank}</span> {r.name} <b>{clock(r.ticks)}</b>
        </li>
      ))}
      {board.mine && !board.top.some((r) => r.me) && (
        <li class="me">
          <span>#{board.mine.rank}</span> You <b>{clock(board.mine.ticks)}</b>
        </li>
      )}
    </ol>
  );
}

/** Main menu: today's challenge and how it stands. */
export function DailyPanel() {
  const d = dailyChallenge();
  return (
    <div class="daily" data-testid="daily">
      <button class="mp-btn" data-testid="open-daily" onClick={() => (location.href = `${location.pathname}?daily=1`)} title="The same match for everyone today: the fastest wins top the board">
        Daily challenge
      </button>
      <p class="muted small">{d.label}</p>
      <DailyBoard />
    </div>
  );
}
