/// <reference lib="webworker" />
import { LockstepScheduler, NullTransport, type NetMessage, type Transport } from '@signal-fall/net';
import { KIND, Sim, inCoverage, powerStatus, type ScheduledCommand, type World } from '@signal-fall/sim';
import { STATS_INTERVAL, commandsByTick, createSim, sampleStats, scheduleCommand, type MatchStats, type Replay } from '../game/scenario';
import {
  E,
  ENT_FLAG,
  ENT_STRIDE,
  H,
  HEADER_LEN,
  ORDER_CODE,
  P,
  PLAYER_STRIDE,
  POINT_STRIDE,
  P_HARVESTED,
  P_POWER,
  PROD_STRIDE,
  QUEUE_SLOTS,
  BUILD_STRIDE,
  WAYPOINTS,
  PR,
  PROJ_STRIDE,
  type FromWorker,
  type ScenarioSpec,
  type ToWorker,
} from '../protocol';

declare const self: DedicatedWorkerGlobalScope;

let TICK_MS = 50;
const MAX_CATCH_UP = 4;

let sim: Sim | null = null;
let lockstep: LockstepScheduler | null = null;
let localPlayer = 0;
let paused = false;
let lastFogTick = -1;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function encode(world: World, stalled: boolean): ArrayBuffer {
  const e = world.entities;
  let count = 0;
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1) count++;
  const players = world.players.length;
  const projectiles = world.projectiles.length;
  const a = new Int32Array(HEADER_LEN + players * PLAYER_STRIDE + count * ENT_STRIDE + projectiles * PROJ_STRIDE + world.points.length * POINT_STRIDE);
  a[H.tick] = world.tick;
  a[H.ended] = world.ended ? 1 : 0;
  a[H.winnerTeam] = world.winnerTeam;
  a[H.entityCount] = count;
  a[H.projectileCount] = projectiles;
  a[H.playerCount] = players;
  a[H.stalled] = stalled ? 1 : 0;
  a[H.pointCount] = world.points.length;
  let off = HEADER_LEN;
  for (const p of world.players) {
    a[off + P.credits] = p.credits;
    a[off + P.defeated] = p.defeated ? 1 : 0;
    a[off + P.powerProduced] = p.powerProduced;
    a[off + P.powerUsed] = p.powerUsed;
    a[off + P.lowPower] = p.lowPower ? 1 : 0;
    const r = p.research;
    a[off + P.researchItem] = r.item;
    a[off + P.researchProgress] = r.item >= 0 ? Math.floor((r.progress * 1000) / (world.rules.upgrades[r.item]!.researchTicks * 100)) : 0;
    a[off + P.upgrades] = p.upgrades.reduce((bits, v, i) => bits | (v << i), 0);
    p.build.forEach((q, i) => {
      const o = off + P.build + i * BUILD_STRIDE;
      a[o] = q.item;
      a[o + 1] = q.item >= 0 ? Math.floor((q.progress * 1000) / (world.rules.structures[q.item]!.buildTicks * 100)) : 0;
      a[o + 2] = q.ready ? 1 : 0;
      a[o + 3] = q.atX;
      a[o + 4] = q.atY;
    });
    p.production.forEach((q, i) => {
      const o = off + P.production + i * PROD_STRIDE;
      const first = q.items[0];
      a[o] = first !== undefined ? Math.floor((q.progress * 1000) / (world.rules.units[first]!.buildTicks * 100)) : 0;
      for (let k = 0; k < QUEUE_SLOTS; k++) a[o + 1 + k] = q.items[k] ?? -1;
    });
    a[off + P_POWER] = powerStatus(world, p.index);
    a[off + P_HARVESTED] = p.harvested;
    off += PLAYER_STRIDE;
  }
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    a[off + E.handle] = e.handle(s);
    a[off + E.kind] = e.kind[s]!;
    a[off + E.type] = e.type[s]!;
    a[off + E.owner] = e.owner[s]!;
    a[off + E.x] = e.x[s]!;
    a[off + E.y] = e.y[s]!;
    a[off + E.hp] = e.hp[s]!;
    a[off + E.maxHp] = e.maxHp[s]!;
    a[off + E.shields] = e.shields[s]!;
    a[off + E.maxShields] = e.maxShields[s]!;
    a[off + E.facing] = e.facing[s]!;
    a[off + E.rank] = e.rank[s]!;
    a[off + E.vx] = e.vx[s]!;
    a[off + E.vy] = e.vy[s]!;
    a[off + E.stance] = e.stance[s]!;
    a[off + E.target] = e.target[s]!;
    const orders = e.orders[s]!;
    a[off + E.orderCount] = orders.length;
    a[off + E.tileX] = e.tileX[s]!;
    a[off + E.tileY] = e.tileY[s]!;
    a[off + E.repairing] = e.repairing[s]!;
    a[off + E.hstate] = e.hstate[s]!;
    a[off + E.cargo] = e.cargo[s]!;
    a[off + E.rallyX] = e.rallyX[s]!;
    a[off + E.rallyY] = e.rallyY[s]!;
    a[off + E.hmode] = e.hmode[s]!;
    a[off + E.abilityLeft] = Math.max(0, e.abilityReady[s]! - world.tick);
    a[off + E.flags] =
      (e.phasedUntil[s]! > world.tick ? ENT_FLAG.phased : 0) |
      (e.homeOwner[s]! >= 0 ? ENT_FLAG.overridden : 0) |
      (e.kind[s] === KIND.unit && inCoverage(world, s) ? ENT_FLAG.covered : 0) |
      (e.dugInAt[s]! > 0 ? (world.tick >= e.dugInAt[s]! ? ENT_FLAG.dugIn : ENT_FLAG.digging) : 0) |
      (e.jammedUntil[s]! > world.tick ? ENT_FLAG.jammed : 0) |
      (e.uplinkUntil[s]! > world.tick ? ENT_FLAG.uplink : 0);
    for (let k = 0; k < WAYPOINTS; k++) {
      const q = orders[k + 1];
      const p = q && 'x' in q ? q : q && q.type === 'patrol' ? { x: q.bx, y: q.by } : null;
      a[off + E.wp + 2 * k] = p ? p.x : -1;
      a[off + E.wp + 2 * k + 1] = p ? p.y : -1;
    }
    const o = orders[0];
    a[off + E.order] = o ? ORDER_CODE[o.type] : 0;
    if (o) {
      if (o.type === 'move' || o.type === 'attackMove' || o.type === 'attack') {
        a[off + E.orderX] = o.x;
        a[off + E.orderY] = o.y;
      } else if (o.type === 'patrol') {
        a[off + E.orderX] = o.toB ? o.bx : o.ax;
        a[off + E.orderY] = o.toB ? o.by : o.ay;
      } else {
        const t = e.resolve(o.target);
        a[off + E.orderX] = t >= 0 ? e.x[t]! : -1;
        a[off + E.orderY] = t >= 0 ? e.y[t]! : -1;
      }
    }
    off += ENT_STRIDE;
  }
  for (const p of world.projectiles) {
    a[off + PR.ox] = p.ox;
    a[off + PR.oy] = p.oy;
    a[off + PR.x] = p.x;
    a[off + PR.y] = p.y;
    a[off + PR.type] = p.type;
    a[off + PR.ticks] = p.ticks;
    a[off + PR.total] = p.total;
    off += PROJ_STRIDE;
  }
  for (const p of world.points) {
    a.set([p.x, p.y, p.kind, p.owner, p.capturer, p.progress], off);
    off += POINT_STRIDE;
  }
  return a.buffer;
}

function publish(stalled: boolean): void {
  if (!sim) return;
  const w = sim.world;
  const buf = encode(w, stalled);
  // Fog changes every FOG_INTERVAL ticks; ship a copy only when it may have changed.
  let fog: Uint8Array | null = null;
  if (w.tick !== lastFogTick && (w.tick % 4 === 1 || lastFogTick < 0)) {
    fog = w.fog[localPlayer]!.slice();
    lastFogTick = w.tick;
  }
  // Echo changes slowly; ship it once a second.
  const echo = w.tick % 20 === 1 || lastFogTick === w.tick ? w.map.echo.slice() : null;
  // Hand over the cosmetic events (shots, impacts, deaths) and start a fresh log.
  const fx = w.fx.length > 0 ? Int32Array.from(w.fx) : null;
  w.fx.length = 0;
  const transfer: Transferable[] = [buf];
  if (fog) transfer.push(fog.buffer);
  if (echo) transfer.push(echo.buffer);
  if (fx) transfer.push(fx.buffer);
  post({ type: 'snapshot', buf, fog, echo, fx }, transfer);
}

/** Lockstep messages to and from the main thread, which owns the network connection. */
class PortTransport implements Transport {
  private handlers: ((m: NetMessage) => void)[] = [];
  send(msg: NetMessage): void {
    post({ type: 'net', msg });
  }
  onMessage(h: (m: NetMessage) => void): void {
    this.handlers.push(h);
  }
  deliver(msg: NetMessage): void {
    for (const h of this.handlers) h(msg);
  }
  close(): void {}
}

let port: PortTransport | null = null;
/** Peer messages that arrived before our own 'start' (the host may start a moment earlier). */
let earlyNet: NetMessage[] = [];
let scenario: ScenarioSpec | null = null;
/** Every command applied, for desync reports. */
let commandLog: ScheduledCommand[] = [];
/** Start positions (for an AI taking over a seat). */
let starts: { x: number; y: number }[] = [];
/** Ticks at which the AI takes over a person who left (multiplayer). */
const takeovers = new Map<number, number>();
/** Replay playback: commands by tick, and where/what the recording ended. */
let replayCmds: Map<number, ScheduledCommand[]> | null = null;
let replayEnd: { tick: number; hash: number } | null = null;
/** Live spectating: commands are known up to this tick; null when not live. */
let liveUntil: number | null = null;
/** Statistics for the post-game report, sent once when the match ends. */
let stats: MatchStats | null = null;
let statsSent = false;

function recordStats(): void {
  if (!sim || !stats) return;
  if (sim.tick % STATS_INTERVAL === 0 || sim.world.ended) stats.samples.push({ tick: sim.tick, players: sampleStats(sim.world) });
  if (sim.world.ended && !statsSent) {
    statsSent = true;
    post({ type: 'stats', stats: { ...stats, actions: actionCounts() } });
    if (!replayCmds) post({ type: 'final', tick: sim.tick, hash: sim.hash(), winnerTeam: sim.world.winnerTeam });
  }
}
/** Orders each player has given so far (played or replayed). */
function actionCounts(): number[] {
  const n = new Array<number>(sim?.world.players.length ?? 0).fill(0);
  const count = (c: ScheduledCommand) => {
    if (c.player < n.length) n[c.player]!++;
  };
  if (replayCmds) {
    for (const [tick, list] of replayCmds) if (tick <= (sim?.tick ?? 0)) list.forEach(count);
  } else commandLog.forEach(count);
  return n;
}
let desynced = false;
/** Multiplayer housekeeping: ping, adapt the input delay, exchange state hashes. */
const HASH_EVERY = 100;
let lastPing = 0;

function netHousekeeping(now: number): void {
  if (!port || !lockstep || !sim) return;
  if (now - lastPing < 1000) return;
  lastPing = now;
  lockstep.ping();
  if (lockstep.rtt > 0) lockstep.setDelay(LockstepScheduler.delayForRtt(lockstep.rtt));
  post({ type: 'netStatus', delayTurns: lockstep.delayTurns, rtt: lockstep.rtt, waitingOn: lockstep.waitingOn(sim.tick) });
}

function loop(): void {
  let last = performance.now();
  let acc = 0;
  setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    if (!sim || !lockstep || paused) {
      acc = 0;
      return;
    }
    let steps = 0;
    let stalled = false;
    while (acc >= TICK_MS && steps < MAX_CATCH_UP) {
      if (replayCmds) {
        // Replay: the recorded commands drive the match; stop and verify at the recorded end.
        if (replayEnd && sim.tick >= replayEnd.tick) {
          const hash = sim.hash();
          post({ type: 'replayEnd', tick: sim.tick, ok: hash === replayEnd.hash });
          if (stats) post({ type: 'stats', stats: { ...stats, actions: actionCounts(), samples: [...stats.samples, { tick: sim.tick, players: sampleStats(sim.world) }] } });
          replayEnd = null;
          paused = true;
          break;
        }
        // Live: wait at the edge of what has been played so far.
        if (liveUntil !== null && sim.tick >= liveUntil) {
          stalled = true;
          break;
        }
        for (const c of replayCmds.get(sim.tick) ?? []) scheduleCommand(sim, c, starts);
      } else {
        if (!lockstep.ready(sim.tick)) {
          stalled = true;
          break;
        }
        const gone = takeovers.get(sim.tick);
        if (gone !== undefined) {
          takeovers.delete(sim.tick);
          const c: ScheduledCommand = { tick: sim.tick, player: gone, cmd: { type: 'takeover', difficulty: 'normal' } };
          scheduleCommand(sim, c, starts);
          commandLog.push(c);
        }
        for (const c of lockstep.take(sim.tick)) {
          sim.schedule(c);
          commandLog.push(c);
        }
      }
      sim.step();
      recordStats();
      if (port && sim.tick % HASH_EVERY === 0) lockstep.reportHash(sim.tick, sim.hash());
      acc -= TICK_MS;
      steps++;
    }
    if (acc > TICK_MS * MAX_CATCH_UP) acc = TICK_MS * MAX_CATCH_UP;
    if (steps > 0 || stalled) publish(stalled);
    netHousekeeping(now);
  }, 4);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'start': {
      const created = createSim(msg.scenario);
      sim = created.sim;
      const extras = created.extras;
      starts = extras.starts;
      takeovers.clear();
      localPlayer = msg.localPlayer;
      TICK_MS = 50 / Math.max(0.25, Math.min(8, msg.speed ?? 1));
      scenario = msg.scenario;
      port = msg.net ? new PortTransport() : null;
      commandLog = [];
      desynced = false;
      paused = false;
      replayCmds = msg.replay ? commandsByTick(msg.replay.commands) : null;
      stats = { interval: STATS_INTERVAL, players: sim.world.players.map((p) => ({ faction: p.faction, team: p.team })), samples: [{ tick: 0, players: sampleStats(sim.world) }] };
      statsSent = false;
      if (msg.rejoin) {
        // Back in a running multiplayer match: replay what was played, up to the first turn not yet played.
        const played = commandsByTick(msg.rejoin.log);
        const end = (msg.rejoin.taken + 1) * 2;
        while (sim.tick < end && !sim.world.ended) {
          for (const c of played.get(sim.tick) ?? []) {
            scheduleCommand(sim, c, starts);
            commandLog.push(c);
          }
          sim.step();
          recordStats();
        }
      }
      if (msg.resume) {
        // A saved skirmish: replay its orders as fast as possible, then hand over (on a turn boundary).
        const saved = commandsByTick(msg.resume.commands);
        const end = msg.resume.endTick + (msg.resume.endTick % 2);
        while (sim.tick < end && !sim.world.ended) {
          for (const c of saved.get(sim.tick) ?? []) {
            scheduleCommand(sim, c, starts);
            commandLog.push(c);
          }
          sim.step();
          recordStats();
        }
      }
      // A live match starts as an empty replay with its end unknown.
      liveUntil = msg.live ? 0 : null;
      replayEnd = msg.replay && !msg.live ? { tick: msg.replay.endTick, hash: msg.replay.hash } : null;
      lockstep = new LockstepScheduler({
        startTurn: Math.ceil(sim.tick / 2),
        restore: msg.rejoin ? { inputs: msg.rejoin.inputs, ownNext: msg.rejoin.ownNext } : undefined,
        localPlayer,
        peers: msg.net ? msg.net.peers : [localPlayer],
        transport: port ?? new NullTransport(),
        delayTurns: msg.net ? 3 : 1,
        onDesync: (tick, local, remote, player) => {
          if (desynced) return;
          desynced = true;
          const report = JSON.stringify({ version: 1, scenario, localPlayer, tick, local, remote, player, commands: commandLog });
          post({ type: 'desync', tick, local, remote, player, report });
        },
      });
      // Rejoined: send our own turns the others held again, for any peer that missed some.
      if (msg.rejoin) lockstep.resendOwn();
      lockstep.onDropped = (player, turn) => {
        takeovers.set(turn * 2, player);
        post({ type: 'dropped', player });
      };
      const w = sim.world;
      const terrain = w.map.terrain.slice();
      post(
        {
          type: 'ready',
          width: w.map.width,
          height: w.map.height,
          terrain,
          decoration: extras.decoration,
          surface: extras.surface,
          landmark: extras.landmark,
          biome: extras.biome,
          mapSeed: extras.mapSeed,
          players: w.players.map((p) => ({ faction: p.faction, team: p.team })),
          localPlayer,
        },
        [terrain.buffer, extras.decoration.buffer, extras.surface.buffer, extras.landmark.buffer],
      );
      publish(false);
      if (port) for (const m of earlyNet) port.deliver(m);
      earlyNet = [];
      return;
    }
    case 'command':
      lockstep?.submit(msg.cmd);
      return;
    case 'resendOwn':
      lockstep?.resendOwn(msg.from);
      return;
    case 'catchupRequest':
      if (sim && lockstep) post({ type: 'catchup', log: commandLog, taken: lockstep.takenTurn, inputs: lockstep.heldInputs() });
      return;
    case 'dropPeer':
      lockstep?.proposeDrop(msg.player);
      return;
    case 'pause':
      // Nobody pauses a networked match on their own.
      if (!port) paused = msg.paused;
      return;
    case 'speed':
      TICK_MS = 50 / Math.max(0.25, Math.min(16, msg.speed));
      return;
    case 'live':
      if (!replayCmds) return;
      for (const c of msg.commands) {
        const list = replayCmds.get(c.tick) ?? [];
        list.push(c);
        replayCmds.set(c.tick, list);
      }
      if (msg.hash !== undefined) {
        // The end: play to it, then verify like a replay.
        replayEnd = { tick: msg.until, hash: msg.hash };
        liveUntil = null;
      } else liveUntil = msg.until;
      return;
    case 'requestStats':
      if (sim && stats) post({ type: 'stats', stats: { ...stats, actions: actionCounts(), samples: [...stats.samples, { tick: sim.tick, players: sampleStats(sim.world) }] } });
      return;
    case 'saveReplay': {
      if (!sim || !scenario) return;
      const replay: Replay = { format: 'signal-fall-replay', version: 1, scenario, localPlayer, commands: commandLog, endTick: sim.tick, hash: sim.hash() };
      post({ type: 'replay', json: JSON.stringify(replay), purpose: msg.purpose ?? 'download' });
      return;
    }
    case 'net':
      if (port) port.deliver(msg.msg);
      else earlyNet.push(msg.msg);
      return;
  }
};

loop();
