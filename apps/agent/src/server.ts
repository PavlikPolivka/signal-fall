import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Difficulty } from '@signal-fall/ai';
import { defaultRules } from '@signal-fall/data';
import { translate, type Action } from './act';
import { AgentMatch, type Seat } from './match';
import { observe } from './observe';
import { GUIDE, rulesDigest } from './rules';
import { watchUrl } from './spectate';

const rules = defaultRules();
const FACTION_IDS = rules.factions.map((f) => f.id) as [string, ...string[]];

/** Matches live in memory for the life of the server process. */
export class MatchManager {
  readonly matches = new Map<string, AgentMatch>();
  /** Base URL of the spectator endpoints, when served: matches then come with a watch link. */
  spectateBase: string | null = null;

  watch(match: AgentMatch): { watch_url: string } | Record<string, never> {
    return this.spectateBase ? { watch_url: watchUrl(this.spectateBase, match.id) } : {};
  }

  get(id: string): AgentMatch {
    const m = this.matches.get(id);
    if (!m) throw new Error(`no match "${id}" (list_matches shows what is running)`);
    return m;
  }

  byJoinCode(code: string): AgentMatch {
    for (const m of this.matches.values()) if (m.joinCode === code.trim().toUpperCase() && m.openSeats.length) return m;
    throw new Error('no match with an open seat for that join code');
  }
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }], isError: true });

const ACTIONS_HELP = `Each action is an object with "do":
build {what} · place {what, at?} · cancel_build {category} · train {what, count?} · cancel_train {what} · research {what} · cancel_research
move | attack_move | patrol {units, to:[x,y], queue?} · attack | guard {units, target:id} · stop | scatter | hold | deploy {units}
stance {units, stance: guard|hold|aggressive|hold_fire} · harvest {units, at} · salvage {units, target} · ability {units, at?, target?}
rally {building, to} · sell | repair {building} · surrender
"units" is a list of ids or "army" | "idle_army" | "harvesters" | "type:<unit id>". Coordinates are tiles.`;

const action = z.looseObject({ do: z.string() });

/** Apply actions for a seat: translate, queue the valid ones, report each. */
function apply(match: AgentMatch, seat: number, actions: Action[]): { ok: boolean; error?: string }[] {
  const results = actions.map((a) => translate(match.sim.world, seat, a));
  match.queue(
    seat,
    results.flatMap((r) => ('cmd' in r ? [r.cmd] : [])),
  );
  return results.map((r) => ('cmd' in r ? { ok: true } : { ok: false, error: r.error }));
}

/** The MCP server: tools to create or join a match, observe, act and end turns, and save replays. */
export function createServer(manager = new MatchManager()): McpServer {
  const server = new McpServer({ name: 'signal-fall', version: '1.0.0' }, { instructions: GUIDE });

  server.registerTool(
    'get_guide',
    { title: 'How to play', description: 'How Signal Fall works and an opening that wins against easy AI. Read this first.', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: GUIDE }] }),
  );

  server.registerTool(
    'get_rules',
    {
      title: 'Rules',
      description: 'Units, structures, upgrades, costs, requirements, weapons and the damage-vs-armor table, for one faction or all.',
      inputSchema: { faction: z.enum(FACTION_IDS).optional() },
    },
    async ({ faction }) => json(rulesDigest(rules, faction)),
  );

  server.registerTool(
    'create_match',
    {
      title: 'Create a match',
      description:
        'Start a 1v1 match. You play seat 0. The opponent is the built-in AI at a difficulty, or "agent": another agent joins with the returned join_code. ' +
        'Your seat is marked as an AI agent everywhere the match is shown. Returns your seat token (needed for every other call) and the first observation.',
      inputSchema: {
        agent_name: z.string().min(1).max(40).describe('Shown as the player name, marked as an AI agent'),
        model: z.string().max(60).optional().describe('Model or program playing, e.g. "claude-opus-5-5"'),
        faction: z.enum(FACTION_IDS),
        opponent: z.enum(['easy', 'normal', 'hard', 'brutal', 'agent']),
        opponent_faction: z.enum(FACTION_IDS),
        map_size: z.enum(['S', 'M', 'L']).optional(),
        biome: z.enum(['wasteland', 'city', 'crystal']).optional(),
        seed: z.number().int().min(0).max(2_147_483_647).optional(),
        turn_seconds: z.number().min(1).max(30).optional().describe('Game seconds per turn (default 5)'),
      },
    },
    async (a) => {
      try {
        const me: Seat = { kind: 'agent', agent: { name: a.agent_name, model: a.model } };
        const them: Seat = a.opponent === 'agent' ? { kind: 'agent', agent: { name: 'waiting for an agent' } } : { kind: 'ai', difficulty: a.opponent as Difficulty };
        const match = new AgentMatch({
          factions: [FACTION_IDS.indexOf(a.faction), FACTION_IDS.indexOf(a.opponent_faction)],
          seats: [me, them],
          seed: a.seed,
          map: { size: a.map_size, biome: a.biome },
          turnTicks: Math.round((a.turn_seconds ?? 5) * rules.constants.tickRate),
        });
        manager.matches.set(match.id, match);
        const { seat, token } = match.claim(0);
        return json({
          match_id: match.id,
          seat,
          token,
          ...manager.watch(match),
          ...(a.opponent === 'agent' ? { join_code: match.joinCode, note: 'Share join_code with the other agent; turns wait for both.' } : {}),
          observation: observe(match, seat),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'join_match',
    {
      title: 'Join a match',
      description: 'Take the open agent seat of a match another agent created (agent vs agent). Returns your seat token and first observation.',
      inputSchema: { join_code: z.string().min(4).max(12), agent_name: z.string().min(1).max(40), model: z.string().max(60).optional() },
    },
    async ({ join_code, agent_name, model }) => {
      try {
        const match = manager.byJoinCode(join_code);
        const { seat, token } = match.claim(undefined, { name: agent_name, model });
        return json({ match_id: match.id, seat, token, ...manager.watch(match), observation: observe(match, seat) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  const seatArgs = { match_id: z.string(), token: z.string() };

  server.registerTool(
    'observe',
    {
      title: 'Observe',
      description: 'What your side knows now: credits, power, your structures and units (ids, positions, hp %, status), queues, what you can build, visible enemies and remembered enemy buildings, Echo fields.',
      inputSchema: seatArgs,
    },
    async ({ match_id, token }) => {
      try {
        const match = manager.get(match_id);
        return json(observe(match, match.seatOf(token)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'act',
    {
      title: 'Queue actions',
      description: `Queue actions for this turn (they apply when the turn is played). Returns ok/error per action.\n${ACTIONS_HELP}`,
      inputSchema: { ...seatArgs, actions: z.array(action).max(60) },
    },
    async ({ match_id, token, actions }) => {
      try {
        const match = manager.get(match_id);
        return json({ results: apply(match, match.seatOf(token), actions as unknown as Action[]) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'end_turn',
    {
      title: 'End turn',
      description:
        'Optionally queue more actions, then end your turn. When every agent in the match has ended theirs, the game runs one turn (a few game seconds) ' +
        `and this returns the new observation. Repeat until "result" is won, lost or draw.\n${ACTIONS_HELP}`,
      inputSchema: { ...seatArgs, actions: z.array(action).max(60).optional() },
    },
    async ({ match_id, token, actions }) => {
      try {
        const match = manager.get(match_id);
        const seat = match.seatOf(token);
        const results = actions?.length ? apply(match, seat, actions as unknown as Action[]) : [];
        await match.endTurn(seat);
        return json({ ...(results.length ? { results } : {}), observation: observe(match, seat) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'save_replay',
    {
      title: 'Save replay',
      description: 'Write the match so far as a replay file. Open it in the game (main menu → Watch a replay) to watch it; agent seats are marked.',
      inputSchema: { match_id: z.string(), path: z.string().optional().describe('File to write (default ./replays/<match>.json)') },
    },
    async ({ match_id, path }) => {
      try {
        const match = manager.get(match_id);
        const file = resolve(path ?? `replays/signal-fall-${match.id}.json`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(match.replay(0)));
        return json({ path: file, ticks: match.sim.tick });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool('list_matches', { title: 'List matches', description: 'Matches running in this server, with open seats and join codes.', inputSchema: {} }, async () =>
    json(
      [...manager.matches.values()].map((m) => ({
        match_id: m.id,
        tick: m.sim.tick,
        over: m.over,
        seats: m.options.seats.map((s, k) => ({ seat: k, faction: rules.factions[m.scenario.factions[k]!]!.id, player: s.kind === 'ai' ? `AI ${s.difficulty}` : `agent ${s.agent.name}` })),
        ...(m.openSeats.length ? { join_code: m.joinCode } : {}),
        ...manager.watch(m),
      })),
    ),
  );

  return server;
}
