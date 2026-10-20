# Work list (from playtest feedback, 2026-10-19)

Everything raised while playtesting the campaign, in the order it gets built. One commit per item;
the status column is updated as each one lands.

| # | Item | Why it matters | Status |
|---|---|---|---|
| 1 | **Briefing between missions**: Next mission opens the next briefing and reads it aloud, highlighting the paragraph being spoken | The jump from one mission straight into the next lost the story | done |
| 2 | **Keep fullscreen** when going from a match to the menus and back | Every screen change was a page load, which drops fullscreen | done |
| 3 | **Campaign list spacing**: one mission per row, even gaps | The wrapped buttons looked ragged | done |
| 3b | **Campaign tabs per act, fullscreen button on every menu, compact Listen button** | Follow-up feedback | done |
| 4 | **Mission art**: one painted image per mission at the top of its briefing (Gemini image pipeline, prompts in `tools/assets/missions/images.json`) | Briefings were text only | done |
| 5 | **Unit animations**: Hornet rotors spin (and it no longer flies tail first), tank treads crawl, the Ironclad walks, hover craft float and bob, wheeled vehicles rumble | Generated models were static: rotors and treads stood still. Also found and fixed: 12 generated models faced the wrong way | done |
| 6 | **In-game menu**: split the crowded pause menu into side sections (Briefing, Sound, Graphics, Controls, Interface) | Too busy to find anything | done |
| 7 | **Better voices** (Improvements #200): re-record the announcer and the campaign with Gemini text-to-speech, acted per speaker | Piper sounds flat | in progress: campaign 9 of 15 missions and the Holdout announcer shipped. Each model has its own daily cap (campaign `gemini-3.8-flash-tts` 100 a day, announcer `gemini-2.5-pro-preview-tts` about 50). Left for the next run (`python3 tools/assets/voices/gemini.py`): 8 campaign lines (tools/assets/build/voices-gemini/failed.txt), holding back Crater Field, Initialization, Recompile, Harvest Protocol, Override and Divergence; 11 Halcyon and 27 Choir announcer lines |
| 8 | **Acts II and III pass**: Divergence, Requiem, The Silent Seed, Signal Rise get the same tuning as Act I (growing waves, events, clear goals) | Only Act I was replayed and retuned | done (events per mission, see docs/CAMPAIGN.md) |
| 9 | **Objective markers without a radar**: mission targets show on the minimap even before a radar is built | The minimap is dark early, exactly when you look for the target | done |
| 11 | **One match setup for skirmish and multiplayer**: one screen where each seat is you, an AI or an open slot for a friend; skirmish is simply a match with only AI seats | Two near-identical setup screens to learn and maintain | done: Play shows the room's seat list (each seat an AI with faction and skill, or open for a player; an open seat turns Start into Create room); Join a game only joins |
| 12 | **Daily challenge button**: find it a better place on the main menu (now a main button under Multiplayer) | Its placement looks off | done |
| 10 | **Multiplayer test flake**: the guest sometimes misses the host's map seed in the lobby test | CI failed once on it (a rerun passed). Cause: the seed box only saved on leaving the field, and a lobby refresh in between put the old seed back; it now saves as you type | done |
| 13 | **Campaign briefing box keeps its size** when switching missions | The panel jumps as briefings differ in length | done |
| 14 | **Unit spacing and formations**: groups (vehicles above all) stop overlapping, jittering and swapping places on the move, and spread out at a waypoint or a building's rally point instead of piling up | Big groups clip into each other and dance | done: no dancing at buildings, rally spots sized to the unit, smooth sprite turning, formation rows a hull length apart, parked vehicles keep room (balance checked, docs/balance) |
| 15 | **Room for more campaigns**: missions grouped under a campaign (title, acts, progress), so new campaigns can be added later without code changes | More campaigns are planned | done: `CAMPAIGNS` in missions.ts, picker when there is more than one (see docs/CAMPAIGN.md) |
