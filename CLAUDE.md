# Signal Fall: notes for Claude

## Change notes (always)

`CHANGELOG.md` is the player-facing "What's new". The game shows it in the main menu (`apps/client/src/ui/Changes.tsx`).
Every push that changes something a player can notice adds a release entry to it, in the same commit:

- Each release gets its own heading, newest first: `## YYYY-MM-DD HH:MM UTC`. Use the time you commit (`date -u +'%Y-%m-%d %H:%M'`). There can be several releases a day.
- While you work, collect notes under `## Coming in the next release`, and stamp that heading with the time when you commit.
- Write one bullet per change, in plain player language: what changed and why it matters. Don't name code.
- Start a bullet with a bold lead-in when it helps scanning.
- Skip internal-only changes: tests, CI, refactors, docs.
- Supported markdown: `##`/`###` headings, `-` bullets, tables, paragraphs, `**bold**`, `*italic*`, `` `code` ``, `<kbd>`, and `[links](url)`.

## Balance (always)

CI owns the balance numbers. The `balance` job runs `pnpm -s headless balance-report` on every push. On `main` it publishes `balance.json` to the `balance-data` branch, and the Codex Balance tab reads that live. Nothing is kept in the repo by hand.

- Balance applies the same rules to the AI and to players. Never give the AI rules a player doesn't have.
- The gate is 45–55% per faction pairing (Hard vs Hard, 300 matches), and Hard beats Easy at least 90%.
- For changes that can move win rates (unit and structure stats, costs, economy constants, AI code or data, placement, mapgen, combat), check locally before pushing: `pnpm -s headless balance --a holdout:hard --b choir:hard --matches 100`.
- Note what you tuned and why in the *Balance Tuning Log* note in Obsidian (see Tracking below).

## 3D models (Meshy)

Generated models cost credits, so never lose one:
- Prompts live in `tools/assets/meshy/models.json`, and task IDs in `tools/assets/meshy/tasks/`. Commit both with every generation.
- Compact copies in `tools/assets/meshy/models/` are committed; the sprite pipeline renders from these.
- Full originals land in `tools/assets/build/meshy/`, which git ignores. After generating, add them to the `models-originals` GitHub Release: `gh release upload models-originals <zip>`. Use zips under 1.9 GB.
- Keep replaced versions (`<id>_vN.*`) and note why in `models.json`.

## Tracking (Obsidian)

Features, progress, ideas, the roadmap, worklists, playtest feedback, the balance tuning log and design notes live in
Pavel's Obsidian vault (`~/Documents/Pavel`), folder `Projects/Signal Fall/`, not in the repo. The hub note
`Signal Fall` links everything; raw feedback lands in `Playtest Feedback`, planned work in `Backlog`.

- Before writing to the vault the first time in a session, read its rules: `obsidian-cli read path="Vault Rules.md"`.
  Use `obsidian-cli` to search, read and append (give each call `</dev/null` in shell loops); writing a long note
  directly as a file is fine. Keep frontmatter `updated` current, never delete Pavel's text, log the work in the
  daily note under `## Claude`.
- When a feature ships: tick it in `Backlog` (or move a feedback item to Done) and update the hub's Status.
- The repo keeps only what code, CI and players depend on: `CHANGELOG.md`, `README.md`, `docs/ARCHITECTURE.md` (how
  the code works; update it when that changes), `docs/AGENTS.md`, `docs/KEYBOARD.md`. Don't add new planning or
  progress docs to the repo.

## Other rules

- Commit and push to `main` per feature.
- The sim, AI and mapgen are deterministic: no floats, no `/`, no `Math.*` (lint enforces this; use `idiv`).
- Run Node 22 (`.nvmrc`): the system Node if it is 22, or `source ~/.nvm/nvm.sh && nvm use 22`. pnpm comes from corepack or mise (`eval "$(mise env -s bash)"` if `pnpm` is not found).
- Typecheck with `pnpm typecheck`, never `pnpm -s typecheck`: the silent flag hides failures.
