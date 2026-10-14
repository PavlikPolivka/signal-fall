import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseReplay, runReplay } from '@signal-fall/scenario';
import { translate, type Action } from '../src/act';
import { AgentMatch } from '../src/match';
import { observe, unitIds, type Observation } from '../src/observe';
import { createServer } from '../src/server';

/** A tiny scripted "agent": the guide's opening, one decision per turn. */
function decide(o: Observation): Action[] {
  const out: Action[] = [];
  const mcv = unitIds(o)[0];
  if (!o.structures.length && mcv !== undefined) return [{ do: 'deploy', units: [mcv] }];
  for (const [cat, q] of Object.entries(o.queues)) {
    const item = q as { item: string; ready?: boolean };
    if ((cat === 'structures' || cat === 'defenses') && item.ready) out.push({ do: 'place', what: item.item });
  }
  if (!o.queues.structures) {
    const want = ['power', 'refinery', 'barracks', 'power', 'factory'];
    const have = (role: string) => o.structures.filter((s) => s.type === role).length;
    void have;
    const next = o.can_build.structures.find((id) => !o.structures.some((s) => s.type === id)) ?? o.can_build.structures[0];
    if (next && want.length) out.push({ do: 'build', what: next });
  }
  const infantry = o.can_build.units[0];
  if (infantry && o.you.credits > 600 && !o.queues.infantry) out.push({ do: 'train', what: infantry, count: 3 });
  return out;
}

describe('agent matches', () => {
  it('an agent plays an opening through actions; the match replays exactly', { timeout: 60_000 }, () => {
    const m = new AgentMatch({ factions: [0, 1], seats: [{ kind: 'agent', agent: { name: 'script', model: 'test' } }, { kind: 'ai', difficulty: 'easy' }], seed: 11, map: { size: 'S' } });
    const { seat } = m.claim(0);
    let o = observe(m, seat);
    expect(o.enemies).toHaveLength(0); // fog: the enemy base is far away
    expect(o.players[0]!.controller).toBe('agent: script');
    expect(o.notes.join(' ')).toContain('Deploy');
    for (let turn = 0; turn < 60 && o.result === 'playing'; turn++) {
      for (const a of decide(o)) {
        const r = translate(m.sim.world, seat, a);
        if ('cmd' in r) m.queue(seat, [r.cmd]);
      }
      void m.endTurn(seat);
      o = observe(m, seat);
    }
    expect(o.tick).toBeGreaterThan(5000);
    expect(o.structures.length).toBeGreaterThanOrEqual(3);
    expect(o.you.harvested).toBeGreaterThan(0);
    const replay = m.replay(0);
    expect(replay.scenario.kind === 'skirmish' && replay.scenario.agents?.[0]).toEqual({ name: 'script', model: 'test' });
    expect(runReplay(parseReplay(JSON.stringify(replay)))).toBe(replay.hash);
  });

  it('refuses bad actions with a reason', () => {
    const m = new AgentMatch({ factions: [0, 1], seats: [{ kind: 'agent', agent: { name: 'a' } }, { kind: 'ai', difficulty: 'easy' }], seed: 3, map: { size: 'S' } });
    const w = m.sim.world;
    expect(translate(w, 0, { do: 'build', what: 'nexus' })).toEqual({ error: expect.stringContaining('not a holdout structure') });
    expect(translate(w, 0, { do: 'place', what: 'dynamo' })).toEqual({ error: expect.stringContaining('no finished dynamo') });
    expect(translate(w, 0, { do: 'move', units: [123456], to: [5, 5] })).toEqual({ error: expect.stringContaining('none of those units') });
    const enemyUnit = unitIds(observe(m, 1))[0]!;
    expect(translate(w, 0, { do: 'move', units: [enemyUnit], to: [5, 5] })).toEqual({ error: expect.stringContaining('none of those units') });
    expect(translate(w, 0, { do: 'move', units: 'army', to: [-1, 5] })).toEqual({ error: expect.anything() });
  });

  it('agent vs agent: a turn waits for both', async () => {
    const m = new AgentMatch({
      factions: [0, 2],
      seats: [
        { kind: 'agent', agent: { name: 'a' } },
        { kind: 'agent', agent: { name: 'b' } },
      ],
      seed: 4,
      map: { size: 'S' },
      turnTicks: 40,
    });
    const a = m.claim(0);
    // Before the second agent joins, ending a turn waits for it and plays nothing.
    let joined = false;
    const waiting = m.endTurn(a.seat).then(() => (joined = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(joined).toBe(false);
    const b = m.claim(undefined, { name: 'late' });
    expect(b.seat).toBe(1);
    await waiting;
    expect(m.sim.tick).toBe(0);
    // Now a turn needs both.
    let played = false;
    const first = m.endTurn(a.seat).then(() => (played = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(played).toBe(false);
    await m.endTurn(b.seat);
    await first;
    expect(m.sim.tick).toBe(40);
    expect(observe(m, 0).players[1]!.controller).toBe('agent: late');
  });
});

describe('MCP server', () => {
  it('create a match, play turns, save a replay', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['act', 'create_match', 'end_turn', 'get_guide', 'get_rules', 'join_match', 'list_matches', 'match_report', 'observe', 'save_replay']);

    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      if (r.isError) throw new Error(r.content[0]!.text);
      return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
    };
    const created = await call('create_match', { agent_name: 'Claude', model: 'claude-opus-5-5', faction: 'choir', opponent: 'easy', opponent_faction: 'holdout', map_size: 'S', seed: 9, autopilot: false });
    const id = created.match_id as string;
    const token = created.token as string;
    const o = created.observation as Observation;
    expect(o.you.faction).toBe('choir');
    const mcv = unitIds(o, 'overture')[0]!;
    const turn = await call('end_turn', { match_id: id, token, actions: [{ do: 'deploy', units: [mcv] }, { do: 'build', what: 'nonsense' }] });
    expect(turn.results).toEqual([{ ok: true }, { ok: false, error: expect.any(String) }]);
    expect((turn.observation as Observation).structures.map((s) => s.type)).toContain('opus');
    await expect(call('observe', { match_id: id, token: 'wrong' })).rejects.toThrow('unknown seat token');

    const rulesOut = await call('get_rules', { faction: 'choir' });
    expect(JSON.stringify(rulesOut)).toContain('"id":"basso"');

    const dir = mkdtempSync(join(tmpdir(), 'sf-agent-'));
    const saved = await call('save_replay', { match_id: id, path: join(dir, 'r.json') });
    const replay = parseReplay(readFileSync(saved.path as string, 'utf8'));
    expect(runReplay(replay)).toBe(replay.hash);
  });
});

describe('autopilot over MCP', () => {
  it('a plan steers the autopilot; the match plays to the end; the report has the minutes', { timeout: 120_000 }, async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      if (r.isError) throw new Error(r.content[0]!.text);
      return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
    };
    const c = await call('create_match', { agent_name: 'Planner', faction: 'holdout', opponent: 'easy', opponent_faction: 'halcyon', map_size: 'S', seed: 21 });
    const id = c.match_id as string;
    const token = c.token as string;
    const first = await call('end_turn', {
      match_id: id,
      token,
      plan: { build: ['dynamo', 'smelter', 'bunkhouse', 'motor_pool', 'smelter'], army: [['grunt', 30], ['bulldog', 70], ['laser_shark', 50]], posture: 'attack', attackAt: 3000 },
      wait_turns: 6,
    });
    // Unknown ids are dropped, and the agent is told what stuck.
    expect(first.plan_accepted).toMatchObject({ army: [['grunt', 30], ['bulldog', 70]], posture: 'attack' });
    let o = first.observation as Observation;
    expect(o.plan).toMatchObject({ posture: 'attack' });
    expect(o.events.join(' ')).toContain('Finished');
    for (let i = 0; i < 80 && o.result === 'playing'; i++) o = (await call('end_turn', { match_id: id, token, wait_turns: 12 })).observation as Observation;
    // The match plays to the end (who wins depends on the plan, not on the plumbing).
    expect(['won', 'lost', 'draw']).toContain(o.result);
    const report = await call('match_report', { match_id: id });
    expect((report.minutes as unknown[]).length).toBeGreaterThan(4);
  });
});
