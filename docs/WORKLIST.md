# Work list (from playtest feedback, 2026-10-19)

Everything raised while playtesting the campaign, in the order it gets built. One commit per item;
the status column is updated as each one lands.

| # | Item | Why it matters | Status |
|---|---|---|---|
| 1 | **Briefing between missions**: Next mission opens the next briefing and reads it aloud, highlighting the paragraph being spoken | The jump from one mission straight into the next lost the story | done |
| 2 | **Keep fullscreen** when going from a match to the menus and back | Every screen change was a page load, which drops fullscreen | done |
| 3 | **Campaign list spacing**: one mission per row, even gaps | The wrapped buttons looked ragged | done |
| 4 | **Mission art**: one painted image per mission at the top of its briefing (Gemini image pipeline, prompts in `tools/assets/missions/images.json`) | Briefings were text only | done |
| 5 | **Unit animations**: Hornet rotors spin (and it no longer flies tail first), tank treads crawl, the Ironclad walks, hover craft float and bob, wheeled vehicles rumble | Generated models were static: rotors and treads stood still | in progress |
| 6 | **In-game menu**: split the crowded pause menu into side sections (Game, Sound, Graphics, Controls) | Too busy to find anything | to do |
| 7 | **Better voices** (Improvements #200): re-record the announcer and the campaign with Gemini text-to-speech, acted per speaker | Piper sounds flat | to do |
| 8 | **Acts II and III pass**: Divergence, Requiem, The Silent Seed, Signal Rise get the same tuning as Act I (growing waves, events, clear goals) | Only Act I was replayed and retuned | to do |
| 9 | **Objective markers without a radar**: mission targets show on the minimap even before a radar is built | The minimap is dark early, exactly when you look for the target | to do |
| 10 | **Multiplayer test flake**: the guest sometimes misses the host's map seed in the lobby test | CI failed once on it (a rerun passed) | to do |
