import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MatchManager } from './server';

/** Where people watch: the hosted game, which follows a stream given in ?watch=. */
export const GAME_URL = process.env.SIGNAL_FALL_GAME_URL ?? 'https://signal-fall.app/play/';

export function watchUrl(base: string, matchId: string): string {
  return `${GAME_URL}?watch=${encodeURIComponent(`${base}/matches/${matchId}/stream`)}`;
}

/**
 * Spectator endpoints (CORS-open, so the hosted game can read a local server):
 *   GET /matches                → running matches and their watch links
 *   GET /matches/<id>/stream    → Server-Sent Events: "start" (scenario and commands so far),
 *                                 then "turn" per played turn, "end" with the final state hash.
 * The browser runs the same deterministic simulation from these commands.
 * Returns false if the request is not for these endpoints.
 */
export function spectate(manager: MatchManager, base: string, req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  const cors = {
    'Access-Control-Allow-Origin': '*',
    // Chrome asks public sites before they reach a local server (Private Network Access).
    'Access-Control-Allow-Private-Network': 'true',
  };
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/matches')) {
    res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' }).end();
    return true;
  }
  if (req.method !== 'GET') return false;
  if (url.pathname === '/matches') {
    const list = [...manager.matches.values()].map((m) => ({
      match_id: m.id,
      tick: m.sim.tick,
      over: m.over,
      seats: m.options.seats.map((s) => (s.kind === 'ai' ? `AI ${s.difficulty}` : `agent ${s.agent.name}`)),
      watch: watchUrl(base, m.id),
    }));
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(list));
    return true;
  }
  const m = /^\/matches\/([0-9a-f]+)\/stream$/.exec(url.pathname);
  if (!m) return false;
  const match = manager.matches.get(m[1]!);
  if (!match) {
    res.writeHead(404, cors).end('no such match\n');
    return true;
  }
  res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('start', { scenario: match.scenario, commands: match.commandsSoFar, until: match.sim.tick, ...(match.over ? { over: true, hash: match.sim.hash() } : {}) });
  if (match.over) {
    res.end();
    return true;
  }
  const stop = match.watch((turn) => {
    send(turn.over ? 'end' : 'turn', turn);
    if (turn.over) res.end();
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  res.on('close', () => {
    stop();
    clearInterval(ping);
  });
  return true;
}
