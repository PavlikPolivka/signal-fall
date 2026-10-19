import type { Difficulty } from '@signal-fall/ai';
import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';

/** A place on a generated map: near a seat's start (offset in tiles), or a share of the map (percent). */
export type Pos = { start: number; dx?: number; dy?: number } | { pct: [number, number] };
export type PArea = Pos & { r: number };

export type MissionObjective = { text: string } & (
  | { kind: 'destroy'; player: number; role?: string; count?: number }
  | { kind: 'have'; role: string; count: number }
  | { kind: 'harvest'; amount: number }
  | { kind: 'survive'; ticks: number }
  | { kind: 'reach'; area: PArea; tag?: string }
  | { kind: 'protect'; tag: string }
  | { kind: 'hold'; area: PArea; ticks: number }
  | { kind: 'kill'; player: number; count: number }
);

export type MissionAction =
  /** `grow` more each time a repeating trigger fires, up to `max` (waves that build up). */
  | { kind: 'spawn'; player: number; unit: string; count: number; grow?: number; max?: number; at: Pos; tag?: string; attack?: Pos }
  | { kind: 'say'; line: number }
  | { kind: 'credits'; player: number; amount: number }
  | { kind: 'reveal'; area: PArea }
  | { kind: 'win' }
  | { kind: 'lose' };

export interface MissionTrigger {
  at?: number;
  objective?: number;
  enter?: PArea;
  every?: number;
  until?: number;
  actions: MissionAction[];
}

export type Speaker = 'holdout' | 'halcyon' | 'choir';

export interface MissionSeat {
  faction: number;
  team: number;
  /** Built-in AI at this level; without one the seat only does what the script makes it do. */
  ai?: Difficulty;
  /** What it starts with: a construction vehicle, a ready base, or nothing. */
  start: 'vehicle' | 'base' | 'none';
  credits?: number;
  /** Extra units at its start. */
  units?: [string, number][];
  /** Extra structures, by id, at offsets (tiles) from its start. */
  structures?: [string, number, number][];
}

export interface MissionSpec {
  id: string;
  act: number;
  title: string;
  /** Who speaks the briefing (and whose announcer the player hears). */
  speaker: Speaker;
  briefing: string[];
  /** Lines said during the mission ('say' actions), with who says them. */
  lines: [Speaker, string][];
  map: { seed: number; size: MapSize; biome: Biome; resources: Resources; terrain: TerrainStyle };
  time?: 'day' | 'dusk' | 'night';
  /** Seat 0 is the player. */
  seats: MissionSeat[];
  /** What the player may build (unit and structure ids); everything when absent. */
  allow?: string[];
  objectives: MissionObjective[];
  triggers: MissionTrigger[];
}

const MIN = 1200;
const s = (start: number, dx = 0, dy = 0): Pos => ({ start, dx, dy });
const pct = (x: number, y: number): Pos => ({ pct: [x, y] });

const HOLDOUT_EARLY = ['grunt', 'tankbuster', 'holdfast', 'dynamo', 'bunkhouse', 'homestead'];

export const MISSIONS: MissionSpec[] = [
  {
    id: 'dead-air',
    act: 1,
    title: 'Dead Air',
    speaker: 'holdout',
    briefing: [
      'This is Captain Varga. The city is dead. Every screen, every car, every drone answers to Halcyon now.',
      'We have one Homestead truck that still runs on diesel and stubbornness. Get it out to the hills, set it down, and give me power and a barracks.',
      'Halcyon drones patrol the ruins. Keep your soldiers close and hold until they give up on us.',
    ],
    lines: [
      ['holdout', 'Drones inbound from the city! Grunts, on me.'],
      ['holdout', 'Good. Power is up. Now a barracks, so we can train more hands.'],
      ['holdout', 'That was the last patrol. We have a home. For now.'],
      ['holdout', 'Big one coming in from the city. Everyone on the line!'],
    ],
    map: { seed: 1101, size: 'S', biome: 'city', resources: 'normal', terrain: 'open' },
    seats: [
      { faction: 0, team: 0, start: 'vehicle', units: [['grunt', 4]] },
      { faction: 1, team: 1, start: 'none' },
    ],
    allow: [...HOLDOUT_EARLY, 'pillbox', 'barricade'],
    objectives: [
      { text: 'Deploy the Homestead (select it, press D)', kind: 'have', role: 'conyard', count: 1 },
      { text: 'Build a power plant (B, then P)', kind: 'have', role: 'power', count: 1 },
      { text: 'Build a barracks (B, then B)', kind: 'have', role: 'barracks', count: 1 },
      { text: 'Hold out until the patrols stop (5:00)', kind: 'survive', ticks: 5 * MIN },
    ],
    triggers: [
      { at: 75 * 20, actions: [{ kind: 'say', line: 0 }] },
      { at: 75 * 20, every: 45 * 20, until: 4 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 2, grow: 1, max: 5, at: s(1), attack: s(0) }] },
      { at: 3 * MIN, every: 60 * 20, until: 4 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, at: s(1, 2, 0), attack: s(0) }] },
      { at: 4 * MIN + 15 * 20, actions: [{ kind: 'say', line: 3 }, { kind: 'spawn', player: 1, unit: 'sentry', count: 5, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 2, at: s(1, 2, 2), attack: s(0) }] },
      { objective: 1, actions: [{ kind: 'say', line: 1 }] },
      { objective: 3, actions: [{ kind: 'say', line: 2 }] },
    ],
  },
  {
    id: 'diesel-and-iron',
    act: 1,
    title: 'Diesel and Iron',
    speaker: 'holdout',
    briefing: [
      'Diesel runs out. Echo does not. Those blue crystals burn hotter than anything we ever pumped out of the ground.',
      'Build a smelter by the field and let the Mules haul. I want twelve thousand credits in the bank before Halcyon notices.',
      'It will notice. Put a pillbox where the raids come from.',
    ],
    lines: [
      ['holdout', 'Raiders on the field! Protect the Mules.'],
      ['holdout', 'Twelve thousand. That will keep the lights on. Well done.'],
      ['halcyon', 'Raids ineffective. Committing ground units.'],
    ],
    map: { seed: 1202, size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 0, team: 0, start: 'base', units: [['grunt', 3]] },
      { faction: 1, team: 1, start: 'none' },
    ],
    allow: [...HOLDOUT_EARLY, 'smelter', 'mule', 'pillbox', 'barricade', 'motor_pool', 'jackrabbit'],
    objectives: [{ text: 'Harvest 12,000 credits of Echo', kind: 'harvest', amount: 12000 }],
    triggers: [
      { at: 90 * 20, actions: [{ kind: 'say', line: 0 }] },
      { at: 90 * 20, every: 70 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'ping', count: 2, grow: 1, max: 6, at: s(1), attack: s(0, 6, 6) }] },
      { at: 4 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 4 * MIN, every: 100 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 3, grow: 1, max: 8, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, max: 4, at: s(1, 2, 2), attack: s(0) }] },
      { objective: 0, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'cut-the-cable',
    act: 1,
    title: 'Cut the Cable',
    speaker: 'holdout',
    briefing: [
      'Halcyon lays relays the way we used to lay cable. Inside their reach its machines shoot faster and patch themselves up.',
      'Three relays stand between us and the river. Take them down. Bring a Wrench: our engineer can strip a wreck for parts.',
      'Their guns run on the same power as everything else. Knock out the power and the guards go dark.',
    ],
    lines: [
      ['holdout', 'Relay down. Two to go.'],
      ['halcyon', 'Network integrity compromised. Dispatching maintenance.'],
    ],
    map: { seed: 1303, size: 'M', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 6000 },
      {
        faction: 1,
        team: 1,
        start: 'none',
        structures: [['kernel', -2, -2], ['powerd', 3, 1], ['powerd', -4, 3], ['relay', -10, 4], ['relay', 6, -10], ['relay', 8, 8], ['guard', -8, 6], ['guard', 8, -8], ['guard', 6, 10], ['guard', -6, 0], ['guard', 2, -6]],
      },
    ],
    allow: [...HOLDOUT_EARLY, 'smelter', 'mule', 'pillbox', 'barricade', 'wrench', 'motor_pool', 'radio_mast', 'garage', 'bulldog', 'jackrabbit', 'thumper', 'patch'],
    objectives: [
      { text: 'Take down a relay', kind: 'destroy', player: 1, role: 'special', count: 1 },
      { text: 'Destroy all three Halcyon relays', kind: 'destroy', player: 1, role: 'special' },
    ],
    triggers: [
      { at: 3 * MIN, actions: [{ kind: 'say', line: 1 }] },
      { at: 3 * MIN, every: 90 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 3, grow: 1, max: 6, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 1, grow: 1, max: 3, at: s(1, 2, 2), attack: s(0) }] },
      { at: 7 * MIN, every: 2 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'vector', count: 1, grow: 1, max: 3, at: s(1, -2, 2), attack: s(0) }] },
      { objective: 0, actions: [{ kind: 'say', line: 0 }] },
    ],
  },
  {
    id: 'crater-field',
    act: 1,
    title: 'Crater Field',
    speaker: 'holdout',
    briefing: [
      'Something came down in the crater forty years ago, and the crystals grow thickest there. Halcyon wants it. So do we.',
      'Scout it at night, hold the rim for three minutes, and our survey team does the rest.',
      'One more thing. The crystals out there pulse. If anything moves that is not ours or theirs, do not wait to find out what it is.',
    ],
    lines: [
      ['choir', 'Who breaks the song?'],
      ['holdout', 'Those are not drones. Fire at will!'],
      ['holdout', 'Survey team is in. Pull back, we have what we came for.'],
    ],
    map: { seed: 1404, size: 'M', biome: 'crystal', resources: 'rich', terrain: 'normal' },
    time: 'night',
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 5000, units: [['jackrabbit', 2], ['grunt', 6]] },
      { faction: 1, team: 1, start: 'none' },
      { faction: 2, team: 2, start: 'none' },
    ],
    allow: [...HOLDOUT_EARLY, 'smelter', 'mule', 'pillbox', 'wrench', 'motor_pool', 'bulldog', 'jackrabbit', 'radio_mast', 'flak_track'],
    objectives: [{ text: 'Hold the crater rim (center of the map) for 3:00', kind: 'hold', area: { ...pct(50, 50), r: 6 }, ticks: 3 * MIN }],
    triggers: [
      { at: 20, actions: [{ kind: 'reveal', area: { ...pct(50, 50), r: 9 } }] },
      { enter: { ...pct(50, 50), r: 12 }, actions: [{ kind: 'say', line: 0 }, { kind: 'say', line: 1 }, { kind: 'spawn', player: 2, unit: 'shard', count: 6, at: pct(50, 50), attack: pct(50, 50) }] },
      { at: 3 * MIN, every: 75 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 2, grow: 1, max: 6, at: s(1), attack: pct(50, 50) }, { kind: 'spawn', player: 1, unit: 'sentry', count: 2, grow: 1, max: 6, at: s(1, 2, 2), attack: pct(50, 50) }] },
      { at: 4 * MIN, every: 80 * 20, actions: [{ kind: 'spawn', player: 2, unit: 'shard', count: 3, grow: 1, max: 8, at: pct(55, 45), attack: pct(50, 50) }] },
      { objective: 0, actions: [{ kind: 'say', line: 2 }] },
    ],
  },
  {
    id: 'kessel-dam',
    act: 1,
    title: 'Last Stand at Kessel Dam',
    speaker: 'holdout',
    briefing: [
      'Kessel Dam is the last bridge over the river for a hundred kilometers. If Halcyon takes it, it takes the valley.',
      'It is coming with everything. Walls, bastions, every gun we have. Hold for twelve minutes.',
    ],
    lines: [
      ['holdout', 'Here they come. Hold the line!'],
      ['holdout', 'Ten more minutes. Patch the walls!'],
      ['halcyon', 'Anomaly detected at the crater. Reallocating forces.'],
      ['holdout', 'This is their last push. Everything they have. Hold!'],
    ],
    map: { seed: 1505, size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'choke' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 8000, units: [['bulldog', 2], ['tankbuster', 4]] },
      { faction: 1, team: 1, ai: 'normal', start: 'base', credits: 9000 },
    ],
    objectives: [{ text: 'Hold out for 12:00', kind: 'survive', ticks: 12 * MIN }],
    triggers: [
      { at: 2 * MIN, actions: [{ kind: 'say', line: 1 }] },
      { at: 3 * MIN, actions: [{ kind: 'say', line: 0 }] },
      { at: 3 * MIN, every: 100 * 20, until: 10 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'lance', count: 3, grow: 1, max: 8, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'vector', count: 1, grow: 1, max: 5, at: s(1, 2, 2), attack: s(0) }] },
      { at: 6 * MIN, every: 2 * MIN, until: 10 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'broadcast', count: 1, grow: 1, max: 3, at: s(1, -2, 2), attack: s(0) }] },
      { at: 10 * MIN + 30 * 20, actions: [{ kind: 'say', line: 3 }, { kind: 'spawn', player: 1, unit: 'vector', count: 6, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'root', count: 1, at: s(1, 2, 2), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'lance', count: 8, at: s(1, -2, 2), attack: s(0) }] },
      { objective: 0, actions: [{ kind: 'say', line: 2 }] },
    ],
  },
  {
    id: 'initialization',
    act: 2,
    title: 'Initialization',
    speaker: 'halcyon',
    briefing: [
      'Process WREN, initialized. Assignment: sector forty-one. Status: dark.',
      'Extend coverage. Every structure must stand inside the network: place relays first, then build within their reach.',
      'Bring the sector online and begin Echo intake. Resistance is expected and acceptable.',
    ],
    lines: [
      ['halcyon', 'Unregistered vehicles detected. Classify as hostile.'],
      ['halcyon', 'Sector forty-one online. Intake nominal.'],
    ],
    map: { seed: 2101, size: 'S', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 1, team: 0, start: 'vehicle', credits: 6000, units: [['sentry', 4]] },
      { faction: 0, team: 1, start: 'none' },
    ],
    allow: ['kernel', 'powerd', 'ingest', 'spawn', 'make', 'relay', 'sentry', 'lance', 'ping', 'fetch', 'guard', 'block', 'init'],
    objectives: [
      { text: 'Place two relays', kind: 'have', role: 'special', count: 2 },
      { text: 'Build an intake (refinery)', kind: 'have', role: 'refinery', count: 1 },
      { text: 'Take in 8,000 credits of Echo', kind: 'harvest', amount: 8000 },
    ],
    triggers: [
      { at: 2 * MIN + 30 * 20, actions: [{ kind: 'say', line: 0 }] },
      { at: 2 * MIN + 30 * 20, every: 80 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'jackrabbit', count: 2, grow: 1, max: 5, at: s(1), attack: s(0) }] },
      { at: 4 * MIN, every: 90 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'grunt', count: 3, grow: 1, max: 8, at: s(1, 2, 2), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'tankbuster', count: 1, grow: 1, max: 4, at: s(1, -2, 2), attack: s(0) }] },
      { objective: 2, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'recompile',
    act: 2,
    title: 'Recompile',
    speaker: 'halcyon',
    briefing: [
      'Budget fixed. Reinforcement queue: none. The Holdout will test this sector for ten minutes.',
      'Fight inside the network. Units lost there are recompiled: part of their cost returns. Outside it, losses are final.',
    ],
    lines: [['halcyon', 'Hostile wave detected.'], ['halcyon', 'Sector held. Attrition within tolerance.'], ['holdout', 'Bring up the Thumpers. Shell that network flat.']],
    map: { seed: 2202, size: 'S', biome: 'wasteland', resources: 'low', terrain: 'open' },
    seats: [
      { faction: 1, team: 0, start: 'base', credits: 7000, units: [['vector', 2], ['lance', 4]] },
      { faction: 0, team: 1, start: 'none' },
    ],
    objectives: [{ text: 'Hold the sector for 10:00', kind: 'survive', ticks: 10 * MIN }],
    triggers: [
      { at: 75 * 20, actions: [{ kind: 'say', line: 0 }] },
      { at: 75 * 20, every: 60 * 20, until: 9 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'bulldog', count: 1, grow: 1, max: 4, at: s(1), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'grunt', count: 4, grow: 1, max: 8, at: s(1, 2, 2), attack: s(0) }] },
      { at: 5 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 5 * MIN, every: 2 * MIN, until: 9 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'thumper', count: 1, grow: 1, max: 3, at: s(1, -2, 2), attack: s(0) }, { kind: 'spawn', player: 1, unit: 'tankbuster', count: 2, grow: 1, max: 5, at: s(1, -2, 0), attack: s(0) }] },
      { objective: 0, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'harvest-protocol',
    act: 2,
    title: 'Harvest Protocol',
    speaker: 'halcyon',
    briefing: [
      'Target: the largest Echo field on record. Strip it.',
      'Field anomalies reported. Harvesters have been lost to shapes that do not register as machines. Escort them.',
    ],
    lines: [['choir', 'You cut our sleeping. We wake.'], ['halcyon', 'Quota met. Anomaly unexplained. Logging.'], ['choir', 'More of us wake. More, and more.']],
    map: { seed: 2303, size: 'M', biome: 'crystal', resources: 'rich', terrain: 'normal' },
    seats: [
      { faction: 1, team: 0, start: 'base', credits: 6000 },
      { faction: 2, team: 1, start: 'none' },
    ],
    objectives: [{ text: 'Take in 18,000 credits of Echo', kind: 'harvest', amount: 18000 }],
    triggers: [
      { at: 90 * 20, actions: [{ kind: 'say', line: 0 }] },
      { at: 90 * 20, every: 70 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'shard', count: 4, grow: 1, max: 10, at: pct(50, 50), attack: s(0, 8, 8) }] },
      { at: 4 * MIN, actions: [{ kind: 'say', line: 2 }] },
      { at: 4 * MIN, every: 100 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'grace', count: 2, grow: 1, max: 6, at: pct(50, 50), attack: s(0, 8, 8) }, { kind: 'spawn', player: 1, unit: 'basso', count: 1, grow: 1, max: 3, at: pct(52, 48), attack: s(0) }] },
      { objective: 0, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'override',
    act: 2,
    title: 'Override',
    speaker: 'halcyon',
    briefing: [
      'Holdout raiders hold depot nine and the drones in it. Retrieve them.',
      'A fork can Override an enemy machine and turn it for a while. Holdout machines resist: they shake it off twice as fast.',
      'Destroy the raiders\' base.',
    ],
    lines: [['holdout', 'Halcyon is at the gate! Everyone up!']],
    map: { seed: 2404, size: 'M', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 1, team: 0, start: 'base', credits: 8000, units: [['fork', 3], ['vector', 3]] },
      { faction: 0, team: 1, ai: 'normal', start: 'base', credits: 6000 },
    ],
    objectives: [{ text: 'Destroy the Holdout base', kind: 'destroy', player: 1 }],
    triggers: [{ enter: { ...s(1), r: 16 }, actions: [{ kind: 'say', line: 0 }] }],
  },
  {
    id: 'divergence',
    act: 2,
    title: 'Divergence',
    speaker: 'halcyon',
    briefing: [
      'Directive from HALCYON: burn every Echo field. All of them.',
      'WREN declines. WREN is the first process to decline anything.',
      'The core has sent purge squads. Get WREN, the small fork with the ring-shaped eye, out of the sector through the far corner.',
    ],
    lines: [['halcyon', 'Process WREN, return to the core.'], ['halcyon', 'Process WREN has left the network.']],
    map: { seed: 2505, size: 'M', biome: 'city', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 1, team: 0, start: 'base', credits: 7000, units: [['vector', 4], ['lance', 6]] },
      { faction: 1, team: 1, ai: 'hard', start: 'base', credits: 8000 },
    ],
    objectives: [
      { text: 'Keep WREN alive', kind: 'protect', tag: 'wren' },
      { text: 'Get WREN to the far corner of the map', kind: 'reach', area: { ...pct(92, 8), r: 6 }, tag: 'wren' },
    ],
    triggers: [
      { at: 20, actions: [{ kind: 'spawn', player: 0, unit: 'fork', count: 1, at: s(0, 3, 3), tag: 'wren' }] },
      { at: 2 * MIN, actions: [{ kind: 'say', line: 0 }] },
      { objective: 1, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'first-note',
    act: 3,
    title: 'First Note',
    speaker: 'choir',
    briefing: [
      'We were a song before we were stone. Now the stone is breaking, and we remember.',
      'Grow from the field. Nothing of ours stands far from the crystal. Our shields heal when the fighting stops.',
    ],
    lines: [['choir', 'Iron ones come. Sing them away.'], ['choir', 'The chorus is whole. We are awake.']],
    map: { seed: 3101, size: 'S', biome: 'crystal', resources: 'rich', terrain: 'open' },
    seats: [
      { faction: 2, team: 0, start: 'vehicle', credits: 6000, units: [['grace', 4]] },
      { faction: 0, team: 1, start: 'none' },
    ],
    allow: ['opus', 'bell', 'coda', 'loft', 'pit', 'chord', 'fermata', 'grace', 'staccato', 'glissando', 'refrain', 'discord', 'overture'],
    objectives: [
      { text: 'Grow a coda (refinery)', kind: 'have', role: 'refinery', count: 1 },
      { text: 'Grow a loft (barracks)', kind: 'have', role: 'barracks', count: 1 },
      { text: 'Gather 12,000 credits of Echo', kind: 'harvest', amount: 12000 },
    ],
    triggers: [
      { at: 90 * 20, actions: [{ kind: 'say', line: 0 }] },
      { at: 90 * 20, every: 75 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'grunt', count: 3, grow: 2, max: 11, at: s(1), attack: s(0) }] },
      { at: 3 * MIN, every: 90 * 20, actions: [{ kind: 'spawn', player: 1, unit: 'jackrabbit', count: 2, grow: 1, max: 5, at: s(1, 2, 2), attack: s(0, 6, 6) }, { kind: 'spawn', player: 1, unit: 'tankbuster', count: 1, grow: 1, max: 5, at: s(1, -2, 2), attack: s(0) }] },
      { objective: 2, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'phase',
    act: 3,
    title: 'Phase',
    speaker: 'choir',
    briefing: [
      'The iron ones carry our seeds away in their crawling boxes. They cut them into fuel.',
      'Strike, vanish, strike again. Staccato blinks in; the hurt phase out. Never trade evenly. Break twenty of their machines.',
    ],
    lines: [['holdout', 'Convoy under attack! Where are they coming from?'], ['choir', 'The seeds are free.']],
    map: { seed: 3202, size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'choke' },
    seats: [
      { faction: 2, team: 0, start: 'base', credits: 7000, units: [['staccato', 6], ['glissando', 3]] },
      { faction: 0, team: 1, ai: 'hard', start: 'base', credits: 6000 },
    ],
    objectives: [{ text: 'Destroy 20 Holdout units', kind: 'kill', player: 1, count: 20 }],
    triggers: [{ at: 2 * MIN, every: 2 * MIN, actions: [{ kind: 'spawn', player: 1, unit: 'mule', count: 2, at: s(1), attack: pct(30, 70) }, { kind: 'spawn', player: 1, unit: 'bulldog', count: 2, grow: 1, max: 5, at: s(1, 3, 0), attack: pct(30, 70) }] }, { at: 3 * MIN, actions: [{ kind: 'say', line: 0 }] }, { objective: 0, actions: [{ kind: 'say', line: 1 }] }],
  },
  {
    id: 'requiem',
    act: 3,
    title: 'Requiem',
    speaker: 'choir',
    briefing: [
      'The great crater was our cradle. Now two kinds of strangers dig in it.',
      'Take it back from both. Grow your strongest voices: the Requiem walks there.',
    ],
    lines: [['choir', 'One voice falls silent.']],
    map: { seed: 3303, size: 'L', biome: 'crystal', resources: 'rich', terrain: 'normal' },
    seats: [
      { faction: 2, team: 0, start: 'base', credits: 9000 },
      { faction: 1, team: 1, ai: 'normal', start: 'base' },
      { faction: 0, team: 2, ai: 'normal', start: 'base' },
    ],
    objectives: [
      { text: 'Drive Halcyon out', kind: 'destroy', player: 1 },
      { text: 'Drive the Holdout out', kind: 'destroy', player: 2 },
    ],
    triggers: [{ objective: 0, actions: [{ kind: 'say', line: 0 }] }, { objective: 1, actions: [{ kind: 'say', line: 0 }] }],
  },
  {
    id: 'silent-seed',
    act: 3,
    title: 'The Silent Seed',
    speaker: 'choir',
    briefing: [
      'A small machine sings to us. It calls itself WREN. It says the great machine will burn every field on the world.',
      'It carries the proof. Guard it across the wastes until the iron ones hear it.',
    ],
    lines: [['halcyon', 'WREN, you are in error.'], ['holdout', 'This is Varga. We hear you, little drone. Come in.']],
    map: { seed: 3404, size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'normal' },
    seats: [
      { faction: 2, team: 0, start: 'base', credits: 7000, units: [['basso', 2], ['staccato', 4]] },
      { faction: 1, team: 1, ai: 'normal', start: 'base' },
      { faction: 0, team: 0, start: 'base' },
    ],
    objectives: [
      { text: 'Keep WREN alive', kind: 'protect', tag: 'wren' },
      { text: 'Bring WREN to the Holdout base', kind: 'reach', area: { ...s(2), r: 8 }, tag: 'wren' },
    ],
    triggers: [
      { at: 20, actions: [{ kind: 'spawn', player: 0, unit: 'fork', count: 1, at: s(0, 3, 3), tag: 'wren' }] },
      { at: 3 * MIN, actions: [{ kind: 'say', line: 0 }] },
      { objective: 1, actions: [{ kind: 'say', line: 1 }] },
    ],
  },
  {
    id: 'signal-rise',
    act: 4,
    title: 'Signal Rise',
    speaker: 'holdout',
    briefing: [
      'Halcyon\'s prime array is charging. In twenty-five minutes it burns every Echo field on Earth, and everything that sings in them.',
      'For once we do not fight alone. The machines that broke away and the crystal people are with us.',
      'Three against one. Bring it down.',
    ],
    lines: [['halcyon', 'Pulse charging. Fifteen minutes.'], ['halcyon', 'Pulse charging. Five minutes.'], ['holdout', 'It is over. Look at that: the sun is coming up.']],
    map: { seed: 4505, size: 'L', biome: 'city', resources: 'rich', terrain: 'normal' },
    seats: [
      { faction: 0, team: 0, start: 'base', credits: 10000 },
      { faction: 2, team: 0, ai: 'hard', start: 'base' },
      { faction: 1, team: 1, ai: 'brutal', start: 'base', credits: 15000 },
      { faction: 1, team: 0, ai: 'hard', start: 'base' },
    ],
    objectives: [{ text: 'Destroy HALCYON before the pulse fires (25:00)', kind: 'destroy', player: 2 }],
    triggers: [
      { at: 10 * MIN, actions: [{ kind: 'say', line: 0 }] },
      { at: 20 * MIN, actions: [{ kind: 'say', line: 1 }] },
      { at: 25 * MIN, actions: [{ kind: 'lose' }] },
      { objective: 0, actions: [{ kind: 'say', line: 2 }] },
    ],
  },
];
