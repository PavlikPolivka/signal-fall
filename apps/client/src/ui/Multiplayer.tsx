import { useEffect, useReducer, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import type { ScenarioSpec } from '../protocol';
import { Lobby, roomCode } from '../net/lobby';
import { openRoom, signalingKind, type RoomConnection } from '../net/connect';
import { account, backend, rename, signIn } from '../net/backend';
import type { LobbyState } from '../net/lobby';
import type { PeerLink } from '../net/webrtc';
import { MenuScreen } from './Setup';
import { MapSettings } from './MapSettings';

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
  onStart: (scenario: ScenarioSpec, slot: number, link: PeerLink, room: LobbyState) => void;
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
      const sb = backend();
      if (sb && profileName !== null && name.trim() !== profileName) {
        await rename(sb, name);
        setProfileName(name.trim());
      }
      const uid = sb ? await signIn(sb) : undefined;
      const r = await openRoom(host, c, roomCode);
      // ?relay=1 forces every packet through the TURN relay (testing strict networks).
      const relayOnly = new URLSearchParams(location.search).get('relay') === '1';
      const l = new Lobby(r.signaling, host, { name: name.trim(), faction, uid }, r.code, { iceServers: r.iceServers, relayOnly });
      l.onChange = () => refresh(undefined);
      l.onStart = (scenario, slot, link, room) => {
        if (host) r.started();
        onStart(scenario, slot, link, room);
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
      <MenuScreen testid="multiplayer">
        <div class="setup-panel">
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
          <button class="codex-btn" onClick={onBack} data-testid="back">
            Back
          </button>
        </div>
      </MenuScreen>
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
    <MenuScreen testid="lobby">
      <div class="setup-panel wide">
        <h1>
          Room <span class="room-code" data-testid="room-code">{s?.code ?? code}</span>
        </h1>
        {lobby.isHost && <p class="muted small">Send this code to your opponent. They choose Multiplayer → Join.</p>}
        <div class="setup-cols">
          <section>
            <h2>Players</h2>
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
            <p class="mp-status" data-testid="mp-status">
              {status}
            </p>
          </section>
          <section data-testid="mp-map">
            <h2>Map{lobby.isHost ? '' : ' (the host chooses)'}</h2>
            {s && <MapSettings value={{ ...s.map, seed: s.seed }} onChange={lobby.isHost ? (patch) => lobby.setMap(patch) : undefined} />}
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
