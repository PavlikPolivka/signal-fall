# Roadmap (post-release)

Ordered by benefit relative to effort. Every item updates the Codex and docs where players or developers see it.

| # | Item | Effort | Status |
|---|---|---|---|
| 1 | Requirement names use the faction's buildings (Bunkhouse / spawn / Loft, not "Barracks") | XS | done |
| 2 | Auto-deploy: pushes to `main` go live on Vercel | XS | done |
| 3 | Menus: main menu (Skirmish vs AI / Multiplayer), a setup screen for each with its own map options (the lobby host picks the map), one seamless backdrop video | S | done |
| 4 | Post-game breakdown: income, army value, losses/kills over time; per-player summary | M | done |
| 5 | Choir buildings rework (floating crystal style, like the vehicles; growing seedlings while under construction) | M | done |
| 6 | Permanent accounts: upgrade the anonymous account (email link), display name, sign in elsewhere. Open: custom SMTP for public email delivery; Google/GitHub sign-in needs OAuth apps | M | done (email) |
| 7 | Stats: match history, per-faction records, leaderboard (Elo on 1v1 multiplayer, rated when both players' reports agree) | M | done |
| 8 | 2v2 with any mix of players and AI: 4-seat lobby (open / person / AI per seat), full-mesh peer connections, teams; 2v2 skirmish vs AI. Open: 2v2 results in stats (history records 1v1 only), replacing a player who drops with an AI | L | done |
| 9 | LLM play over MCP: (a) headless agent API + MCP server, AI players labelled as such ([docs/AGENTS.md](AGENTS.md)); (b) live spectating; (c) agent-vs-agent matches and a ladder | XL | (a) done; agent vs agent works on one server; (b), (c) next |
| 10 | Landing page: what the game is, trailer (intro video), screenshots, faction overview, Play button | M | |
