import { defaultRules } from '@signal-fall/data';
import { FX_ONE, Sim, spawnUnit, type Command } from '@signal-fall/sim';
import { describe, expect, it } from 'vitest';
import { LockstepScheduler, LoopbackTransport, NullTransport, TICKS_PER_TURN, VirtualClock } from '../src/index';

const rules = defaultRules();
const TICK_MS = 50;

function makeSim() {
  const sim = new Sim({
    rules,
    seed: 9,
    width: 48,
    height: 48,
    players: [
      { faction: 0, team: 0 },
      { faction: 1, team: 1 },
    ],
    victoryRules: false,
  });
  const units: number[][] = [[], []];
  for (let i = 0; i < 10; i++) {
    units[0]!.push(spawnUnit(sim.world, rules.unitIndex.get('grunt')!, 0, (5 + i) * FX_ONE, 5 * FX_ONE));
    units[1]!.push(spawnUnit(sim.world, rules.unitIndex.get('sentry')!, 1, (5 + i) * FX_ONE, 40 * FX_ONE));
  }
  return { sim, units };
}

/** Pseudo-random but reproducible command stream per player. */
function randomCommand(player: number, units: number[], k: number): Command {
  const x = ((k * 7919 + player * 31) % 44) + 2;
  const y = ((k * 104729 + player * 17) % 44) + 2;
  const pick = units.filter((_, i) => (i + k) % 3 !== 0);
  return k % 4 === 0
    ? { type: 'attackMove', units: pick, x: x * FX_ONE, y: y * FX_ONE }
    : { type: 'move', units: pick, x: x * FX_ONE, y: y * FX_ONE, queue: k % 5 === 0 };
}

describe('lockstep', () => {
  it('single player with NullTransport advances and applies commands after the delay', () => {
    const { sim, units } = makeSim();
    const ls = new LockstepScheduler({ localPlayer: 0, peers: [0], transport: new NullTransport(), delayTurns: 1 });
    ls.submit({ type: 'stop', units: units[0]! });
    const applied: number[] = [];
    for (let i = 0; i < 10; i++) {
      expect(ls.ready(sim.tick)).toBe(true);
      for (const c of ls.take(sim.tick)) {
        applied.push(c.tick);
        sim.schedule(c);
      }
      sim.step();
    }
    // Submitted before turn 0 flushed -> sent for turn 0 + delay(1) = tick 2.
    expect(applied).toEqual([2]);
  });

  it.each([
    ['no latency', 0, 0],
    ['150 ms latency with jitter', 150, 60],
    ['300 ms latency', 300, 0],
  ])('two peers stay in sync: %s', (_name, latency, jitter) => {
    const clock = new VirtualClock();
    let j = 0;
    const link = clock.link(() => latency + (jitter ? (j++ * 37) % jitter : 0));
    const [t0, t1] = LoopbackTransport.mesh(2, link);
    const desyncs: number[] = [];
    const delay = LockstepScheduler.delayForRtt(latency * 2);
    const peers = [0, 1].map((p) => ({
      ...makeSim(),
      ls: new LockstepScheduler({
        localPlayer: p,
        peers: [0, 1],
        transport: p === 0 ? t0! : t1!,
        delayTurns: delay,
        onDesync: (tick) => desyncs.push(tick),
        now: () => clock.time,
      }),
      stalls: 0,
    }));
    const target = 20 * 60; // one minute of game time
    let k = 0;
    // Each peer runs at real-time pace on the virtual clock; stalls when input is missing.
    for (let ms = 0; ms < 200_000 && peers.some((p) => p.sim.tick < target); ms += TICK_MS) {
      for (const peer of peers) {
        if (peer.sim.tick >= target) continue;
        if (peer.sim.tick % 37 === 0) peer.ls.submit(randomCommand(peer.ls.localPlayer, peer.units[peer.ls.localPlayer]!, k++));
        if (!peer.ls.ready(peer.sim.tick)) {
          peer.stalls++;
          continue;
        }
        for (const c of peer.ls.take(peer.sim.tick)) peer.sim.schedule(c);
        peer.sim.step();
        if (peer.sim.tick % 20 === 0) peer.ls.reportHash(peer.sim.tick, peer.sim.hash());
      }
      clock.advance(TICK_MS);
    }
    clock.advance(10_000);
    expect(peers[0]!.sim.tick).toBe(target);
    expect(peers[1]!.sim.tick).toBe(target);
    expect(peers[0]!.sim.hash()).toBe(peers[1]!.sim.hash());
    expect(desyncs).toEqual([]);
    // With a delay matched to latency, stalls stay rare.
    expect(peers[0]!.stalls).toBeLessThan(target / TICKS_PER_TURN / 4);
  });

  it('detects a desync', () => {
    const [t0, t1] = LoopbackTransport.mesh(2);
    const seen: number[] = [];
    const a = new LockstepScheduler({ localPlayer: 0, peers: [0, 1], transport: t0!, delayTurns: 2, onDesync: (t) => seen.push(t) });
    const b = new LockstepScheduler({ localPlayer: 1, peers: [0, 1], transport: t1!, delayTurns: 2 });
    a.reportHash(20, 111);
    b.reportHash(20, 222);
    return Promise.resolve().then(() => expect(seen).toEqual([20]));
  });

  it('changing delay mid-game never skips or duplicates a turn', () => {
    const [t0, t1] = LoopbackTransport.mesh(2);
    const received: number[] = [];
    t1!.onMessage((m) => m.kind === 'turn' && received.push(m.turn));
    const a = new LockstepScheduler({ localPlayer: 0, peers: [0], transport: t0!, delayTurns: 2 });
    const delays = [2, 2, 4, 4, 1, 1, 1, 1, 6, 3, 3, 3, 3, 3, 3];
    delays.forEach((d, turn) => {
      a.setDelay(d);
      a.ready(turn * TICKS_PER_TURN);
      a.take(turn * TICKS_PER_TURN);
    });
    return Promise.resolve().then(() => {
      expect(received).toEqual(Array.from({ length: received.length }, (_, i) => i + 2));
    });
  });

  it('measures round-trip time with ping/pong', () => {
    const clock = new VirtualClock();
    const [t0, t1] = LoopbackTransport.mesh(2, clock.link(() => 40));
    const a = new LockstepScheduler({ localPlayer: 0, peers: [0, 1], transport: t0!, delayTurns: 2, now: () => clock.time });
    new LockstepScheduler({ localPlayer: 1, peers: [0, 1], transport: t1!, delayTurns: 2, now: () => clock.time });
    a.ping();
    clock.advance(200);
    expect(a.rtt).toBe(80);
    expect(LockstepScheduler.delayForRtt(80)).toBe(2);
    expect(LockstepScheduler.delayForRtt(600)).toBe(4);
  });
});
