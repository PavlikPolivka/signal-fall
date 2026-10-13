# Playing Signal Fall with an AI agent (MCP)

`apps/agent` is an [MCP](https://modelcontextprotocol.io) server that lets an AI agent, such as an LLM in
Claude Code or Claude Desktop, or any program that speaks MCP, play Signal Fall. Matches run headless with the
same deterministic simulation as the browser game. Every match can be saved as a replay and watched in
the game. Seats played by agents are always marked **AI agent**, with the agent's name and model.

## Run it

```sh
pnpm install
pnpm agent                      # stdio: one agent
pnpm agent -- --http 7777       # HTTP at http://localhost:7777/mcp: several agents share matches
```

Claude Code:

```sh
claude mcp add signal-fall -- pnpm --dir /path/to/signal-fall agent
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "signal-fall": { "command": "pnpm", "args": ["--dir", "/path/to/signal-fall", "agent"] } } }
```

Then ask the model something like: *"Create a Signal Fall match as Holdout against the easy AI and win it.
Read get_guide first."*

## Tools

| Tool | What it does |
|---|---|
| `get_guide` | How the game works and an opening that beats the easy AI. The server also sends this as its instructions. |
| `get_rules {faction?}` | Units, structures, upgrades with costs, build times, requirements and weapons, plus the damage-vs-armor table. |
| `create_match {agent_name, model?, faction, opponent, opponent_faction, map_size?, biome?, seed?, turn_seconds?}` | A 1v1. `opponent` is `easy` / `normal` / `hard` / `brutal` (built-in AI) or `agent`. Returns `match_id`, your seat `token`, a `join_code` for agent opponents, and the first observation. |
| `join_match {join_code, agent_name, model?}` | Take the open seat of an agent-vs-agent match. |
| `observe {match_id, token}` | Your side's view (below). |
| `act {match_id, token, actions}` | Queue actions for this turn. Each one is answered with ok or an error. |
| `end_turn {match_id, token, actions?}` | Queue actions (optional) and end the turn. When every agent in the match has ended its turn, the game runs one turn and the new observation comes back. |
| `save_replay {match_id, path?}` | Write a replay (default `replays/signal-fall-<id>.json`). |
| `list_matches` | Running matches, seats, and open join codes. |

### Turns

Time moves in turns of `turn_seconds` game seconds (default 5, which is 100 ticks). In each turn you act,
then call `end_turn`. Built-in AIs think continuously inside the simulation, as in a normal skirmish. With
two agents, a turn plays once both have ended theirs. A seat that takes longer than 2 minutes is skipped
for that turn. Before an agent opponent joins, `end_turn` waits for them and the game does not start.

## Observation

All coordinates are tiles; `[x, y]` with x to the east and y to the south on the map grid.

```jsonc
{
  "match": "708a9632", "tick": 400, "time": "0:20", "result": "playing",   // won | lost | draw at the end
  "you": { "seat": 0, "faction": "holdout", "team": 0, "credits": 5400, "power": { "produced": 100, "used": 20, "low": false },
           "harvested": 700, "unit_cap": "6/200" },
  "players": [ { "seat": 1, "faction": "choir", "team": 1, "controller": "built-in AI (easy)", "defeated": false } ],
  "map": { "width": 96, "height": 96, "starts": [ { "seat": 0, "x": 18, "y": 18 }, { "seat": 1, "x": 77, "y": 77 } ] },
  "structures": [ { "id": 65537, "type": "holdfast", "x": 18.5, "y": 18.5, "hp": 100 } ],
  "units": [ { "id": 131074, "type": "grunt", "x": 21.3, "y": 19.8, "hp": 100, "status": "idle" } ],
  "queues": { "structures": { "item": "dynamo", "progress": 40 }, "infantry": { "items": ["grunt", "grunt"], "progress": 10 } },
  "can_build": { "structures": ["dynamo", "smelter"], "defenses": [], "units": ["grunt"], "research": [] },
  "locked": { "motor_pool": "needs smelter" },
  "enemies": [],                                   // only what your team sees right now
  "remembered_enemy_structures": [],               // enemy buildings seen before, with the tick
  "echo_fields": [ { "x": 30, "y": 22, "amount": 5200 } ],
  "notes": ["A finished structure is waiting to be placed."]
}
```

`status` is idle, moving, attack-moving, attacking, fighting, patrolling, guarding, harvesting,
to field, returning cargo, fleeing or salvaging. `hp` is a percentage (shields included).

## Actions

```jsonc
{ "do": "deploy", "units": [131074] }                 // construction vehicle → construction yard
{ "do": "build", "what": "dynamo" }                   // start a structure or defense
{ "do": "place", "what": "dynamo" }                   // place it when ready; "at": [x, y] to place near a tile
{ "do": "train", "what": "grunt", "count": 5 }
{ "do": "research", "what": "<upgrade id>" }
{ "do": "attack_move", "units": "army", "to": [77, 77] }
{ "do": "attack", "units": [131074], "target": 262150 }
{ "do": "harvest", "units": "harvesters", "at": [30, 22] }
{ "do": "rally", "building": 65540, "to": [26, 24] }
```

The full list: `build`, `place`, `cancel_build`, `train`, `cancel_train`, `research`, `cancel_research`, `move`,
`attack_move`, `patrol`, `attack`, `guard`, `stop`, `scatter`, `hold`, `deploy`, `stance` (guard / hold /
aggressive / hold_fire), `harvest`, `salvage`, `ability`, `rally`, `sell`, `repair`, `surrender`.

`units` is a list of ids or a selector: `army` (armed units), `idle_army`, `harvesters`, `type:<unit id>`.
Actions are checked when queued: other players' units, unknown items or a placement with no room come back
as errors and are not sent.

## Fair play

- Agents see what a player would see: their own side fully, enemies only where their team has vision.
- An agent's commands are the same commands a person's mouse and keyboard produce. Nothing else reaches the
  simulation.
- Agent seats carry `agents[seat] = { name, model }` in the match scenario. The replay bar and the post-game
  report mark them **AI agent**. A match with an agent is never shown as a human's.

## Watching

`save_replay` writes a replay. In the game, open **main menu → Watch a replay** and pick the file. It plays at up
to 8× speed with the post-game report, and is checked against the recorded final state.

## Roadmap

Live spectating of agent matches in the browser and an agent ladder (agent vs agent, Elo) are next; see
`docs/ROADMAP.md` item 9.
