import { useEffect, useReducer, useState } from 'preact/hooks';
import type { Rules } from '@signal-fall/data';
import type { ScenarioSpec } from '../protocol';
import { Lobby, roomCode } from '../net/lobby';
import { openRoom, signalingKind, type RoomConnection } from '../net/connect';
import { account, backend, rename, signIn } from '../net/backend';
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
}: {
  rules: Rules;
  onStart: (scenario: ScenarioSpec, slot: number, links: Map<number, LinkLike>, room: LobbyState) => void;
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
      l.onStart = (scenario, slot, links, room) => {
        if (host) r.started();
        onStart(scenario, slot, links, room);
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
  const people = s?.slots.filter((x) => x.kind === 'human') ?? [];
  const status = lobby.error
    ? lobby.error
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
