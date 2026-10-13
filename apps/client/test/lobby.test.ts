import { afterEach, describe, expect, it } from 'vitest';
import type { Datagram } from '@signal-fall/net';
import { Lobby, type LinkLike } from '../src/net/lobby';
import type { SignalMessage, Signaling } from '../src/net/signaling';

/** In-memory room: messages are delivered asynchronously, like the real channels. */
function hub() {
  const members = new Set<{ id: string; handlers: Set<(m: SignalMessage) => void> }>();
  let n = 0;
  return (): Signaling => {
    const me = { id: `p${n++}`, handlers: new Set<(m: SignalMessage) => void>() };
    members.add(me);
    return {
      id: me.id,
      send(type, data, to) {
        const m: SignalMessage = { from: me.id, to, type, data: structuredClone(data) };
        for (const other of members) if (other !== me && (!to || to === other.id)) queueMicrotask(() => other.handlers.forEach((h) => h(m)));
      },
      onMessage(h) {
        me.handlers.add(h);
        return () => me.handlers.delete(h);
      },
      close() {
        members.delete(me);
      },
    };
  };
}

/** Fake peer links: a pair opens once both ends exist. */
function linker() {
  const ends = new Map<string, () => void>();
  const opened: [string, string][] = [];
  const factory = (self: string) => (remote: string): LinkLike => {
    let resolve!: (d: Datagram) => void;
    const ready = new Promise<Datagram>((r) => (resolve = r));
    const key = [self, remote].sort().join('|');
    const open = () => resolve({ send: () => undefined, onMessage: () => undefined, close: () => undefined });
    const other = ends.get(key);
    if (other) {
      other();
      open();
      opened.push([self, remote]);
    } else ends.set(key, open);
    return { ready, onFailed: () => undefined, close: () => undefined };
  };
  return { factory, opened };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const lobbies: Lobby[] = [];
afterEach(() => {
  while (lobbies.length) lobbies.pop()!.close();
});

function setup() {
  const room = hub();
  const links = linker();
  const make = (host: boolean, name: string, faction = 0) => {
    const sig = room();
    const l = new Lobby(sig, host, { name, faction, uid: `uid-${name}` }, 'ABCD', links.factory(sig.id));
    lobbies.push(l);
    return l;
  };
  return { make, links };
}

describe('lobby', () => {
  it('1v1: a guest takes the open seat, links open, and both start the same match', async () => {
    const { make } = setup();
    const host = make(true, 'Ann', 0);
    const guest = make(false, 'Bob', 2);
    await settle();
    expect(guest.mySlot()).toBe(1);
    expect(host.canStart).toBe(true);
    const started: { slot: number; links: number; humans?: number[] }[] = [];
    for (const l of [host, guest]) l.onStart = (sc, slot, links) => sc.kind === 'skirmish' && started.push({ slot, links: links.size, humans: sc.humans });
    host.start();
    await settle();
    expect(started).toEqual([
      { slot: 0, links: 1, humans: [0, 1] },
      { slot: 1, links: 1, humans: [0, 1] },
    ]);
    expect(host.state!.slots.map((s) => s.player?.uid)).toEqual(['uid-Ann', 'uid-Bob']);
  });

  it('2v2: three people and an AI, every pair of people connected', async () => {
    const { make, links } = setup();
    const host = make(true, 'Ann');
    host.setMode('2v2');
    const a = make(false, 'Bob', 1);
    const b = make(false, 'Cat', 2);
    await settle();
    expect([host.mySlot(), a.mySlot(), b.mySlot()]).toEqual([0, 1, 2]);
    expect(host.canStart).toBe(false); // seat 3 still open
    host.setSeat(3, 'ai');
    host.setAi(3, { faction: 1, difficulty: 'hard' });
    await settle();
    expect(links.opened).toHaveLength(3); // Ann–Bob, Ann–Cat, Bob–Cat
    expect(host.canStart).toBe(true);
    let scenario: unknown;
    let bLinks = 0;
    b.onStart = (sc, _slot, l) => {
      scenario = sc;
      bLinks = l.size;
    };
    host.start();
    await settle();
    expect(scenario).toMatchObject({ factions: [0, 1, 2, 1], ai: [null, null, null, 'hard'], humans: [0, 1, 2], teams: [0, 0, 1, 1] });
    expect(bLinks).toBe(2);
  });

  it('people switch to an open seat; leaving frees the seat; 2v2 with three people cannot shrink to 1v1', async () => {
    const { make } = setup();
    const host = make(true, 'Ann');
    host.setMode('2v2');
    const a = make(false, 'Bob');
    const b = make(false, 'Cat');
    await settle();
    b.moveTo(3);
    await settle();
    expect(b.mySlot()).toBe(3);
    expect(host.state!.slots[2]!.kind).toBe('open');
    host.setMode('1v1');
    expect(host.state!.mode).toBe('2v2');
    a.close();
    lobbies.splice(lobbies.indexOf(a), 1);
    await settle();
    expect(host.state!.slots[1]!.kind).toBe('open');
    expect(host.links.size).toBe(1);
  });

  it('a full room says so', async () => {
    const { make } = setup();
    make(true, 'Ann');
    make(false, 'Bob');
    await settle();
    const late = make(false, 'Cat');
    await settle();
    expect(late.error).toBe('That room is full');
  });
});
