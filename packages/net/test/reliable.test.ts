import { defaultRules } from '@signal-fall/data';
import { FX_ONE, Rng, Sim, spawnUnit, type Command } from '@signal-fall/sim';
import { describe, expect, it } from 'vitest';
import { LockstepScheduler, ReliableLink, ReliableTransport, VirtualClock, lossyPair, type NetMessage } from '../src/index';

const rules = defaultRules();
const TICK_MS = 50;

/** A lossy link pair on a virtual clock. */
function net(clock: VirtualClock, latencyMs: number, jitterMs: number, lossPct: number, seed = 7) {
  const rng = new Rng(seed);
  return lossyPair({
    schedule: (d, fn) => clock.at(clock.time + Math.max(0, d), fn),
    latencyMs,
    jitterMs,
    lossPct,
    random: () => rng.int(1_000_000) / 1_000_000,
  });
}

describe('reliable link', () => {
  it('delivers everything once and in order over loss, jitter and reordering', () => {
    const clock = new VirtualClock();
    const [da, db] = net(clock, 80, 60, 20);
    const a = new ReliableLink(da, { now: () => clock.time });
    const b = new ReliableLink(db, { now: () => clock.time });
    const got: number[] = [];
    b.onMessage((m) => m.kind === 'ping' && got.push(m.t));
    for (let i = 0; i < 300; i++) {
      a.send({ kind: 'ping', player: 0, t: i } satisfies NetMessage);
      for (let k = 0; k < 2; k++) {
        clock.advance(10);
        a.tick();
        b.tick();
      }
    }
    for (let k = 0; k < 500; k++) {
      clock.advance(10);
      a.tick();
      b.tick();
    }
    expect(got).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(a.unacked).toBe(0);
  });
});

describe('lockstep over a lossy network', () => {
  function makeSim() {
    const sim = new Sim({
      rules,
      seed: 21,
      width: 48,
      height: 48,
      players: [
        { faction: 0, team: 0 },
        { faction: 2, team: 1 },
      ],
      victoryRules: false,
    });
    const units: number[][] = [[], []];
    for (let i = 0; i < 12; i++) {
      units[0]!.push(spawnUnit(sim.world, rules.unitIndex.get('grunt')!, 0, (5 + i) * FX_ONE, 5 * FX_ONE));
      units[1]!.push(spawnUnit(sim.world, rules.unitIndex.get('grace')!, 1, (5 + i) * FX_ONE, 40 * FX_ONE));
    }
    return { sim, units };
  }

  function command(player: number, units: number[], k: number): Command {
    const x = ((k * 7919 + player * 31) % 44) + 2;
    const y = ((k * 104729 + player * 17) % 44) + 2;
    if (player === 1 && k % 6 === 0) return { type: 'ability', units: units.slice(0, 4), x: x * FX_ONE, y: y * FX_ONE };
    return k % 3 === 0 ? { type: 'attackMove', units, x: x * FX_ONE, y: y * FX_ONE } : { type: 'move', units, x: x * FX_ONE, y: y * FX_ONE };
  }

  it('150 ms latency and 5% packet loss: three minutes stay in sync with adaptive delay', () => {
    const clock = new VirtualClock();
    const [da, db] = net(clock, 150, 40, 5, 11);
    const transports = [da, db].map((d) => new ReliableTransport([new ReliableLink(d, { now: () => clock.time })]));
    const desyncs: number[] = [];
    const peers = [0, 1].map((p) => ({
      ...makeSim(),
      ls: new LockstepScheduler({
        localPlayer: p,
        peers: [0, 1],
        transport: transports[p]!,
        delayTurns: 2,
        onDesync: (tick) => desyncs.push(tick),
        now: () => clock.time,
      }),
      stalls: 0,
    }));
    const target = 20 * 180;
    let k = 0;
    for (let ms = 0; ms < 600_000 && peers.some((p) => p.sim.tick < target); ms += TICK_MS) {
      for (const peer of peers) {
        const t = transports[peer.ls.localPlayer]!;
        t.tick();
        if (peer.sim.tick >= target) continue;
        if (ms % 1000 === 0) {
          peer.ls.ping();
          if (peer.ls.rtt > 0) peer.ls.setDelay(LockstepScheduler.delayForRtt(peer.ls.rtt));
        }
        if (peer.sim.tick % 41 === 0) peer.ls.submit(command(peer.ls.localPlayer, peer.units[peer.ls.localPlayer]!, k++));
        if (!peer.ls.ready(peer.sim.tick)) {
          peer.stalls++;
          continue;
        }
        for (const c of peer.ls.take(peer.sim.tick)) peer.sim.schedule(c);
        peer.sim.step();
        if (peer.sim.tick % 100 === 0) peer.ls.reportHash(peer.sim.tick, peer.sim.hash());
      }
      clock.advance(TICK_MS);
    }
    for (let i = 0; i < 200; i++) {
      transports.forEach((t) => t.tick());
      clock.advance(TICK_MS);
    }
    expect(peers[0]!.sim.tick).toBe(target);
    expect(peers[1]!.sim.tick).toBe(target);
    expect(peers[0]!.sim.hash()).toBe(peers[1]!.sim.hash());
    expect(desyncs).toEqual([]);
    // Loss costs a resend now and then, but the game keeps moving.
    expect(peers[0]!.stalls).toBeLessThan(target / 2 / 5);
  });
});
