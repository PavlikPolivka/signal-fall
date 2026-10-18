import { useEffect, useReducer, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import type { ScenarioSpec } from '../protocol';
import { Lobby, roomCode } from '../net/lobby';
import { openRoom, signalingKind, type RoomConnection } from '../net/connect';
import { account, backend, findMatch, joinQueue, leaveQueue, publicRooms, rename, signIn, type PublicRoom } from '../net/backend';
import type { LinkLike, LobbySlot, LobbyState } from '../net/lobby';
import type { Difficulty } from '@signal-fall/ai';
import { MenuScreen } from './Setup';
import { Choice, MapSettings } from './MapSettings';
import { TEAM_COLORS } from '../game/state';

const NAME_KEY = 'signalfall.name';

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Create or join a 1v1 room, pick factions, and start (host). */
export function Multiplayer({
  rules,
  onStart,
  onBack,
  rematch,
}: {
  rules: Rules;
  onStart: (scenario: ScenarioSpec, slot: number, links: Map<number, LinkLike>, room: LobbyState, watchers: LinkLike[]) => void;
  onBack: () => void;
  /** Back to the same room after a match: the host reopens it, the others rejoin. */
  rematch?: { host: boolean; room: LobbyState };
}) {
  const [name, setName] = useState(savedName() || `Commander ${Math.floor(Math.random() * 90 + 10)}`);
  const [code, setCode] = useState('');
  const [faction, setFaction] = useState(0);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [room, setRoom] = useState<RoomConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refresh] = useReducer((n: number, _: undefined) => n + 1, 0);
  const [listed, setListed] = useState(false);
  /** Ranked: waiting in the queue (since when), and whether this room came from it (it starts by itself). */
  const [queued, setQueued] = useState<number | null>(null);
  const [rankedRoom, setRankedRoom] = useState(false);
  useEffect(() => {
    const sb = backend();
    if (!sb || queued === null) return;
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const m = await findMatch(sb);
        if (m && !stop) {
          stop = true;
          await leaveQueue(sb);
          setQueued(null);
          void enter(m.host, undefined, m.host ? undefined : m.code, false, m.host ? m.code : undefined);
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setQueued(null);
        return;
      }
      // A little jitter, so two players polling together don't keep missing each other.
      setTimeout(() => void poll(), 1500 + Math.random() * 1000);
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [queued]);
  // A ranked room starts as soon as both players are connected.
  useEffect(() => {
    if (rankedRoom && lobby?.isHost && lobby.canStart) lobby.start();
  });
  const [open, setOpen] = useState<PublicRoom[]>([]);
  // The room browser: open public games, refreshed while this screen shows.
  useEffect(() => {
    const sb = backend();
    if (!sb || lobby) return;
    const load = () => void signIn(sb).then(() => publicRooms(sb)).then(setOpen, () => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [lobby]);
  // Host: keep the public listing current (seats, mode) and alive (heartbeat).
  useEffect(() => {
    const s = lobby?.state;
    if (!room || !lobby?.isHost || !s) return;
    const send = () => {
      const st = lobby.state!;
      room.advertise({ public: listed, title: `${name.trim()}'s ${st.mode} game`, mode: st.mode, openSeats: st.slots.filter((x) => x.kind === 'open').length });
    };
    send();
    const t = setInterval(send, 20_000);
    return () => clearInterval(t);
  }, [room, lobby, listed, lobby?.state?.mode, lobby?.state?.slots.filter((x) => x.kind === 'open').length]);
  // Online, the name is the account's display name (renaming here renames the account).
  const [profileName, setProfileName] = useState<string | null>(null);
  useEffect(() => {
    const sb = backend();
    if (sb)
      void account(sb).then(
        (a) => {
          setProfileName(a.name);
          setName(a.name);
        },
        () => undefined,
      );
  }, []);
  // Rematch: straight back into the room.
  useEffect(() => {
    if (rematch) void enter(rematch.host, rematch.room);
  }, []);
  // Join links: ?room=ABCD opens the join form prefilled.
  useEffect(() => {
    const room = new URLSearchParams(location.search).get('room');
    if (room) setCode(room.toUpperCase());
  }, []);
  useEffect(
    () => () => {
      lobby?.close();
      room?.close();
    },
    [lobby],
  );

  const enter = async (host: boolean, again?: LobbyState, join?: string, spectate = false, ranked?: string) => {
    const c = ranked ?? (again ? again.code : host ? roomCode() : (join ?? code).trim().toUpperCase());
    if (c.length !== 4 || busy) return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Not saved; fine.
    }
    setBusy(true);
    setError(null);
    try {
      const sb = backend();
      if (sb && profileName !== null && name.trim() !== profileName) {
        await rename(sb, name);
        setProfileName(name.trim());
      }
      const uid = sb ? await signIn(sb) : undefined;
      const r = await openRoom(host, c, roomCode, again || ranked ? { reopen: host, waitMs: 60_000 } : {});
      // ?relay=1 forces every packet through the TURN relay (testing strict networks).
      const relayOnly = new URLSearchParams(location.search).get('relay') === '1';
      const mine = again?.slots.find((x) => x.player?.uid === uid || x.player?.name === name.trim())?.faction;
      const l = new Lobby(r.signaling, host, { name: name.trim(), faction: mine ?? faction, uid, spectate }, r.code, { iceServers: r.iceServers, relayOnly }, host ? again : undefined);
      l.onChange = () => refresh(undefined);
      l.onStart = (scenario, slot, links, room, watchers) => {
        if (host) r.started();
        onStart(scenario, slot, links, room, watchers);
      };
      if (ranked) setRankedRoom(true);
      setRoom(r);
      setLobby(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!lobby) {
    return (
      <MenuScreen testid="multiplayer">
        <div class="setup-panel">
          <h1>Multiplayer</h1>
          <p class="muted small">1v1 over a direct peer-to-peer connection. Signaling: {signalingKind()}.</p>
          <label class="choice">
            <span class="label">Your name</span>
            <input value={name} maxLength={20} data-testid="mp-name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <button class="start" data-testid="mp-create" disabled={busy || queued !== null} onClick={() => void enter(true)}>
            {busy ? 'Connecting…' : 'Create a room'}
          </button>
          {backend() &&
            (queued === null ? (
              <button
                class="mp-btn"
                data-testid="mp-ranked"
                disabled={busy}
                title="Play a rated 1v1 against someone near your rating"
                onClick={() => {
                  const sb = backend()!;
                  setError(null);
                  void joinQueue(sb).then(
                    () => setQueued(Date.now()),
                    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                Ranked match
              </button>
            ) : (
              <div class="mp-status" data-testid="mp-queue">
                Looking for an opponent near your rating…{' '}
                <button
                  class="link"
                  onClick={() => {
                    setQueued(null);
                    void leaveQueue(backend()!);
                  }}
                >
                  Cancel
                </button>
              </div>
            ))}
          <div class="choice">
            <span class="label">Join with a code</span>
            <div class="seed">
              <input value={code} maxLength={4} placeholder="ABCD" data-testid="mp-code" onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value.toUpperCase())} />
              <button data-testid="mp-join" disabled={code.trim().length !== 4 || busy} onClick={() => void enter(false)}>
                Join
              </button>
              <button data-testid="mp-watch" disabled={code.trim().length !== 4 || busy} title="Watch the match without playing" onClick={() => void enter(false, undefined, undefined, true)}>
                Watch
              </button>
            </div>
          </div>
          {backend() && (
            <div class="choice" data-testid="open-games">
              <span class="label">Open games</span>
              {open.length === 0 ? (
                <span class="muted small">None right now. Create a room and list it publicly.</span>
              ) : (
                <ul class="open-games">
                  {open.map((r) => (
                    <li>
                      <span>
                        {r.title} <span class="muted">· {r.mode} · {r.openSeats} open</span>
                      </span>
                      <button
                        data-testid={`open-game-${r.code}`}
                        disabled={busy}
                        onClick={() => {
                          setCode(r.code);
                          void enter(false, undefined, r.code);
                        }}
                      >
                        Join
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && (
            <p class="mp-status" data-testid="mp-error">
              {error}
            </p>
          )}
          <button class="codex-btn" onClick={onBack} data-testid="back">
            Back
          </button>
        </div>
      </MenuScreen>
    );
  }

  const s = lobby.state;
  const me = lobby.mySlot();
  const people = s?.slots.filter((x) => x.kind === 'human') ?? [];
  const status = lobby.error
    ? lobby.error
    : lobby.watching()
      ? 'You are watching. The match shows when the host starts it.'
      : !s || me < 0
      ? 'Looking for the room…'
      : s.slots.some((x) => x.kind === 'open')
        ? lobby.isHost
          ? 'Waiting for players to join. You can fill seats with AI.'
          : 'Waiting for players to join…'
        : people.length < 2
          ? 'Multiplayer needs at least one other person.'
          : !people.every((x) => s.ready.includes(x.player!.id))
            ? 'Connecting everyone…'
            : lobby.isHost
              ? 'Everyone is connected. Start when ready.'
              : 'Connected. The host starts the match.';
  const teams = s ? [...new Set(s.slots.map((x) => x.team))] : [];
  const seat = (x: LobbySlot, k: number) => (
    <li class={`lobby-seat ${x.kind}${k === me ? ' me' : ''}`} data-testid={`seat-${k}`}>
      <i class="swatch" style={{ background: `#${TEAM_COLORS[k]!.toString(16).padStart(6, '0')}` }} title="Colour in the match" />
      {x.kind === 'human' ? (
        <>
          <b>
            {x.player!.name}
            {k === me ? ' (you)' : ''}
          </b>
          {k === me ? (
            <div class="seg" data-testid="mp-faction">
              {rules.factions.map((f) => (
                <button
                  class={x.faction === f.index ? 'active' : ''}
                  data-value={f.id}
                  onClick={() => {
                    setFaction(f.index);
                    lobby.setFaction(f.index);
                  }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          ) : (
            <span>{rules.factions[x.faction]!.name}</span>
          )}
          <span class="muted small">{x.player!.id === s!.host ? 'host' : s!.ready.includes(x.player!.id) ? 'connected' : 'connecting…'}</span>
        </>
      ) : x.kind === 'ai' ? (
        <>
          <b>AI</b>
          {lobby.isHost ? (
            <>
              <select value={x.faction} data-testid={`seat-${k}-faction`} onChange={(e) => lobby.setAi(k, { faction: Number((e.currentTarget as HTMLSelectElement).value) })}>
                {rules.factions.map((f) => (
                  <option value={f.index}>{f.name}</option>
                ))}
              </select>
              <select value={x.difficulty} data-testid={`seat-${k}-difficulty`} onChange={(e) => lobby.setAi(k, { difficulty: (e.currentTarget as HTMLSelectElement).value as Difficulty })}>
                {(['easy', 'normal', 'hard', 'brutal'] as const).map((d) => (
                  <option value={d}>{d[0]!.toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
              <button class="link" data-testid={`seat-${k}-open`} onClick={() => lobby.setSeat(k, 'open')}>
                Open seat
              </button>
            </>
          ) : (
            <span>
              {rules.factions[x.faction]!.name} · {x.difficulty}
            </span>
          )}
        </>
      ) : (
        <>
          <span class="muted">Open seat</span>
          {me >= 0 && (
            <button class="link" data-testid={`seat-${k}-take`} onClick={() => lobby.moveTo(k)}>
              Sit here
            </button>
          )}
          {lobby.isHost && (
            <button class="link" data-testid={`seat-${k}-ai`} onClick={() => lobby.setSeat(k, 'ai')}>
              Add AI
            </button>
          )}
        </>
      )}
    </li>
  );
  return (
    <MenuScreen testid="lobby">
      <div class="setup-panel wide">
        <h1>
          Room <span class="room-code" data-testid="room-code">{s?.code ?? code}</span>
        </h1>
        {lobby.isHost && <p class="muted small">Send this code to the other players. They choose Multiplayer → Join.</p>}
        {lobby.isHost && backend() && (
          <label class="check" data-testid="mp-public">
            <input type="checkbox" checked={listed} onChange={(e) => setListed((e.currentTarget as HTMLInputElement).checked)} /> List in Open games, so anyone can join
          </label>
        )}
        <div class="setup-cols">
          <section>
            <h2>Players</h2>
            {s && lobby.isHost && (
              <Choice
                label="Mode"
                value={s.mode}
                options={[
                  ['1v1', '1 vs 1'],
                  ['2v2', '2 vs 2'],
                ]}
                onChange={(m) => lobby.setMode(m)}
                testid="mp-mode"
              />
            )}
            {s &&
              teams.map((t, i) => (
                <div class="lobby-team">
                  {i > 0 && <div class="lobby-vs">vs</div>}
                  <ul class="lobby-players">{s.slots.map((x, k) => (x.team === t ? seat(x, k) : null))}</ul>
                </div>
              ))}
            {(s?.spectators?.length ?? 0) > 0 && (
              <p class="muted small" data-testid="mp-spectators">
                Watching: {s!.spectators!.map((x) => x.name).join(', ')}
              </p>
            )}
            <p class="mp-status" data-testid="mp-status">
              {status}
            </p>
          </section>
          <section data-testid="mp-map">
            <h2>Map{lobby.isHost ? '' : ' (the host chooses)'}</h2>
            {s && (
              <MapSettings
                value={{ ...s.map, seed: s.seed }}
                players={s.slots.length}
                onChange={lobby.isHost ? (patch) => lobby.setMap(patch) : undefined}
              />
            )}
          </section>
        </div>
        <div class="setup-foot">
          <button
            class="codex-btn"
            data-testid="mp-leave"
            onClick={() => {
              lobby.close();
              room?.close();
              setLobby(null);
              setRoom(null);
            }}
          >
            Leave room
          </button>
          {lobby.isHost && (
            <button class="start" data-testid="mp-start" disabled={!lobby.canStart} onClick={() => lobby.start()}>
              Start match
            </button>
          )}
        </div>
      </div>
    </MenuScreen>
  );
}
