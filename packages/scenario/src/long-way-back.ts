import type { MissionSpec, Pos } from './missions';

const MIN = 1200;
const SEC = 20;
const s = (start: number, dx = 0, dy = 0): Pos => ({ start, dx, dy });
/** A share of the way from the player's start to seat 1's (percent), plus an offset in tiles. */
const along = (t: number, dx = 0, dy = 0): Pos => ({ along: t, dx, dy });

const EARLY = ['grunt', 'tankbuster', 'holdfast', 'dynamo', 'bunkhouse', 'homestead', 'pillbox', 'barricade'];
const ECONOMY = [...EARLY, 'smelter', 'mule', 'motor_pool', 'jackrabbit', 'radio_mast'];
const WORKSHOP = [...ECONOMY, 'wrench', 'garage', 'bulldog', 'patch'];
const ARMOR = [...WORKSHOP, 'thumper', 'flak_track', 'flak_nest'];
const AIR = [...ARMOR, 'airstrip', 'hornet', 'foundry'];

/**
 * The Long Way Back: a Holdout campaign beside the main story. Commander Thule gets a handful of soldiers out
 * of the city of Marrow on the night the signal fell, builds an army on the road, and comes back for the city.
 */
export const LONG_WAY_BACK: MissionSpec[] = [
  {
    id: 'lights-out',
    act: 1,
    title: 'Lights Out',
    speaker: 'thule',
    briefing: [
      'This is Commander Thule. An hour ago every screen in Marrow went dark, and then every machine in the city turned on us.',
      'I have a dozen soldiers and no base. The river bridge is the only way out. Stay together, use the ruins, and let the drones come to you.',
      'One more thing. If I go down, nobody leads you out. Keep me alive.',
    ],
    lines: [
      ['okafor', 'Contact! Drones in the street. Into the buildings, now!'],
      ['thule', 'Brush ahead. Hide in it, let them walk in, then hit them hard.'],
      ['halcyon', 'Citizens of Marrow. Return to your homes. Remain calm.'],
      ['okafor', 'Checkpoint on the bridge. Their guns run on that generator.'],
      ['thule', 'We are across. Do not look back. Keep walking.'],
    ],
    map: { seed: 5101, size: 'S', biome: 'city', resources: 'normal', terrain: 'normal' },
    time: 'night',
    squad: true,
    seats: [
      { faction: 0, team: 0, start: 'none', credits: 0, units: [['grunt', 10], ['tankbuster', 3]] },
      { faction: 1, team: 1, start: 'none', structures: [['powerd', -5, -5], ['guard', -4, 1], ['guard', 1, -4]] },
    ],
    allow: [],
    objectives: [
      { text: 'Keep Commander Thule alive', kind: 'protect', tag: 'thule' },
      { text: 'Get across the river bridge', kind: 'reach', area: { ...s(1, -1, -1), r: 4 } },
    ],
    triggers: [
      { at: SEC, actions: [{ kind: 'spawn', player: 0, unit: 'grunt', count: 1, at: s(0, 2, 2), tag: 'thule' }] },
      { enter: { ...along(30), r: 7 }, actions: [{ kind: 'say', line: 0 }, { kind: 'spawn', player: 1, unit: 'sentry', count: 2, at: along(42, 6, -4), attack: along(30) }] },
      { enter: { ...along(50), r: 7 }, actions: [{ kind: 'say', line: 1 }, { kind: 'spawn', player: 1, unit: 'sentry', count: 1, at: along(62, -5, 4), attack: along(50) }, { kind: 'spawn', player: 1, unit: 'lance', count: 2, at: along(62, 5, -4), attack: along(50) }] },
      { at: 3 * MIN, every: 90 * SEC, until: 10 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, max: 2, at: along(80, 6, 0), attack: along(55) }] },
      { enter: { ...along(72), r: 7 }, actions: [{ kind: 'say', line: 2 }, { kind: 'spawn', player: 1, unit: 'ping', count: 1, at: s(1, -8, 3), attack: along(72) }] },
      { enter: { ...along(85), r: 6 }, actions: [{ kind: 'say', line: 3 }] },
      { objective: 1, actions: [{ kind: 'say', line: 4 }] },
    ],
  },
  {
    id: 'dig-in',
    act: 1,
    title: 'Dig In',
    speaker: 'thule',
    briefing: [
      'We found a Homestead truck in a ditch outside the city. Full tank, keys in it. Somebody up there likes us.',
      'Set it down on the ridge. Power first, then a Bunkhouse so we can take in the stragglers. Then pillboxes, and a barricade line across the gap.',
      'The machines hunt at night. We hold until dawn.',
    ],
    lines: [
      ['thule', 'Home, for tonight. Get the power on.'],
      ['okafor', 'Movement on the road. Drones, a lot of them.'],
      ['okafor', 'They are bringing heavier stuff. Drag a barricade line across that gap!'],
      ['thule', 'Two pillboxes up. Let them come.'],
      ['thule', 'Here it comes. Everything they have left. Hold!'],
      ['thule', 'Sun is up. We made it through the first night.'],
      ['okafor', 'Stragglers from the city, with a truck full of supplies. We can train more hands.'],
    ],
    map: { seed: 5202, size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'choke' },
    time: 'dusk',
    seats: [
      { faction: 0, team: 0, start: 'vehicle', credits: 5000, units: [['grunt', 5], ['tankbuster', 2]] },
      { faction: 1, team: 1, start: 'none' },
    ],
    allow: EARLY,
    objectives: [
      { text: 'Deploy the Homestead', kind: 'have', role: 'conyard', count: 1 },
      { text: 'Build a Dynamo and a Bunkhouse', kind: 'have', role: 'barracks', count: 1 },
      { text: 'Build two Pillboxes', kind: 'have', role: 'defense', count: 2 },
      { text: 'Hold until dawn (9:00)', kind: 'survive', ticks: 9 * MIN },
    ],
    triggers: [
      { objective: 0, actions: [{ kind: 'say', line: 0 }] },
      { at: 100 * SEC, actions: [{ kind: 'say', line: 1 }] },
      { at: 100 * SEC, every: 50 * SEC, until: 8 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 2, grow: 1, max: 5, at: s(1), attack: s(0) }] },
      { at: 4 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 4 * MIN, every: 70 * SEC, until: 8 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, max: 3, at: s(1, 2, 2), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'ping', count: 1, grow: 1, max: 2, at: s(1, -2, 2), attack: s(0) }] },
      { objective: 2, actions: [{ kind: 'say', line: 3 }] },
      { at: 5 * MIN, actions: [{ kind: 'say', line: 6 }, { kind: 'credits', player: 0, amount: 1500 }, { kind: 'spawn', player: 0, unit: 'grunt', count: 3, at: s(0, 3, 3) }] },
      { at: 8 * MIN + 15 * SEC, actions: [{ kind: 'say', line: 4 }, { kind: 'spawn', player: 1, unit: 'sentry', count: 6, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 3, at: s(1, 2, 2), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'ping', count: 2, at: s(1, -2, 2), attack: s(0) }] },
      { objective: 3, actions: [{ kind: 'say', line: 5 }] },
    ],
  },
  {
    id: 'diesel-run',
    act: 1,
    title: 'Diesel Run',
    speaker: 'thule',
    briefing: [
      'Forty people eat every day now, and the trucks drink more than we do. There is Echo in the valley, and an old pumping station halfway down it.',
      'Build a Smelter, get the Mules hauling, and take the station. Derricks pay whoever stands next to them. Crates turn up on the roads, too. Grab them.',
      'We are not the only ones out here who figured that out.',
    ],
    lines: [
      ['brann', 'Nice trucks. Would be a real shame if something happened to them.'],
      ['thule', 'Scavengers. People, not machines. Keep them off the Mules.'],
      ['okafor', 'Pumping station is ours. Tell the Ironmongers to find their own.'],
      ['halcyon', 'Unregistered extraction detected. Correcting.'],
      ['thule', 'Ten thousand. We eat this winter.'],
    ],
    map: { seed: 5303, size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'normal', points: true },
    crates: true,
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 4000, units: [['grunt', 4], ['jackrabbit', 2]] },
      { faction: 1, team: 1, start: 'none' },
      { faction: 0, team: 2, start: 'none' },
    ],
    allow: ECONOMY,
    objectives: [
      { text: 'Hold the pumping station (halfway down the valley) for 1:30', kind: 'hold', area: { ...along(50), r: 5 }, ticks: 90 * SEC },
      { text: 'Harvest 10,000 credits of Echo', kind: 'harvest', amount: 10000 },
    ],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...along(50), r: 7 } }] },
      { at: 2 * MIN, actions: [{ kind: 'say', line: 0 }, { kind: 'say', line: 1 }] },
      { at: 2 * MIN, every: 100 * SEC, actions: [{ kind: 'spawn', player: 2, unit: 'jackrabbit', count: 1, grow: 1, max: 3, at: s(2), attack: s(0, 3, 7) }, { kind: 'spawn', player: 2, unit: 'grunt', count: 2, grow: 1, max: 4, at: s(2, 2, 2), attack: s(0, 3, 7) }] },
      { objective: 0, actions: [{ kind: 'say', line: 2 }] },
      { at: 6 * MIN, actions: [{ kind: 'say', line: 3 }] },
      { at: 6 * MIN, every: 100 * SEC, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 3, grow: 1, max: 7, at: s(1), attack: along(50) }, { kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, max: 4, at: s(1, 2, 2), attack: along(50) }] },
      { objective: 1, actions: [{ kind: 'say', line: 4 }] },
    ],
  },
  {
    id: 'mags',
    act: 2,
    title: 'Mags',
    speaker: 'thule',
    briefing: [
      'Our trucks are falling apart and nobody here can fix them. There is a crew of mechanics held at a Halcyon depot across town. Their foreman is called Mags.',
      'Silence the guns around the depot and the crew can walk out. Mags says there are tanks in that yard that only need a wrench and a kind word.',
      'Then bring her home alive. Without her we walk.',
    ],
    lines: [
      ['mags', 'About time! Name is Mags. Give me two minutes and these Bulldogs will run.'],
      ['halcyon', 'Assets removed from the depot. Recover them.'],
      ['okafor', 'Base is under attack! They are hitting us while we are out.'],
      ['mags', 'Home sweet home. Right, who wants a Garage?'],
    ],
    map: { seed: 5404, size: 'M', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 5000, units: [['grunt', 6], ['tankbuster', 3], ['jackrabbit', 2]] },
      { faction: 1, team: 1, start: 'none', structures: [['powerd', -5, -6], ['spawn', 2, -6], ['relay', -7, 1], ['guard', -5, 0], ['guard', 0, -5], ['guard', -7, -3], ['guard', 3, -2]] },
    ],
    allow: WORKSHOP,
    objectives: [
      { text: 'Silence the guns around the Halcyon depot', kind: 'destroy', player: 1, role: 'defense' },
      { text: 'Keep Mags alive', kind: 'protect', tag: 'mags' },
      { text: 'Bring Mags home', kind: 'reach', area: { ...s(0), r: 7 }, tag: 'mags' },
    ],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...s(1, -2, -2), r: 6 } }] },
      { objective: 0, actions: [{ kind: 'say', line: 0 }, { kind: 'spawn', player: 0, unit: 'wrench', count: 1, at: s(1, -2, -2), tag: 'mags' }, { kind: 'spawn', player: 0, unit: 'wrench', count: 2, at: s(1, -3, -1) }, { kind: 'spawn', player: 0, unit: 'bulldog', count: 3, at: s(1, -4, -3) }] },
      { objective: 0, actions: [{ kind: 'say', line: 1 }, { kind: 'spawn', player: 1, unit: 'lance', count: 3, at: s(1, 4, 4), attack: along(60) }, { kind: 'spawn', player: 1, unit: 'vector', count: 1, at: s(1, 4, 4), attack: along(60) }] },
      { objective: 0, actions: [{ kind: 'spawn', player: 1, unit: 'ping', count: 3, at: along(35, 6, -6), attack: along(35) }] },
      { at: 4 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 4 * MIN, every: 90 * SEC, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 3, grow: 1, max: 7, at: along(30, -6, 6), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, max: 4, at: along(30, -6, 6), attack: s(0) }] },
      { objective: 2, actions: [{ kind: 'say', line: 3 }] },
    ],
  },
  {
    id: 'hill-312',
    act: 2,
    title: 'Hill 312',
    speaker: 'thule',
    briefing: [
      'Hill 312 has the old watchtower. Whoever holds it sees the whole valley, and right now that is Halcyon.',
      'Mags got the Thumpers running. They shell what the tower spots, even what you cannot see: Ctrl+click the ground and they keep firing there.',
      'Take the hill and keep it, four minutes all told. They will want it back.',
    ],
    lines: [
      ['okafor', 'Tower is ours! I can see all the way to the river.'],
      ['halcyon', 'Elevated position lost. Reclaiming.'],
      ['okafor', 'Heavy armor, coming up the slope!'],
      ['thule', 'The valley is ours. Good work, all of you.'],
    ],
    map: { seed: 5505, size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'normal', points: true },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 7000, units: [['thumper', 2], ['bulldog', 2], ['grunt', 4]] },
      { faction: 1, team: 1, ai: 'normal', start: 'base', credits: 5000 },
    ],
    allow: ARMOR,
    objectives: [{ text: 'Hold Hill 312 for 4:00 in total', kind: 'hold', area: { ...along(50), r: 5 }, ticks: 4 * MIN }],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...along(50), r: 7 } }] },
      { enter: { ...along(50), r: 5 }, actions: [{ kind: 'say', line: 0 }] },
      { enter: { ...along(50), r: 5 }, actions: [{ kind: 'say', line: 1 }, { kind: 'spawn', player: 1, unit: 'lance', count: 3, at: along(75), attack: along(50) }, { kind: 'spawn', player: 1, unit: 'sentry', count: 3, at: along(75, 2, 2), attack: along(50) }] },
      { at: 4 * MIN, every: 90 * SEC, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 2, grow: 1, max: 6, at: along(80), attack: along(50) }, { kind: 'spawn', player: 1, unit: 'vector', count: 1, grow: 1, max: 3, at: along(80, 2, 2), attack: along(50) }] },
      { at: 7 * MIN, actions: [{ kind: 'say', line: 2 }, { kind: 'spawn', player: 1, unit: 'vector', count: 3, at: along(85), attack: along(50) }, { kind: 'spawn', player: 1, unit: 'broadcast', count: 2, at: along(85, 2, 2), attack: along(50) }] },
      { objective: 0, actions: [{ kind: 'say', line: 3 }] },
    ],
  },
  {
    id: 'ironmongers',
    act: 2,
    title: 'The Ironmongers',
    speaker: 'thule',
    briefing: [
      'Brann and his Ironmongers have been robbing every camp on the road. Last night they burned the Kettle family out of the mill and took their children for workers.',
      'Kettle is still fighting at the east end of the ruins. Join up with him. Alt+click the map to call for help or to point him at a target, and he will answer.',
      'Brann fights like we do, with the same guns and the same tricks. Burn his base to the ground.',
    ],
    lines: [
      ['brann', 'Thule! Heard about you. Join me, or get out of my valley.'],
      ['thule', 'Neither. Everyone, on Kettle. Hit them together.'],
      ['brann', 'You think you are better than me? Out here, nobody is better.'],
      ['okafor', 'Ironmongers are breaking. Push!'],
      ['brann', 'Fine! Fine. You win. Remember who let you live.'],
    ],
    map: { seed: 5606, size: 'M', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 7000, units: [['bulldog', 2], ['grunt', 4]] },
      { faction: 0, team: 1, ai: 'normal', start: 'base', credits: 8000 },
      { faction: 0, team: 0, ai: 'normal', start: 'base' },
    ],
    allow: ARMOR,
    objectives: [{ text: "Destroy Brann's base", kind: 'destroy', player: 1 }],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...s(2), r: 7 } }] },
      { at: 30 * SEC, actions: [{ kind: 'say', line: 0 }, { kind: 'say', line: 1 }] },
      { at: 5 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 3 * MIN, every: 2 * MIN, until: 20 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'jackrabbit', count: 2, grow: 1, max: 4, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'bulldog', count: 1, grow: 1, max: 2, at: s(1, 2, 2), attack: s(0) }] },
      { at: 10 * MIN, actions: [{ kind: 'say', line: 3 }] },
      { objective: 0, actions: [{ kind: 'say', line: 4 }] },
    ],
  },
  {
    id: 'dead-sky',
    act: 2,
    title: 'Dead Sky',
    speaker: 'thule',
    briefing: [
      'Halcyon owns the sky. Its gunships find our convoys wherever they go. Mags dug two Hornets out of a crop-duster hangar.',
      'Get an Airstrip up, and Flak Nests around the base. Power is short. If the lights flicker, switch something off until the Dynamos catch up.',
      'Then fly over to their hangars and burn them.',
    ],
    lines: [
      ['okafor', 'Gunships! Get under cover!'],
      ['mags', 'Power is in the red. Switch off the Garage or the Radio Mast, we will live without them.'],
      ['halcyon', 'Air superiority contested. Escalating.'],
      ['thule', 'The sky is clear. First time since the signal fell.'],
    ],
    map: { seed: 5707, size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'open' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 8000, units: [['hornet', 2], ['flak_track', 2]] },
      { faction: 1, team: 1, ai: 'normal', start: 'base', credits: 6000, structures: [['launchd', -6, -6], ['launchd', -9, -2], ['filter', -4, -9], ['filter', -10, 2]] },
    ],
    allow: AIR,
    objectives: [
      { text: 'Build an Airstrip', kind: 'have', role: 'airfield', count: 1 },
      { text: 'Build two Flak Nests', kind: 'have', role: 'antiAir', count: 2 },
      { text: 'Destroy the Halcyon drone hangars', kind: 'destroy', player: 1, role: 'airfield' },
    ],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...s(1, -7, -4), r: 6 } }] },
      { at: 90 * SEC, actions: [{ kind: 'say', line: 0 }] },
      { at: 90 * SEC, every: 80 * SEC, until: 25 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'seek', count: 1, grow: 1, max: 5, at: s(1), attack: s(0) }] },
      { at: 3 * MIN, actions: [{ kind: 'say', line: 1 }] },
      { at: 8 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 8 * MIN, every: 2 * MIN, until: 25 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'vector', count: 2, grow: 1, max: 5, at: s(1, 2, 2), attack: s(0) }] },
      { objective: 2, actions: [{ kind: 'say', line: 3 }] },
    ],
  },
  {
    id: 'glass-fields',
    act: 3,
    title: 'Glass Fields',
    speaker: 'thule',
    briefing: [
      'East of the hills the ground turns to glass and the crystals sing at night. Halcyon is strip-mining them, and something out there is fighting back.',
      'We need that Echo. Knock out Halcyon\'s intakes and hold the singing stone in the middle of the field for two minutes.',
      'Whatever the crystal folk are, they are not our enemy unless we make them one. Try not to.',
    ],
    lines: [
      ['choir', 'Iron ones. You are loud. Be quiet, or be still.'],
      ['thule', 'We are not here for you. Leave us be, and we leave you be.'],
      ['okafor', 'Machines and crystals going at each other. Let them.'],
      ['thule', 'Their intakes are dark. Now the stone.'],
      ['choir', 'The stone sings for you. For now.'],
    ],
    map: { seed: 5808, size: 'M', biome: 'crystal', resources: 'rich', terrain: 'normal' },
    time: 'night',
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 8000, units: [['patch', 1], ['bulldog', 3]] },
      { faction: 1, team: 1, ai: 'normal', start: 'base', credits: 6000 },
      { faction: 2, team: 2, ai: 'normal', start: 'base', credits: 6000 },
    ],
    allow: AIR,
    objectives: [
      { text: "Destroy Halcyon's Echo intakes", kind: 'destroy', player: 1, role: 'refinery' },
      { text: 'Hold the singing stone (between the bases) for 2:00', kind: 'hold', area: { ...along(50), r: 5 }, ticks: 2 * MIN },
    ],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...along(50), r: 7 } }] },
      { at: 2 * MIN, actions: [{ kind: 'say', line: 0 }, { kind: 'say', line: 1 }] },
      { at: 6 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { enter: { ...along(50), r: 6 }, actions: [{ kind: 'spawn', player: 2, unit: 'shard', count: 6, at: along(50, 3, -3), attack: along(50) }, { kind: 'spawn', player: 2, unit: 'staccato', count: 2, at: along(50, -3, 3), attack: along(50) }] },
      { at: 5 * MIN, every: 2 * MIN, until: 25 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 2, grow: 1, max: 6, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'vector', count: 1, grow: 1, max: 4, at: s(1, 2, 2), attack: s(0) }] },
      { objective: 0, actions: [{ kind: 'say', line: 3 }] },
      { objective: 1, actions: [{ kind: 'say', line: 4 }] },
    ],
  },
  {
    id: 'long-tom',
    act: 3,
    title: 'Long Tom',
    speaker: 'thule',
    briefing: [
      'Halcyon is charging a Purge array on the far side of these ruins. When it is full it burns everything inside its circle, and its circle is us.',
      'Mags has plans for a Long Tom: a gun big enough to hit back from here. Build a Foundry, then the gun. Everyone can see a charging superweapon, theirs and ours.',
      'When the warning comes, scatter. Then bring that array down.',
    ],
    lines: [
      ['halcyon', 'Purge array charging. Target: unregistered settlement.'],
      ['mags', 'Long Tom is up! Give her five minutes to warm up.'],
      ['okafor', 'Strike incoming! Get out of the circle, everyone move!'],
      ['thule', 'Their array is down. Now the rest of it.'],
    ],
    map: { seed: 5909, size: 'L', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 10000, units: [['bulldog', 3], ['thumper', 2], ['hornet', 2]] },
      { faction: 1, team: 1, ai: 'normal', start: 'base', credits: 10000, structures: [['rmrf', -7, -7], ['sudo', -3, -8], ['powerd', -9, -3], ['sigkill', -5, -2]] },
    ],
    objectives: [
      { text: 'Build a Long Tom', kind: 'have', role: 'superweapon', count: 1 },
      { text: 'Destroy the Purge array', kind: 'destroy', player: 1, role: 'superweapon' },
      { text: 'Destroy the Halcyon base', kind: 'destroy', player: 1 },
    ],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...s(1, -7, -7), r: 5 } }] },
      { at: 30 * SEC, actions: [{ kind: 'say', line: 0 }] },
      { objective: 0, actions: [{ kind: 'say', line: 1 }] },
      { at: 4 * MIN + 30 * SEC, actions: [{ kind: 'say', line: 2 }] },
      { at: 6 * MIN, every: 3 * MIN, until: 30 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'vector', count: 2, grow: 1, max: 5, at: s(1, 4, 4), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 3, grow: 1, max: 6, at: s(1, 4, 4), attack: s(0) }] },
      { at: 10 * MIN, every: 3 * MIN, until: 30 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'seek', count: 1, grow: 1, max: 4, at: s(1), attack: s(0) }] },
      { objective: 1, actions: [{ kind: 'say', line: 3 }] },
    ],
  },
  {
    id: 'marrow',
    act: 3,
    title: 'Marrow',
    speaker: 'thule',
    briefing: [
      'A year ago I walked out of Marrow with eight soldiers. Today I am going back with an army.',
      'Halcyon\'s core sits in the old city center, and everything it has is waiting for us. The crystal host has come down from the glass fields, and it answers to nobody.',
      'Brann is with us, for what that is worth. Bring everything. Destroy the core. Then we can all go home.',
    ],
    lines: [
      ['brann', 'Do not get used to this, Thule. I am here for the loot.'],
      ['halcyon', 'Marrow is a closed system. You are not permitted.'],
      ['okafor', 'Purge charging in the city center. Spread out!'],
      ['choir', 'The song is too loud here. We will silence all of it.'],
      ['thule', 'All units, everything you have. Now!'],
      ['thule', 'The lights are coming back on in Marrow. Ours, this time.'],
    ],
    map: { seed: 6010, size: 'L', biome: 'city', resources: 'rich', terrain: 'normal' },
    unitCap: 300,
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 15000, units: [['ironclad', 1], ['bulldog', 4], ['thumper', 2], ['hornet', 2]] },
      { faction: 1, team: 1, ai: 'hard', start: 'base', credits: 15000, structures: [['rmrf', -7, -7], ['sudo', -3, -8], ['sigkill', -5, -2], ['sigkill', -2, -5], ['launchd', -10, -3]] },
      { faction: 0, team: 0, ai: 'hard', start: 'base', credits: 8000 },
      { faction: 2, team: 2, ai: 'normal', start: 'base', credits: 8000 },
    ],
    objectives: [{ text: "Destroy Halcyon's core in Marrow", kind: 'destroy', player: 1 }],
    triggers: [
      { at: SEC, actions: [{ kind: 'reveal', area: { ...s(1), r: 9 } }] },
      { at: 30 * SEC, actions: [{ kind: 'say', line: 0 }, { kind: 'say', line: 1 }] },
      { at: 4 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 7 * MIN, actions: [{ kind: 'say', line: 3 }] },
      { at: 8 * MIN, every: 3 * MIN, until: 40 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'vector', count: 2, grow: 1, max: 6, at: s(1, 5, 5), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 3, grow: 1, max: 8, at: s(1, 5, 5), attack: s(0) }] },
      { at: 15 * MIN, every: 4 * MIN, until: 40 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'root', count: 1, grow: 1, max: 3, at: s(1, 5, 5), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'seek', count: 2, grow: 1, max: 5, at: s(1), attack: s(0) }] },
      { at: 15 * MIN, actions: [{ kind: 'say', line: 4 }] },
      { objective: 0, actions: [{ kind: 'say', line: 5 }] },
    ],
  },
];

export const LONG_WAY_BACK_EPILOGUE = {
  title: 'Home',
  speaker: 'thule' as const,
  paragraphs: [
    'The core is quiet. People are coming back to Marrow street by street, carrying whatever they kept.',
    'Mags has the trams running again, on diesel and stubbornness. Brann took his loot and went back to his valley. The crystals sing on the edge of town, and nobody bothers them.',
    'I said I would bring them home. It took a year and too many good people. But we came the long way back.',
  ],
};
