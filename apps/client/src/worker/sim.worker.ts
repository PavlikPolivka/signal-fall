/// <reference lib="webworker" />
import { defaultRules } from '@signal-fall/data';
import { LockstepScheduler, NullTransport } from '@signal-fall/net';
import { Sim, createMatch, grantBase, sandbox, type World } from '@signal-fall/sim';
import { generateMap, type Biome } from '@signal-fall/mapgen';
import { attachAi } from '@signal-fall/ai';
import {
  E,
  ENT_STRIDE,
  H,
  HEADER_LEN,
  ORDER_CODE,
  P,
  PLAYER_STRIDE,
  PROD_STRIDE,
  QUEUE_SLOTS,
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

interface MapExtras {
  decoration: Uint8Array;
  biome: Biome;
  mapSeed: number;
}

function createSim(spec: ScenarioSpec): { sim: Sim; extras: MapExtras } {
  const rules = defaultRules();
  switch (spec.kind) {
    case 'skirmish': {
      const map = generateMap({ seed: spec.seed, players: spec.factions.length, ...spec.map });
      const sim = createMatch({
        rules,
        seed: spec.seed,
        map,
        players: spec.factions.map((faction, team) => ({ faction, team })),
      });
      spec.ai.forEach((difficulty, p) => {
        // A computer player without a difficulty is a passive base (sandbox/testing).
        if (difficulty) attachAi(sim, p, difficulty, map.starts);
        else if (p !== 0) grantBase(sim, p, map.starts[p]!);
      });
      return { sim, extras: { decoration: map.decoration, biome: map.biome, mapSeed: map.seedUsed } };
    }
    case 'sandbox':
    case 'stress': {
      const sim = sandbox(rules, { unitsPerSide: spec.unitsPerSide, seed: spec.seed });
      const n = sim.world.map.width * sim.world.map.height;
      return { sim, extras: { decoration: new Uint8Array(n), biome: 'wasteland', mapSeed: spec.seed } };
    }
  }
}

function encode(world: World, stalled: boolean): ArrayBuffer {
  const e = world.entities;
  let count = 0;
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1) count++;
  const players = world.players.length;
  const projectiles = world.projectiles.length;
  const a = new Int32Array(HEADER_LEN + players * PLAYER_STRIDE + count * ENT_STRIDE + projectiles * PROJ_STRIDE);
  a[H.tick] = world.tick;
  a[H.ended] = world.ended ? 1 : 0;
  a[H.winnerTeam] = world.winnerTeam;
  a[H.entityCount] = count;
  a[H.projectileCount] = projectiles;
  a[H.playerCount] = players;
  a[H.stalled] = stalled ? 1 : 0;
  let off = HEADER_LEN;
  for (const p of world.players) {
    a[off + P.credits] = p.credits;
    a[off + P.defeated] = p.defeated ? 1 : 0;
    a[off + P.powerProduced] = p.powerProduced;
    a[off + P.powerUsed] = p.powerUsed;
    a[off + P.lowPower] = p.lowPower ? 1 : 0;
    p.build.forEach((q, i) => {
      const o = off + P.build + i * 3;
      a[o] = q.item;
      a[o + 1] = q.item >= 0 ? Math.floor((q.progress * 1000) / (world.rules.structures[q.item]!.buildTicks * 100)) : 0;
      a[o + 2] = q.ready ? 1 : 0;
    });
    p.production.forEach((q, i) => {
      const o = off + P.production + i * PROD_STRIDE;
      const first = q.items[0];
      a[o] = first !== undefined ? Math.floor((q.progress * 1000) / (world.rules.units[first]!.buildTicks * 100)) : 0;
      for (let k = 0; k < QUEUE_SLOTS; k++) a[o + 1 + k] = q.items[k] ?? -1;
    });
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
  const transfer: Transferable[] = [buf];
  if (fog) transfer.push(fog.buffer);
  if (echo) transfer.push(echo.buffer);
  post({ type: 'snapshot', buf, fog, echo }, transfer);
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
      if (!lockstep.ready(sim.tick)) {
        stalled = true;
        break;
      }
      for (const c of lockstep.take(sim.tick)) sim.schedule(c);
      sim.step();
      acc -= TICK_MS;
      steps++;
    }
    if (acc > TICK_MS * MAX_CATCH_UP) acc = TICK_MS * MAX_CATCH_UP;
    if (steps > 0 || stalled) publish(stalled);
  }, 4);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'start': {
      const created = createSim(msg.scenario);
      sim = created.sim;
      const extras = created.extras;
      localPlayer = msg.localPlayer;
      TICK_MS = 50 / Math.max(0.25, Math.min(8, msg.speed ?? 1));
      lockstep = new LockstepScheduler({ localPlayer, peers: [localPlayer], transport: new NullTransport(), delayTurns: 1 });
      const w = sim.world;
      const terrain = w.map.terrain.slice();
      post(
        {
          type: 'ready',
          width: w.map.width,
          height: w.map.height,
          terrain,
          decoration: extras.decoration,
          biome: extras.biome,
          mapSeed: extras.mapSeed,
          players: w.players.map((p) => ({ faction: p.faction, team: p.team })),
          localPlayer,
        },
        [terrain.buffer, extras.decoration.buffer],
      );
      publish(false);
      return;
    }
    case 'command':
      lockstep?.submit(msg.cmd);
      return;
    case 'pause':
      paused = msg.paused;
      return;
  }
};

loop();
