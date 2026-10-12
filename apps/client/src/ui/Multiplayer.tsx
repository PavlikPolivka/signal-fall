import { useEffect, useReducer, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import type { ScenarioSpec } from '../protocol';
import { Lobby, roomCode } from '../net/lobby';
import { openRoom, signalingKind, type RoomConnection } from '../net/connect';
import type { PeerLink } from '../net/webrtc';
import { Logo } from './Logo';
import { MenuVideo } from './Video';

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
}: {
  rules: Rules;
  onStart: (scenario: ScenarioSpec, slot: number, link: PeerLink) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(savedName() || `Commander ${Math.floor(Math.random() * 90 + 10)}`);
  const [code, setCode] = useState('');
  const [faction, setFaction] = useState(0);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [room, setRoom] = useState<RoomConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refresh] = useReducer((n: number, _: undefined) => n + 1, 0);
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

  const enter = async (host: boolean) => {
    const c = host ? roomCode() : code.trim().toUpperCase();
    if (c.length !== 4 || busy) return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Not saved; fine.
    }
    setBusy(true);
    setError(null);
    try {
      const r = await openRoom(host, c, roomCode);
      const l = new Lobby(r.signaling, host, { name, faction }, r.code, { iceServers: r.iceServers });
      l.onChange = () => refresh(undefined);
      l.onStart = (scenario, slot, link) => {
        if (host) r.started();
        onStart(scenario, slot, link);
      };
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
      <div class="setup mp" data-testid="multiplayer">
        <MenuVideo />
        <div class="setup-panel">
          <Logo size={30} />
          <h1>Multiplayer</h1>
          <p class="muted small">1v1 over a direct peer-to-peer connection. Signaling: {signalingKind()}.</p>
          <label class="choice">
            <span class="label">Your name</span>
            <input value={name} maxLength={20} data-testid="mp-name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <button class="start" data-testid="mp-create" disabled={busy} onClick={() => void enter(true)}>
            {busy ? 'Connecting…' : 'Create a room'}
          </button>
          <div class="choice">
            <span class="label">Join with a code</span>
            <div class="seed">
              <input value={code} maxLength={4} placeholder="ABCD" data-testid="mp-code" onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value.toUpperCase())} />
              <button data-testid="mp-join" disabled={code.trim().length !== 4 || busy} onClick={() => void enter(false)}>
                Join
              </button>
            </div>
          </div>
          {error && (
            <p class="mp-status" data-testid="mp-error">
              {error}
            </p>
          )}
          <button class="codex-btn" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const s = lobby.state;
  const me = lobby.mySlot();
  const status = lobby.error
    ? lobby.error
    : !s || s.players.length < 2
      ? lobby.isHost
        ? 'Waiting for your opponent to join…'
        : 'Looking for the room…'
      : lobby.linkOpen
        ? lobby.isHost
          ? 'Connected. Start when ready.'
          : 'Connected. The host starts the match.'
        : 'Connecting…';
  return (
    <div class="setup mp" data-testid="lobby">
      <MenuVideo />
      <div class="setup-panel">
        <h1>
          Room <span class="room-code" data-testid="room-code">{s?.code ?? code}</span>
        </h1>
        {lobby.isHost && <p class="muted small">Send this code to your opponent. They choose Multiplayer → Join.</p>}
        <ul class="lobby-players">
          {(s?.players ?? []).map((p) => (
            <li>
              <b>{p.name}</b>
              <span>{rules.factions[p.faction]!.name}</span>
              <span class="muted">{p.slot === 0 ? 'host' : 'guest'}</span>
            </li>
          ))}
        </ul>
        <div class="choice">
          <span class="label">Your faction</span>
          <div class="seg" data-testid="mp-faction">
            {rules.factions.map((f) => (
              <button
                class={(s?.players.find((p) => p.slot === me)?.faction ?? faction) === f.index ? 'active' : ''}
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
        </div>
        {s && (
          <p class="muted small" data-testid="mp-map">
            Map: {s.map.size} · {s.map.biome} · seed {s.seed}
          </p>
        )}
        <p class="mp-status" data-testid="mp-status">
          {status}
        </p>
        {lobby.isHost && (
          <button class="start" data-testid="mp-start" disabled={!lobby.canStart} onClick={() => lobby.start()}>
            Start match
          </button>
        )}
        <button
          class="codex-btn"
          onClick={() => {
            lobby.close();
            room?.close();
            setLobby(null);
            setRoom(null);
          }}
        >
          Leave room
        </button>
      </div>
    </div>
  );
}
