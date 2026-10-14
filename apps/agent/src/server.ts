import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Difficulty } from '@signal-fall/ai';
import { defaultRules } from '@signal-fall/data';
import { sanitizeDirectives } from '@signal-fall/sim';
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

const PLAN_HELP = `"plan" (with the autopilot) is your standing orders; it replaces the previous plan:
{ build: [structure ids in order, repeat for more], defenses: [ids], army: [[unit id, weight 0-100], ...],
  harvestersPerRefinery: 0-4, maxRefineries: 1-6, research: [upgrade ids], posture: "defend" | "attack" | "all_in", attackAt: army value in credits,
  target: [x, y] or null (nearest known enemy structure), rally: [x, y] or null, scout: bool, harass: bool }
The autopilot (same speed as the built-in AI you face) builds, harvests, places, fills production queues with your mix and builds what that mix needs. It never retreats, defends or
picks counters on its own: watch "events" and change the plan (or give unit orders) yourself.`;

const plan = z.looseObject({}).describe('Standing orders for the autopilot (see the tool description)');

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
        turn_seconds: z.number().min(1).max(30).optional().describe('Game seconds per turn (default 10 with the autopilot, 5 without)'),
        autopilot: z.boolean().optional().describe('Default true: you set a plan (end_turn "plan") and the autopilot does the clicking. False: you give every order yourself.'),
      },
    },
    async (a) => {
      try {
        const autopilot = a.autopilot ?? true;
        // The autopilot's hands match the built-in opponent's (same speed), so only decisions differ.
        const hands = autopilot ? (a.opponent === 'agent' ? 'hard' : (a.opponent as Difficulty)) : false;
        const me: Seat = { kind: 'agent', agent: { name: a.agent_name, model: a.model, autopilot: hands } };
        const them: Seat =
          a.opponent === 'agent' ? { kind: 'agent', agent: { name: 'waiting for an agent', autopilot: hands } } : { kind: 'ai', difficulty: a.opponent as Difficulty };
        const match = new AgentMatch({
          factions: [FACTION_IDS.indexOf(a.faction), FACTION_IDS.indexOf(a.opponent_faction)],
          seats: [me, them],
          seed: a.seed,
          map: { size: a.map_size, biome: a.biome },
          turnTicks: Math.round((a.turn_seconds ?? (autopilot ? 10 : 5)) * rules.constants.tickRate),
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
        'Optionally set a new plan and queue actions, then end your turn. When every agent in the match has ended theirs, the game runs one turn ' +
        '(a few game seconds; wait_turns runs several when nothing needs deciding) and this returns the new observation. Repeat until "result" is ' +
        `won, lost or draw.\n${PLAN_HELP}\n${ACTIONS_HELP}`,
      inputSchema: {
        ...seatArgs,
        plan: plan.optional(),
        actions: z.array(action).max(60).optional(),
        wait_turns: z.number().int().min(1).max(12).optional().describe('Turns to play before you are asked again (default 1)'),
      },
    },
    async ({ match_id, token, plan: next, actions, wait_turns }) => {
      try {
        const match = manager.get(match_id);
        const seat = match.seatOf(token);
        let accepted: unknown;
        if (next) {
          accepted = sanitizeDirectives(match.sim.world, seat, next);
          // Choosing counters is the agent's job: the autopilot's automatic counter-picking stays off.
          delete (accepted as { adapt?: boolean }).adapt;
          match.queue(seat, [{ type: 'directives', directives: accepted as never }]);
        }
        const results = actions?.length ? apply(match, seat, actions as unknown as Action[]) : [];
        for (let i = 0; i < (wait_turns ?? 1) && !match.over; i++) {
          await match.endTurn(seat);
          // Stop waiting early when something needs a decision.
          if (i + 1 < (wait_turns ?? 1) && match.attacked(seat)) break;
        }
        return json({ ...(next ? { plan_accepted: accepted } : {}), ...(results.length ? { results } : {}), observation: observe(match, seat) });
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

  server.registerTool(
    'match_report',
    {
      title: 'Match report',
      description:
        'Statistics over the match so far, one sample per game minute for every player: income, army value, units, structures, kills and losses. ' +
        'Use it to review a finished match and decide what to do differently.',
      inputSchema: { match_id: z.string() },
    },
    async ({ match_id }) => {
      try {
        const match = manager.get(match_id);
        const w = match.sim.world;
        return json({
          ticks: match.sim.tick,
          players: w.players.map((p, k) => ({
            seat: k,
            faction: rules.factions[p.faction]!.id,
            controller: match.options.seats[k]!.kind === 'ai' ? 'built-in AI' : 'agent',
            result: match.result(k),
          })),
          minutes: match.samples.map((s) => ({ minute: Math.round(s.tick / 1200), players: s.players })),
        });
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
