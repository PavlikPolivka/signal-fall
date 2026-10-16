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
- Note what you tuned and why in `docs/balance/README.md` (the tuning log).

## Other rules

- Commit and push to `main` per feature. Track progress in README and `docs/`, not in Obsidian.
- The sim, AI and mapgen are deterministic: no floats, no `/`, no `Math.*` (lint enforces this; use `idiv`).
- Run Node 22: `source ~/.nvm/nvm.sh && nvm use 22`.
